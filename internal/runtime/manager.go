// Package runtime is the Go port of src/main/runtimeManager.ts.
//
// The original TypeScript source has been lost; this implementation is reverse
// engineered from dist-electron/main/runtimeManager.js (387 lines of compiled
// output). Behaviour matches that artifact unless noted in comments.
//
// Style conventions follow the settings package:
//
//   - Optional dependencies are injected through ManagerOptions; nil values get
//     reasonable defaults so callers can pass a zero options struct in tests.
//   - Listener is a single function callback rather than the Node EventEmitter
//     surface; it is invoked synchronously for every state transition.
//   - All on-disk JSON shapes use camelCase to match the renderer.
//   - Context replaces AbortController: the manager stores a cancel func and
//     CancelDownload triggers it.
package runtime

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"sync"
	"time"

	"officedex/internal/types"
)

// Timeouts mirror the FETCH_* constants in the JS source.
const (
	FetchJSONTimeoutMs        = 15 * time.Second
	FetchDownloadTimeoutMs    = 60 * time.Second
	FetchDownloadSocketIdleMs = 60 * time.Second
)

const (
	userAgent    = "officedex-runtime-manager"
	maxRedirects = 5
)

// FetchJSONFunc fetches a URL and returns the raw response body. Implementations
// must honour ctx for cancellation and timeout.
type FetchJSONFunc func(ctx context.Context, url string) ([]byte, error)

// FetchDownload is the streaming form used for binary downloads.
type FetchDownload struct {
	Stream io.ReadCloser
	Size   int64
}

// FetchDownloadFunc opens a streaming download. Implementations must honour ctx
// and close the stream when the caller is done with it.
type FetchDownloadFunc func(ctx context.Context, url string) (*FetchDownload, error)

// LatestRelease is the resolved result of CheckLatestVersion.
type LatestRelease struct {
	Version   string `json:"version"`
	AssetURL  string `json:"assetUrl"`
	AssetName string `json:"assetName"`
	Size      int64  `json:"size"`
}

// ManagerOptions configures a Manager. InstallRoot and Repo are required.
type ManagerOptions struct {
	InstallRoot   string
	Repo          string
	Platform      string
	Arch          string
	FetchJSON     FetchJSONFunc
	FetchDownload FetchDownloadFunc
	// HTTPClient drives the default fetchers. nil falls back to the
	// std-lib defaults. Ignored when FetchJSON/FetchDownload are set.
	HTTPClient *http.Client
	Now        func() time.Time
	Listener   func(types.RuntimeEvent)
}

// Manager owns the lifecycle of the officecli binary under InstallRoot. It
// queries GitHub Releases for new versions and atomically installs goreleaser
// archive assets named `officecli_<version>_<os>_<arch>.tar.gz`. The
// `officecli` (or `officecli.exe`) binary is extracted from the archive into
// InstallRoot.
type Manager struct {
	installRoot   string
	repo          string
	platform      string
	arch          string
	fetchJSON     FetchJSONFunc
	fetchDownload FetchDownloadFunc
	now           func() time.Time
	listener      func(types.RuntimeEvent)

	mu             sync.Mutex
	installed      bool
	currentVersion *string
	latestVersion  *string
	lastCheckedAt  *string
	manualPath     *string
	updating       bool
	lastError      *string
	cancel         context.CancelFunc
}

// New validates options and returns a ready-to-use Manager.
func New(opts ManagerOptions) (*Manager, error) {
	if strings.TrimSpace(opts.InstallRoot) == "" {
		return nil, errors.New("runtime: InstallRoot is required")
	}
	if strings.TrimSpace(opts.Repo) == "" {
		return nil, errors.New("runtime: Repo is required")
	}
	platform := opts.Platform
	if platform == "" {
		platform = mapGoosToNode(goruntime.GOOS)
	}
	arch := opts.Arch
	if arch == "" {
		arch = mapGoarchToNode(goruntime.GOARCH)
	}
	fetchJSON := opts.FetchJSON
	if fetchJSON == nil {
		fetchJSON = newDefaultFetchJSON(opts.HTTPClient)
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
		installRoot:   opts.InstallRoot,
		repo:          opts.Repo,
		platform:      platform,
		arch:          arch,
		fetchJSON:     fetchJSON,
		fetchDownload: fetchDownload,
		now:           now,
		listener:      opts.Listener,
	}, nil
}

// Status returns a snapshot of the manager's public state.
func (m *Manager) Status() types.RuntimeStatus {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.statusLocked()
}

// SetRepo updates the GitHub repo used for release lookups.
func (m *Manager) SetRepo(repo string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.repo = repo
}

// LoadFromDisk reads version.json and verifies the managed binary still exists.
// Any error or inconsistency leaves the manager in the not-installed state.
func (m *Manager) LoadFromDisk() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	data, err := os.ReadFile(m.versionFilePathLocked())
	if err != nil {
		m.installed = false
		m.currentVersion = nil
		return nil
	}
	var parsed struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(data, &parsed); err != nil || parsed.Version == "" {
		m.installed = false
		m.currentVersion = nil
		return nil
	}
	binaryPath := m.managedBinaryPathLocked()
	if _, err := os.Stat(binaryPath); err != nil {
		m.installed = false
		m.currentVersion = nil
		return nil
	}
	m.installed = true
	v := parsed.Version
	m.currentVersion = &v
	return nil
}

// SetManualPath records a user-selected binary path. An empty/whitespace string
// clears the manual override.
func (m *Manager) SetManualPath(filePath string) types.RuntimeStatus {
	m.mu.Lock()
	trimmed := strings.TrimSpace(filePath)
	if trimmed == "" {
		m.manualPath = nil
	} else {
		m.manualPath = &trimmed
	}
	status := m.statusLocked()
	m.mu.Unlock()
	m.emit(types.RuntimeEvent{Type: types.RuntimeEventStatus, Status: &status})
	return status
}

// ResolveBinaryPath returns the active binary path: manual override wins, then
// the managed install, then nil.
func (m *Manager) ResolveBinaryPath() *string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.resolveBinaryPathLocked()
}

// CheckLatestVersion queries GitHub Releases for the latest tag and the asset
// matching the goreleaser naming convention. It updates latestVersion +
// lastCheckedAt and emits status/error events. Returns nil on failure (error
// info available via the status event).
func (m *Manager) CheckLatestVersion(ctx context.Context) (*LatestRelease, error) {
	m.mu.Lock()
	m.lastError = nil
	repo := m.repo
	m.mu.Unlock()

	m.emit(types.RuntimeEvent{
		Type:    types.RuntimeEventProgress,
		Phase:   types.RuntimePhaseChecking,
		Message: "Checking latest release",
	})

	apiURL := fmt.Sprintf("https://api.github.com/repos/%s/releases/latest", repo)
	body, err := m.fetchJSON(ctx, apiURL)
	if err != nil {
		return nil, m.failCheck(err)
	}
	var raw struct {
		TagName string `json:"tag_name"`
		Assets  []struct {
			Name               string `json:"name"`
			BrowserDownloadURL string `json:"browser_download_url"`
			Size               int64  `json:"size"`
		} `json:"assets"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, m.failCheck(fmt.Errorf("parse release response: %w", err))
	}
	tag := strings.TrimSpace(raw.TagName)
	if tag == "" {
		return nil, m.failCheck(errors.New("Release response missing tag_name"))
	}
	m.mu.Lock()
	assetName := m.expectedAssetNameLocked(tag)
	m.mu.Unlock()
	var matched *struct {
		Name               string `json:"name"`
		BrowserDownloadURL string `json:"browser_download_url"`
		Size               int64  `json:"size"`
	}
	for i := range raw.Assets {
		if raw.Assets[i].Name == assetName {
			matched = &raw.Assets[i]
			break
		}
	}
	if matched == nil || matched.BrowserDownloadURL == "" {
		return nil, m.failCheck(fmt.Errorf("Release %s has no asset named %s", tag, assetName))
	}

	m.mu.Lock()
	m.latestVersion = &tag
	ts := m.now().UTC().Format(time.RFC3339Nano)
	m.lastCheckedAt = &ts
	status := m.statusLocked()
	m.mu.Unlock()
	m.emit(types.RuntimeEvent{Type: types.RuntimeEventStatus, Status: &status})

	return &LatestRelease{Version: tag, AssetURL: matched.BrowserDownloadURL, Size: matched.Size, AssetName: assetName}, nil
}

func (m *Manager) failCheck(err error) error {
	msg := err.Error()
	m.mu.Lock()
	m.lastError = &msg
	ts := m.now().UTC().Format(time.RFC3339Nano)
	m.lastCheckedAt = &ts
	status := m.statusLocked()
	m.mu.Unlock()
	m.emit(types.RuntimeEvent{Type: types.RuntimeEventStatus, Status: &status})
	m.emit(types.RuntimeEvent{Type: types.RuntimeEventError, Message: msg})
	return err
}

// DownloadAndInstall fetches the latest matching asset, writes it atomically to
// the managed binary path, and updates version.json. Calls are serialised: if
// an install is already in progress, returns the current status without doing
// anything.
func (m *Manager) DownloadAndInstall(ctx context.Context) (types.RuntimeStatus, error) {
	m.mu.Lock()
	if m.updating {
		status := m.statusLocked()
		m.mu.Unlock()
		return status, nil
	}
	m.updating = true
	m.lastError = nil
	installRoot := m.installRoot
	platform := m.platform
	arch := m.arch
	finalPath := m.managedBinaryPathLocked()
	versionFile := m.versionFilePathLocked()
	downloadCtx, cancel := context.WithCancel(ctx)
	m.cancel = cancel
	status := m.statusLocked()
	m.mu.Unlock()
	m.emit(types.RuntimeEvent{Type: types.RuntimeEventStatus, Status: &status})

	tmpDir := filepath.Join(installRoot, "tmp")
	var tmpFile string

	finish := func(installErr error) (types.RuntimeStatus, error) {
		m.mu.Lock()
		m.updating = false
		if m.cancel != nil {
			m.cancel = nil
		}
		if installErr != nil {
			msg := installErr.Error()
			m.lastError = &msg
		}
		status := m.statusLocked()
		m.mu.Unlock()
		if installErr != nil {
			if tmpFile != "" {
				_ = os.Remove(tmpFile)
			}
			_ = os.RemoveAll(tmpDir)
			m.emit(types.RuntimeEvent{Type: types.RuntimeEventStatus, Status: &status})
			m.emit(types.RuntimeEvent{Type: types.RuntimeEventError, Message: *status.LastError})
			return status, installErr
		}
		return status, nil
	}

	latest, err := m.CheckLatestVersion(downloadCtx)
	if err != nil {
		cancel()
		return finish(err)
	}
	assetName := latest.AssetName

	if err := os.MkdirAll(tmpDir, 0o755); err != nil {
		cancel()
		return finish(fmt.Errorf("mkdir tmp: %w", err))
	}
	tmpFile = filepath.Join(tmpDir, assetName+".partial")

	progressTotal := pointerInt64(latest.Size)
	m.emit(types.RuntimeEvent{
		Type:       types.RuntimeEventProgress,
		Phase:      types.RuntimePhaseDownloading,
		BytesTotal: progressTotal,
		Message:    "Downloading " + assetName,
	})

	download, err := m.fetchDownload(downloadCtx, latest.AssetURL)
	if err != nil {
		cancel()
		return finish(err)
	}
	defer download.Stream.Close()

	totalSize := download.Size
	if totalSize <= 0 {
		totalSize = latest.Size
	}

	out, err := os.Create(tmpFile)
	if err != nil {
		cancel()
		return finish(fmt.Errorf("create tmp file: %w", err))
	}
	bytesDone, copyErr := copyWithProgress(out, download.Stream, totalSize, func(done int64) {
		d := done
		var totalPtr *int64
		if totalSize > 0 {
			t := totalSize
			totalPtr = &t
		}
		m.emit(types.RuntimeEvent{
			Type:       types.RuntimeEventProgress,
			Phase:      types.RuntimePhaseDownloading,
			BytesDone:  &d,
			BytesTotal: totalPtr,
		})
	})
	_ = bytesDone
	if cerr := out.Close(); cerr != nil && copyErr == nil {
		copyErr = cerr
	}
	if copyErr != nil {
		cancel()
		return finish(copyErr)
	}

	m.emit(types.RuntimeEvent{
		Type:    types.RuntimeEventProgress,
		Phase:   types.RuntimePhaseInstalling,
		Message: "Installing binary",
	})

	if err := os.MkdirAll(installRoot, 0o755); err != nil {
		cancel()
		return finish(fmt.Errorf("mkdir install root: %w", err))
	}
	if err := extractOfficecliFromTarGz(tmpFile, finalPath, platform); err != nil {
		cancel()
		return finish(err)
	}
	_ = os.Remove(tmpFile)
	tmpFile = ""

	record := struct {
		Version     string `json:"version"`
		InstalledAt string `json:"installedAt"`
		Platform    string `json:"platform"`
		Arch        string `json:"arch"`
		AssetName   string `json:"assetName"`
	}{
		Version:     latest.Version,
		InstalledAt: m.now().UTC().Format(time.RFC3339Nano),
		Platform:    platform,
		Arch:        arch,
		AssetName:   assetName,
	}
	body, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		cancel()
		return finish(fmt.Errorf("marshal version record: %w", err))
	}
	body = append(body, '\n')
	if err := os.WriteFile(versionFile, body, 0o644); err != nil {
		cancel()
		return finish(fmt.Errorf("write version file: %w", err))
	}

	m.mu.Lock()
	m.installed = true
	v := latest.Version
	m.currentVersion = &v
	m.mu.Unlock()
	_ = os.RemoveAll(tmpDir)

	cancel()
	status, _ = finish(nil)
	m.emit(types.RuntimeEvent{Type: types.RuntimeEventStatus, Status: &status})
	m.emit(types.RuntimeEvent{Type: types.RuntimeEventInstalled, Version: latest.Version})
	return status, nil
}

// CancelDownload aborts any in-flight install. Safe to call when no install is
// running; it is a no-op in that case.
func (m *Manager) CancelDownload() {
	m.mu.Lock()
	c := m.cancel
	m.mu.Unlock()
	if c != nil {
		c()
	}
}

// ManagedBinaryPath returns the absolute path of the managed binary file
// (platform-aware, with .exe on Windows).
func (m *Manager) ManagedBinaryPath() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.managedBinaryPathLocked()
}

// VersionFilePath returns the absolute path of the on-disk version manifest.
func (m *Manager) VersionFilePath() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.versionFilePathLocked()
}

// ExpectedAssetName returns the GitHub Releases asset filename this manager
// expects for the given release tag and the configured platform/arch.
func (m *Manager) ExpectedAssetName(tag string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.expectedAssetNameLocked(tag)
}

func (m *Manager) statusLocked() types.RuntimeStatus {
	return types.RuntimeStatus{
		Installed:          m.installed,
		CurrentVersion:     m.currentVersion,
		LatestVersion:      m.latestVersion,
		LastCheckedAt:      m.lastCheckedAt,
		ManualPath:         m.manualPath,
		ResolvedBinaryPath: m.resolveBinaryPathLocked(),
		Updating:           m.updating,
		LastError:          m.lastError,
	}
}

func (m *Manager) resolveBinaryPathLocked() *string {
	if m.manualPath != nil {
		v := *m.manualPath
		return &v
	}
	if m.installed {
		v := m.managedBinaryPathLocked()
		return &v
	}
	return nil
}

func (m *Manager) managedBinaryPathLocked() string {
	name := "officecli"
	if m.platform == "win32" {
		name = "officecli.exe"
	}
	return filepath.Join(m.installRoot, name)
}

func (m *Manager) versionFilePathLocked() string {
	return filepath.Join(m.installRoot, "version.json")
}

func (m *Manager) expectedAssetNameLocked(tag string) string {
	platformKey := mapPlatform(m.platform)
	archKey := mapArch(m.arch)
	version := strings.TrimPrefix(strings.TrimSpace(tag), "v")
	return fmt.Sprintf("officecli_%s_%s_%s.tar.gz", version, platformKey, archKey)
}

func (m *Manager) emit(event types.RuntimeEvent) {
	if m.listener == nil {
		return
	}
	m.listener(event)
}

// extractOfficecliFromTarGz reads a goreleaser-produced tar.gz archive and
// copies the `officecli` (or `officecli.exe`) entry into outPath. The output
// file is created with 0o755 mode on POSIX so the binary is immediately
// executable. Returns an error if the archive does not contain the binary.
func extractOfficecliFromTarGz(archivePath, outPath, platform string) error {
	f, err := os.Open(archivePath)
	if err != nil {
		return fmt.Errorf("open archive: %w", err)
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return fmt.Errorf("gzip reader: %w", err)
	}
	defer gz.Close()
	binaryName := "officecli"
	if platform == "win32" {
		binaryName = "officecli.exe"
	}
	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return fmt.Errorf("tar next: %w", err)
		}
		if !hdr.FileInfo().Mode().IsRegular() {
			continue
		}
		if filepath.Base(hdr.Name) != binaryName {
			continue
		}
		out, err := os.OpenFile(outPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
		if err != nil {
			return fmt.Errorf("create binary: %w", err)
		}
		if _, err := io.Copy(out, tr); err != nil {
			out.Close()
			return fmt.Errorf("write binary: %w", err)
		}
		if err := out.Close(); err != nil {
			return fmt.Errorf("close binary: %w", err)
		}
		return nil
	}
	return fmt.Errorf("archive does not contain %s", binaryName)
}

func mapPlatform(platform string) string {
	switch platform {
	case "win32":
		return "windows"
	case "darwin", "linux":
		return platform
	default:
		return platform
	}
}

func mapArch(arch string) string {
	switch arch {
	case "x64":
		return "amd64"
	case "arm64":
		return arch
	default:
		return arch
	}
}

// mapGoosToNode converts Go's runtime.GOOS values to the Node-style identifiers
// the original TypeScript baked into expected asset names.
func mapGoosToNode(goos string) string {
	switch goos {
	case "windows":
		return "win32"
	default:
		return goos
	}
}

// mapGoarchToNode converts Go's runtime.GOARCH values to the Node-style ones.
func mapGoarchToNode(goarch string) string {
	switch goarch {
	case "amd64":
		return "x64"
	default:
		return goarch
	}
}

func pointerInt64(v int64) *int64 {
	if v <= 0 {
		return nil
	}
	out := v
	return &out
}

// copyWithProgress copies src to dst while invoking onProgress with the
// cumulative byte count. The onProgress callback fires after every chunk, just
// like the data event in the JS source.
func copyWithProgress(dst io.Writer, src io.Reader, _ int64, onProgress func(int64)) (int64, error) {
	buf := make([]byte, 32*1024)
	var total int64
	for {
		n, readErr := src.Read(buf)
		if n > 0 {
			if _, writeErr := dst.Write(buf[:n]); writeErr != nil {
				return total, writeErr
			}
			total += int64(n)
			if onProgress != nil {
				onProgress(total)
			}
		}
		if readErr != nil {
			if errors.Is(readErr, io.EOF) {
				return total, nil
			}
			return total, readErr
		}
	}
}

// AssertManualBinaryAccessible validates that a user-selected binary path can be
// executed. On Windows we check existence only (matching the JS source); on
// POSIX we additionally require the executable bit on the file mode.
func AssertManualBinaryAccessible(filePath string, platform string) error {
	if platform == "" {
		platform = mapGoosToNode(goruntime.GOOS)
	}
	info, err := os.Stat(filePath)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return fmt.Errorf("Selected file is not accessible: %s", filePath)
		}
		return fmt.Errorf("Selected file is not accessible: %s", filePath)
	}
	if info.IsDir() {
		return fmt.Errorf("Selected file is not accessible: %s", filePath)
	}
	if platform != "win32" {
		if info.Mode().Perm()&0o111 == 0 {
			return fmt.Errorf("Selected file is not accessible: %s", filePath)
		}
	}
	return nil
}

// defaultFetchJSON performs a GET request with redirect-following and a 15s
// context timeout, returning the raw body when the response is 2xx.
func defaultFetchJSON(ctx context.Context, target string) ([]byte, error) {
	return newDefaultFetchJSON(nil)(ctx, target)
}

func newDefaultFetchJSON(base *http.Client) FetchJSONFunc {
	client := jsonClientFrom(base)
	return func(ctx context.Context, target string) ([]byte, error) {
		c, cancel := context.WithTimeout(ctx, FetchJSONTimeoutMs)
		defer cancel()
		req, err := http.NewRequestWithContext(c, http.MethodGet, target, nil)
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
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			return nil, err
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			snippet := body
			if len(snippet) > 200 {
				snippet = snippet[:200]
			}
			return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(snippet))
		}
		return body, nil
	}
}

// defaultFetchDownload streams a GET response without loading it into memory.
// The caller is responsible for closing FetchDownload.Stream.
func defaultFetchDownload(ctx context.Context, target string) (*FetchDownload, error) {
	return newDefaultFetchDownload(nil)(ctx, target)
}

func newDefaultFetchDownload(base *http.Client) FetchDownloadFunc {
	client := downloadClientFrom(base)
	return func(ctx context.Context, target string) (*FetchDownload, error) {
		c, cancel := context.WithTimeout(ctx, FetchDownloadTimeoutMs)
		req, err := http.NewRequestWithContext(c, http.MethodGet, target, nil)
		if err != nil {
			cancel()
			return nil, err
		}
		req.Header.Set("User-Agent", userAgent)
		req.Header.Set("Accept", "application/octet-stream")
		resp, err := client.Do(req)
		if err != nil {
			cancel()
			return nil, err
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			resp.Body.Close()
			cancel()
			return nil, fmt.Errorf("HTTP %d downloading %s", resp.StatusCode, target)
		}
		size := resp.ContentLength
		if size < 0 {
			size = 0
		}
		return &FetchDownload{
			Stream: &cancellingReader{ReadCloser: resp.Body, cancel: cancel},
			Size:   size,
		}, nil
	}
}

// cancellingReader is a ReadCloser wrapper that cancels the parent context
// once the stream is closed. It keeps the download context alive while the
// caller is still reading.
type cancellingReader struct {
	io.ReadCloser
	cancel context.CancelFunc
	once   sync.Once
}

func (c *cancellingReader) Close() error {
	err := c.ReadCloser.Close()
	c.once.Do(c.cancel)
	return err
}

func jsonClient() *http.Client {
	return jsonClientFrom(nil)
}

// jsonClientFrom returns the small-body GET client used for manifest/release
// JSON. When base is non-nil, its Transport is reused so the proxy pool's
// ProxyFunc applies; otherwise we fall back to the std-lib default transport.
func jsonClientFrom(base *http.Client) *http.Client {
	if base == nil {
		return &http.Client{CheckRedirect: redirectPolicy}
	}
	out := *base
	out.CheckRedirect = redirectPolicy
	return &out
}

func downloadClient() *http.Client {
	return downloadClientFrom(nil)
}

// downloadClientFrom layers the per-call response-header idle timeout onto
// base's Transport while preserving Proxy/TLS settings. When base.Transport
// is not *http.Transport we leave it alone — the caller already opted into
// a custom transport and the manager's redirect/timeouts still apply.
func downloadClientFrom(base *http.Client) *http.Client {
	if base == nil {
		return &http.Client{
			Transport: &http.Transport{
				ResponseHeaderTimeout: FetchDownloadSocketIdleMs,
			},
			CheckRedirect: redirectPolicy,
		}
	}
	out := *base
	out.CheckRedirect = redirectPolicy
	if t, ok := base.Transport.(*http.Transport); ok && t != nil {
		clone := t.Clone()
		clone.ResponseHeaderTimeout = FetchDownloadSocketIdleMs
		out.Transport = clone
	} else if base.Transport == nil {
		out.Transport = &http.Transport{
			ResponseHeaderTimeout: FetchDownloadSocketIdleMs,
		}
	}
	return &out
}

func redirectPolicy(req *http.Request, via []*http.Request) error {
	if len(via) >= maxRedirects {
		return errors.New("Too many redirects")
	}
	// http.Client resolves Location relative to the most recent request; ensure
	// the URL is absolute, matching the manual redirect handling in the JS
	// source.
	if req.URL != nil && !req.URL.IsAbs() && len(via) > 0 {
		resolved, err := url.Parse(via[len(via)-1].URL.ResolveReference(req.URL).String())
		if err == nil {
			req.URL = resolved
		}
	}
	return nil
}
