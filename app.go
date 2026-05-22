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
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"officedex/internal/binresolver"
	"officedex/internal/bridge"
	"officedex/internal/localstore"
	"officedex/internal/login"
	"officedex/internal/preview"
	"officedex/internal/settings"
	"officedex/internal/types"
)

const (
	appName             = "OfficeDex"
	previewExtraWidth   = 500
	bridgeEventChannel  = "bridge:event"
	authEventChannel    = "auth:event"
	previewEventChannel = "preview:open"
)

// App is the Wails-bound object surfaced to the renderer.
type App struct {
	ctx context.Context

	userDataDir  string
	workspaceDir string

	settingsStore *settings.Store
	localStore    *localstore.Store
	previewReg    *preview.Registry

	mu              sync.Mutex
	cachedSettings  types.UserSettings
	bridgeClient    *bridge.Client
	loginManager    *login.Manager
	loginUnsub      func()
	pendingLoginURL string
	previewModeWidthBefore int
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
		TrustedRoots: []string{workspaceDir},
	})
	if err != nil {
		return nil, fmt.Errorf("preview registry: %w", err)
	}

	localStore := localstore.New(filepath.Join(userDataDir, "officedex.sqlite"))

	return &App{
		userDataDir:    userDataDir,
		workspaceDir:   workspaceDir,
		settingsStore:  settingsStore,
		localStore:     localStore,
		previewReg:     previewReg,
		cachedSettings: cached,
	}, nil
}

// startup is called by Wails after the renderer is ready. The context is
// retained so binding methods can dispatch events and open OS dialogs.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	if err := a.localStore.Open(ctx); err != nil {
		wailsruntime.LogErrorf(ctx, "open local store: %v", err)
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

// GenerateResult is the renderer-facing shape of a task invocation result.
type GenerateResult struct {
	TaskID    string `json:"taskId"`
	SessionID string `json:"sessionId"`
	Status    string `json:"status"`
}

// Generate dispatches `office.generate` against the agent bridge after
// applying settings-driven defaults (output dir, runtime mode).
func (a *App) Generate(input types.GenerateInput) (GenerateResult, error) {
	client, err := a.ensureBridge()
	if err != nil {
		return GenerateResult{}, err
	}
	settings, err := a.settingsStore.Load()
	if err != nil {
		return GenerateResult{}, fmt.Errorf("load settings: %w", err)
	}
	resolved, err := a.resolveGenerateInput(input, settings)
	if err != nil {
		return GenerateResult{}, err
	}
	result, err := client.InvokeGenerate(a.ctx, resolved)
	if err != nil {
		return GenerateResult{}, err
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

// SetPreviewMode resizes the main window to make room for the preview pane,
// or restores the pre-preview width when active is false.
func (a *App) SetPreviewMode(active bool) error {
	if a.ctx == nil {
		return errors.New("app: not started")
	}
	w, h := wailsruntime.WindowGetSize(a.ctx)
	a.mu.Lock()
	defer a.mu.Unlock()
	if active {
		a.previewModeWidthBefore = w
		wailsruntime.WindowSetSize(a.ctx, w+previewExtraWidth, h)
		return nil
	}
	if a.previewModeWidthBefore > 0 {
		wailsruntime.WindowSetSize(a.ctx, a.previewModeWidthBefore, h)
		a.previewModeWidthBefore = 0
	}
	return nil
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

// PreviewHTML is the renderer-facing wrapper for a sidecar HTML preview.
type PreviewHTML struct {
	HTML string `json:"html"`
}

// RenderPreviewHtml returns the `*.preview.html` sidecar next to an artifact,
// or nil when the sidecar does not exist.
func (a *App) RenderPreviewHtml(previewToken string) (*PreviewHTML, error) {
	entry, err := a.previewReg.ResolveToken(previewToken)
	if err != nil {
		return nil, err
	}
	ext := filepath.Ext(entry.FilePath)
	base := strings.TrimSuffix(entry.FilePath, ext)
	sidecar := base + ".preview.html"
	body, err := os.ReadFile(sidecar)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, fmt.Errorf("read sidecar: %w", err)
	}
	return &PreviewHTML{HTML: string(body)}, nil
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
		wailsruntime.BrowserOpenURL(a.ctx, url)
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

// Logout runs `officecli logout`.
func (a *App) Logout() error {
	opts := a.runCommandOptions()
	return login.Logout(a.ctx, opts)
}

// ─── Settings bindings ──────────────────────────────────────────────────────

// GetSettings returns the current sanitized settings.
func (a *App) GetSettings() (types.UserSettings, error) {
	return a.settingsStore.Load()
}

// UpdateSettings applies a patch and restarts the bridge if the change might
// affect it (binary path, LLM provider, runtime mode).
func (a *App) UpdateSettings(patch settings.Patch) (types.UserSettings, error) {
	merged, err := a.settingsStore.Update(patch)
	if err != nil {
		return types.UserSettings{}, err
	}
	a.mu.Lock()
	a.cachedSettings = merged
	touchesBridge := patch.BridgeBinaryPath != nil ||
		patch.LlmProvider != nil ||
		patch.ClearLlmProvider ||
		(patch.Defaults != nil && patch.Defaults.RuntimeMode != nil)
	client := a.bridgeClient
	if touchesBridge {
		a.bridgeClient = nil
	}
	if patch.BridgeBinaryPath != nil {
		a.loginManager = nil
		if a.loginUnsub != nil {
			a.loginUnsub()
			a.loginUnsub = nil
		}
	}
	a.mu.Unlock()

	if touchesBridge && client != nil {
		client.Stop()
	}
	return merged, nil
}

// GetDefaultWorkspaceDir returns the per-user workspace folder.
func (a *App) GetDefaultWorkspaceDir() string {
	return a.workspaceDir
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

	client := bridge.New(bridge.Options{
		BinaryPath: resolved.Path,
		Env:        llmProviderEnv(settingsValue),
		Cwd:        a.workspaceDir,
		RequestTimeout: 30 * time.Second,
	})
	ctx := a.ctx
	client.OnEvent(func(event types.BridgeEvent) {
		if strings.HasPrefix(event.Type, "bridge.") {
			emit(ctx, bridgeEventChannel, event)
			return
		}
		if a.localStore != nil {
			_ = a.localStore.RecordEvent(event)
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
	manager := login.New(login.ManagerOptions{
		BinaryPath: binresolver.ResolvePath(a.resolverOptions(a.cachedSettings)),
		Env:        toEnvSlice(llmProviderEnv(a.cachedSettings)),
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
	return login.ManagerOptions{
		BinaryPath: binresolver.ResolvePath(a.resolverOptions(a.cachedSettings)),
		Env:        toEnvSlice(llmProviderEnv(a.cachedSettings)),
	}
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
	return binresolver.Options{
		UserBinaryPath:    userPath,
		BundledBinaryPath: bundledPtr,
		EnvBinaryPath:     envPtr,
	}
}

func (a *App) bundledBinaryPath() string {
	binaryName := "officecli"
	if runtime.GOOS == "windows" {
		binaryName = "officecli.exe"
	}
	// Packaged Wails app: <App>.app/Contents/Resources/officecli/<binary>
	// Dev: <repo>/build/officecli/<binary>
	exe, err := os.Executable()
	if err == nil {
		candidate := filepath.Join(filepath.Dir(exe), "..", "Resources", "officecli", binaryName)
		if _, err := os.Stat(candidate); err == nil {
			abs, _ := filepath.Abs(candidate)
			return abs
		}
	}
	if cwd, err := os.Getwd(); err == nil {
		candidate := filepath.Join(cwd, "build", "officecli", binaryName)
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	return ""
}

func (a *App) resolveGenerateInput(input types.GenerateInput, s types.UserSettings) (types.GenerateInput, error) {
	if strings.TrimSpace(input.OutputDir) != "" {
		return input, nil
	}
	if s.OutputDir != nil && strings.TrimSpace(*s.OutputDir) != "" {
		if err := os.MkdirAll(*s.OutputDir, 0o755); err != nil {
			return types.GenerateInput{}, fmt.Errorf("mkdir output dir: %w", err)
		}
		out := input
		out.OutputDir = *s.OutputDir
		return out, nil
	}
	out := input
	out.OutputDir = a.workspaceDir
	return out, nil
}

func llmProviderEnv(s types.UserSettings) []string {
	if s.Defaults.RuntimeMode != types.RuntimeExternal || s.LlmProvider == nil {
		return nil
	}
	out := []string{}
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
		return exec.Command("open", filePath).Start()
	case "windows":
		return exec.Command("cmd", "/c", "start", "", filePath).Start()
	default:
		return exec.Command("xdg-open", filePath).Start()
	}
}

func revealOSPath(filePath string) error {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", "-R", filePath).Start()
	case "windows":
		return exec.Command("explorer", "/select,", filePath).Start()
	default:
		return exec.Command("xdg-open", filepath.Dir(filePath)).Start()
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
