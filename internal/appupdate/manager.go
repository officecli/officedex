// Package appupdate manages OfficeDex desktop app self-update.
//
// Distinct from internal/runtime (which manages the bundled officecli
// CLI binary), appupdate polls a JSON manifest hosted at a configurable
// URL describing the latest desktop app release, including per-platform
// assets, SHA-256 checksums, release notes, and a mandatory-update flag.
//
// Manifest shape (camelCase JSON):
//
//	{
//	  "version": "0.2.0",
//	  "notes": "Bug fixes and a new template gallery.",
//	  "minSupportedVersion": "0.1.0",
//	  "mandatory": false,
//	  "publishedAt": "2026-05-22T08:00:00Z",
//	  "assets": {
//	    "darwin-arm64": { "url": "https://.../OfficeDex-0.2.0-arm64.dmg", "sha256": "abc...", "size": 12345 },
//	    "darwin-amd64": { ... },
//	    "windows-amd64": { ... }
//	  }
//	}
//
// IsMandatory reports the union of two conditions:
//
//   - manifest.mandatory == true (server forces this release on everyone),
//   - currentVersion < manifest.minSupportedVersion (server retires older
//     versions; useful for protocol breaks).
//
// Style follows internal/runtime: nil-safe options, single-listener
// callback, camelCase JSON, atomic .part-then-rename downloads.
package appupdate

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	goruntime "runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	fetchManifestTimeout = 15 * time.Second
	fetchDownloadTimeout = 5 * time.Minute
	progressChunkBytes   = 256 * 1024
	userAgent            = "officedex-app-update"
)

// EventType discriminates AppUpdateEvent.
type EventType string

const (
	EventStatus     EventType = "status"
	EventProgress   EventType = "progress"
	EventDownloaded EventType = "downloaded"
	EventInstalled  EventType = "installed"
	EventError      EventType = "error"
)

// Asset describes one platform-specific download in the manifest.
type Asset struct {
	URL    string `json:"url"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

// ReleaseInfo is the parsed manifest result.
type ReleaseInfo struct {
	Version             string           `json:"version"`
	Notes               string           `json:"notes"`
	MinSupportedVersion string           `json:"minSupportedVersion"`
	Mandatory           bool             `json:"mandatory"`
	PublishedAt         string           `json:"publishedAt,omitempty"`
	Assets              map[string]Asset `json:"assets"`
}

// AssetFor returns the asset matching this manager's platform-arch key,
// or false when the manifest omits the current platform.
func (r *ReleaseInfo) AssetFor(platform, arch string) (Asset, bool) {
	if r == nil || r.Assets == nil {
		return Asset{}, false
	}
	a, ok := r.Assets[platformKey(platform, arch)]
	return a, ok
}

// Status is the renderer-facing snapshot of the manager state.
type Status struct {
	CurrentVersion  string  `json:"currentVersion"`
	LatestVersion   *string `json:"latestVersion"`
	UpdateAvailable bool    `json:"updateAvailable"`
	Mandatory       bool    `json:"mandatory"`
	Downloading     bool    `json:"downloading"`
	DownloadedPath  *string `json:"downloadedPath"`
	LastCheckedAt   *string `json:"lastCheckedAt"`
	LastError       *string `json:"lastError"`
	Notes           string  `json:"notes,omitempty"`
	// LastErrors keeps the most recent CheckLatest failures (newest last) so
	// the Settings → Diagnostics panel can render a timeline. The buffer is
	// capped at maxErrorHistory.
	LastErrors []ErrorEntry `json:"lastErrors,omitempty"`
}

// ErrorEntry records a single CheckLatest failure for the Diagnostics panel.
// LatencyMs is the wall-clock time fetchManifest spent before failing.
type ErrorEntry struct {
	Timestamp   string `json:"timestamp"`
	ManifestURL string `json:"manifestUrl"`
	Message     string `json:"message"`
	LatencyMs   int64  `json:"latencyMs"`
}

const maxErrorHistory = 5

// Event is the value emitted on every state transition.
type Event struct {
	Type           EventType `json:"type"`
	Status         *Status   `json:"status,omitempty"`
	Release        *ReleaseInfo `json:"release,omitempty"`
	BytesDone      *int64    `json:"bytesDone,omitempty"`
	BytesTotal     *int64    `json:"bytesTotal,omitempty"`
	Message        string    `json:"message,omitempty"`
	DownloadedPath string    `json:"downloadedPath,omitempty"`
}

// FetchFunc fetches a URL and returns the response body. Implementations
// must honour ctx.
type FetchFunc func(ctx context.Context, url string) ([]byte, error)

// DownloadFunc opens a streaming download. The returned reader is closed
// by the manager.
type DownloadFunc func(ctx context.Context, url string) (io.ReadCloser, int64, error)

// Options configures a Manager.
type Options struct {
	ManifestURL    string
	CurrentVersion string
	UpdatesDir     string // <userDataDir>/updates
	Platform       string // empty = auto-detect via runtime.GOOS
	Arch           string // empty = auto-detect via runtime.GOARCH
	FetchManifest  FetchFunc
	FetchDownload  DownloadFunc
	// HTTPClient drives the default manifest+download fetchers. nil falls
	// back to http.DefaultClient. Ignored when FetchManifest/FetchDownload
	// are supplied explicitly (tests typically set those instead).
	HTTPClient *http.Client
	Now        func() time.Time
	Listener   func(Event)
}

// Manager owns the lifecycle of self-update polling, download, and
// install hand-off. Safe for concurrent use.
type Manager struct {
	manifestURL    string
	currentVersion string
	updatesDir     string
	platform       string
	arch           string
	fetchManifest  FetchFunc
	fetchDownload  DownloadFunc
	now            func() time.Time
	listener       func(Event)

	mu             sync.Mutex
	latestVersion  *string
	latestRelease  *ReleaseInfo
	lastCheckedAt  *string
	lastError      *string
	lastErrors     []ErrorEntry
	downloading    bool
	downloadedPath *string
	cancel         context.CancelFunc
}

// New validates options and returns a ready-to-use Manager.
func New(opts Options) (*Manager, error) {
	if strings.TrimSpace(opts.ManifestURL) == "" {
		return nil, errors.New("appupdate: ManifestURL is required")
	}
	if strings.TrimSpace(opts.CurrentVersion) == "" {
		return nil, errors.New("appupdate: CurrentVersion is required")
	}
	if strings.TrimSpace(opts.UpdatesDir) == "" {
		return nil, errors.New("appupdate: UpdatesDir is required")
	}
	platform := opts.Platform
	if platform == "" {
		platform = goruntime.GOOS
	}
	arch := opts.Arch
	if arch == "" {
		arch = goruntime.GOARCH
	}
	fetchManifest := opts.FetchManifest
	if fetchManifest == nil {
		fetchManifest = newDefaultFetchManifest(opts.HTTPClient)
	}
	fetchDownload := opts.FetchDownload
	if fetchDownload == nil {
		fetchDownload = newDefaultFetchDownload(opts.HTTPClient)
	}
	now := opts.Now
	if now == nil {
		now = time.Now
	}
	return &Manager{
		manifestURL:    opts.ManifestURL,
		currentVersion: opts.CurrentVersion,
		updatesDir:     opts.UpdatesDir,
		platform:       platform,
		arch:           arch,
		fetchManifest:  fetchManifest,
		fetchDownload:  fetchDownload,
		now:            now,
		listener:       opts.Listener,
	}, nil
}

// Status returns a snapshot of the manager's public state.
func (m *Manager) Status() Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.statusLocked()
}

func (m *Manager) statusLocked() Status {
	notes := ""
	if m.latestRelease != nil {
		notes = m.latestRelease.Notes
	}
	updateAvailable := m.latestVersion != nil && CompareSemver(*m.latestVersion, m.currentVersion) > 0
	mandatory := false
	if updateAvailable && m.latestRelease != nil {
		mandatory = IsMandatory(m.latestRelease, m.currentVersion)
	}
	var errs []ErrorEntry
	if len(m.lastErrors) > 0 {
		errs = append(errs, m.lastErrors...)
	}
	return Status{
		CurrentVersion:  m.currentVersion,
		LatestVersion:   m.latestVersion,
		UpdateAvailable: updateAvailable,
		Mandatory:       mandatory,
		Downloading:     m.downloading,
		DownloadedPath:  m.downloadedPath,
		LastCheckedAt:   m.lastCheckedAt,
		LastError:       m.lastError,
		Notes:           notes,
		LastErrors:      errs,
	}
}

// CheckLatest queries the manifest URL and updates the cached release.
// When currentVersion is the "dev" sentinel (wails dev / go run), the
// network call is skipped and a not-available snapshot is returned so
// developers don't see spurious update banners.
func (m *Manager) CheckLatest(ctx context.Context) (*ReleaseInfo, error) {
	if strings.TrimSpace(m.currentVersion) == "dev" {
		m.mu.Lock()
		m.lastError = nil
		ts := m.now().UTC().Format(time.RFC3339Nano)
		m.lastCheckedAt = &ts
		status := m.statusLocked()
		m.mu.Unlock()
		m.emit(Event{Type: EventStatus, Status: &status})
		return nil, nil
	}
	m.mu.Lock()
	m.lastError = nil
	url := m.manifestURL
	m.mu.Unlock()

	start := m.now()
	body, err := m.fetchManifest(ctx, url)
	latency := m.now().Sub(start)
	if err != nil {
		return nil, m.failCheck(fmt.Errorf("fetch manifest: %w", err), url, latency)
	}
	var release ReleaseInfo
	if err := json.Unmarshal(body, &release); err != nil {
		return nil, m.failCheck(fmt.Errorf("parse manifest: %w", err), url, latency)
	}
	if strings.TrimSpace(release.Version) == "" {
		return nil, m.failCheck(errors.New("manifest missing version"), url, latency)
	}

	m.mu.Lock()
	version := release.Version
	m.latestVersion = &version
	m.latestRelease = &release
	ts := m.now().UTC().Format(time.RFC3339Nano)
	m.lastCheckedAt = &ts
	// Stale downloadedPath: if cached path version differs from latest,
	// drop it so the renderer re-downloads.
	if m.downloadedPath != nil && !strings.Contains(*m.downloadedPath, string(filepath.Separator)+release.Version+string(filepath.Separator)) {
		m.downloadedPath = nil
	}
	status := m.statusLocked()
	m.mu.Unlock()
	m.emit(Event{Type: EventStatus, Status: &status, Release: &release})
	return &release, nil
}

func (m *Manager) failCheck(err error, manifestURL string, latency time.Duration) error {
	msg := err.Error()
	m.mu.Lock()
	m.lastError = &msg
	ts := m.now().UTC().Format(time.RFC3339Nano)
	m.lastCheckedAt = &ts
	entry := ErrorEntry{
		Timestamp:   ts,
		ManifestURL: manifestURL,
		Message:     msg,
		LatencyMs:   latency.Milliseconds(),
	}
	m.lastErrors = append(m.lastErrors, entry)
	if len(m.lastErrors) > maxErrorHistory {
		m.lastErrors = m.lastErrors[len(m.lastErrors)-maxErrorHistory:]
	}
	status := m.statusLocked()
	m.mu.Unlock()
	m.emit(Event{Type: EventStatus, Status: &status})
	m.emit(Event{Type: EventError, Message: msg})
	return err
}

// DownloadUpdate fetches the asset for the current platform, verifies its
// sha256, and atomically renames the .part file. Returns the absolute path
// to the verified file. Second invocations after a successful download
// short-circuit and return the cached path without re-downloading.
func (m *Manager) DownloadUpdate(ctx context.Context) (string, error) {
	m.mu.Lock()
	if m.downloading {
		m.mu.Unlock()
		return "", errors.New("appupdate: download already in progress")
	}
	if m.latestRelease == nil {
		m.mu.Unlock()
		return "", errors.New("appupdate: no release info; call CheckLatest first")
	}
	release := *m.latestRelease
	if m.downloadedPath != nil {
		// Verify cached path is still on disk for the same version.
		expectedDir := filepath.Join(m.updatesDir, release.Version)
		if strings.HasPrefix(*m.downloadedPath, expectedDir+string(filepath.Separator)) {
			if _, err := os.Stat(*m.downloadedPath); err == nil {
				path := *m.downloadedPath
				m.mu.Unlock()
				return path, nil
			}
		}
		m.downloadedPath = nil
	}
	asset, ok := release.AssetFor(m.platform, m.arch)
	if !ok {
		m.mu.Unlock()
		return "", fmt.Errorf("appupdate: no asset for %s", platformKey(m.platform, m.arch))
	}
	if strings.TrimSpace(asset.URL) == "" {
		m.mu.Unlock()
		return "", errors.New("appupdate: asset url is empty")
	}
	m.downloading = true
	m.lastError = nil
	downloadCtx, cancel := context.WithCancel(ctx)
	m.cancel = cancel
	updatesDir := m.updatesDir
	version := release.Version
	status := m.statusLocked()
	m.mu.Unlock()
	m.emit(Event{Type: EventStatus, Status: &status})

	finalPath, err := m.runDownload(downloadCtx, updatesDir, version, asset)

	m.mu.Lock()
	m.downloading = false
	if m.cancel != nil {
		m.cancel = nil
	}
	if err != nil {
		msg := err.Error()
		m.lastError = &msg
	} else {
		m.downloadedPath = &finalPath
	}
	status = m.statusLocked()
	m.mu.Unlock()

	if err != nil {
		m.emit(Event{Type: EventStatus, Status: &status})
		m.emit(Event{Type: EventError, Message: err.Error()})
		return "", err
	}
	m.emit(Event{Type: EventStatus, Status: &status})
	m.emit(Event{Type: EventDownloaded, DownloadedPath: finalPath})
	return finalPath, nil
}

func (m *Manager) runDownload(ctx context.Context, updatesDir, version string, asset Asset) (string, error) {
	versionDir := filepath.Join(updatesDir, version)
	if err := os.MkdirAll(versionDir, 0o755); err != nil {
		return "", fmt.Errorf("mkdir version dir: %w", err)
	}
	fileName := assetFileName(asset.URL)
	finalPath := filepath.Join(versionDir, fileName)
	tmpPath := finalPath + ".part"

	stream, totalSize, err := m.fetchDownload(ctx, asset.URL)
	if err != nil {
		return "", fmt.Errorf("open download: %w", err)
	}
	defer stream.Close()
	if totalSize <= 0 {
		totalSize = asset.Size
	}

	out, err := os.Create(tmpPath)
	if err != nil {
		return "", fmt.Errorf("create tmp file: %w", err)
	}
	hasher := sha256.New()
	mw := io.MultiWriter(out, hasher)

	var bytesDone int64
	buf := make([]byte, 64*1024)
	nextEmit := int64(progressChunkBytes)
	for {
		if err := ctx.Err(); err != nil {
			_ = out.Close()
			_ = os.Remove(tmpPath)
			return "", err
		}
		n, readErr := stream.Read(buf)
		if n > 0 {
			if _, werr := mw.Write(buf[:n]); werr != nil {
				_ = out.Close()
				_ = os.Remove(tmpPath)
				return "", fmt.Errorf("write: %w", werr)
			}
			bytesDone += int64(n)
			if bytesDone >= nextEmit {
				m.emitProgress(bytesDone, totalSize)
				nextEmit = bytesDone + progressChunkBytes
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			_ = out.Close()
			_ = os.Remove(tmpPath)
			return "", fmt.Errorf("read: %w", readErr)
		}
	}
	if err := out.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return "", fmt.Errorf("close tmp: %w", err)
	}
	m.emitProgress(bytesDone, totalSize)

	if expected := strings.ToLower(strings.TrimSpace(asset.SHA256)); expected != "" {
		got := hex.EncodeToString(hasher.Sum(nil))
		if got != expected {
			_ = os.Remove(tmpPath)
			return "", errors.New("appupdate: checksum mismatch")
		}
	}
	if err := os.Rename(tmpPath, finalPath); err != nil {
		_ = os.Remove(tmpPath)
		return "", fmt.Errorf("rename: %w", err)
	}
	return finalPath, nil
}

func (m *Manager) emitProgress(done, total int64) {
	doneCopy := done
	var totalPtr *int64
	if total > 0 {
		t := total
		totalPtr = &t
	}
	m.emit(Event{Type: EventProgress, BytesDone: &doneCopy, BytesTotal: totalPtr})
}

// CancelDownload aborts any in-flight download. Safe to call when no
// download is running.
func (m *Manager) CancelDownload() {
	m.mu.Lock()
	c := m.cancel
	m.mu.Unlock()
	if c != nil {
		c()
	}
}

// DownloadedPath returns the cached download path (or nil).
func (m *Manager) DownloadedPath() *string {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.downloadedPath == nil {
		return nil
	}
	v := *m.downloadedPath
	return &v
}

// LatestRelease returns the most recently fetched manifest (or nil).
func (m *Manager) LatestRelease() *ReleaseInfo {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.latestRelease == nil {
		return nil
	}
	r := *m.latestRelease
	return &r
}

// MarkInstalled emits an installed event. The caller (Wails binding) is
// responsible for actually launching the installer / quitting the app.
func (m *Manager) MarkInstalled(version string) {
	m.emit(Event{Type: EventInstalled, Message: version})
}

func (m *Manager) emit(event Event) {
	if m.listener != nil {
		m.listener(event)
	}
}

// CompareSemver returns -1, 0, or 1 for a vs b. Non-numeric or empty
// strings are treated as 0; missing segments are padded with zero.
// Pre-release suffixes (anything after '-') are ignored.
func CompareSemver(a, b string) int {
	pa := parseSemver(a)
	pb := parseSemver(b)
	for i := 0; i < 3; i++ {
		if pa[i] < pb[i] {
			return -1
		}
		if pa[i] > pb[i] {
			return 1
		}
	}
	return 0
}

func parseSemver(v string) [3]int {
	var out [3]int
	trimmed := strings.TrimPrefix(strings.TrimSpace(v), "v")
	if i := strings.IndexAny(trimmed, "-+"); i >= 0 {
		trimmed = trimmed[:i]
	}
	parts := strings.Split(trimmed, ".")
	for i := 0; i < 3 && i < len(parts); i++ {
		n, _ := strconv.Atoi(strings.TrimSpace(parts[i]))
		if n < 0 {
			n = 0
		}
		out[i] = n
	}
	return out
}

// IsMandatory reports whether the release should force-update the user.
// Either the manifest's `mandatory` flag is true, or the current version
// is below minSupportedVersion.
func IsMandatory(release *ReleaseInfo, currentVersion string) bool {
	if release == nil {
		return false
	}
	if release.Mandatory {
		return true
	}
	if strings.TrimSpace(release.MinSupportedVersion) == "" {
		return false
	}
	return CompareSemver(currentVersion, release.MinSupportedVersion) < 0
}

func platformKey(platform, arch string) string {
	return platform + "-" + arch
}

func assetFileName(rawURL string) string {
	idx := strings.LastIndex(rawURL, "/")
	if idx < 0 || idx == len(rawURL)-1 {
		return "update.bin"
	}
	name := rawURL[idx+1:]
	if q := strings.Index(name, "?"); q >= 0 {
		name = name[:q]
	}
	// Strip any directory segments the server might have squeezed past the
	// final '/'. filepath.Base on the cleaned form prevents '..' or absolute
	// paths from escaping versionDir when joined.
	name = filepath.Base(name)
	if name == "" || name == "." || name == ".." || name == string(filepath.Separator) {
		return "update.bin"
	}
	return name
}

func defaultFetchManifest(ctx context.Context, target string) ([]byte, error) {
	return newDefaultFetchManifest(nil)(ctx, target)
}

func newDefaultFetchManifest(client *http.Client) FetchFunc {
	if client == nil {
		client = http.DefaultClient
	}
	return func(ctx context.Context, target string) ([]byte, error) {
		reqCtx, cancel := context.WithTimeout(ctx, fetchManifestTimeout)
		defer cancel()
		req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, target, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("User-Agent", userAgent)
		req.Header.Set("Accept", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return nil, fmt.Errorf("manifest request: status %d", resp.StatusCode)
		}
		body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		if err != nil {
			return nil, err
		}
		return body, nil
	}
}

func defaultFetchDownload(ctx context.Context, target string) (io.ReadCloser, int64, error) {
	return newDefaultFetchDownload(nil)(ctx, target)
}

func newDefaultFetchDownload(client *http.Client) DownloadFunc {
	if client == nil {
		client = http.DefaultClient
	}
	return func(ctx context.Context, target string) (io.ReadCloser, int64, error) {
		reqCtx, cancel := context.WithTimeout(ctx, fetchDownloadTimeout)
		req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, target, nil)
		if err != nil {
			cancel()
			return nil, 0, err
		}
		req.Header.Set("User-Agent", userAgent)
		resp, err := client.Do(req)
		if err != nil {
			cancel()
			return nil, 0, err
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			resp.Body.Close()
			cancel()
			return nil, 0, fmt.Errorf("download request: status %d", resp.StatusCode)
		}
		return &cancelReader{ReadCloser: resp.Body, cancel: cancel}, resp.ContentLength, nil
	}
}

type cancelReader struct {
	io.ReadCloser
	cancel context.CancelFunc
}

func (c *cancelReader) Close() error {
	err := c.ReadCloser.Close()
	if c.cancel != nil {
		c.cancel()
		c.cancel = nil
	}
	return err
}
