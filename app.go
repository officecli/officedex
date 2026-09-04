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
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"officedex/internal/config"
	"officedex/internal/runtimeenv"
	"officedex/internal/taskrecovery"
	"officedex/internal/watermark"
	"officedex/internal/workspace"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"officedex/internal/applog"
	"officedex/internal/appupdate"
	"officedex/internal/bridge"
	"officedex/internal/demoflow"
	"officedex/internal/instance"
	"officedex/internal/localstore"
	"officedex/internal/login"
	"officedex/internal/mophttp"
	"officedex/internal/netproxy"
	"officedex/internal/office2modoc"
	"officedex/internal/pptxeditor"
	"officedex/internal/preview"
	runtimemgr "officedex/internal/runtime"
	"officedex/internal/settings"
	"officedex/internal/timeline"
	"officedex/internal/types"
	"officedex/internal/xlsxeditor"
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

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// appVersion is injected at build time via `-ldflags "-X main.appVersion=<v>"`.
// The default "dev" sentinel makes `go run` / `wails dev` work without flags.
var appVersion = "dev"

type DesktopNotificationInput struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

type desktopNotificationRuntime interface {
	IsNotificationAvailable(context.Context) bool
	CheckNotificationAuthorization(context.Context) (bool, error)
	RequestNotificationAuthorization(context.Context) (bool, error)
	SendNotification(context.Context, wailsruntime.NotificationOptions) error
}

type pptxJSPlanner interface {
	PlanPptxJS(context.Context, bridge.PlanPptxJSInput) (bridge.PlanPptxJSResult, error)
}

type PlanPptxJSInput struct {
	Prompt  string           `json:"prompt"`
	Context any              `json:"context"`
	History []PlanPptxJSTurn `json:"history,omitempty"`
}
type PlanPptxJSTurn struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}
type PlanPptxJSResult = bridge.PlanPptxJSResult

// PlanPptxJS asks OfficeCLI for an Office.js PowerPoint.run plan. The plan is
// returned to the embedded editor for explicit user confirmation and execution.
func (a *App) PlanPptxJS(input PlanPptxJSInput) (PlanPptxJSResult, error) {
	if strings.TrimSpace(input.Prompt) == "" {
		return PlanPptxJSResult{}, errors.New("plan pptx: prompt is required")
	}
	if input.Context == nil {
		return PlanPptxJSResult{}, errors.New("plan pptx: context is required")
	}
	history := make([]bridge.PlanPptxJSTurn, 0, len(input.History))
	for _, turn := range input.History {
		if strings.TrimSpace(turn.Content) != "" {
			history = append(history, bridge.PlanPptxJSTurn{Role: turn.Role, Content: strings.TrimSpace(turn.Content)})
		}
	}
	planner := a.pptxJSPlanner
	if planner == nil {
		client, err := a.ensureBridge()
		if err != nil {
			return PlanPptxJSResult{}, err
		}
		planner = client
	}
	result, err := planner.PlanPptxJS(a.ctx, bridge.PlanPptxJSInput{Prompt: strings.TrimSpace(input.Prompt), Context: input.Context, History: history})
	if err != nil {
		return PlanPptxJSResult{}, fmt.Errorf("plan pptx: %w", err)
	}
	if strings.TrimSpace(result.Source) == "" {
		return PlanPptxJSResult{}, errors.New("plan pptx: empty source")
	}
	if result.Warnings == nil {
		result.Warnings = []string{}
	}
	if strings.EqualFold(result.Confidence, "low") {
		result.RequiresConfirmation = true
		if result.Confirmation == nil {
			result.Confirmation = &bridge.PlanPptxJSConfirmation{Message: result.Summary}
		}
	}
	return result, nil
}

type xlsxEditorService interface {
	Prepare(context.Context, string) (xlsxeditor.PrepareResult, error)
	Save(context.Context, string, string, string, []xlsxeditor.ManagedSheet) (xlsxeditor.SaveResult, error)
	StageImage(string, string, []byte, string, string, int, int, int) (xlsxeditor.StageImageResult, error)
	Close(string, string) error
	CloseByToken(string) error
	CloseAll() error
	CleanupStale() error
}

var errXlsxEditorUnavailable = errors.New("XLSX editor is unavailable")

// editorSessionLifecycle is what every editor service shares: the app opens
// none of the sessions itself, but it retires stale ones at startup, closes
// them all at shutdown and closes the ones behind a revoked preview token.
// The three lifecycle sites used to spell out each service by name, so a new
// editor meant editing all three.
type editorSessionLifecycle interface {
	CleanupStale() error
	CloseAll() error
	CloseByToken(string) error
}

type editorSession struct {
	label   string
	service editorSessionLifecycle
}

// editorSessions lists the editor services that are configured, with the
// document type each serves.
func (a *App) editorSessions() []editorSession {
	var out []editorSession
	if a.xlsxEditorService != nil {
		out = append(out, editorSession{label: string(types.DocXLSX), service: a.xlsxEditorService})
	}
	if a.pptxEditorService != nil {
		out = append(out, editorSession{label: string(types.DocPPTX), service: a.pptxEditorService})
	}
	return out
}

type pptxEditorService interface {
	Prepare(context.Context, string) (pptxeditor.PrepareResult, error)
	SaveSnapshot(string, string, []byte, int, int) (pptxeditor.SaveResult, error)
	SaveAsset(string, string, string, string, []byte) (pptxeditor.SaveAssetResult, error)
	Export(context.Context, string, string, int) (pptxeditor.SaveResult, error)
	Close(string, string) error
	CloseByToken(string) error
	CloseByFile(string) error
	CloseAll() error
	CleanupStale() error
}

var errPptxEditorUnavailable = errors.New("PPTX editor is unavailable")

type wailsDesktopNotificationRuntime struct{}

func (wailsDesktopNotificationRuntime) IsNotificationAvailable(ctx context.Context) bool {
	return wailsruntime.IsNotificationAvailable(ctx)
}

func (wailsDesktopNotificationRuntime) CheckNotificationAuthorization(ctx context.Context) (bool, error) {
	return wailsruntime.CheckNotificationAuthorization(ctx)
}

func (wailsDesktopNotificationRuntime) RequestNotificationAuthorization(ctx context.Context) (bool, error) {
	return wailsruntime.RequestNotificationAuthorization(ctx)
}

func (wailsDesktopNotificationRuntime) SendNotification(ctx context.Context, options wailsruntime.NotificationOptions) error {
	return wailsruntime.SendNotification(ctx, options)
}

// App is the Wails-bound object surfaced to the renderer.
type App struct {
	ctx context.Context

	userDataDir       string
	workspaceDir      string
	runtimeRoot       string
	desktopInstanceID string

	settingsStore *settings.Store
	localStore    *localstore.Store
	// eventWrites serialises task-event persistence off the bridge's stdout
	// reader. Recording used to happen inline on that goroutine, so every
	// frame waited on a SQLite transaction holding the store's single lock,
	// and a dense op stream backed up into the child process's stdout pipe.
	eventWrites   chan func()
	eventWritesWG sync.WaitGroup
	// eventWritesMu guards the queue's lifecycle: queueEventWrite holds it
	// for reading while it enqueues, drainEventWrites takes it for writing to
	// close. Without it a task event arriving from a retired bridge during
	// shutdown could send on the closed channel and panic the app on exit.
	eventWritesMu     sync.RWMutex
	eventWritesClosed bool
	previewReg        *preview.Registry
	demoFlow          *demoflow.Engine

	mu             sync.Mutex
	cachedSettings types.UserSettings
	// runtimeMode mirrors cachedSettings' provider choice for lock-free readers.
	runtimeMode atomic.Value
	// bridgeClients holds one live child process per working directory, keyed
	// by that cwd. A single slot meant starting a task in a second workspace
	// swapped the first workspace's process out, and every later call for the
	// first task — an answer, a cancel — swapped it back, starting a third
	// process that had never heard of the task. Tasks live inside their
	// process, so the process has to outlive the call that is not about it.
	bridges           bridgePool
	pptxJSPlanner     pptxJSPlanner
	loginManager      *login.Manager
	loginUnsub        func()
	pendingLoginURL   string
	preview           previewRestore
	appUpdateMgr      *appupdate.Manager
	runtimeMgr        *runtimemgr.Manager
	proxyPool         *netproxy.Pool
	xlsxEditorService xlsxEditorService
	pptxEditorService pptxEditorService
	mopHTTPHandler    http.Handler
	timelineStore     *timeline.Store

	binary binaryCache

	creditStatus creditStatusCache

	recovery recoveryRoutes

	notificationMu                   sync.Mutex
	notificationAuthorizationGranted bool
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
		TrustedRoots: workspace.TrustedRoots(workspaceDir, cached),
	})
	if err != nil {
		return nil, fmt.Errorf("preview registry: %w", err)
	}

	localStore := localstore.New(filepath.Join(userDataDir, "officedex.sqlite"))
	identity, err := instance.LoadOrCreate(userDataDir)
	if err != nil {
		return nil, fmt.Errorf("load instance identity: %w", err)
	}

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
		userDataDir:       userDataDir,
		workspaceDir:      workspaceDir,
		runtimeRoot:       filepath.Join(userDataDir, "runtime"),
		desktopInstanceID: identity.DesktopInstanceID,
		settingsStore:     settingsStore,
		localStore:        localStore,
		previewReg:        previewReg,
		cachedSettings:    cached,
		proxyPool:         proxyPool,
	}
	repoRoot, ok := config.ProcessCwd()
	if !ok {
		return nil, errors.New("resolve XLSX editor repo root: working directory unavailable")
	}
	app.xlsxEditorService = xlsxeditor.NewService(previewReg, office2modoc.New(repoRoot), os.TempDir())
	app.pptxEditorService = pptxeditor.NewService(previewReg, pptxeditor.NewCLIConverter(repoRoot), os.TempDir())
	app.storeRuntimeModeSnapshot(cached)
	app.startEventWriter()
	app.timelineStore = timeline.New(filepath.Join(workspaceDir, "timeline"), pptxeditor.NewCLIConverter(repoRoot))
	blankTemplatePath := filepath.Join(userDataDir, "blank-presentation.pptx")
	if _, statErr := os.Stat(blankTemplatePath); os.IsNotExist(statErr) {
		if err := os.WriteFile(blankTemplatePath, blankPptxDraft, 0o644); err != nil {
			return nil, fmt.Errorf("write blank presentation template: %w", err)
		}
	} else if statErr != nil {
		return nil, fmt.Errorf("stat blank presentation template: %w", statErr)
	}
	presentationRoot := runtimeenv.Root(repoRoot)
	converterPath := ""
	if presentationRoot != "" {
		converterPath = config.ExecutableFile(filepath.Join(presentationRoot, "tools", "bin", "mop-convert"))
	}
	if converterPath == "" {
		converterPath = resolveMopConvertFromEnvironment()
	}
	// The MOP handler takes a printf-style callback, so its lines arrive
	// pre-formatted; the component attribute is what keeps them findable.
	mopLog := applog.With(slog.String("component", "mophttp"))
	mopHandler := mophttp.New(mophttp.Options{
		Root:              filepath.Join(workspaceDir, "mop-packages"),
		Converter:         mophttp.NewCLIConverter(converterPath),
		BlankTemplatePath: blankTemplatePath,
		Capabilities:      mophttp.Capabilities{ProtocolVersion: mophttp.DefaultProtocolVersion, SchemaVersion: mophttp.DefaultSchemaVersion},
		Logger: func(format string, args ...any) {
			mopLog.Warn(fmt.Sprintf(format, args...))
		},
	})
	app.mopHTTPHandler = mopHandler
	app.demoFlow = demoflow.New(demoflow.Options{Recorder: app})

	manifestURL := config.Trimmed(config.UpdateManifestURLEnv)
	if manifestURL == "" {
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
	wailsEventsArmed.Store(true)
	a.ctx = ctx
	// From here on every package's logging reaches the Wails logger, including
	// the ones that cannot import it. Before startup and after shutdown the same
	// calls go to stderr, so nothing is silently dropped at either end.
	applog.SetForwarder(func(level slog.Level, line string) {
		switch {
		case level >= slog.LevelError:
			wailsruntime.LogError(ctx, line)
		case level >= slog.LevelWarn:
			wailsruntime.LogWarning(ctx, line)
		default:
			wailsruntime.LogInfo(ctx, line)
		}
	})
	if err := a.writeProcessIdentity(); err != nil {
		applog.Logger().Warn("write process identity", applog.Err(err))
	}
	for _, editor := range a.editorSessions() {
		if err := editor.service.CleanupStale(); err != nil {
			applog.Logger().Warn("cleanup stale editor sessions", slog.String("editor", editor.label), applog.Err(err))
		}
	}
	if err := wailsruntime.InitializeNotifications(ctx); err != nil {
		applog.Logger().Warn("init notifications", applog.Err(err))
	}
	if err := a.ensureLocalStoreOpen(ctx); err != nil {
		applog.Logger().Error("open local store", applog.Err(err))
	} else {
		if err := a.prepareLegacyRuntimeMigration(ctx); err != nil {
			applog.Logger().Warn("prepare legacy runtime migration", applog.Err(err))
		}
		if err := a.failInterruptedTasks(ctx); err != nil {
			applog.Logger().Warn("fail interrupted tasks", applog.Err(err))
		}
		if err := a.initializeWorkspaces(ctx); err != nil {
			applog.Logger().Error("init workspace", applog.Err(err))
		}
	}
}

func (a *App) ensureLocalStoreOpen(ctx context.Context) error {
	if a.localStore == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := a.localStore.Open(ctx); err != nil {
		return fmt.Errorf("open local store: %w", err)
	}
	return nil
}

// interruptedTaskMessage is shown for tasks whose bridge process died with the
// previous app session.
const interruptedTaskMessage = "OfficeDex was closed before this task finished. Please run it again."

// failInterruptedTasks marks tasks left in the `running` state by an earlier
// process as failed. No bridge child survives a restart, and a running task --
// unlike one parked in `question` / `plan_review`, which stale-respond recovery
// can replay -- has no pending user action to resume from. Without this pass the
// renderer replays those rows as cards that spin forever.
func (a *App) failInterruptedTasks(ctx context.Context) error {
	if a.localStore == nil {
		return nil
	}
	taskIDs, err := a.localStore.QueryTaskIDsByStatus(ctx, "running")
	if err != nil {
		return err
	}
	for _, taskID := range taskIDs {
		if err := a.localStore.RecordEvent(types.BridgeEvent{
			EventID: "local-interrupted-" + uuid.NewString(),
			TaskID:  taskID,
			Type:    types.EventTaskFailed,
			TS:      time.Now().UTC().Format(time.RFC3339Nano),
			Payload: map[string]any{
				"message":  interruptedTaskMessage,
				"code":     bridge.StrandedTaskCode,
				"stranded": true,
			},
		}); err != nil {
			return err
		}
	}
	return nil
}

// startEventWriter runs the single goroutine that owns task-event persistence.
// One worker keeps events in the order the bridge produced them, which the
// recovery path depends on when it replays a task's history.
// recordTaskEventBestEffort persists an event whose loss does not fail the
// caller, but says so when it fails. These rows are what the recovery path
// replays: a dropped task.user_input is a task that can no longer be resumed,
// and the write used to be discarded with `_ =`, so the first sign of trouble
// was recovery reporting a missing original input.
func (a *App) recordTaskEventBestEffort(event types.BridgeEvent) {
	if a.localStore == nil {
		return
	}
	if strings.TrimSpace(event.TS) == "" {
		// Stamp locally synthesised events when they are created, not when the
		// writer gets to them, so their order relative to bridge events is the
		// order things happened in.
		event.TS = time.Now().UTC().Format(time.RFC3339Nano)
	}
	ctx := a.ctx
	// Same queue as the bridge's events: two write paths meant a locally
	// written task.cancelled could land before the queued task.question that
	// preceded it, and recovery ordered by write time saw the wrong last state.
	a.queueEventWrite(func() {
		if err := a.localStore.RecordEvent(event); err != nil && ctx != nil {
			applog.Logger().Warn("record task event; this task may not be recoverable",
				slog.String("event_type", event.Type),
				applog.Task(event.TaskID),
				applog.Request(event.RequestID),
				applog.Err(err))
		}
	})
}

func (a *App) startEventWriter() {
	a.eventWritesMu.Lock()
	defer a.eventWritesMu.Unlock()
	a.eventWrites = make(chan func(), 256)
	a.eventWritesClosed = false
	a.eventWritesWG.Add(1)
	go func(queue chan func()) {
		defer a.eventWritesWG.Done()
		for write := range queue {
			write()
		}
	}(a.eventWrites)
}

// queueEventWrite hands persistence to the writer goroutine. A full queue
// blocks rather than dropping: recovery reads these rows back, so losing one
// loses the input a task needs to resume. Once the writer has been drained
// (or was never started) the write runs inline instead, so a late event from
// a child that outlived shutdown is still persisted rather than panicking on
// a closed channel.
func (a *App) queueEventWrite(write func()) {
	a.eventWritesMu.RLock()
	queue := a.eventWrites
	if queue == nil || a.eventWritesClosed {
		a.eventWritesMu.RUnlock()
		write()
		return
	}
	// Holding the read lock while blocked on a full queue is safe: the writer
	// goroutine drains the queue without taking the lock, and drain waits for
	// every in-flight enqueue before it closes the channel.
	queue <- write
	a.eventWritesMu.RUnlock()
}

// drainEventWrites stops the writer and waits for queued rows to land.
func (a *App) drainEventWrites() {
	a.eventWritesMu.Lock()
	queue := a.eventWrites
	if queue == nil || a.eventWritesClosed {
		a.eventWritesMu.Unlock()
		return
	}
	a.eventWritesClosed = true
	close(queue)
	a.eventWritesMu.Unlock()
	a.eventWritesWG.Wait()
}

func (a *App) shutdown(ctx context.Context) {
	wailsEventsArmed.Store(false)
	// The Wails logger stops accepting records around here; send the rest of
	// shutdown's logging to stderr rather than into a closing runtime.
	applog.SetForwarder(nil)
	a.removeProcessIdentity()
	a.mu.Lock()
	bridgeClients := a.takeBridgeClientsLocked()
	loginUnsub := a.loginUnsub
	a.loginUnsub = nil
	demoFlow := a.demoFlow
	a.mu.Unlock()

	for _, client := range bridgeClients {
		client.Stop()
	}
	// Retired clients were replaced while they still had work in flight and
	// are not in the pool proper. They used to survive shutdown as orphaned
	// processes whose listeners kept firing into a closing app.
	for _, client := range a.bridges.takeRetired() {
		client.Close()
	}
	if demoFlow != nil {
		demoFlow.Shutdown()
	}
	if loginUnsub != nil {
		loginUnsub()
	}
	a.drainEventWrites()
	if a.localStore != nil {
		_ = a.localStore.Close()
	}
	if a.runtimeMgr != nil {
		a.runtimeMgr.CancelDownload()
	}
	for _, editor := range a.editorSessions() {
		if err := editor.service.CloseAll(); err != nil && ctx != nil {
			applog.Logger().Warn("close editor sessions", slog.String("editor", editor.label), applog.Err(err))
		}
	}
	if ctx != nil {
		wailsruntime.CleanupNotifications(ctx)
	}
}

// ─── Bridge bindings ────────────────────────────────────────────────────────

// Initialize starts the agent-bridge if needed and forwards the initialize
// JSON-RPC call.
func (a *App) Initialize() ([]byte, error) {
	client, err := a.bridgeForMetadata()
	if err != nil {
		return nil, err
	}
	return client.Initialize(a.ctx)
}

// GetCapabilities returns the agent capability map.
func (a *App) GetCapabilities() ([]byte, error) {
	client, err := a.bridgeForMetadata()
	if err != nil {
		return nil, err
	}
	return client.GetCapabilities(a.ctx)
}

func (a *App) SendDesktopNotification(input DesktopNotificationInput) error {
	return a.sendDesktopNotificationWithRuntime(wailsDesktopNotificationRuntime{}, input)
}

func (a *App) sendDesktopNotificationWithRuntime(notificationRuntime desktopNotificationRuntime, input DesktopNotificationInput) error {
	ctx := a.ctx
	if ctx == nil {
		return errors.New("desktop notification runtime is unavailable")
	}

	title := strings.TrimSpace(input.Title)
	if title == "" {
		title = appName
	}
	body := strings.TrimSpace(input.Body)

	if !notificationRuntime.IsNotificationAvailable(ctx) {
		return errors.New("desktop notifications are unavailable on this platform")
	}
	if err := a.ensureDesktopNotificationAuthorization(ctx, notificationRuntime); err != nil {
		return err
	}

	return notificationRuntime.SendNotification(ctx, wailsruntime.NotificationOptions{
		ID:    fmt.Sprintf("officedex-%d", time.Now().UnixNano()),
		Title: title,
		Body:  body,
	})
}

func (a *App) ensureDesktopNotificationAuthorization(ctx context.Context, notificationRuntime desktopNotificationRuntime) error {
	a.notificationMu.Lock()
	defer a.notificationMu.Unlock()

	if a.notificationAuthorizationGranted {
		return nil
	}

	authorized, err := notificationRuntime.CheckNotificationAuthorization(ctx)
	if err != nil {
		return fmt.Errorf("check notification authorization: %w", err)
	}
	if !authorized {
		authorized, err = notificationRuntime.RequestNotificationAuthorization(ctx)
		if err != nil {
			return fmt.Errorf("request notification authorization: %w", err)
		}
		if !authorized {
			return errors.New("desktop notification permission denied")
		}
	}
	a.notificationAuthorizationGranted = true
	return nil
}

// ListImageTemplates returns server-managed image prompt templates exposed by
// officecli agent-bridge.
func (a *App) ListImageTemplates() ([]types.ImagePromptTemplate, error) {
	client, err := a.bridgeForMetadata()
	if err != nil {
		return nil, err
	}
	return client.ListImageTemplates(a.ctx)
}

func (a *App) CreateImageTemplate(input types.CreateUserImageTemplateInput) (types.ImagePromptTemplate, error) {
	client, err := a.bridgeForMetadata()
	if err != nil {
		return types.ImagePromptTemplate{}, err
	}
	item, err := client.CreateImageTemplate(a.ctx, input)
	if err != nil {
		return types.ImagePromptTemplate{}, err
	}
	return *item, nil
}

func (a *App) CreateImageTemplatePublishRequest(input types.CreateImageTemplatePublishRequestInput) (types.ImageTemplatePublishRequest, error) {
	client, err := a.bridgeForMetadata()
	if err != nil {
		return types.ImageTemplatePublishRequest{}, err
	}
	item, err := client.CreateImageTemplatePublishRequest(a.ctx, input)
	if err != nil {
		return types.ImageTemplatePublishRequest{}, err
	}
	return *item, nil
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
	if err := a.ensureLocalStoreOpen(a.ctx); err != nil {
		return GenerateResult{}, err
	}
	settings, err := a.settingsStore.Load()
	if err != nil {
		return GenerateResult{}, fmt.Errorf("load settings: %w", err)
	}
	input = taskrecovery.NormalizeText(input)
	if a.demoFlow != nil {
		if result, ok, err := a.demoFlow.TryGenerate(a.ctx, input); ok || err != nil {
			if err != nil {
				return GenerateResult{}, err
			}
			return GenerateResult{TaskID: result.TaskID, SessionID: result.SessionID, Status: result.Status}, nil
		}
	}
	if types.Capability(input.DocumentType).Watermark {
		var watermark *types.ImageWatermarkGenerateOptions
		settings, watermark = a.refreshImageWatermarkSettingsForGenerate(settings)
		input.ImageWatermark = watermark
	}
	if err := validateCustomProvider(settings); err != nil {
		return GenerateResult{}, err
	}
	if err := a.requireLoggedInForCustomProvider(settings); err != nil {
		return GenerateResult{}, err
	}
	resolved, err := a.resolveGenerateInput(input, settings)
	if err != nil {
		return GenerateResult{}, err
	}
	targetCwd, err := a.effectiveWorkspaceDirForInput(input.WorkspaceID, input.NoProject, settings)
	if err != nil {
		return GenerateResult{}, err
	}
	client, err := a.ensureBridgeForCwd(targetCwd)
	if err != nil {
		return GenerateResult{}, err
	}
	result, err := client.InvokeGenerate(a.ctx, resolved)
	if err != nil {
		return GenerateResult{}, err
	}
	if a.localStore != nil && result.TaskID != "" {
		if err := a.recordTaskWorkspaceContext(result.TaskID, resolved.WorkspaceID, resolved.ConversationID, resolved.ParentTaskID, resolved.Topic, resolved.NoProject); err != nil {
			return GenerateResult{}, err
		}
		a.recordTaskEventBestEffort(types.BridgeEvent{
			TaskID: result.TaskID,
			Type:   types.EventLocalUserInput,
			Payload: taskrecovery.EncodeGenerateInput(resolved, localstore.TaskContext{
				WorkspaceID:    resolved.WorkspaceID,
				ConversationID: resolved.ConversationID,
				ParentTaskID:   resolved.ParentTaskID,
			}),
		})
	}
	return GenerateResult{TaskID: result.TaskID, SessionID: result.SessionID, Status: result.Status}, nil
}

// Modify dispatches `office.modify` ("继续修改") against the agent bridge: an
// LLM-driven in-place edit of an existing pptx/docx/xlsx artifact. The modified
// file is written next to the source (officecli derives the output directory
// from the source path when OutputDir is empty, but we resolve it explicitly so
// the result lands within a preview-trusted root).
func (a *App) Modify(input types.ModifyInput) (GenerateResult, error) {
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
	if strings.TrimSpace(input.SourceFile) == "" {
		return GenerateResult{}, errors.New("modify: source file is required")
	}
	if strings.TrimSpace(input.Prompt) == "" {
		return GenerateResult{}, errors.New("modify: prompt is required")
	}
	resolved := input
	if strings.TrimSpace(resolved.OutputDir) == "" {
		resolved.OutputDir = filepath.Dir(input.SourceFile)
	}
	targetCwd, err := a.effectiveWorkspaceDirForInput(input.WorkspaceID, input.NoProject, settings)
	if err != nil {
		return GenerateResult{}, err
	}
	client, err := a.ensureBridgeForCwd(targetCwd)
	if err != nil {
		return GenerateResult{}, err
	}
	result, err := client.InvokeModify(a.ctx, resolved)
	if err != nil {
		return GenerateResult{}, err
	}
	if a.localStore != nil && result.TaskID != "" {
		if err := a.recordTaskWorkspaceContext(result.TaskID, resolved.WorkspaceID, resolved.ConversationID, resolved.ParentTaskID, resolved.Prompt, resolved.NoProject); err != nil {
			return GenerateResult{}, err
		}
		a.recordTaskEventBestEffort(types.BridgeEvent{
			TaskID: result.TaskID,
			Type:   types.EventLocalUserInput,
			Payload: map[string]any{
				"prompt":      resolved.Prompt,
				"source_file": resolved.SourceFile,
			},
		})
	}
	return GenerateResult{TaskID: result.TaskID, SessionID: result.SessionID, Status: result.Status}, nil
}

func (a *App) ArtifactStageEdit(input types.ArtifactStageEditInput) (GenerateResult, error) {
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
	targetCwd, err := a.effectiveWorkspaceDirForInput(input.WorkspaceID, input.NoProject, settings)
	if err != nil {
		return GenerateResult{}, err
	}
	client, err := a.ensureBridgeForCwd(targetCwd)
	if err != nil {
		return GenerateResult{}, err
	}
	result, err := client.InvokeArtifactStageEdit(a.ctx, input)
	if err != nil {
		return GenerateResult{}, err
	}
	if a.localStore != nil && result.TaskID != "" {
		if err := a.recordTaskWorkspaceContext(result.TaskID, input.WorkspaceID, input.ConversationID, input.ParentTaskID, input.ArtifactStage.Instruction, input.NoProject); err != nil {
			return GenerateResult{}, err
		}
		a.recordTaskEventBestEffort(types.BridgeEvent{TaskID: result.TaskID, Type: types.EventLocalUserInput, Payload: map[string]any{"prompt": input.ArtifactStage.Instruction, "source_file": input.ArtifactStage.Target.ArtifactPath, "artifact_stage_scope": input.ArtifactStage.Scope.Kind}})
	}
	return GenerateResult{TaskID: result.TaskID, SessionID: result.SessionID, Status: result.Status}, nil
}

// RespondInput is the renderer payload for the respond binding.
type RespondInput struct {
	TaskID     string               `json:"taskId"`
	QuestionID string               `json:"questionId,omitempty"`
	OptionID   string               `json:"optionId,omitempty"`
	Answer     string               `json:"answer,omitempty"`
	Answers    []RespondAnswerInput `json:"answers,omitempty"`
}

type RespondAnswerInput struct {
	QuestionGroupID string `json:"questionGroupId,omitempty"`
	QuestionID      string `json:"questionId"`
	OptionID        string `json:"optionId,omitempty"`
	Answer          string `json:"answer"`
	QuestionIndex   int    `json:"questionIndex,omitempty"`
}

// Respond forwards a user answer back to the running task.
func (a *App) Respond(input RespondInput) ([]byte, error) {
	if err := a.recordRespondAnswers(input); err != nil {
		return nil, err
	}
	if a.demoFlow != nil {
		if raw, ok, err := a.demoFlow.TryRespond(a.ctx, demoflow.RespondInput{
			TaskID:     input.TaskID,
			QuestionID: input.QuestionID,
			OptionID:   input.OptionID,
			Answer:     input.Answer,
			Answers:    demoflowRespondAnswers(input.Answers),
		}); ok || err != nil {
			return raw, err
		}
	}
	// Route to the live replacement task if this id was recovered earlier, so
	// the answer reaches the task at its real position instead of re-triggering
	// a from-scratch recovery.
	taskID := a.liveTaskID(input.TaskID)
	client, err := a.ensureBridgeForTask(taskID)
	if err != nil {
		return nil, err
	}
	questionID := input.QuestionID
	if taskID != input.TaskID {
		// The renderer may still hold the interrupted task's question id while
		// the recovered bridge task has already minted the next one. Resolve the
		// live pending id for every follow-up routed through a recovery mapping;
		// otherwise the bridge rejects an otherwise valid answer with
		// "question mismatch".
		questionID, err = waitForRecoverablePendingInput(a.ctx, client, taskID)
		if err != nil {
			return nil, err
		}
	}
	answers := make([]bridge.RespondAnswer, 0, len(input.Answers))
	for _, answer := range input.Answers {
		answers = append(answers, bridge.RespondAnswer{
			QuestionID: answer.QuestionID,
			OptionID:   answer.OptionID,
			Answer:     answer.Answer,
		})
	}
	raw, err := client.RespondTask(a.ctx, bridge.RespondParams{
		TaskID:     taskID,
		QuestionID: questionID,
		OptionID:   input.OptionID,
		Answer:     input.Answer,
		Answers:    answers,
	})
	if err != nil && isBridgeTaskNotFoundError(err) {
		return a.recoverStaleInteractiveRespond(input, err)
	}
	return raw, withBridgeErrorCode(err)
}

// withBridgeErrorCode carries the bridge's error.data.code into the message
// Wails hands the renderer, which otherwise sees only error.Error().
func withBridgeErrorCode(err error) error {
	if err == nil {
		return nil
	}
	var rpc *bridge.RPCError
	if !errors.As(err, &rpc) || rpc.DataCode() == "" {
		return err
	}
	return fmt.Errorf("%s%w", types.TagCode(rpc.DataCode(), ""), err)
}

// recoveryPendingInputTimeout bounds how long each replayed stage may take to
// produce its next pending question (a generation step can run an LLM call).
const recoveryPendingInputTimeout = 3 * time.Minute

// Cancel asks the bridge to cancel a running task.
func (a *App) Cancel(taskID string) ([]byte, error) {
	client, err := a.ensureBridgeForTask(taskID)
	if err != nil {
		return nil, err
	}
	raw, err := client.CancelTask(a.ctx, taskID)
	if err != nil {
		if isBridgeTaskNotFoundError(err) {
			a.recordLocalTaskCancelled(taskID, "Task was already gone when cancellation was requested")
		}
		return raw, withBridgeErrorCode(err)
	}
	a.recordLocalTaskCancelled(taskID, "Task cancelled by user")
	return raw, nil
}

// ─── Internals ──────────────────────────────────────────────────────────────

// retiredBridgeGrace bounds how long a replaced-but-busy child process may
// linger. It matches bridge.DefaultTaskInvokeTimeout: past that point the task
// would have timed out anyway, so the process is killed and its tasks are
// reported as failed rather than leaking forever.
const retiredBridgeGrace = 30 * time.Minute

// recordTaskEvent persists one event and whatever the event implies. It runs on
// the writer goroutine, never on a bridge reader.
func (a *App) recordTaskEvent(event types.BridgeEvent) error {
	completedArtifact := (*types.Artifact)(nil)
	if event.Type == types.EventTaskCompleted {
		completedArtifact = artifactFromCompletedEvent(event)
	}
	if a.localStore != nil {
		if err := a.localStore.RecordEvent(event); err != nil {
			return err
		}
	}
	if event.Type == types.EventTaskCompleted && completedArtifact != nil {
		if err := a.AllowArtifact(*completedArtifact); err != nil {
			return err
		}
		if err := a.RecordArtifact(*completedArtifact); err != nil {
			return err
		}
	}
	return nil
}

// RecordAndEmitTaskEvent persists an event and forwards it to the renderer.
// Callers outside the bridge reader still use it; the reader queues the write
// and emits on its own so it does not block on SQLite.
func (a *App) RecordAndEmitTaskEvent(ctx context.Context, event types.BridgeEvent) error {
	if err := a.recordTaskEvent(event); err != nil {
		return err
	}
	emit(ctx, bridgeEventChannel, event)
	return nil
}

func (a *App) RecordTaskWorkspaceContext(taskID, workspaceID, conversationID, parentTaskID, title string, noProject bool) error {
	return a.recordTaskWorkspaceContext(taskID, workspaceID, conversationID, parentTaskID, title, noProject)
}

func (a *App) AllowArtifact(artifact types.Artifact) error {
	if a.previewReg == nil {
		return nil
	}
	return a.previewReg.AllowArtifact(artifact)
}

func (a *App) RecordArtifact(artifact types.Artifact) error {
	if a.localStore == nil {
		return nil
	}
	if err := a.localStore.RecordArtifact(artifact); err != nil {
		return err
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	taskContext, _, err := a.localStore.TaskContext(ctx, artifact.TaskID)
	if err != nil {
		return err
	}
	fileName := strings.TrimSpace(artifact.FileName)
	if fileName == "" {
		fileName = filepath.Base(artifact.FilePath)
	}
	return a.localStore.UpsertRecentFile(ctx, types.RecentFile{
		FilePath:       artifact.FilePath,
		FileName:       fileName,
		DocumentType:   artifact.DocumentType,
		Source:         "generated",
		WorkspaceID:    taskContext.WorkspaceID,
		TaskID:         artifact.TaskID,
		ConversationID: taskContext.ConversationID,
		LastOpenedAt:   time.Now().UTC().Format(time.RFC3339Nano),
	})
}

func (a *App) UserDataDir() string {
	return a.userDataDir
}

func (a *App) WorkspaceDir() string {
	return a.workspaceDir
}

func emit(ctx context.Context, channel string, payload any) {
	if !canEmitWailsEvent(ctx) {
		return
	}
	wailsruntime.EventsEmit(ctx, channel, payload)
}

// wailsEventsArmed is set for the window's lifetime (startup..shutdown).
// Tests that build an App by hand never arm it, so emit stays a no-op there.
var wailsEventsArmed atomic.Bool

// canEmitWailsEvent reports whether Wails is up and events reach a window.
// It used to decide by the context's dynamic type name ("context.backgroundCtx"
// meant "not Wails"), which is a private detail of the standard library;
// startup and shutdown now say so explicitly.
func canEmitWailsEvent(ctx context.Context) bool {
	return ctx != nil && wailsEventsArmed.Load()
}

func artifactFromCompletedEvent(event types.BridgeEvent) *types.Artifact {
	if event.Type != types.EventTaskCompleted {
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

func (a *App) refreshImageWatermarkSettingsForGenerate(current types.UserSettings) (types.UserSettings, *types.ImageWatermarkGenerateOptions) {
	// Through the cache, not GetCreditStatus: this runs on every Generate and
	// only asks whether the plan may turn the watermark off, so it does not need
	// a fresh subprocess each time the way the renderer's balance display does.
	credit, creditErr := a.creditStatus.get(func() (types.CreditStatus, error) {
		return login.GetCreditStatus(a.ctx, a.runCommandOptions())
	})
	next, changed := watermark.SyncSettingsForCredit(current, credit, creditErr)
	if !changed {
		return next, watermark.GenerateOptions(next, credit, creditErr)
	}
	updated, err := a.settingsStore.Update(settings.Patch{ImageWatermark: &next.ImageWatermark})
	if err != nil {
		if a.ctx != nil {
			applog.Logger().Warn("image watermark sync settings", applog.Err(err))
		}
		return next, watermark.GenerateOptions(next, credit, creditErr)
	}
	return updated, watermark.GenerateOptions(updated, credit, creditErr)
}

// resolveUserDataDir mirrors what Electron's app.getPath("userData") returns.
func resolveUserDataDir(appName string) (string, error) {
	if override := config.Trimmed(config.DevUserDataDirEnv); override != "" {
		if !filepath.IsAbs(override) {
			return "", fmt.Errorf("OFFICEDEX_DEV_USER_DATA_DIR must be an absolute path: %q", override)
		}
		return filepath.Clean(override), nil
	}
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

func developmentOfficeCLIEnv() []string {
	home := config.Trimmed(config.DevOfficeCLIHomeEnv)
	if home == "" || !filepath.IsAbs(home) {
		return nil
	}
	return []string{"HOME=" + filepath.Clean(home), "XDG_CONFIG_HOME=" + filepath.Join(filepath.Clean(home), ".config")}
}
