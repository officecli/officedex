// Package main wires the per-user Go services into Wails bindings the
// renderer can call as `window.go.main.App.*`. The shape of this object
// mirrors the existing TypeScript DesktopAPI so the renderer migration in
// Phase 3b is a mechanical IPC-call rewrite rather than an API reshape.
//
// Style: each binding method delegates to one of the internal packages and
// returns errors verbatim; Wails surfaces them to the renderer as rejected
// promises. The mutex on App protects only the lazy-initialised handles
// (bridge / login) and the cached settings shape.
package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"officedex/internal/appupdate"
	"officedex/internal/binresolver"
	"officedex/internal/bridge"
	"officedex/internal/diagnostics"
	"officedex/internal/extrender"
	"officedex/internal/localstore"
	"officedex/internal/login"
	"officedex/internal/mask"
	"officedex/internal/netproxy"
	"officedex/internal/preview"
	"officedex/internal/report"
	runtimemgr "officedex/internal/runtime"
	"officedex/internal/settings"
	"officedex/internal/subprocess"
	"officedex/internal/types"
)

const (
	appName                  = "OfficeDex"
	previewExtraWidth        = 500
	bridgeEventChannel       = "bridge:event"
	authEventChannel         = "auth:event"
	previewEventChannel      = "preview:open"
	appUpdateChannel         = "appupdate:event"
	runtimeEventChannel      = "runtime:event"
	defaultUpdateManifestURL = "https://raw.githubusercontent.com/officecli/officedex-dist/main/manifest.json"
)

// appVersion is injected at build time via `-ldflags "-X main.appVersion=<v>"`.
// The default "dev" sentinel makes `go run` / `wails dev` work without flags.
var appVersion = "dev"

// App is the Wails-bound object surfaced to the renderer.
type App struct {
	ctx context.Context

	userDataDir  string
	workspaceDir string

	settingsStore *settings.Store
	localStore    *localstore.Store
	previewReg    *preview.Registry

	mu                     sync.Mutex
	cachedSettings         types.UserSettings
	bridgeClient           *bridge.Client
	loginManager           *login.Manager
	loginUnsub             func()
	pendingLoginURL        string
	previewModeWidthBefore int
	previewModeXBefore     int
	previewModeXShifted    bool
	appUpdateMgr           *appupdate.Manager
	runtimeMgr             *runtimemgr.Manager
	proxyPool              *netproxy.Pool
	extRenderer            *extrender.Renderer

	// resolver cache. binresolver.Resolve stats the filesystem on every call;
	// runCommandOptions / ensureBridge run on every RPC. We cache the resolved
	// path + env until UpdateSettings flips touchesBridge=true.
	resolvedBinaryPath string
	resolvedBinaryEnv  []string
	binaryResolvedAt   time.Time
}

// NewApp resolves user-scoped paths and constructs the per-user services
// that do not depend on a Wails context. Context-dependent setup (bridge
// listeners that emit events) waits for OnStartup.
func NewApp() (*App, error) {
	userDataDir, err := resolveUserDataDir(appName)
	if err != nil {
		return nil, fmt.Errorf("resolve user data dir: %w", err)
	}
	if err := os.MkdirAll(userDataDir, 0o755); err != nil {
		return nil, fmt.Errorf("mkdir user data dir: %w", err)
	}
	workspaceDir := filepath.Join(userDataDir, "workspace")
	if err := os.MkdirAll(workspaceDir, 0o755); err != nil {
		return nil, fmt.Errorf("mkdir workspace: %w", err)
	}

	settingsStore := settings.New(filepath.Join(userDataDir, "settings.json"), nil)
	cached, err := settingsStore.Load()
	if err != nil {
		return nil, fmt.Errorf("load settings: %w", err)
	}

	previewReg, err := preview.New(preview.RegistryOptions{
		TrustedRoots: previewTrustedRoots(workspaceDir, cached),
	})
	if err != nil {
		return nil, fmt.Errorf("preview registry: %w", err)
	}

	localStore := localstore.New(filepath.Join(userDataDir, "officedex.sqlite"))

	proxyPool := netproxy.NewPool()
	if cached.Proxy != nil && cached.Proxy.Enabled && cached.Proxy.URL != "" {
		// Settings sanitize on Load already drops any URL that fails
		// netproxy.ValidateURL, so Set cannot return an error for cached
		// settings; the explicit discard documents that invariant.
		_ = proxyPool.Set(cached.Proxy.URL)
	}
	bridge.SetProxyEnvSupplier(proxyPool.SubprocessEnv)
	login.SetProxyEnvSupplier(proxyPool.SubprocessEnv)

	app := &App{
		userDataDir:    userDataDir,
		workspaceDir:   workspaceDir,
		settingsStore:  settingsStore,
		localStore:     localStore,
		previewReg:     previewReg,
		cachedSettings: cached,
		proxyPool:      proxyPool,
	}

	manifestURL := os.Getenv("OFFICEDEX_UPDATE_MANIFEST_URL")
	if strings.TrimSpace(manifestURL) == "" {
		manifestURL = defaultUpdateManifestURL
	}
	updateMgr, err := appupdate.New(appupdate.Options{
		ManifestURL:    manifestURL,
		CurrentVersion: appVersion,
		UpdatesDir:     filepath.Join(userDataDir, "updates"),
		HTTPClient:     proxyPool.NewClient(0),
		Listener: func(ev appupdate.Event) {
			emit(app.ctx, appUpdateChannel, ev)
		},
	})
	if err != nil {
		return nil, fmt.Errorf("appupdate manager: %w", err)
	}
	app.appUpdateMgr = updateMgr

	runtimeInstallRoot := filepath.Join(userDataDir, "runtime")
	rtMgr, err := runtimemgr.New(runtimemgr.ManagerOptions{
		InstallRoot: runtimeInstallRoot,
		Repo:        "officecli/officecli-dist",
		HTTPClient:  proxyPool.NewClient(0),
		Listener: func(ev types.RuntimeEvent) {
			emit(app.ctx, runtimeEventChannel, ev)
		},
	})
	if err != nil {
		return nil, fmt.Errorf("runtime manager: %w", err)
	}
	_ = rtMgr.LoadFromDisk()
	app.runtimeMgr = rtMgr

	return app, nil
}

// startup is called by Wails after the renderer is ready. The context is
// retained so binding methods can dispatch events and open OS dialogs.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	if err := a.localStore.Open(ctx); err != nil {
		wailsruntime.LogErrorf(ctx, "open local store: %v", err)
	}
	if binPath := a.resolveExtrenderBinary(); binPath != "" {
		a.extRenderer = extrender.New(binPath)
		wailsruntime.LogInfof(ctx, "extrender: %s", binPath)
	}
}

// shutdown is called by Wails when the window is about to close. It stops
// long-running children so we don't leak processes.
func (a *App) shutdown(ctx context.Context) {
	a.mu.Lock()
	bridgeClient := a.bridgeClient
	a.bridgeClient = nil
	loginUnsub := a.loginUnsub
	a.loginUnsub = nil
	a.mu.Unlock()

	if bridgeClient != nil {
		bridgeClient.Stop()
	}
	if loginUnsub != nil {
		loginUnsub()
	}
	if a.localStore != nil {
		_ = a.localStore.Close()
	}
	if a.runtimeMgr != nil {
		a.runtimeMgr.CancelDownload()
	}
}

// ─── Bridge bindings ────────────────────────────────────────────────────────

// Initialize starts the agent-bridge if needed and forwards the initialize
// JSON-RPC call.
func (a *App) Initialize() ([]byte, error) {
	client, err := a.ensureBridge()
	if err != nil {
		return nil, err
	}
	return client.Initialize(a.ctx)
}

// GetCapabilities returns the agent capability map.
func (a *App) GetCapabilities() ([]byte, error) {
	client, err := a.ensureBridge()
	if err != nil {
		return nil, err
	}
	return client.GetCapabilities(a.ctx)
}

// ListImageTemplates returns server-managed image prompt templates exposed by
// officecli agent-bridge.
func (a *App) ListImageTemplates() ([]types.ImagePromptTemplate, error) {
	client, err := a.ensureBridge()
	if err != nil {
		return nil, err
	}
	return client.ListImageTemplates(a.ctx)
}

// GenerateResult is the renderer-facing shape of a task invocation result.
type GenerateResult struct {
	TaskID    string `json:"taskId"`
	SessionID string `json:"sessionId"`
	Status    string `json:"status"`
}

// Generate dispatches `office.generate` against the agent bridge after
// applying settings-driven defaults (output dir, runtime mode).
func (a *App) Generate(input types.GenerateInput) (GenerateResult, error) {
	settings, err := a.settingsStore.Load()
	if err != nil {
		return GenerateResult{}, fmt.Errorf("load settings: %w", err)
	}
	if err := validateCustomProvider(settings); err != nil {
		return GenerateResult{}, err
	}
	if err := a.requireLoggedInForCustomProvider(settings); err != nil {
		return GenerateResult{}, err
	}
	client, err := a.ensureBridge()
	if err != nil {
		return GenerateResult{}, err
	}
	resolved, err := a.resolveGenerateInput(input, settings)
	if err != nil {
		return GenerateResult{}, err
	}
	result, err := client.InvokeGenerate(a.ctx, resolved)
	if err != nil {
		return GenerateResult{}, err
	}
	if a.localStore != nil && result.TaskID != "" {
		payload := map[string]any{
			"prompt": resolved.Prompt,
		}
		if resolved.PromptTemplateID != "" {
			payload["prompt_template_id"] = resolved.PromptTemplateID
		}
		if resolved.SourceFile != "" {
			payload["source_file"] = resolved.SourceFile
		}
		if len(resolved.ReferenceImages) > 0 {
			payload["reference_images"] = resolved.ReferenceImages
		}
		_ = a.localStore.RecordEvent(types.BridgeEvent{
			TaskID:  result.TaskID,
			Type:    "task.user_input",
			Payload: payload,
		})
	}
	return GenerateResult{TaskID: result.TaskID, SessionID: result.SessionID, Status: result.Status}, nil
}

// RespondInput is the renderer payload for the respond binding.
type RespondInput struct {
	TaskID     string `json:"taskId"`
	QuestionID string `json:"questionId,omitempty"`
	OptionID   string `json:"optionId,omitempty"`
	Answer     string `json:"answer,omitempty"`
}

// Respond forwards a user answer back to the running task.
func (a *App) Respond(input RespondInput) ([]byte, error) {
	client, err := a.ensureBridge()
	if err != nil {
		return nil, err
	}
	return client.RespondTask(a.ctx, bridge.RespondParams{
		TaskID:     input.TaskID,
		QuestionID: input.QuestionID,
		OptionID:   input.OptionID,
		Answer:     input.Answer,
	})
}

// Cancel asks the bridge to cancel a running task.
func (a *App) Cancel(taskID string) ([]byte, error) {
	client, err := a.ensureBridge()
	if err != nil {
		return nil, err
	}
	return client.CancelTask(a.ctx, taskID)
}

// ─── Shell / dialog bindings ────────────────────────────────────────────────

// OpenPath opens filePath with the OS default handler.
func (a *App) OpenPath(filePath string) error {
	return openOSPath(filePath)
}

// ShowItemInFolder reveals filePath in the platform file manager.
func (a *App) ShowItemInFolder(filePath string) error {
	return revealOSPath(filePath)
}

// OpenExternal opens an http(s) URL in the user's default browser.
func (a *App) OpenExternal(url string) error {
	if a.ctx == nil {
		return errors.New("app: not started")
	}
	wailsruntime.BrowserOpenURL(a.ctx, url)
	return nil
}

// FileDialogFilter matches the renderer-facing filter shape.
type FileDialogFilter struct {
	Name       string   `json:"name"`
	Extensions []string `json:"extensions"`
}

// FileDialogOptions matches the renderer-facing dialog options.
type FileDialogOptions struct {
	Filters []FileDialogFilter `json:"filters,omitempty"`
}

// OpenFileDialog shows a single-file picker. Returns "" when the user
// cancels.
func (a *App) OpenFileDialog(options *FileDialogOptions) (string, error) {
	if a.ctx == nil {
		return "", errors.New("app: not started")
	}
	return wailsruntime.OpenFileDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Filters: dialogFilters(options),
	})
}

// OpenDirectoryDialog shows a folder picker. Returns "" when the user cancels.
func (a *App) OpenDirectoryDialog() (string, error) {
	if a.ctx == nil {
		return "", errors.New("app: not started")
	}
	return wailsruntime.OpenDirectoryDialog(a.ctx, wailsruntime.OpenDialogOptions{})
}

// OpenMultiFileDialog shows a multi-file picker. Returns an empty slice when
// the user cancels.
func (a *App) OpenMultiFileDialog(options *FileDialogOptions) ([]string, error) {
	if a.ctx == nil {
		return nil, errors.New("app: not started")
	}
	return wailsruntime.OpenMultipleFilesDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Filters: dialogFilters(options),
	})
}

// PastedImageInput is the renderer-facing payload for SavePastedImage.
// DataBase64 is the standard base64-encoded image bytes (no data: URL
// prefix), and Ext is the file extension without a leading dot. Unsupported
// extensions normalise to "png".
type PastedImageInput struct {
	DataBase64 string `json:"dataBase64"`
	Ext        string `json:"ext"`
}

// SavePastedImage persists clipboard image bytes inside the workspace and
// returns the absolute file path so the renderer can append it to the
// reference-images list.
func (a *App) SavePastedImage(input PastedImageInput) (string, error) {
	if input.DataBase64 == "" {
		return "", errors.New("save pasted image: empty data")
	}
	data, err := base64.StdEncoding.DecodeString(input.DataBase64)
	if err != nil {
		return "", fmt.Errorf("decode pasted image: %w", err)
	}
	if len(data) == 0 {
		return "", errors.New("save pasted image: empty data")
	}
	ext := normalizePastedImageExt(input.Ext)
	dir := filepath.Join(a.workspaceDir, ".pasted-images")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("mkdir pasted-images dir: %w", err)
	}
	name := fmt.Sprintf("paste-%d.%s", time.Now().UnixNano(), ext)
	dest := filepath.Join(dir, name)
	if err := os.WriteFile(dest, data, 0o644); err != nil {
		return "", fmt.Errorf("write pasted image: %w", err)
	}
	return dest, nil
}

func normalizePastedImageExt(ext string) string {
	cleaned := strings.ToLower(strings.TrimPrefix(strings.TrimSpace(ext), "."))
	switch cleaned {
	case "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg":
		return cleaned
	default:
		return "png"
	}
}

// SetPreviewMode resizes the main window to make room for the preview pane,
// or restores the pre-preview width when active is false. The widened window
// is clamped to the current screen width, and if the right edge would overflow
// the screen the window is shifted left to keep it fully visible.
func (a *App) SetPreviewMode(active bool) error {
	if a.ctx == nil {
		return errors.New("app: not started")
	}
	w, h := wailsruntime.WindowGetSize(a.ctx)
	a.mu.Lock()
	defer a.mu.Unlock()
	if active {
		if a.previewModeWidthBefore > 0 {
			return nil
		}
		a.previewModeWidthBefore = w

		targetW := w + previewExtraWidth
		screenW := a.currentScreenWidthLocked()
		if screenW > 0 && targetW > screenW {
			targetW = screenW
		}

		x, y := wailsruntime.WindowGetPosition(a.ctx)
		if screenW > 0 && x+targetW > screenW {
			newX := screenW - targetW
			if newX < 0 {
				newX = 0
			}
			a.previewModeXBefore = x
			a.previewModeXShifted = true
			wailsruntime.WindowSetPosition(a.ctx, newX, y)
		}

		wailsruntime.WindowSetSize(a.ctx, targetW, h)
		return nil
	}
	if a.previewModeWidthBefore > 0 {
		wailsruntime.WindowSetSize(a.ctx, a.previewModeWidthBefore, h)
		a.previewModeWidthBefore = 0
		if a.previewModeXShifted {
			_, y := wailsruntime.WindowGetPosition(a.ctx)
			wailsruntime.WindowSetPosition(a.ctx, a.previewModeXBefore, y)
			a.previewModeXShifted = false
			a.previewModeXBefore = 0
		}
	}
	return nil
}

// currentScreenWidthLocked returns the logical width of the screen currently
// hosting the window, falling back to the primary screen, or 0 when unknown.
// Caller must hold a.mu (the function does not touch shared state, but the
// name documents the calling context).
func (a *App) currentScreenWidthLocked() int {
	screens, err := wailsruntime.ScreenGetAll(a.ctx)
	if err != nil {
		return 0
	}
	for _, s := range screens {
		if s.IsCurrent {
			return s.Size.Width
		}
	}
	for _, s := range screens {
		if s.IsPrimary {
			return s.Size.Width
		}
	}
	return 0
}

// ─── Preview bindings ───────────────────────────────────────────────────────

// PreviewArtifact registers an artifact for preview and emits an event so the
// renderer can open it. Phase 3a uses the main-window preview pane instead of
// a separate window (Wails v2 multi-window is non-trivial); a follow-up phase
// can introduce a real second window if needed.
func (a *App) PreviewArtifact(artifact types.Artifact) error {
	if err := a.previewReg.AllowArtifact(artifact); err != nil {
		return err
	}
	grant, err := a.previewReg.IssueToken(artifact)
	if err != nil {
		return err
	}
	if a.ctx != nil {
		wailsruntime.EventsEmit(a.ctx, previewEventChannel, grant)
	}
	return nil
}

// IssuePreviewToken mints a token for a previously-allowed artifact.
func (a *App) IssuePreviewToken(artifact types.Artifact) (types.PreviewGrant, error) {
	return a.previewReg.IssueToken(artifact)
}

// RevokePreviewToken invalidates a token. No-op if unknown.
func (a *App) RevokePreviewToken(token string) {
	a.previewReg.RevokeToken(token)
}

// ArtifactFile is the renderer-facing wrapper for raw artifact bytes.
type ArtifactFile struct {
	Data []byte `json:"data"`
}

// ReadArtifactFile returns the raw bytes for a granted preview token.
func (a *App) ReadArtifactFile(previewToken string) (ArtifactFile, error) {
	entry, err := a.previewReg.ResolveToken(previewToken)
	if err != nil {
		return ArtifactFile{}, err
	}
	data, err := os.ReadFile(entry.FilePath)
	if err != nil {
		return ArtifactFile{}, fmt.Errorf("read artifact: %w", err)
	}
	return ArtifactFile{Data: data}, nil
}

// LocalImageData wraps a read-back image for renderer preview.
type LocalImageData struct {
	Data []byte `json:"data"`
	Mime string `json:"mime"`
}

var localImageMimeByExt = map[string]string{
	"png":  "image/png",
	"jpg":  "image/jpeg",
	"jpeg": "image/jpeg",
	"gif":  "image/gif",
	"webp": "image/webp",
	"bmp":  "image/bmp",
	"svg":  "image/svg+xml",
}

// ReadLocalImage returns raw bytes for an image file the user has attached
// (via OpenMultiFileDialog / SavePastedImage). The extension whitelist mirrors
// the renderer-side reference-image spec so unrelated paths cannot be read.
func (a *App) ReadLocalImage(filePath string) (LocalImageData, error) {
	if filePath == "" {
		return LocalImageData{}, errors.New("read local image: empty path")
	}
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(filePath), "."))
	mime, ok := localImageMimeByExt[ext]
	if !ok {
		return LocalImageData{}, fmt.Errorf("read local image: unsupported extension %q", ext)
	}
	data, err := os.ReadFile(filePath)
	if err != nil {
		return LocalImageData{}, fmt.Errorf("read local image: %w", err)
	}
	return LocalImageData{Data: data, Mime: mime}, nil
}

// PreviewHTML is the renderer-facing wrapper for a sidecar HTML preview.
type PreviewHTML struct {
	HTML string `json:"html"`
}

// RenderPreviewHtml returns the `*.preview.html` sidecar next to an artifact,
// or nil when the sidecar does not exist. Relative <img src> / <link href>
// references inside the sidecar are inlined as data: URLs so the renderer can
// load them inside a sandboxed iframe (which has no filesystem access).
func (a *App) RenderPreviewHtml(previewToken string) (*PreviewHTML, error) {
	entry, err := a.previewReg.ResolveToken(previewToken)
	if err != nil {
		return nil, err
	}

	ext := strings.ToLower(filepath.Ext(entry.FilePath))
	if ext == ".pptx" && a.extRenderer.Available() {
		html, err := a.extRenderer.RenderHTML(a.ctx, entry.FilePath)
		if err != nil {
			wailsruntime.LogWarningf(a.ctx, "extrender fallback to sidecar: %v", err)
		} else {
			return &PreviewHTML{HTML: html}, nil
		}
	}

	base := strings.TrimSuffix(entry.FilePath, filepath.Ext(entry.FilePath))
	sidecar := base + ".preview.html"
	body, err := os.ReadFile(sidecar)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, fmt.Errorf("read sidecar: %w", err)
	}
	inlined := inlineSidecarResources(string(body), filepath.Dir(sidecar))
	return &PreviewHTML{HTML: inlined}, nil
}

var (
	// Captures <img ... src="..."> and <link ... href="..."> with single or
	// double-quoted attribute values. Used to rewrite relative resource paths
	// inside sidecar HTML to data: URLs.
	sidecarImgSrcRE   = regexp.MustCompile(`(?i)(<img\b[^>]*?\bsrc\s*=\s*)(["'])([^"'<>]+)(["'])`)
	sidecarLinkHrefRE = regexp.MustCompile(`(?i)(<link\b[^>]*?\bhref\s*=\s*)(["'])([^"'<>]+)(["'])`)
)

// sidecarMimeByExt maps lowercase file extensions (without dot) to MIME types
// used when inlining sidecar HTML resources. Kept intentionally narrow:
// officecli sidecars should bundle their own CSS — we only support a small
// allowlist to avoid surprises.
var sidecarMimeByExt = map[string]string{
	"png":  "image/png",
	"jpg":  "image/jpeg",
	"jpeg": "image/jpeg",
	"gif":  "image/gif",
	"webp": "image/webp",
	"bmp":  "image/bmp",
	"svg":  "image/svg+xml",
	"css":  "text/css",
}

// inlineSidecarResources rewrites relative <img src> / <link href> attribute
// values in html so they become self-contained data: URLs sourced from baseDir.
// Absolute (http/https/data/protocol-relative/root-absolute) URLs are left
// untouched. If a referenced file cannot be read or its extension is not in
// sidecarMimeByExt, the original attribute is preserved so the iframe surfaces
// a normal "broken image" instead of crashing the preview pipeline.
func inlineSidecarResources(html, baseDir string) string {
	if baseDir == "" {
		return html
	}
	rewriteAttr := func(prefix, openQuote, url, closeQuote string) string {
		original := prefix + openQuote + url + closeQuote
		if !isRelativeResource(url) {
			return original
		}
		dataURL, ok := readAsDataURL(baseDir, url)
		if !ok {
			return original
		}
		return prefix + openQuote + dataURL + closeQuote
	}

	html = sidecarImgSrcRE.ReplaceAllStringFunc(html, func(m string) string {
		parts := sidecarImgSrcRE.FindStringSubmatch(m)
		return rewriteAttr(parts[1], parts[2], parts[3], parts[4])
	})
	html = sidecarLinkHrefRE.ReplaceAllStringFunc(html, func(m string) string {
		parts := sidecarLinkHrefRE.FindStringSubmatch(m)
		return rewriteAttr(parts[1], parts[2], parts[3], parts[4])
	})
	return html
}

func isRelativeResource(url string) bool {
	if url == "" {
		return false
	}
	if strings.HasPrefix(url, "data:") || strings.HasPrefix(url, "http://") || strings.HasPrefix(url, "https://") {
		return false
	}
	if strings.HasPrefix(url, "//") || strings.HasPrefix(url, "/") {
		return false
	}
	if strings.HasPrefix(url, "#") {
		return false
	}
	return true
}

func readAsDataURL(baseDir, relURL string) (string, bool) {
	// Strip query/fragment before resolving on disk.
	clean := relURL
	if i := strings.IndexAny(clean, "?#"); i >= 0 {
		clean = clean[:i]
	}
	resolved := filepath.Join(baseDir, filepath.FromSlash(clean))
	absBase, err := filepath.Abs(baseDir)
	if err != nil {
		return "", false
	}
	absResolved, err := filepath.Abs(resolved)
	if err != nil {
		return "", false
	}
	rel, err := filepath.Rel(absBase, absResolved)
	if err != nil || strings.HasPrefix(rel, "..") {
		// Refuse to traverse out of the sidecar directory.
		return "", false
	}
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(absResolved), "."))
	mime, ok := sidecarMimeByExt[ext]
	if !ok {
		return "", false
	}
	data, err := os.ReadFile(absResolved)
	if err != nil {
		return "", false
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data), true
}

// ─── Auth bindings ──────────────────────────────────────────────────────────

// LoginURLResult is the renderer-facing shape returned by Login.
type LoginURLResult struct {
	URL string `json:"url"`
}

// Login starts an OAuth flow if one is not already in progress, returns the
// verification URL the renderer can show / open in the browser.
func (a *App) Login() (LoginURLResult, error) {
	a.mu.Lock()
	if a.pendingLoginURL != "" {
		url := a.pendingLoginURL
		a.mu.Unlock()
		return LoginURLResult{URL: url}, nil
	}
	manager := a.ensureLoginManagerLocked()
	a.mu.Unlock()

	url, err := manager.Start(a.ctx)
	if err != nil {
		return LoginURLResult{}, err
	}
	a.mu.Lock()
	a.pendingLoginURL = url
	a.mu.Unlock()

	if a.ctx != nil {
		wailsruntime.EventsEmit(a.ctx, authEventChannel, types.AuthEvent{Type: types.AuthEventURL, URL: url})
	}
	return LoginURLResult{URL: url}, nil
}

// CancelLogin SIGTERM-s the active login subprocess (if any).
func (a *App) CancelLogin() error {
	a.mu.Lock()
	manager := a.loginManager
	a.mu.Unlock()
	if manager == nil {
		return nil
	}
	return manager.Cancel()
}

// WhoAmI runs `officecli whoami` and returns the parsed result.
func (a *App) WhoAmI() (types.WhoAmIResult, error) {
	opts := a.runCommandOptions()
	return login.GetWhoAmI(a.ctx, opts)
}

// GetCreditStatus runs `officecli auth status` and returns the parsed quota
// snapshot (hosted credit balance, free trial / reward / paid-key counters,
// access mode, plan name). A non-zero exit from the CLI is reported as an
// anonymous status with zeroed counters rather than an error.
func (a *App) GetCreditStatus() (types.CreditStatus, error) {
	opts := a.runCommandOptions()
	return login.GetCreditStatus(a.ctx, opts)
}

// Logout runs `officecli logout`.
func (a *App) Logout() error {
	opts := a.runCommandOptions()
	return login.Logout(a.ctx, opts)
}

// Redeem runs `officecli redeem --json --source desktop <code>` to add hosted
// credits to the signed-in account. Errors surfaced by the platform (expired
// code, exhausted code, already-claimed, etc.) are returned as a normal error
// so the renderer can show the message to the user.
func (a *App) Redeem(code string) (types.RedeemResult, error) {
	opts := a.runCommandOptions()
	return login.Redeem(a.ctx, opts, code)
}

// ─── Settings bindings ──────────────────────────────────────────────────────

// GetSettings returns the current sanitized settings.
func (a *App) GetSettings() (types.UserSettings, error) {
	return a.settingsStore.Load()
}

// UpdateSettings applies a patch and restarts the bridge if the change might
// affect it (binary path, LLM provider, runtime mode, proxy).
func (a *App) UpdateSettings(patch settings.Patch) (types.UserSettings, error) {
	if patch.LlmProvider != nil {
		if err := a.requireLoggedInForProvider(patch.LlmProvider); err != nil {
			return types.UserSettings{}, err
		}
	}
	merged, err := a.settingsStore.Update(patch)
	if err != nil {
		return types.UserSettings{}, err
	}
	proxyChanged := patch.Proxy != nil || patch.ClearProxy
	if proxyChanged {
		if merged.Proxy != nil && merged.Proxy.Enabled && merged.Proxy.URL != "" {
			if err := a.proxyPool.Set(merged.Proxy.URL); err != nil {
				return types.UserSettings{}, fmt.Errorf("apply proxy: %w", err)
			}
		} else {
			a.proxyPool.Clear()
		}
	}
	a.mu.Lock()
	a.cachedSettings = merged
	touchesBridge := patch.BridgeBinaryPath != nil ||
		patch.LlmProvider != nil ||
		patch.ClearLlmProvider ||
		proxyChanged
	client := a.bridgeClient
	if touchesBridge {
		a.bridgeClient = nil
		a.resolvedBinaryPath = ""
		a.resolvedBinaryEnv = nil
		a.binaryResolvedAt = time.Time{}
	}
	if patch.BridgeBinaryPath != nil || proxyChanged {
		a.loginManager = nil
		if a.loginUnsub != nil {
			a.loginUnsub()
			a.loginUnsub = nil
		}
	}
	a.mu.Unlock()

	if patch.OutputDir != nil {
		if err := a.refreshPreviewTrustedRoots(merged); err != nil {
			return types.UserSettings{}, err
		}
	}
	if touchesBridge && client != nil {
		client.Close()
	}
	return merged, nil
}

// GetDefaultWorkspaceDir returns the per-user workspace folder.
func (a *App) GetDefaultWorkspaceDir() string {
	return a.workspaceDir
}

// GetCreditFeatureSince returns the timestamp at which per-task credit
// tracking became available for this install (the schema_migrations v1 row).
// The renderer uses this to label tasks predating the feature with "—"
// instead of "0".
func (a *App) GetCreditFeatureSince() (string, error) {
	if a.localStore == nil {
		return "", nil
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	return a.localStore.GetCreditFeatureSince(ctx)
}

// GetTaskHistory returns the persisted bridge events for the most recently
// active tasks so the renderer can replay them into TaskState on startup.
// Entries are ordered oldest-first; events within each entry are sorted
// ascending by created_at. A non-positive limit is clamped to a default cap.
func (a *App) GetTaskHistory(limit int) ([]types.TaskHistoryEntry, error) {
	if a.localStore == nil {
		return nil, nil
	}
	if limit <= 0 {
		limit = 50
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	ids, err := a.localStore.QueryRecentTaskIDs(ctx, limit)
	if err != nil {
		return nil, fmt.Errorf("get task history: list tasks: %w", err)
	}
	entries := make([]types.TaskHistoryEntry, 0, len(ids))
	for _, id := range ids {
		events, err := a.localStore.QueryEventsByTask(ctx, id)
		if err != nil {
			return nil, fmt.Errorf("get task history: events for %s: %w", id, err)
		}
		if len(events) == 0 {
			continue
		}
		// Re-register completed artifacts with the preview registry so the
		// renderer can issue preview tokens after an app restart. Without this,
		// `IssuePreviewToken` rejects historical artifacts with "artifact is not
		// registered" and the preview button appears to do nothing.
		for _, ev := range events {
			if ev.Type != "task.completed" {
				continue
			}
			if artifact := artifactFromCompletedEvent(ev); artifact != nil {
				if err := a.previewReg.AllowArtifact(*artifact); err != nil {
					wailsruntime.LogWarningf(ctx, "preview register (history): %v", err)
				}
			}
		}
		entries = append(entries, types.TaskHistoryEntry{TaskID: id, Events: events})
	}
	return entries, nil
}

// ─── App update bindings ────────────────────────────────────────────────────

// AppUpdateCheckResult is the renderer-facing result of CheckAppUpdate.
type AppUpdateCheckResult struct {
	Release *appupdate.ReleaseInfo `json:"release"`
	Status  appupdate.Status       `json:"status"`
}

// GetAppVersion returns the desktop app version string.
func (a *App) GetAppVersion() string { return appVersion }

// GetAppUpdateStatus returns the cached status snapshot.
func (a *App) GetAppUpdateStatus() appupdate.Status {
	return a.appUpdateMgr.Status()
}

// CheckAppUpdate polls the manifest URL and returns the parsed release info
// plus a fresh status snapshot.
func (a *App) CheckAppUpdate() (AppUpdateCheckResult, error) {
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	rel, err := a.appUpdateMgr.CheckLatest(ctx)
	if err != nil {
		return AppUpdateCheckResult{Status: a.appUpdateMgr.Status()}, err
	}
	return AppUpdateCheckResult{Release: rel, Status: a.appUpdateMgr.Status()}, nil
}

// DownloadAppUpdate fetches the asset for the current platform and returns
// the absolute path to the verified file.
func (a *App) DownloadAppUpdate() (string, error) {
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	return a.appUpdateMgr.DownloadUpdate(ctx)
}

// CancelAppUpdate aborts any in-flight download.
func (a *App) CancelAppUpdate() error {
	a.appUpdateMgr.CancelDownload()
	return nil
}

// InstallAppUpdate launches the downloaded installer in a platform-specific
// way then quits the current process so the installer can replace files.
// Returns an error when no download has completed.
func (a *App) InstallAppUpdate() error {
	dp := a.appUpdateMgr.DownloadedPath()
	if dp == nil {
		return errors.New("appupdate: not downloaded")
	}
	path := *dp
	if _, err := os.Stat(path); err != nil {
		return fmt.Errorf("appupdate: installer file missing: %w", err)
	}
	if err := launchInstaller(path); err != nil {
		return fmt.Errorf("appupdate: launch installer: %w", err)
	}
	rel := a.appUpdateMgr.LatestRelease()
	if rel != nil {
		a.appUpdateMgr.MarkInstalled(rel.Version)
	}
	if a.ctx != nil {
		wailsruntime.Quit(a.ctx)
	}
	return nil
}

// ─── Runtime (OfficeCLI) update bindings ───────────────────────────────────

// RuntimeUpdateCheckResult is the renderer-facing result of CheckRuntimeUpdate.
type RuntimeUpdateCheckResult struct {
	Latest *runtimemgr.LatestRelease `json:"latest"`
	Status types.RuntimeStatus       `json:"status"`
}

// GetRuntimeStatus returns the cached runtime manager status snapshot.
func (a *App) GetRuntimeStatus() types.RuntimeStatus {
	return a.runtimeMgr.Status()
}

// CheckRuntimeUpdate queries GitHub Releases for the latest officecli version.
func (a *App) CheckRuntimeUpdate() (RuntimeUpdateCheckResult, error) {
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	latest, err := a.runtimeMgr.CheckLatestVersion(ctx)
	if err != nil {
		return RuntimeUpdateCheckResult{Status: a.runtimeMgr.Status()}, err
	}
	return RuntimeUpdateCheckResult{Latest: latest, Status: a.runtimeMgr.Status()}, nil
}

// DownloadRuntimeUpdate fetches the latest officecli binary and installs it
// into the managed runtime directory.
func (a *App) DownloadRuntimeUpdate() (types.RuntimeStatus, error) {
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	status, err := a.runtimeMgr.DownloadAndInstall(ctx)
	if err != nil {
		return status, err
	}
	a.mu.Lock()
	a.resolvedBinaryPath = ""
	a.resolvedBinaryEnv = nil
	a.binaryResolvedAt = time.Time{}
	client := a.bridgeClient
	a.bridgeClient = nil
	a.mu.Unlock()
	if client != nil {
		client.Close()
	}
	return status, nil
}

// CancelRuntimeUpdate aborts any in-flight runtime download.
func (a *App) CancelRuntimeUpdate() error {
	a.runtimeMgr.CancelDownload()
	return nil
}

func launchInstaller(path string) error {
	switch runtime.GOOS {
	case "darwin":
		return installDarwinUpdate(path)
	case "windows":
		return subprocess.Command("cmd", "/c", "start", "", path).Start()
	default:
		return subprocess.Command("xdg-open", path).Start()
	}
}

// ─── Diagnostics ────────────────────────────────────────────────────────────

// ExportLogsInput is the optional input shape passed from the renderer. A
// zero-value struct (no input from the renderer) is treated as "include all"
// so that A0 callers continue to receive a fully-populated bundle.
type ExportLogsInput struct {
	TaskID          string `json:"taskId,omitempty"`
	IncludeSettings bool   `json:"includeSettings"`
	IncludeEvents   bool   `json:"includeEvents"`
	IncludeLogs     bool   `json:"includeLogs"`
	IncludeRecent   bool   `json:"includeRecent"`
}

// ExportLogsResult is the value returned by ExportLogs to the renderer.
type ExportLogsResult struct {
	Path     string                     `json:"path"`
	Manifest diagnostics.BundleManifest `json:"manifest"`
}

// ExportLogs assembles a diagnostics bundle (scrubbed settings, events, logs)
// into ~/Downloads and returns the path + manifest.
func (a *App) ExportLogs(input ExportLogsInput) (ExportLogsResult, error) {
	// Zero-value struct from a renderer that omitted input → default to all-on.
	if !input.IncludeSettings && !input.IncludeEvents && !input.IncludeLogs && !input.IncludeRecent {
		input.IncludeSettings = true
		input.IncludeEvents = true
		input.IncludeLogs = true
		input.IncludeRecent = true
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return ExportLogsResult{}, fmt.Errorf("export logs: home dir: %w", err)
	}
	downloads := filepath.Join(home, "Downloads")

	a.mu.Lock()
	currentSettings := a.cachedSettings
	bridgeClient := a.bridgeClient
	a.mu.Unlock()

	var droppedBytes int64
	if bridgeClient != nil {
		droppedBytes = bridgeClient.LogfileDroppedBytes()
	}

	bundleID := uuid.New().String()

	zipPath, manifest, err := diagnostics.BuildBundle(a.ctx, diagnostics.BundleOptions{
		DestDir:             downloads,
		UserDataDir:         a.userDataDir,
		WorkspaceDir:        a.workspaceDir,
		LocalStore:          a.localStore,
		Settings:            currentSettings,
		CachedBridgeEnv:     a.currentBridgeEnv(),
		TaskID:              input.TaskID,
		IncludeSettings:     input.IncludeSettings,
		IncludeEvents:       input.IncludeEvents,
		IncludeRecent:       input.IncludeRecent,
		IncludeLogs:         input.IncludeLogs,
		AppVersion:          appVersion,
		BundleID:            bundleID,
		RuntimeDroppedBytes: droppedBytes,
	})
	if err != nil {
		return ExportLogsResult{}, fmt.Errorf("export logs: %w", err)
	}
	return ExportLogsResult{Path: zipPath, Manifest: manifest}, nil
}

func (a *App) currentBridgeEnv() []string {
	a.mu.Lock()
	s := a.cachedSettings
	a.mu.Unlock()
	return toEnvSlice(llmProviderEnv(s))
}

// GetBridgeRuntimeSnapshot returns the renderer-facing description of the
// officecli subprocess as it was actually resolved. EnvApplied is true only
// when ensureBridge has populated the cached path/env/timestamp — i.e. a real
// subprocess has been spawned. Provider is parsed strictly from the env slice
// that was handed to the subprocess; we do not consult cachedSettings as a
// stand-in, because the whole point of this method is to prove what is
// running rather than echo what is merely configured.
func (a *App) GetBridgeRuntimeSnapshot() (types.BridgeRuntimeSnapshot, error) {
	a.mu.Lock()
	provider := a.cachedSettings.LlmProvider
	var mode types.RuntimeMode
	if provider == nil {
		mode = types.RuntimeHosted
	} else {
		mode = types.RuntimeCustom
	}
	path := a.resolvedBinaryPath
	env := append([]string(nil), a.resolvedBinaryEnv...)
	at := a.binaryResolvedAt
	a.mu.Unlock()

	snap := types.BridgeRuntimeSnapshot{
		RuntimeMode: mode,
		BinaryPath:  path,
		EnvApplied:  path != "" && len(env) > 0 && !at.IsZero(),
	}
	if !at.IsZero() {
		snap.ResolvedAt = at.UTC().Format(time.RFC3339)
	}
	if a.proxyPool != nil {
		if u := a.proxyPool.Get(); u != nil {
			snap.ProxyHost = mask.Host(u.String())
		}
	}
	if snap.EnvApplied && mode == types.RuntimeCustom {
		snap.Provider = providerSnapshotFromEnv(env)
	}
	return snap, nil
}

// providerSnapshotFromEnv parses the OFFICECLI_LLM_* lines emitted by
// llmProviderEnv and returns a renderer-safe view. Returns nil when none of
// the provider keys are present (e.g. hosted mode subprocess).
func providerSnapshotFromEnv(env []string) *types.ProviderSnapshot {
	const (
		keyType    = "OFFICECLI_LLM_PROVIDER="
		keyBaseURL = "OFFICECLI_LLM_BASE_URL="
		keyKey     = "OFFICECLI_LLM_API_KEY="
		keyModel   = "OFFICECLI_LLM_MODEL="
	)
	var providerType, baseURL, apiKey, model string
	var found bool
	for _, kv := range env {
		switch {
		case strings.HasPrefix(kv, keyType):
			providerType = kv[len(keyType):]
			found = true
		case strings.HasPrefix(kv, keyBaseURL):
			baseURL = kv[len(keyBaseURL):]
			found = true
		case strings.HasPrefix(kv, keyKey):
			apiKey = kv[len(keyKey):]
			found = true
		case strings.HasPrefix(kv, keyModel):
			model = kv[len(keyModel):]
			found = true
		}
	}
	if !found {
		return nil
	}
	return &types.ProviderSnapshot{
		Type:         types.LlmProviderType(providerType),
		BaseURLHost:  mask.Host(baseURL),
		Model:        model,
		APIKeyMasked: mask.APIKey(apiKey),
		APIKeyLength: len([]rune(strings.TrimSpace(apiKey))),
	}
}

// providerProbe describes the network request TestProvider should issue to
// validate the user's configured provider. Every provider type ends up issuing
// a real HTTP request — we deliberately avoid host-only TCP probes here
// because "host alive" is a false trust signal: it greenlights wrong paths,
// rejected keys, and nonexistent model names.
type providerProbe struct {
	method     string
	url        string
	headers    map[string]string
	body       []byte
	displayURL string
}

func providerProbeFor(p types.LlmProvider) (providerProbe, error) {
	base := strings.TrimRight(strings.TrimSpace(p.BaseURL), "/")
	if base == "" {
		return providerProbe{}, errors.New("test_provider.base_url_required")
	}

	// Build a "hi" chat completion request body. All providers now send a
	// real conversation message instead of probing /models — this exercises
	// the same code path officecli uses for generation, catching issues like
	// wrong model names, rate limits, and auth errors that a GET /models
	// probe would miss.
	model := strings.TrimSpace(p.Model)
	chatMessages := []map[string]string{{"role": "user", "content": "hi"}}

	switch p.Type {
	case types.LlmOpenAI:
		body, err := json.Marshal(map[string]any{
			"model":      model,
			"messages":   chatMessages,
			"max_tokens": 50,
			"stream":     false,
		})
		if err != nil {
			return providerProbe{}, fmt.Errorf("test_provider.marshal: %w", err)
		}
		return providerProbe{
			method:     http.MethodPost,
			url:        base + "/chat/completions",
			headers:    map[string]string{"Authorization": "Bearer " + p.APIKey, "Content-Type": "application/json"},
			body:       body,
			displayURL: mask.Host(base) + "/chat/completions",
		}, nil

	case types.LlmAzure:
		probeURL := base + "/openai/deployments/" + model + "/chat/completions?api-version=2024-02-15-preview"
		body, err := json.Marshal(map[string]any{
			"messages":   chatMessages,
			"max_tokens": 50,
			"stream":     false,
		})
		if err != nil {
			return providerProbe{}, fmt.Errorf("test_provider.marshal: %w", err)
		}
		return providerProbe{
			method:     http.MethodPost,
			url:        probeURL,
			headers:    map[string]string{"api-key": p.APIKey, "Content-Type": "application/json"},
			body:       body,
			displayURL: mask.Host(base) + "/openai/deployments/" + model + "/chat/completions",
		}, nil

	case types.LlmAnthropic:
		body, err := json.Marshal(map[string]any{
			"model":      model,
			"messages":   []map[string]string{{"role": "user", "content": "hi"}},
			"max_tokens": 50,
		})
		if err != nil {
			return providerProbe{}, fmt.Errorf("test_provider.marshal: %w", err)
		}
		return providerProbe{
			method: http.MethodPost,
			url:    base + "/v1/messages",
			headers: map[string]string{
				"x-api-key":         p.APIKey,
				"anthropic-version": "2023-06-01",
				"Content-Type":      "application/json",
			},
			body:       body,
			displayURL: mask.Host(base) + "/v1/messages",
		}, nil

	case types.LlmCustom:
		// Custom endpoints are almost always OpenAI-compatible (4zapi,
		// OpenRouter, Deepseek, local llama.cpp, etc.). Send a real chat
		// completion to exercise the full generation path.
		body, err := json.Marshal(map[string]any{
			"model":      model,
			"messages":   chatMessages,
			"max_tokens": 50,
			"stream":     false,
		})
		if err != nil {
			return providerProbe{}, fmt.Errorf("test_provider.marshal: %w", err)
		}
		return providerProbe{
			method: http.MethodPost,
			url:    base + "/chat/completions",
			headers: map[string]string{
				"Authorization": "Bearer " + p.APIKey,
				"Content-Type":  "application/json",
			},
			body:       body,
			displayURL: mask.Host(base) + "/chat/completions",
		}, nil

	default:
		return providerProbe{}, fmt.Errorf("test_provider.unsupported_type: %s", p.Type)
	}
}

const officialProviderTestUnavailable = "official provider connection test is not available; run a generation task to verify the hosted provider"

// TestProvider issues a probe against the configured provider. For custom
// providers (OpenAI/Azure/Anthropic/Custom) it sends a real "hi" chat
// completion. Official hosted mode does not expose a zero-cost provider ping, so
// it returns an explicit unavailable result instead of treating a local bridge
// handshake as proof that the hosted provider is reachable.
func (a *App) TestProvider() (types.ProviderTestResult, error) {
	a.mu.Lock()
	s := a.cachedSettings
	a.mu.Unlock()

	return a.testProviderWithSettings(s, a.proxyPool, false)
}

// TestProviderWithInput runs the same provider probe as TestProvider, but with
// per-call provider/proxy overrides. It is used by onboarding before draft
// settings have been persisted.
func (a *App) TestProviderWithInput(input types.ProviderTestInput) (types.ProviderTestResult, error) {
	a.mu.Lock()
	s := a.cachedSettings
	a.mu.Unlock()
	if input.UseProviderOverride {
		s.LlmProvider = input.LlmProvider
	}

	pool := a.proxyPool
	if input.UseProxyOverride {
		tempPool := netproxy.NewPool()
		if input.Proxy != nil && input.Proxy.Enabled && strings.TrimSpace(input.Proxy.URL) != "" {
			if err := tempPool.Set(input.Proxy.URL); err != nil {
				return types.ProviderTestResult{}, fmt.Errorf("apply test proxy: %w", err)
			}
		}
		pool = tempPool
	}
	return a.testProviderWithSettings(s, pool, input.AllowPaidOfficialProbe)
}

func (a *App) testProviderWithSettings(s types.UserSettings, pool *netproxy.Pool, allowPaidOfficialProbe bool) (types.ProviderTestResult, error) {
	if s.LlmProvider == nil {
		if allowPaidOfficialProbe {
			return a.runOfficialPaidProviderProbe(s, pool)
		}
		return testOfficialProvider()
	}
	if err := a.requireLoggedInForCustomProvider(s); err != nil {
		return types.ProviderTestResult{}, err
	}

	probe, err := providerProbeFor(*s.LlmProvider)
	if err != nil {
		return types.ProviderTestResult{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return runHTTPProbe(ctx, pool, probe), nil
}

// testOfficialProvider deliberately does not call bridge initialize. That RPC is
// a local stdio handshake and can return in 0ms even when no hosted LLM request
// would succeed, so reporting it as a provider connection test is misleading.
func testOfficialProvider() (types.ProviderTestResult, error) {
	return types.ProviderTestResult{
		URL:         "official",
		Error:       officialProviderTestUnavailable,
		Unavailable: true,
	}, nil
}

func (a *App) runOfficialPaidProviderProbe(s types.UserSettings, pool *netproxy.Pool) (types.ProviderTestResult, error) {
	probeCtx := a.ctx
	if probeCtx == nil {
		probeCtx = context.Background()
	}
	ctx, cancel := context.WithTimeout(probeCtx, 2*time.Minute)
	defer cancel()

	outDir, err := os.MkdirTemp("", "officedex-provider-test-*")
	if err != nil {
		return types.ProviderTestResult{}, fmt.Errorf("official provider test temp dir: %w", err)
	}
	defer os.RemoveAll(outDir)

	binary := binresolver.ResolvePath(a.resolverOptions(s))
	if strings.TrimSpace(binary) == "" {
		binary = "officecli"
	}
	args := []string{
		"new",
		"docx",
		"OfficeDex Provider Connection Test",
		"--prompt",
		"Write exactly: OfficeDex provider connection test OK.",
		"--mode",
		"fast",
		"--out",
		outDir,
		"--no-publish",
		"--json",
	}
	cmd := subprocess.CommandContext(ctx, binary, args...)
	cmd.Env = buildOfficialProbeEnv(llmProviderEnv(types.UserSettings{}), pool)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	start := time.Now()
	err = cmd.Run()
	latency := time.Since(start).Milliseconds()
	if ctx.Err() != nil {
		return types.ProviderTestResult{
			URL:       "official",
			LatencyMs: latency,
			Error:     "official provider paid probe timed out",
			ProbeType: "officialPaid",
		}, nil
	}
	if err != nil {
		exitCode := -1
		if cmd.ProcessState != nil {
			exitCode = cmd.ProcessState.ExitCode()
		}
		return types.ProviderTestResult{
			URL:       "official",
			LatencyMs: latency,
			Error:     officialProbeFailureSummary(exitCode, stdout.String(), stderr.String(), err),
			ProbeType: "officialPaid",
		}, nil
	}
	return types.ProviderTestResult{
		OK:        true,
		URL:       "official",
		LatencyMs: latency,
		ProbeType: "officialPaid",
	}, nil
}

func buildOfficialProbeEnv(extra []string, pool *netproxy.Pool) []string {
	env := stripProxyEnv(append([]string{}, os.Environ()...))
	env = appendKVForCommand(env, "OFFICECLI_SKIP_SKILL_PREFLIGHT", "1")
	env = appendKVForCommand(env, "OFFICECLI_SKIP_PUBLISH_SETUP", "1")
	env = appendKVForCommand(env, "OFFICECLI_SKIP_UPDATE_CHECK", "1")
	if pool != nil {
		for _, kv := range pool.SubprocessEnv() {
			key, _, ok := strings.Cut(kv, "=")
			if ok {
				env = setKVForCommand(env, key, kv)
			}
		}
	}
	for _, kv := range extra {
		key, _, ok := strings.Cut(kv, "=")
		if ok {
			env = setKVForCommand(env, key, kv)
		}
	}
	return env
}

func stripProxyEnv(env []string) []string {
	filtered := env[:0]
	for _, kv := range env {
		key, _, ok := strings.Cut(kv, "=")
		if !ok {
			filtered = append(filtered, kv)
			continue
		}
		switch strings.ToUpper(key) {
		case "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY":
			continue
		default:
			filtered = append(filtered, kv)
		}
	}
	return filtered
}

func appendKVForCommand(env []string, key, value string) []string {
	return setKVForCommand(env, key, key+"="+value)
}

func setKVForCommand(env []string, key, kv string) []string {
	prefix := key + "="
	for i, current := range env {
		if strings.HasPrefix(current, prefix) {
			env[i] = kv
			return env
		}
	}
	return append(env, kv)
}

func officialProbeFailureSummary(exitCode int, stdout string, stderr string, runErr error) string {
	parts := []string{fmt.Sprintf("official provider paid probe exited with exit code %d", exitCode)}
	if trimmed := limitProbeOutput(stderr); trimmed != "" {
		parts = append(parts, "stderr: "+trimmed)
	}
	if trimmed := limitProbeOutput(stdout); trimmed != "" {
		parts = append(parts, "stdout: "+trimmed)
	}
	if len(parts) == 1 && runErr != nil {
		parts = append(parts, runErr.Error())
	}
	return strings.Join(parts, "\n")
}

func limitProbeOutput(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	const max = 2000
	if len(trimmed) > max {
		return trimmed[:max] + "...(truncated)"
	}
	return trimmed
}

func runHTTPProbe(ctx context.Context, pool *netproxy.Pool, p providerProbe) types.ProviderTestResult {
	client := pool.NewClient(15 * time.Second)
	var bodyReader io.Reader
	if len(p.body) > 0 {
		bodyReader = bytes.NewReader(p.body)
	}
	req, err := http.NewRequestWithContext(ctx, p.method, p.url, bodyReader)
	if err != nil {
		return types.ProviderTestResult{URL: p.displayURL, Error: err.Error()}
	}
	for k, v := range p.headers {
		req.Header.Set(k, v)
	}
	start := time.Now()
	resp, err := client.Do(req)
	latency := time.Since(start).Milliseconds()
	if err != nil {
		return types.ProviderTestResult{URL: p.displayURL, LatencyMs: latency, Error: err.Error()}
	}
	defer resp.Body.Close()

	respBody, readErr := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if readErr != nil {
		return types.ProviderTestResult{
			URL:       p.displayURL,
			LatencyMs: latency,
			Error:     fmt.Sprintf("read response: %v", readErr),
		}
	}

	result := types.ProviderTestResult{
		OK:         resp.StatusCode >= 200 && resp.StatusCode < 300,
		HTTPStatus: resp.StatusCode,
		LatencyMs:  latency,
		URL:        p.displayURL,
	}

	if result.OK {
		if msg := extractResponseMessage(respBody); msg != "" {
			result.ResponseMessage = msg
		}
	} else {
		// Include body snippet in error for debugging (e.g. model_not_found).
		if msg := extractErrorFromBody(respBody); msg != "" {
			result.Error = msg
		}
	}

	return result
}

// extractResponseMessage parses a chat completion response body and returns
// the first line of the assistant's reply, or empty on failure.
func extractResponseMessage(body []byte) string {
	// Try OpenAI-compatible format: {"choices":[{"message":{"content":"..."}}]}
	var openaiResp struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if json.Unmarshal(body, &openaiResp) == nil {
		for _, c := range openaiResp.Choices {
			if c.Message.Content != "" {
				return firstLine(c.Message.Content, 200)
			}
		}
	}

	// Try Anthropic format: {"content":[{"type":"text","text":"..."}]}
	var anthropicResp struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	}
	if json.Unmarshal(body, &anthropicResp) == nil {
		for _, c := range anthropicResp.Content {
			if c.Type == "text" && c.Text != "" {
				return firstLine(c.Text, 200)
			}
		}
	}

	return ""
}

// extractErrorFromBody tries to pull a human-readable error message from the
// response body. Handles OpenAI-style {"error":{"message":"..."}} and
// Anthropic-style {"error":{"message":"..."}}.
func extractErrorFromBody(body []byte) string {
	var errResp struct {
		Error struct {
			Message string `json:"message"`
			Type    string `json:"type"`
		} `json:"error"`
	}
	if json.Unmarshal(body, &errResp) == nil && errResp.Error.Message != "" {
		msg := errResp.Error.Message
		if errResp.Error.Type != "" {
			msg = errResp.Error.Type + ": " + msg
		}
		return firstLine(msg, 200)
	}
	return ""
}

func firstLine(s string, maxLen int) string {
	if idx := strings.IndexAny(s, "\r\n"); idx >= 0 {
		s = s[:idx]
	}
	if len(s) > maxLen {
		s = s[:maxLen] + "…"
	}
	return s
}

// ─── Issue report bindings ──────────────────────────────────────────────────

// SubmitReportInput is the renderer-facing payload for SubmitReport.
type SubmitReportInput struct {
	TaskID       string `json:"taskId,omitempty"`
	Description  string `json:"description"`
	ContactEmail string `json:"contactEmail,omitempty"`
}

// SubmitReportResult is the value returned to the renderer.
type SubmitReportResult struct {
	TicketID       string `json:"ticketId,omitempty"`
	ViewURL        string `json:"viewUrl,omitempty"`
	RequestID      string `json:"requestId,omitempty"`
	Uploaded       bool   `json:"uploaded"`
	FallbackReason string `json:"fallbackReason,omitempty"`
}

// ReportCapabilityResult is the gated view the renderer uses to decide whether
// to surface a "Report issue" action vs falling back to "Copy request id".
type ReportCapabilityResult struct {
	Enabled bool   `json:"enabled"`
	Reason  string `json:"reason,omitempty"`
}

// PeekReportContextResult is the renderer-facing snapshot of the failed-task
// context the report dialog renders in its header bar. All fields are empty
// when the user opens the dialog without a task selection (e.g. from
// Settings) or when no failure has been recorded yet.
type PeekReportContextResult struct {
	RequestID    string `json:"requestId"`
	ErrorCode    string `json:"errorCode"`
	ErrorMessage string `json:"errorMessage"`
	RuntimeMode  string `json:"runtimeMode"`
}

const (
	reportDescriptionMinLen = 10
	reportErrorMessageCap   = 500
)

// GetReportCapability returns a renderer-friendly snapshot of whether report
// submission is available.
func (a *App) GetReportCapability() ReportCapabilityResult {
	cap := a.detectReportCapability()
	return ReportCapabilityResult{Enabled: cap.Enabled, Reason: cap.Reason}
}

// PeekReportContext returns the report header data the renderer renders in
// the dialog (request_id + error code + error message + runtime mode). Safe
// to call with empty taskID; returns zero-value result without error.
func (a *App) PeekReportContext(taskID string) (PeekReportContextResult, error) {
	out := PeekReportContextResult{}
	if a.localStore == nil || strings.TrimSpace(taskID) == "" {
		return out, nil
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	requestID, err := a.localStore.LatestRequestID(ctx, taskID)
	if err != nil {
		return out, fmt.Errorf("peek report context: latest request id: %w", err)
	}
	out.RequestID = requestID

	events, err := a.localStore.QueryEventsByTask(ctx, taskID)
	if err != nil {
		return out, fmt.Errorf("peek report context: query events: %w", err)
	}
	if failure := latestFailedEvent(events); failure != nil {
		out.ErrorCode, out.ErrorMessage = extractErrorFields(failure)
	}
	out.RuntimeMode = string(a.currentRuntimeMode())
	return out, nil
}

// SubmitReport posts a minimal JSON payload to the configured support
// endpoint. Validation errors return verbatim; upload failures degrade to
// Uploaded=false with a FallbackReason so the renderer can prompt the user
// to copy the request id manually.
func (a *App) SubmitReport(input SubmitReportInput) (SubmitReportResult, error) {
	desc := strings.TrimSpace(input.Description)
	if len(desc) < reportDescriptionMinLen {
		return SubmitReportResult{}, fmt.Errorf("submit report: description must be at least %d characters", reportDescriptionMinLen)
	}

	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}

	result := SubmitReportResult{}
	payload := report.ReportPayload{
		TaskID:       strings.TrimSpace(input.TaskID),
		Description:  desc,
		ContactEmail: strings.TrimSpace(input.ContactEmail),
		Timestamp:    time.Now().UTC().Format(time.RFC3339),
		Via:          "http",
		RuntimeMode:  string(a.currentRuntimeMode()),
	}

	if payload.TaskID != "" && a.localStore != nil {
		if requestID, err := a.localStore.LatestRequestID(ctx, payload.TaskID); err == nil {
			payload.RequestID = requestID
		}
		if events, err := a.localStore.QueryEventsByTask(ctx, payload.TaskID); err == nil {
			if failure := latestFailedEvent(events); failure != nil {
				payload.ErrorCode, payload.ErrorMessage = extractErrorFields(failure)
			}
		}
	}
	result.RequestID = payload.RequestID

	cap := a.detectReportCapability()
	if !cap.Enabled {
		result.FallbackReason = "capability_not_enabled"
		return result, nil
	}

	a.mu.Lock()
	s := a.cachedSettings
	a.mu.Unlock()
	endpoint := ""
	token := ""
	if s.SupportReportEndpoint != nil {
		endpoint = *s.SupportReportEndpoint
	}
	if s.SupportReportToken != nil {
		token = *s.SupportReportToken
	}
	sub := report.NewHTTPSubmitter(report.HTTPOptions{
		Endpoint:   endpoint,
		Token:      token,
		UserAgent:  fmt.Sprintf("OfficeDex/%s (%s; %s)", appVersion, runtime.GOOS, runtime.GOARCH),
		HTTPClient: a.proxyPool.NewClient(30 * time.Second),
	})
	sr, err := sub.Submit(ctx, payload)
	if err != nil {
		result.FallbackReason = fmt.Sprintf("http_upload_failed: %v", err)
		return result, nil
	}
	result.TicketID = sr.TicketID
	result.ViewURL = sr.ViewURL
	result.Uploaded = true
	return result, nil
}

// detectReportCapability resolves the inputs and runs report.DetectCapability.
// Never panics; on any unexpected condition returns a disabled snapshot.
func (a *App) detectReportCapability() report.ReportCapability {
	a.mu.Lock()
	s := a.cachedSettings
	client := a.bridgeClient
	a.mu.Unlock()

	endpoint := ""
	if s.SupportReportEndpoint != nil {
		endpoint = *s.SupportReportEndpoint
	}

	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}

	var capsPayload []byte
	if client != nil {
		if payload, err := client.GetCapabilities(ctx); err == nil {
			capsPayload = payload
		}
	}

	return report.DetectCapability(ctx, report.CapabilityOptions{
		HTTPEndpoint:        endpoint,
		CapabilitiesPayload: capsPayload,
	})
}

func (a *App) currentRuntimeMode() types.RuntimeMode {
	a.mu.Lock()
	mode := a.currentRuntimeModeLocked()
	a.mu.Unlock()
	return mode
}

// currentRuntimeModeLocked returns the cached runtime mode. Caller must hold
// a.mu; bridge event callbacks use this to avoid blocking the stdout reader by
// trying to acquire the same mutex twice.
func (a *App) currentRuntimeModeLocked() types.RuntimeMode {
	if a.cachedSettings.LlmProvider == nil {
		return types.RuntimeHosted
	}
	return types.RuntimeCustom
}

// latestFailedEvent walks the event slice in reverse and returns the most
// recent task.failed entry, or nil when none exists.
func latestFailedEvent(events []types.BridgeEvent) *types.BridgeEvent {
	for i := len(events) - 1; i >= 0; i-- {
		if events[i].Type == "task.failed" {
			ev := events[i]
			return &ev
		}
	}
	return nil
}

// extractErrorFields pulls error_code + error_message from a task.failed
// payload, handling both snake_case and camelCase keys the bridge has used
// over time. Falls back to ("unknown", message) when no explicit code field
// is present.
func extractErrorFields(ev *types.BridgeEvent) (string, string) {
	code := stringField(ev.Payload, "error_code", "errorCode", "code")
	message := stringField(ev.Payload, "error_message", "errorMessage", "message", "error")
	if code == "" {
		code = "unknown"
	}
	if len(message) > reportErrorMessageCap {
		message = message[:reportErrorMessageCap]
	}
	return code, message
}

func stringField(payload map[string]any, keys ...string) string {
	if payload == nil {
		return ""
	}
	for _, k := range keys {
		if v, ok := payload[k]; ok {
			if s, ok := v.(string); ok && s != "" {
				return s
			}
		}
	}
	return ""
}

// ─── Internals ──────────────────────────────────────────────────────────────

func (a *App) ensureBridge() (*bridge.Client, error) {
	a.mu.Lock()
	if a.bridgeClient != nil {
		client := a.bridgeClient
		a.mu.Unlock()
		if !client.Connected() {
			if err := client.Start(a.ctx); err != nil {
				return nil, err
			}
		}
		return client, nil
	}

	settingsValue := a.cachedSettings
	a.mu.Unlock()

	resolved := binresolver.Resolve(a.resolverOptions(settingsValue))
	if resolved.Source == binresolver.SourceFallback {
		message := "OfficeCLI binary is not configured. Install it or set a Bridge binary path in Settings."
		if a.ctx != nil {
			wailsruntime.EventsEmit(a.ctx, bridgeEventChannel, types.BridgeEvent{
				Type:    "bridge.unconfigured",
				Payload: map[string]any{"message": message},
			})
		}
		return nil, errors.New(message)
	}

	env := llmProviderEnv(settingsValue)

	a.mu.Lock()
	a.resolvedBinaryPath = resolved.Path
	a.resolvedBinaryEnv = env
	a.binaryResolvedAt = time.Now()
	a.mu.Unlock()

	client := bridge.New(bridge.Options{
		BinaryPath:     resolved.Path,
		Env:            env,
		Cwd:            a.workspaceDir,
		LogDir:         filepath.Join(a.userDataDir, "logs"),
		RequestTimeout: 30 * time.Second,
	})
	ctx := a.ctx
	client.OnEvent(func(event types.BridgeEvent) {
		if strings.HasPrefix(event.Type, "bridge.") {
			emit(ctx, bridgeEventChannel, event)
			return
		}
		if event.Type == "task.started" {
			a.mu.Lock()
			mode := a.currentRuntimeModeLocked()
			env := append([]string(nil), a.resolvedBinaryEnv...)
			at := a.binaryResolvedAt
			a.mu.Unlock()
			if mode != "" {
				if event.Payload == nil {
					event.Payload = map[string]any{}
				}
				event.Payload["runtime_mode"] = string(mode)
				if mode == types.RuntimeCustom {
					if p := providerSnapshotFromEnv(env); p != nil {
						event.Payload["runtime_provider"] = map[string]any{
							"type":           string(p.Type),
							"base_url_host":  p.BaseURLHost,
							"model":          p.Model,
							"api_key_masked": p.APIKeyMasked,
							"api_key_length": p.APIKeyLength,
						}
						if !at.IsZero() {
							event.Payload["runtime_applied_at"] = at.UTC().Format(time.RFC3339)
						}
					}
				}
			}
		}
		if a.localStore != nil {
			_ = a.localStore.RecordEvent(event)
		}
		if event.Type == "task.completed" || event.Type == "task.failed" {
			if a.localStore != nil && event.Payload != nil {
				if c, ok := event.Payload["credits_charged"].(float64); ok {
					charged := int(c)
					mode, _ := event.Payload["credit_mode"].(string)
					if err := a.localStore.RecordTaskCredit(event.TaskID, &charged, mode); err != nil {
						wailsruntime.LogWarningf(ctx, "record task credit: %v", err)
					}
				}
			}
		}
		if event.Type == "task.completed" {
			if artifact := artifactFromCompletedEvent(event); artifact != nil {
				if err := a.previewReg.AllowArtifact(*artifact); err != nil {
					wailsruntime.LogWarningf(ctx, "preview register: %v", err)
				}
				if a.localStore != nil {
					_ = a.localStore.RecordArtifact(*artifact)
				}
			}
		}
		emit(ctx, bridgeEventChannel, event)
	})

	if err := client.Start(a.ctx); err != nil {
		return nil, err
	}

	a.mu.Lock()
	a.bridgeClient = client
	a.mu.Unlock()
	return client, nil
}

func (a *App) ensureLoginManagerLocked() *login.Manager {
	if a.loginManager != nil {
		return a.loginManager
	}
	path, env := a.resolvedBinaryLocked()
	manager := login.New(login.ManagerOptions{
		BinaryPath: path,
		Env:        env,
		URLTimeout: 30 * time.Second,
	})
	ctx := a.ctx
	unsub := manager.OnEvent(func(event login.LoginEvent) {
		switch event.Type {
		case login.EventSuccess:
			a.mu.Lock()
			a.pendingLoginURL = ""
			a.mu.Unlock()
			emit(ctx, authEventChannel, types.AuthEvent{Type: types.AuthEventSuccess})
		case login.EventFailure:
			a.mu.Lock()
			a.pendingLoginURL = ""
			a.mu.Unlock()
			emit(ctx, authEventChannel, types.AuthEvent{Type: types.AuthEventFailure, Message: event.Message})
		case login.EventExit:
			a.mu.Lock()
			a.pendingLoginURL = ""
			a.mu.Unlock()
			emit(ctx, authEventChannel, types.AuthEvent{Type: types.AuthEventExit, Code: event.Code, Signal: event.Signal})
		}
	})
	a.loginManager = manager
	a.loginUnsub = unsub
	return manager
}

func (a *App) runCommandOptions() login.ManagerOptions {
	a.mu.Lock()
	defer a.mu.Unlock()
	path, env := a.resolvedBinaryLocked()
	return login.ManagerOptions{
		BinaryPath: path,
		Env:        env,
	}
}

// resolvedBinaryLocked returns the cached binary path + provider env, running
// binresolver / llmProviderEnv at most once per settings change. Caller must
// hold a.mu. The cache is invalidated by UpdateSettings when touchesBridge=true.
func (a *App) resolvedBinaryLocked() (string, []string) {
	if a.resolvedBinaryPath != "" {
		return a.resolvedBinaryPath, a.resolvedBinaryEnv
	}
	path := binresolver.ResolvePath(a.resolverOptions(a.cachedSettings))
	env := toEnvSlice(llmProviderEnv(a.cachedSettings))
	a.resolvedBinaryPath = path
	a.resolvedBinaryEnv = env
	a.binaryResolvedAt = time.Now()
	return path, env
}

func (a *App) resolverOptions(s types.UserSettings) binresolver.Options {
	var userPath *string
	if s.BridgeBinaryPath != nil && strings.TrimSpace(*s.BridgeBinaryPath) != "" {
		userPath = s.BridgeBinaryPath
	}
	bundled := a.bundledBinaryPath()
	var bundledPtr *string
	if bundled != "" {
		bundledPtr = &bundled
	}
	env := os.Getenv("OFFICECLI_DESKTOP_BINARY")
	var envPtr *string
	if env != "" {
		envPtr = &env
	}
	var managedPtr *string
	if a.runtimeMgr != nil {
		status := a.runtimeMgr.Status()
		if status.Installed {
			mp := a.runtimeMgr.ManagedBinaryPath()
			managedPtr = &mp
		}
	}
	return binresolver.Options{
		UserBinaryPath:    userPath,
		BundledBinaryPath: bundledPtr,
		ManagedBinaryPath: managedPtr,
		EnvBinaryPath:     envPtr,
	}
}

func (a *App) bundledBinaryPath() string {
	exe := ""
	if resolvedExe, err := os.Executable(); err == nil {
		exe = resolvedExe
	}
	cwd := ""
	if resolvedCwd, err := os.Getwd(); err == nil {
		cwd = resolvedCwd
	}
	return findBundledBinaryPath(runtime.GOOS, exe, cwd, func(candidate string) bool {
		_, err := os.Stat(candidate)
		return err == nil
	})
}

func findBundledBinaryPath(goos, exePath, cwd string, exists func(string) bool) string {
	binaryName := "officecli"
	if goos == "windows" {
		binaryName = "officecli.exe"
	}
	if exePath != "" {
		exeDir := filepath.Dir(exePath)
		candidates := []string{
			// Packaged macOS Wails app: <App>.app/Contents/Resources/officecli/<binary>
			filepath.Join(exeDir, "..", "Resources", "officecli", binaryName),
			// Windows release zip: OfficeDex.exe sits beside officecli/<binary>.
			filepath.Join(exeDir, "officecli", binaryName),
		}
		for _, candidate := range candidates {
			if exists(candidate) {
				return filepath.Clean(candidate)
			}
		}
	}
	if cwd != "" {
		candidate := filepath.Join(cwd, "build", "officecli", binaryName)
		if exists(candidate) {
			return candidate
		}
	}
	return ""
}

func (a *App) resolveExtrenderBinary() string {
	binaryName := "extrender"
	if runtime.GOOS == "windows" {
		binaryName = "extrender.exe"
	}

	exe, err := os.Executable()
	if err == nil {
		candidate := filepath.Join(filepath.Dir(exe), "..", "Resources", "extrender", binaryName)
		if _, err := os.Stat(candidate); err == nil {
			abs, _ := filepath.Abs(candidate)
			return abs
		}
	}

	if cwd, err := os.Getwd(); err == nil {
		platformDir := resolveExtrenderPlatformDir()
		candidate := filepath.Join(cwd, "build", "extrender", platformDir, binaryName)
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	return ""
}

func resolveExtrenderPlatformDir() string {
	switch runtime.GOOS + "/" + runtime.GOARCH {
	case "darwin/arm64":
		return "mac-arm64"
	case "windows/amd64":
		return "win-x64"
	default:
		return runtime.GOOS + "-" + runtime.GOARCH
	}
}

func (a *App) resolveGenerateInput(input types.GenerateInput, s types.UserSettings) (types.GenerateInput, error) {
	// Caller-provided OutputDir wins. This is the seam the future
	// "continue editing" path uses to reuse a prior task's directory so
	// follow-up edits land alongside the original artifact.
	if strings.TrimSpace(input.OutputDir) != "" {
		outputDir, err := cleanGenerateOutputDir(input.OutputDir)
		if err != nil {
			return types.GenerateInput{}, err
		}
		out := input
		out.OutputDir = outputDir
		return out, nil
	}
	base := a.workspaceDir
	if s.OutputDir != nil && strings.TrimSpace(*s.OutputDir) != "" {
		outputDir, err := cleanGenerateOutputDir(*s.OutputDir)
		if err != nil {
			return types.GenerateInput{}, err
		}
		base = outputDir
	}
	taskDir := filepath.Join(base, buildTaskDirName(input.Topic, string(input.DocumentType)))
	if err := os.MkdirAll(taskDir, 0o755); err != nil {
		return types.GenerateInput{}, fmt.Errorf("mkdir task output dir: %w", err)
	}
	out := input
	out.OutputDir = taskDir
	return out, nil
}

func cleanGenerateOutputDir(outputDir string) (string, error) {
	cleaned := strings.TrimSpace(outputDir)
	if strings.ContainsRune(cleaned, 0) {
		return "", errors.New("generate output dir is invalid")
	}
	if !filepath.IsAbs(cleaned) {
		return "", errors.New("generate output dir must be absolute")
	}
	return cleaned, nil
}

func (a *App) refreshPreviewTrustedRoots(s types.UserSettings) error {
	if a.previewReg == nil {
		return nil
	}
	if err := a.previewReg.SetTrustedRoots(previewTrustedRoots(a.workspaceDir, s)); err != nil {
		return fmt.Errorf("refresh preview trusted roots: %w", err)
	}
	return nil
}

func previewTrustedRoots(workspaceDir string, s types.UserSettings) []string {
	roots := []string{workspaceDir}
	if s.OutputDir == nil {
		return roots
	}
	outputDir := strings.TrimSpace(*s.OutputDir)
	if outputDir == "" || strings.ContainsRune(outputDir, 0) || !filepath.IsAbs(outputDir) {
		return roots
	}
	return append(roots, outputDir)
}

// buildTaskDirName returns a unique, filesystem-safe folder name for a single
// generation task. The format is `<yyyymmdd-HHMMSS>-<slug>-<shortid>` so the
// directories sort chronologically and remain readable when browsed.
func buildTaskDirName(topic, docType string) string {
	slug := slugify(topic)
	if slug == "" {
		slug = slugify(docType)
	}
	if slug == "" {
		slug = "task"
	}
	short := strings.ReplaceAll(uuid.New().String(), "-", "")
	if len(short) > 8 {
		short = short[:8]
	}
	return fmt.Sprintf("%s-%s-%s", time.Now().Format("20060102-150405"), slug, short)
}

// slugify maps an arbitrary topic/document-type label to an ASCII, lowercase,
// hyphen-separated slug capped at 40 characters. Non-ASCII characters
// (e.g. CJK) are dropped entirely; if the result would be empty the caller
// falls back to a sensible default.
func slugify(input string) string {
	var b strings.Builder
	b.Grow(len(input))
	lastDash := true
	for _, r := range strings.ToLower(strings.TrimSpace(input)) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			lastDash = false
		default:
			if !lastDash {
				b.WriteByte('-')
				lastDash = true
			}
		}
		if b.Len() >= 40 {
			break
		}
	}
	return strings.Trim(b.String(), "-")
}

func llmProviderEnv(s types.UserSettings) []string {
	out := []string{}
	if s.LlmProvider == nil {
		out = append(out, "OFFICE_CLI_RUNTIME_MODE=hosted")
		return out
	}
	out = append(out, "OFFICE_CLI_RUNTIME_MODE=custom")
	if s.LlmProvider.Type != "" {
		out = append(out, "OFFICECLI_LLM_PROVIDER="+string(s.LlmProvider.Type))
	}
	if s.LlmProvider.BaseURL != "" {
		out = append(out, "OFFICECLI_LLM_BASE_URL="+s.LlmProvider.BaseURL)
	}
	if s.LlmProvider.APIKey != "" {
		out = append(out, "OFFICECLI_LLM_API_KEY="+s.LlmProvider.APIKey)
	}
	if s.LlmProvider.Model != "" {
		out = append(out, "OFFICECLI_LLM_MODEL="+s.LlmProvider.Model)
	}
	return out
}

// validateCustomProvider rejects Generate calls that would silently fall
// through to officecli's built-in default endpoint. When the user selects
// custom mode without supplying BaseURL/APIKey/Model, the subprocess
// receives OFFICE_CLI_RUNTIME_MODE=custom but no provider env, and
// officecli routes the request to its hosted fallback — which is misleading.
// Block here with a sentinel error the renderer can translate.
func validateCustomProvider(s types.UserSettings) error {
	if s.LlmProvider == nil {
		return nil
	}
	if s.LlmProvider == nil {
		return errors.New("generate.custom_provider_missing")
	}
	if strings.TrimSpace(s.LlmProvider.BaseURL) == "" ||
		strings.TrimSpace(s.LlmProvider.APIKey) == "" ||
		strings.TrimSpace(s.LlmProvider.Model) == "" {
		return errors.New("generate.custom_provider_incomplete")
	}
	return nil
}

func (a *App) requireLoggedInForCustomProvider(s types.UserSettings) error {
	if s.LlmProvider == nil {
		return nil
	}
	return a.requireLoggedInForProvider(s.LlmProvider)
}

func (a *App) requireLoggedInForProvider(provider *types.LlmProvider) error {
	if provider == nil {
		return nil
	}
	opts := a.runCommandOptions()
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	whoami, err := login.GetWhoAmI(ctx, opts)
	if err != nil {
		return fmt.Errorf("custom_provider.login_required: %w", err)
	}
	if whoami.Mode != types.WhoAmILoggedIn {
		return errors.New("custom_provider.login_required")
	}
	return nil
}

// toEnvSlice keeps callers symmetric: many of them already pass []string-shaped
// env so this is a no-op pass-through for now.
func toEnvSlice(env []string) []string {
	return env
}

func dialogFilters(options *FileDialogOptions) []wailsruntime.FileFilter {
	if options == nil || len(options.Filters) == 0 {
		return []wailsruntime.FileFilter{
			{DisplayName: "All Files (*.*)", Pattern: "*.*"},
		}
	}
	out := make([]wailsruntime.FileFilter, 0, len(options.Filters))
	for _, f := range options.Filters {
		pattern := strings.Join(toGlobPatterns(f.Extensions), ";")
		out = append(out, wailsruntime.FileFilter{
			DisplayName: f.Name,
			Pattern:     pattern,
		})
	}
	return out
}

func toGlobPatterns(extensions []string) []string {
	out := make([]string, 0, len(extensions))
	for _, ext := range extensions {
		ext = strings.TrimPrefix(ext, ".")
		if ext == "" || ext == "*" {
			out = append(out, "*.*")
			continue
		}
		out = append(out, "*."+ext)
	}
	return out
}

func openOSPath(filePath string) error {
	switch runtime.GOOS {
	case "darwin":
		return subprocess.Command("open", filePath).Start()
	case "windows":
		return subprocess.Command("cmd", "/c", "start", "", filePath).Start()
	default:
		return subprocess.Command("xdg-open", filePath).Start()
	}
}

func revealOSPath(filePath string) error {
	switch runtime.GOOS {
	case "darwin":
		return subprocess.Command("open", "-R", filePath).Start()
	case "windows":
		return subprocess.Command("explorer", "/select,", filePath).Start()
	default:
		return subprocess.Command("xdg-open", filepath.Dir(filePath)).Start()
	}
}

func emit(ctx context.Context, channel string, payload any) {
	if ctx == nil {
		return
	}
	wailsruntime.EventsEmit(ctx, channel, payload)
}

func artifactFromCompletedEvent(event types.BridgeEvent) *types.Artifact {
	if event.Type != "task.completed" {
		return nil
	}
	var raw map[string]any
	if r, ok := event.Payload["result"]; ok {
		raw, _ = r.(map[string]any)
	}
	if raw == nil {
		raw = event.Payload
	}
	if raw == nil {
		return nil
	}
	body, err := json.Marshal(raw)
	if err != nil {
		return nil
	}
	artifact := bridge.ResultToArtifact(body)
	if artifact == nil {
		return nil
	}
	artifact.TaskID = event.TaskID
	return artifact
}

// resolveUserDataDir mirrors what Electron's app.getPath("userData") returns.
func resolveUserDataDir(appName string) (string, error) {
	switch runtime.GOOS {
	case "darwin":
		home, err := os.UserHomeDir()
		if err == nil {
			return filepath.Join(home, "Library", "Application Support", appName), nil
		}
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, appName), nil
}
