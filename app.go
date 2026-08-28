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
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"officedex/internal/appupdate"
	"officedex/internal/binresolver"
	"officedex/internal/bridge"
	"officedex/internal/demoflow"
	"officedex/internal/diagnostics"
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

type pptistDeckPlanner interface {
	PlanPptistEdit(context.Context, bridge.PlanPptistEditInput) (bridge.PlanPptistEditResult, error)
}

// pptxJSPlanner turns a natural-language request plus the live learnof/pptx
// editor context into PowerPoint.run source. OfficeDex only plans through it;
// the returned JavaScript is executed by the embedded editor's isolated Worker.
type pptxJSPlanner interface {
	PlanPptxJS(context.Context, bridge.PlanPptxJSInput) (bridge.PlanPptxJSResult, error)
}

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

	userDataDir  string
	workspaceDir string

	settingsStore *settings.Store
	localStore    *localstore.Store
	previewReg    *preview.Registry
	demoFlow      *demoflow.Engine

	mu                     sync.Mutex
	cachedSettings         types.UserSettings
	bridgeClient           *bridge.Client
	pptistPlanner          pptistDeckPlanner
	pptxJSPlanner          pptxJSPlanner
	bridgeCwd              string
	loginManager           *login.Manager
	loginUnsub             func()
	pendingLoginURL        string
	previewModeWidthBefore int
	previewModeXBefore     int
	previewModeXShifted    bool
	appUpdateMgr           *appupdate.Manager
	runtimeMgr             *runtimemgr.Manager
	proxyPool              *netproxy.Pool

	// resolver cache. binresolver.Resolve stats the filesystem on every call;
	// runCommandOptions / ensureBridge run on every RPC. We cache the resolved
	// path + env until UpdateSettings flips touchesBridge=true.
	resolvedBinaryPath string
	resolvedBinaryEnv  []string
	binaryResolvedAt   time.Time

	// recoveredTaskIDs maps an interrupted task id (the one the renderer keeps
	// using after an app restart) to the live replacement task created during
	// stale-respond recovery. Subsequent answers for the old id are routed to
	// the live task so recovery runs once instead of re-running generation from
	// the idea gate on every step.
	recoveredTaskIDs map[string]string

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
	app.demoFlow = demoflow.New(demoflow.Options{Recorder: app})

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
	if err := wailsruntime.InitializeNotifications(ctx); err != nil {
		wailsruntime.LogWarningf(ctx, "init notifications: %v", err)
	}
	if err := a.localStore.Open(ctx); err != nil {
		wailsruntime.LogErrorf(ctx, "open local store: %v", err)
	} else if err := a.initializeWorkspaces(ctx); err != nil {
		wailsruntime.LogErrorf(ctx, "init workspace: %v", err)
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
	demoFlow := a.demoFlow
	a.mu.Unlock()

	if bridgeClient != nil {
		bridgeClient.Stop()
	}
	if demoFlow != nil {
		demoFlow.Shutdown()
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
	if ctx != nil {
		wailsruntime.CleanupNotifications(ctx)
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
	client, err := a.ensureBridge()
	if err != nil {
		return nil, err
	}
	return client.ListImageTemplates(a.ctx)
}

func (a *App) CreateImageTemplate(input types.CreateUserImageTemplateInput) (types.ImagePromptTemplate, error) {
	client, err := a.ensureBridge()
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
	client, err := a.ensureBridge()
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
	settings, err := a.settingsStore.Load()
	if err != nil {
		return GenerateResult{}, fmt.Errorf("load settings: %w", err)
	}
	input = normalizeGenerateInputText(input)
	if a.demoFlow != nil {
		if result, ok, err := a.demoFlow.TryGenerate(a.ctx, input); ok || err != nil {
			if err != nil {
				return GenerateResult{}, err
			}
			return GenerateResult{TaskID: result.TaskID, SessionID: result.SessionID, Status: result.Status}, nil
		}
	}
	if input.DocumentType == types.DocIMG {
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
		_ = a.localStore.RecordEvent(types.BridgeEvent{
			TaskID: result.TaskID,
			Type:   "task.user_input",
			Payload: generateInputEventPayload(resolved, localstore.TaskContext{
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
		_ = a.localStore.RecordEvent(types.BridgeEvent{
			TaskID: result.TaskID,
			Type:   "task.user_input",
			Payload: map[string]any{
				"prompt":      resolved.Prompt,
				"source_file": resolved.SourceFile,
			},
		})
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

// liveTaskID follows the recovered-task chain so answers for an interrupted
// task id reach the live replacement created by a prior recovery. Returns the
// input id unchanged when no mapping exists.
func (a *App) liveTaskID(taskID string) string {
	a.mu.Lock()
	defer a.mu.Unlock()
	// Follow the chain (an old id may have been recovered more than once),
	// guarding against accidental cycles.
	for hops := 0; hops < 16; hops++ {
		next, ok := a.recoveredTaskIDs[taskID]
		if !ok || next == "" || next == taskID {
			break
		}
		taskID = next
	}
	return taskID
}

// registerRecoveredTask records that oldID was replaced by a live newID during
// recovery so future answers for oldID are routed to newID.
func (a *App) registerRecoveredTask(oldID, newID string) {
	oldID = strings.TrimSpace(oldID)
	newID = strings.TrimSpace(newID)
	if oldID == "" || newID == "" || oldID == newID {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.recoveredTaskIDs == nil {
		a.recoveredTaskIDs = make(map[string]string)
	}
	a.recoveredTaskIDs[oldID] = newID
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
		QuestionID: input.QuestionID,
		OptionID:   input.OptionID,
		Answer:     input.Answer,
		Answers:    answers,
	})
	if err != nil && isBridgeTaskNotFoundError(err) {
		return a.recoverStaleInteractiveRespond(input, err)
	}
	return raw, err
}

func demoflowRespondAnswers(input []RespondAnswerInput) []demoflow.RespondAnswerInput {
	out := make([]demoflow.RespondAnswerInput, 0, len(input))
	for _, item := range input {
		out = append(out, demoflow.RespondAnswerInput{
			QuestionGroupID: item.QuestionGroupID,
			QuestionID:      item.QuestionID,
			OptionID:        item.OptionID,
			Answer:          item.Answer,
			QuestionIndex:   item.QuestionIndex,
		})
	}
	return out
}

func (a *App) recordRespondAnswers(input RespondInput) error {
	if a.localStore == nil || strings.TrimSpace(input.TaskID) == "" {
		return nil
	}
	answers := make([]localstore.TaskAnswer, 0, len(input.Answers)+1)
	if len(input.Answers) > 0 {
		for _, item := range input.Answers {
			if strings.TrimSpace(item.QuestionID) == "" {
				continue
			}
			groupID := strings.TrimSpace(item.QuestionGroupID)
			if groupID == "" {
				groupID = strings.TrimSpace(input.QuestionID)
			}
			answers = append(answers, localstore.TaskAnswer{
				QuestionGroupID: groupID,
				QuestionID:      strings.TrimSpace(item.QuestionID),
				OptionID:        strings.TrimSpace(item.OptionID),
				Answer:          strings.TrimSpace(item.Answer),
				QuestionIndex:   item.QuestionIndex,
			})
		}
	} else if strings.TrimSpace(input.QuestionID) != "" && (strings.TrimSpace(input.OptionID) != "" || strings.TrimSpace(input.Answer) != "") {
		answers = append(answers, localstore.TaskAnswer{
			QuestionID:    strings.TrimSpace(input.QuestionID),
			OptionID:      strings.TrimSpace(input.OptionID),
			Answer:        strings.TrimSpace(input.Answer),
			QuestionIndex: -1,
		})
	}
	if len(answers) == 0 {
		return nil
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	return a.localStore.RecordTaskAnswers(ctx, strings.TrimSpace(input.TaskID), answers)
}

func (a *App) recoverStaleInteractiveRespond(input RespondInput, originalErr error) ([]byte, error) {
	if a.localStore == nil {
		return nil, originalErr
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	events, err := a.localStore.QueryEventsByTask(ctx, input.TaskID)
	if err != nil {
		return nil, err
	}
	if !latestTaskStateRecoverable(events) {
		return nil, fmt.Errorf("task was interrupted and cannot be resumed; please restart this plan")
	}
	taskCtx, ok, err := a.localStore.TaskContext(ctx, input.TaskID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, fmt.Errorf("task was interrupted and cannot be resumed; missing task context")
	}
	generateInput, err := recoverGenerateInputFromEvents(events, taskCtx)
	if err != nil {
		return nil, err
	}
	client, err := a.ensureBridgeForTask(input.TaskID)
	if err != nil {
		return nil, err
	}
	result, err := client.InvokeGenerate(ctx, generateInput)
	if err != nil {
		return nil, err
	}
	if result.TaskID == "" {
		return nil, fmt.Errorf("task recovery failed: replacement task id is empty")
	}
	if err := a.recordTaskWorkspaceContext(result.TaskID, taskCtx.WorkspaceID, taskCtx.ConversationID, input.TaskID, generateInput.Topic, generateInput.NoProject); err != nil {
		return nil, err
	}
	recoveredInputEvent := types.BridgeEvent{
		EventID: "local-recovered-input-" + uuid.NewString(),
		TaskID:  result.TaskID,
		Type:    "task.user_input",
		TS:      time.Now().UTC().Format(time.RFC3339Nano),
		Payload: generateInputEventPayload(generateInput, taskCtx),
	}
	_ = a.localStore.RecordEvent(recoveredInputEvent)
	if canEmitWailsEvent(ctx) {
		emit(ctx, bridgeEventChannel, recoveredInputEvent)
	}
	answers, err := a.localStore.QueryTaskAnswers(ctx, input.TaskID)
	if err != nil {
		return nil, err
	}
	// The fresh bridge run always restarts at the first interactive gate (for
	// the vibe flow, idea confirmation). Replaying only the current answer works
	// when the user was interrupted at that first gate, but breaks when they had
	// already advanced — the current step's answer (often an action with an
	// empty answer body) would be delivered to the idea gate and rejected with
	// "idea confirmation is required". Replay the full saved-answer history in
	// order so the re-created task fast-forwards to the user's real position.
	groups, skippedRevisions := buildRecoveryReplayGroups(answers, input)
	if len(groups) == 0 && !skippedRevisions {
		return nil, fmt.Errorf("task was interrupted and cannot be resumed; missing saved answers")
	}
	// When every saved answer was an unreplayable per-node revision, the
	// recovered task is already at its first gate with nothing to fast-forward;
	// fall through to register the mapping and report success.
	for _, group := range groups {
		// Each replayed answer targets the live question/plan the re-created task
		// is currently waiting on. IDs are re-minted per bridge process, so we
		// must use the live pending ID rather than any ID persisted from the
		// previous run; otherwise the bridge rejects it with "question mismatch".
		pendingID, err := waitForRecoverablePendingInput(ctx, client, result.TaskID)
		if err != nil {
			return nil, err
		}
		params := bridge.RespondParams{
			TaskID:     result.TaskID,
			QuestionID: pendingID,
			OptionID:   strings.TrimSpace(group.OptionID),
			Answer:     strings.TrimSpace(group.Answer),
			Answers:    group.Answers,
		}
		if len(params.Answers) == 0 && params.OptionID == "" && params.Answer == "" {
			return nil, fmt.Errorf("task was interrupted and cannot be resumed; missing saved answers")
		}
		if _, err := client.RespondTask(ctx, params); err != nil {
			return nil, err
		}
	}
	// Route future answers for the interrupted id to this live task so the
	// renderer (which keeps using the original id) no longer re-triggers a
	// from-scratch recovery on every subsequent step.
	a.registerRecoveredTask(input.TaskID, result.TaskID)
	a.recordLocalTaskCancelled(input.TaskID, "Task was recovered after the application restarted")
	payload, err := json.Marshal(map[string]any{
		"accepted":      true,
		"task_id":       result.TaskID,
		"taskId":        result.TaskID,
		"recoveredFrom": input.TaskID,
	})
	if err != nil {
		return nil, err
	}
	return payload, nil
}

// recoveryReplayGroup is one answer to replay against one pending question of a
// recovered task. A multi-question group (shared question_group_id) collapses
// into a single respond carrying every sub-answer; a standalone answer is its
// own group.
type recoveryReplayGroup struct {
	OptionID string
	Answer   string
	Answers  []bridge.RespondAnswer
}

// isUnreplayableVibeRevision reports whether a saved answer is a per-node vibe
// revision (feedback on a specific node, or an undo) that cannot be safely
// replayed against a recovered task. Recovery re-runs generation from scratch,
// producing a fresh tree with new node IDs, so these answers reference nodes
// that no longer exist — RewriteNode would error and fail the whole task. They
// only ever trigger a same-stage re-ask (never a stage advance), so dropping
// them during replay preserves stage alignment while losing only fine-grained
// edits that the regenerated tree wouldn't have reproduced anyway.
func isUnreplayableVibeRevision(answer string) bool {
	trimmed := strings.TrimSpace(answer)
	if !strings.HasPrefix(trimmed, "{") {
		return false
	}
	var probe struct {
		Kind string `json:"kind"`
	}
	if err := json.Unmarshal([]byte(trimmed), &probe); err != nil {
		return false
	}
	switch probe.Kind {
	case "vibe_node_feedback", "vibe_undo_last_revision":
		return true
	}
	return false
}

// buildRecoveryReplayGroups turns the chronological saved answers into the
// ordered sequence of responds needed to fast-forward a recovered task to the
// user's current position. Answers sharing a non-empty question_group_id are
// merged into one group (preserving first-seen order); answers without a group
// id each become their own group. The final group represents the in-flight
// answer, so its representative option/answer is taken from the live input
// (matching the non-recovery respond payload) when present.
//
// skipped reports whether any per-node revision was dropped (see
// isUnreplayableVibeRevision); the caller uses it to distinguish "nothing to
// replay because nothing was answered" from "all answers were unreplayable
// revisions, leaving the task correctly at its current gate".
func buildRecoveryReplayGroups(answers []localstore.TaskAnswer, input RespondInput) (groups []recoveryReplayGroup, skipped bool) {
	groups = make([]recoveryReplayGroup, 0, len(answers))
	indexByGroupID := make(map[string]int)
	for _, item := range answers {
		if isUnreplayableVibeRevision(item.Answer) {
			skipped = true
			continue
		}
		groupID := strings.TrimSpace(item.QuestionGroupID)
		sub := bridge.RespondAnswer{
			QuestionID: strings.TrimSpace(item.QuestionID),
			OptionID:   strings.TrimSpace(item.OptionID),
			Answer:     strings.TrimSpace(item.Answer),
		}
		if groupID != "" {
			if idx, ok := indexByGroupID[groupID]; ok {
				groups[idx].Answers = append(groups[idx].Answers, sub)
				// Track the latest sub-answer as the representative; the final
				// group is overridden by the live input below.
				groups[idx].OptionID = sub.OptionID
				groups[idx].Answer = sub.Answer
				continue
			}
			indexByGroupID[groupID] = len(groups)
		}
		groups = append(groups, recoveryReplayGroup{
			OptionID: sub.OptionID,
			Answer:   sub.Answer,
			Answers:  []bridge.RespondAnswer{sub},
		})
	}
	// Prefer the live input's representative option/answer for the final group
	// (or as a standalone group when nothing replayable was persisted) so the
	// replayed payload matches what a normal respond would have sent — but never
	// when the live input is itself an unreplayable revision.
	inputHasContent := strings.TrimSpace(input.OptionID) != "" || strings.TrimSpace(input.Answer) != ""
	inputReplayable := inputHasContent && !isUnreplayableVibeRevision(input.Answer)
	if len(groups) == 0 {
		if inputReplayable {
			return []recoveryReplayGroup{{OptionID: input.OptionID, Answer: input.Answer}}, skipped
		}
		return nil, skipped
	}
	if inputReplayable {
		last := &groups[len(groups)-1]
		last.OptionID = input.OptionID
		last.Answer = input.Answer
	}
	return groups, skipped
}

func latestTaskStateRecoverable(events []types.BridgeEvent) bool {
	state := ""
	for _, event := range events {
		switch event.Type {
		case "task.question", "task.plan", "task.completed", "task.failed", "task.cancelled":
			state = event.Type
		}
	}
	return state == "task.question" || state == "task.plan"
}

func recoverGenerateInputFromEvents(events []types.BridgeEvent, taskCtx localstore.TaskContext) (types.GenerateInput, error) {
	var userInput map[string]any
	var started map[string]any
	for _, event := range events {
		if event.Type == "task.started" {
			started = event.Payload
		}
		if event.Type == "task.user_input" {
			userInput = event.Payload
		}
	}
	if userInput == nil {
		return types.GenerateInput{}, fmt.Errorf("task was interrupted and cannot be resumed; missing original input")
	}
	documentType := stringField(userInput, "document_type", "documentType")
	if documentType == "" {
		documentType = stringField(started, "document_type", "documentType")
	}
	prompt := recoverPromptFromPayload(userInput)
	if prompt == "" {
		prompt = stringField(started, "prompt")
	}
	topic := recoverTopicFromPayload(userInput)
	if topic == "" {
		topic = stringField(started, "topic")
	}
	if topic == "" {
		topic = prompt
	}
	if prompt == "" {
		prompt = topic
	}
	if documentType == "" || prompt == "" {
		return types.GenerateInput{}, fmt.Errorf("task was interrupted and cannot be resumed; missing original prompt")
	}
	input := types.GenerateInput{
		DocumentType:     types.DocumentType(documentType),
		Topic:            topic,
		Prompt:           prompt,
		WorkspaceID:      taskCtx.WorkspaceID,
		NoProject:        strings.TrimSpace(taskCtx.WorkspaceID) == "",
		ConversationID:   taskCtx.ConversationID,
		ParentTaskID:     taskCtx.ParentTaskID,
		RuntimeMode:      stringField(userInput, "runtime_mode", "runtimeMode"),
		GenerationMode:   stringField(userInput, "generation_mode", "generationMode"),
		PromptTemplateID: stringField(userInput, "prompt_template_id", "promptTemplateId"),
		SourceFile:       stringField(userInput, "source_file", "sourceFile"),
		ReferenceImages:  stringSliceField(userInput, "reference_images", "referenceImages"),
		ImageRatio:       stringField(userInput, "image_ratio", "imageRatio"),
		FPS:              intField(userInput, "fps"),
		OutputDir:        stringField(userInput, "output_dir", "outputDir"),
		Publish:          boolField(userInput, "publish"),
		ImageQuality:     stringField(userInput, "image_quality", "imageQuality"),
		LocalPreview:     boolField(userInput, "local_preview", "localPreview"),
	}
	if v, ok := optionalBoolField(userInput, "enable_images", "enableImages"); ok {
		input.EnableImages = &v
	}
	return input, nil
}

// recoveryPendingInputTimeout bounds how long each replayed stage may take to
// produce its next pending question (a generation step can run an LLM call).
const recoveryPendingInputTimeout = 3 * time.Minute

// waitForRecoverablePendingInput blocks until the recovered task is waiting on
// fresh input, returning the ID the bridge expects the answer to reference. The
// ID is re-minted per bridge process, so callers must use this value rather than
// any ID replayed from persisted events.
func waitForRecoverablePendingInput(ctx context.Context, client *bridge.Client, taskID string) (string, error) {
	// Recovery replays answers stage by stage; between responds the re-created
	// task runs a generation step (often an LLM call), so allow well beyond the
	// few seconds a single idle gate would need. The loop still returns early
	// once the task reaches a pending question or a terminal state.
	waitCtx, cancel := context.WithTimeout(ctx, recoveryPendingInputTimeout)
	defer cancel()
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	for {
		status, err := client.TaskStatus(waitCtx, taskID)
		if err != nil {
			return "", err
		}
		if len(status.CurrentQuestion) > 0 {
			return pendingInputID(status.CurrentQuestion), nil
		}
		if len(status.CurrentPlan) > 0 {
			return pendingInputID(status.CurrentPlan), nil
		}
		if status.Status == "failed" || status.Status == "completed" || status.Status == "cancelled" {
			return "", fmt.Errorf("task recovery failed before input was requested: %s", status.Status)
		}
		select {
		case <-waitCtx.Done():
			return "", fmt.Errorf("task recovery timed out waiting for pending input")
		case <-ticker.C:
		}
	}
}

// pendingInputID extracts the question/plan identifier from a bridge
// current_question or current_plan payload. The bridge accepts either the "id"
// or, for plans, the "plan_id" field; "id" is preferred when present.
func pendingInputID(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var fields struct {
		ID     string `json:"id"`
		PlanID string `json:"plan_id"`
	}
	if err := json.Unmarshal(raw, &fields); err != nil {
		return ""
	}
	if fields.ID != "" {
		return fields.ID
	}
	return fields.PlanID
}

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
		return raw, err
	}
	a.recordLocalTaskCancelled(taskID, "Task cancelled by user")
	return raw, nil
}

func (a *App) recordLocalTaskCancelled(taskID, message string) {
	if a.localStore == nil || strings.TrimSpace(taskID) == "" {
		return
	}
	if strings.TrimSpace(message) == "" {
		message = "Task cancelled"
	}
	_ = a.localStore.RecordEvent(types.BridgeEvent{
		EventID: "local-cancel-" + uuid.NewString(),
		TaskID:  strings.TrimSpace(taskID),
		Type:    "task.cancelled",
		TS:      time.Now().UTC().Format(time.RFC3339Nano),
		Payload: map[string]any{"message": message},
	})
}

func isBridgeTaskNotFoundError(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "not found") || strings.Contains(message, "not_found")
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
	settings, err := a.settingsStore.Load()
	if err != nil {
		return "", fmt.Errorf("load settings: %w", err)
	}
	workspaceDir, err := a.effectiveWorkspaceDir(settings)
	if err != nil {
		return "", err
	}
	dir := filepath.Join(workspaceDir, ".pasted-images")
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

// SavePptxInput carries a base64-encoded .pptx plus its desired file name.
type SavePptxInput struct {
	DataBase64     string `json:"dataBase64"`
	FileName       string `json:"fileName"`
	TargetFilePath string `json:"targetFilePath,omitempty"`
}

// SavePptx writes a client-exported .pptx (produced in the PPTist embed) to the
// user's Downloads folder and returns the path. Desktop webviews can't surface
// blob downloads from inside an iframe, so the embed hands the bytes back and the
// host persists them natively.
func (a *App) SavePptx(input SavePptxInput) (string, error) {
	if input.DataBase64 == "" {
		return "", errors.New("save pptx: empty data")
	}
	data, err := base64.StdEncoding.DecodeString(input.DataBase64)
	if err != nil {
		return "", fmt.Errorf("decode pptx: %w", err)
	}
	if len(data) == 0 {
		return "", errors.New("save pptx: empty data")
	}
	dest, err := a.resolveSavePptxDestination(input)
	if err != nil {
		return "", err
	}
	if err := writeFileAtomic(dest, data, 0o644); err != nil {
		return "", fmt.Errorf("write pptx: %w", err)
	}
	if a.previewReg != nil {
		_ = a.previewReg.AllowArtifact(types.Artifact{FilePath: dest, FileName: filepath.Base(dest), DocumentType: "pptx"})
	}
	return dest, nil
}

func (a *App) resolveSavePptxDestination(input SavePptxInput) (string, error) {
	if strings.TrimSpace(input.TargetFilePath) != "" {
		dest, err := filepath.Abs(input.TargetFilePath)
		if err != nil {
			return "", fmt.Errorf("save pptx: target path: %w", err)
		}
		if strings.ToLower(filepath.Ext(dest)) != ".pptx" {
			return "", errors.New("save pptx: target file must be .pptx")
		}
		if a.previewReg != nil {
			if err := a.previewReg.AllowArtifact(types.Artifact{FilePath: dest, FileName: filepath.Base(dest), DocumentType: "pptx"}); err != nil {
				return "", fmt.Errorf("save pptx: %w", err)
			}
		}
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			return "", fmt.Errorf("save pptx: mkdir target: %w", err)
		}
		return dest, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("save pptx: home dir: %w", err)
	}
	dir := filepath.Join(home, "Downloads")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("save pptx: mkdir: %w", err)
	}
	name := normalizePptxFileName(input.FileName)
	dest := filepath.Join(dir, name)
	if _, statErr := os.Stat(dest); statErr == nil {
		base := strings.TrimSuffix(name, ".pptx")
		dest = filepath.Join(dir, fmt.Sprintf("%s-%d.pptx", base, time.Now().UnixNano()))
	}
	return dest, nil
}

func writeFileAtomic(dest string, data []byte, perm os.FileMode) error {
	tmp, err := os.CreateTemp(filepath.Dir(dest), "."+filepath.Base(dest)+".tmp-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.Remove(tmpPath)
		}
	}()
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Chmod(perm); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, dest); err != nil {
		return err
	}
	cleanup = false
	return nil
}

// PlanPptxJSInput is the renderer-facing request for the learnof/pptx AI
// planner. Context is the inspect result produced by the embedded editor
// (slides, selectedSlideIds, selectedShapes) and is forwarded verbatim.
type PlanPptxJSInput struct {
	Prompt  string           `json:"prompt"`
	Context any              `json:"context"`
	History []PptistEditTurn `json:"history,omitempty"`
}

const pptxJSPlannerMaxContextBytes = 512 * 1024

// PlanPptxJS asks OfficeCLI for PowerPoint.run JavaScript that edits the
// presentation currently open in the embedded learnof/pptx editor. It never
// executes JavaScript in Go and never touches the document; it only returns the
// plan (source, summary, confirmation requirements) to the renderer.
func (a *App) PlanPptxJS(input PlanPptxJSInput) (bridge.PlanPptxJSResult, error) {
	prompt := strings.TrimSpace(input.Prompt)
	if prompt == "" {
		return bridge.PlanPptxJSResult{}, errors.New("plan pptx js: prompt is required")
	}
	if input.Context == nil {
		return bridge.PlanPptxJSResult{}, errors.New("plan pptx js: editor context is required")
	}
	if encoded, err := json.Marshal(input.Context); err != nil {
		return bridge.PlanPptxJSResult{}, fmt.Errorf("plan pptx js: encode editor context: %w", err)
	} else if len(encoded) > pptxJSPlannerMaxContextBytes {
		return bridge.PlanPptxJSResult{}, fmt.Errorf("plan pptx js: editor context is too large (%d bytes)", len(encoded))
	}
	planner := a.pptxJSPlanner
	if planner == nil {
		client, err := a.ensureBridge()
		if err != nil {
			return bridge.PlanPptxJSResult{}, fmt.Errorf("plan pptx js: bridge unavailable: %w", err)
		}
		planner = client
	}
	history := make([]bridge.PlanPptxJSTurn, 0, len(input.History))
	for _, turn := range input.History {
		if strings.TrimSpace(turn.Content) == "" {
			continue
		}
		history = append(history, bridge.PlanPptxJSTurn{Role: turn.Role, Content: turn.Content})
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	result, err := planner.PlanPptxJS(ctx, bridge.PlanPptxJSInput{
		Prompt:  prompt,
		Context: input.Context,
		History: history,
	})
	if err != nil {
		return bridge.PlanPptxJSResult{}, fmt.Errorf("plan pptx js: %w", err)
	}
	if strings.TrimSpace(result.Source) == "" {
		return bridge.PlanPptxJSResult{}, errors.New("plan pptx js: planner returned empty source")
	}
	if result.Confidence == "low" || result.RequiresConfirmation {
		result.RequiresConfirmation = true
		if result.Confirmation == nil {
			result.Confirmation = &bridge.PlanPptxJSConfirmation{
				Title:   "Confirm AI edit",
				Message: firstNonEmptyPptist(result.Summary, "Review this edit before applying it."),
			}
		}
	}
	if result.Warnings == nil {
		result.Warnings = []string{}
	}
	return result, nil
}

type ModifyPptistDeckInput struct {
	Prompt             string             `json:"prompt"`
	Snapshot           PptistDeckSnapshot `json:"snapshot"`
	SelectedSlideID    string             `json:"selectedSlideId,omitempty"`
	SelectedElementIDs []string           `json:"selectedElementIds,omitempty"`
	History            []PptistEditTurn   `json:"history,omitempty"`
	PptxDataBase64     string             `json:"pptxDataBase64,omitempty"`
}

type PptistEditTurn struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type PptistDeckSnapshot struct {
	Slides        []PptistSlide  `json:"slides"`
	Title         string         `json:"title,omitempty"`
	Theme         map[string]any `json:"theme,omitempty"`
	ViewportSize  float64        `json:"viewportSize,omitempty"`
	ViewportRatio float64        `json:"viewportRatio,omitempty"`
	SlideIndex    int            `json:"slideIndex,omitempty"`
}

type PptistSlide struct {
	ID         string           `json:"id"`
	Elements   []map[string]any `json:"elements"`
	Background map[string]any   `json:"background,omitempty"`
	Rest       map[string]any   `json:"-"`
}

type ModifyPptistDeckResult struct {
	Summary              string                  `json:"summary"`
	Ops                  []map[string]any        `json:"ops"`
	Confidence           string                  `json:"confidence,omitempty"`
	RequiresConfirmation bool                    `json:"requiresConfirmation,omitempty"`
	Confirmation         *PptistEditConfirmation `json:"confirmation,omitempty"`
	Warnings             []string                `json:"warnings,omitempty"`
}

type PptistEditConfirmation struct {
	Title     string   `json:"title,omitempty"`
	Message   string   `json:"message,omitempty"`
	Target    string   `json:"target,omitempty"`
	Changes   []string `json:"changes,omitempty"`
	Preserved []string `json:"preserved,omitempty"`
}

// ModifyPptistDeck plans edits against the live PPTist deck model. It returns
// PPTist edit operations only; the renderer applies them inside the iframe.
// The current PPTX bytes, when supplied, are used only as planner context.
func (a *App) ModifyPptistDeck(input ModifyPptistDeckInput) (ModifyPptistDeckResult, error) {
	prompt := strings.TrimSpace(input.Prompt)
	if prompt == "" {
		return ModifyPptistDeckResult{}, errors.New("modify pptist: prompt is required")
	}
	if len(input.Snapshot.Slides) == 0 {
		return ModifyPptistDeckResult{}, errors.New("modify pptist: snapshot has no slides")
	}
	if a.demoFlow != nil {
		if result, ok, err := a.demoFlow.TryModifyPptistDeck(a.ctx, demoflow.ModifyPptistDeckInput{
			Prompt:             input.Prompt,
			Snapshot:           demoflowPptistSnapshot(input.Snapshot),
			SelectedSlideID:    input.SelectedSlideID,
			SelectedElementIDs: append([]string(nil), input.SelectedElementIDs...),
		}); ok || err != nil {
			if err != nil {
				return ModifyPptistDeckResult{}, err
			}
			var confirmation *PptistEditConfirmation
			if result.Confirmation != nil {
				confirmation = &PptistEditConfirmation{
					Title:     result.Confirmation.Title,
					Message:   result.Confirmation.Message,
					Target:    result.Confirmation.Target,
					Changes:   append([]string(nil), result.Confirmation.Changes...),
					Preserved: append([]string(nil), result.Confirmation.Preserved...),
				}
			}
			return ModifyPptistDeckResult{
				Summary:              result.Summary,
				Ops:                  result.Ops,
				Confidence:           result.Confidence,
				RequiresConfirmation: result.RequiresConfirmation,
				Confirmation:         confirmation,
				Warnings:             append([]string(nil), result.Warnings...),
			}, nil
		}
	}
	if result, ok, err := planDeterministicPptistTitleEdit(input); ok || err != nil {
		if err != nil {
			return ModifyPptistDeckResult{}, err
		}
		return result, nil
	}
	planner := a.pptistPlanner
	if planner == nil {
		client, err := a.ensureBridge()
		if err != nil {
			return ModifyPptistDeckResult{}, fmt.Errorf("modify pptist: bridge unavailable: %w", err)
		}
		planner = client
	}
	history := make([]bridge.PlanPptistEditTurn, 0, len(input.History))
	for _, turn := range input.History {
		history = append(history, bridge.PlanPptistEditTurn{Role: turn.Role, Content: turn.Content})
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	result, err := planner.PlanPptistEdit(ctx, bridge.PlanPptistEditInput{
		Tool:               "office.pptist.plan_edit",
		Prompt:             prompt,
		Snapshot:           compactPptistSnapshotForPlanner(input.Snapshot),
		SelectedSlideID:    input.SelectedSlideID,
		SelectedElementIDs: append([]string(nil), input.SelectedElementIDs...),
		History:            history,
		PptxDataBase64:     input.PptxDataBase64,
	})
	if err != nil {
		if isPptistNoEditOpsError(err) {
			op, summary, fallbackErr := planPptistEditOp(input)
			if fallbackErr != nil {
				return ModifyPptistDeckResult{}, fmt.Errorf("modify pptist: %w", err)
			}
			if validateErr := validatePptistEditOpsAgainstSelectedElements([]map[string]any{op}, input.SelectedElementIDs); validateErr != nil {
				return ModifyPptistDeckResult{}, validateErr
			}
			return ModifyPptistDeckResult{
				Summary:              firstNonEmptyPptist(summary, "Prepared a conservative text edit."),
				Ops:                  []map[string]any{op},
				Confidence:           "low",
				RequiresConfirmation: true,
				Confirmation: &PptistEditConfirmation{
					Title:     "Confirm AI edit",
					Message:   "The AI planner returned no operations, so OfficeDex prepared a conservative edit for review.",
					Target:    "Current PPTist deck",
					Changes:   []string{firstNonEmptyPptist(summary, "Apply one text edit.")},
					Preserved: []string{"Existing style and layout"},
				},
				Warnings: []string{"AI planner returned no operations; used conservative fallback."},
			}, nil
		}
		return ModifyPptistDeckResult{}, fmt.Errorf("modify pptist: %w", err)
	}
	if err := validatePptistEditOpsAgainstSelectedElements(result.Ops, input.SelectedElementIDs); err != nil {
		return ModifyPptistDeckResult{}, err
	}
	return ModifyPptistDeckResult{
		Summary:              result.Summary,
		Ops:                  result.Ops,
		Confidence:           result.Confidence,
		RequiresConfirmation: result.RequiresConfirmation,
		Confirmation:         pptistEditConfirmationFromBridge(result.Confirmation),
		Warnings:             append([]string(nil), result.Warnings...),
	}, nil
}

func demoflowPptistSnapshot(input PptistDeckSnapshot) demoflow.PptistDeckSnapshot {
	slides := make([]demoflow.PptistSlide, 0, len(input.Slides))
	for _, slide := range input.Slides {
		slides = append(slides, demoflow.PptistSlide{
			ID:         slide.ID,
			Elements:   append([]map[string]any(nil), slide.Elements...),
			Background: cloneMapAny(slide.Background),
		})
	}
	return demoflow.PptistDeckSnapshot{Slides: slides, SlideIndex: input.SlideIndex}
}

func cloneMapAny(input map[string]any) map[string]any {
	if input == nil {
		return nil
	}
	out := make(map[string]any, len(input))
	for k, v := range input {
		out[k] = v
	}
	return out
}

func isPptistNoEditOpsError(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(strings.ToLower(err.Error()), "no edit operations")
}

func validatePptistEditOpsAgainstSelectedElements(ops []map[string]any, selectedElementIDs []string) error {
	if len(selectedElementIDs) == 0 {
		return nil
	}
	selected := make(map[string]struct{}, len(selectedElementIDs))
	for _, id := range selectedElementIDs {
		id = strings.TrimSpace(id)
		if id != "" {
			selected[id] = struct{}{}
		}
	}
	if len(selected) == 0 {
		return nil
	}
	for i, op := range ops {
		elementID, _ := op["elementId"].(string)
		elementID = strings.TrimSpace(elementID)
		if elementID == "" {
			return fmt.Errorf("modify pptist: planner returned op outside selected elements at index %d: missing elementId", i)
		}
		if _, ok := selected[elementID]; !ok {
			return fmt.Errorf("modify pptist: planner returned op outside selected elements at index %d: %s", i, elementID)
		}
	}
	return nil
}

func firstNonEmptyPptist(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func planDeterministicPptistTitleEdit(input ModifyPptistDeckInput) (ModifyPptistDeckResult, bool, error) {
	prompt := strings.TrimSpace(input.Prompt)
	if !pptistPromptMentionsTitle(prompt) {
		return ModifyPptistDeckResult{}, false, nil
	}
	newText := requestedTitleText(prompt)
	if newText == "" {
		return ModifyPptistDeckResult{}, false, nil
	}
	targetSlideIndex := resolvePptistTargetSlideIndex(input)
	if targetSlideIndex < 0 || targetSlideIndex >= len(input.Snapshot.Slides) {
		return ModifyPptistDeckResult{}, false, nil
	}
	targetSlide := input.Snapshot.Slides[targetSlideIndex]
	element, _ := firstEditableTitleElement(targetSlide)
	if element == nil {
		return ModifyPptistDeckResult{}, false, nil
	}
	elementID, _ := element["id"].(string)
	if elementID == "" {
		return ModifyPptistDeckResult{}, true, errors.New("modify pptist: target title element has no id")
	}
	return ModifyPptistDeckResult{
		Summary:              fmt.Sprintf("Updated slide %d title.", targetSlideIndex+1),
		Confidence:           "high",
		RequiresConfirmation: false,
		Ops: []map[string]any{{
			"type":          "element:update-text",
			"slideId":       targetSlide.ID,
			"elementId":     elementID,
			"text":          newText,
			"preserveStyle": true,
		}},
	}, true, nil
}

func pptistPromptMentionsTitle(prompt string) bool {
	lower := strings.ToLower(prompt)
	return strings.Contains(prompt, "标题") || strings.Contains(lower, "title")
}

func pptistEditConfirmationFromBridge(input *bridge.PlanPptistEditConfirmation) *PptistEditConfirmation {
	if input == nil {
		return nil
	}
	return &PptistEditConfirmation{
		Title:     input.Title,
		Message:   input.Message,
		Target:    input.Target,
		Changes:   append([]string(nil), input.Changes...),
		Preserved: append([]string(nil), input.Preserved...),
	}
}

const (
	pptistPlannerMaxStringBytes = 4096
	pptistPlannerMaxListItems   = 80
)

func compactPptistSnapshotForPlanner(snapshot PptistDeckSnapshot) PptistDeckSnapshot {
	compact := PptistDeckSnapshot{
		Title:         compactPptistStringForPlanner("title", snapshot.Title),
		Theme:         compactPptistMapForPlanner(snapshot.Theme),
		ViewportSize:  snapshot.ViewportSize,
		ViewportRatio: snapshot.ViewportRatio,
		SlideIndex:    snapshot.SlideIndex,
	}
	compact.Slides = make([]PptistSlide, 0, len(snapshot.Slides))
	for _, slide := range snapshot.Slides {
		next := PptistSlide{
			ID:         compactPptistStringForPlanner("id", slide.ID),
			Background: compactPptistMapForPlanner(slide.Background),
		}
		next.Elements = make([]map[string]any, 0, len(slide.Elements))
		for _, element := range slide.Elements {
			next.Elements = append(next.Elements, compactPptistMapForPlanner(element))
		}
		compact.Slides = append(compact.Slides, next)
	}
	return compact
}

func compactPptistMapForPlanner(input map[string]any) map[string]any {
	if len(input) == 0 {
		return nil
	}
	output := make(map[string]any, len(input))
	for key, value := range input {
		output[key] = compactPptistValueForPlanner(key, value)
	}
	return output
}

func compactPptistValueForPlanner(key string, value any) any {
	switch typed := value.(type) {
	case string:
		return compactPptistStringForPlanner(key, typed)
	case map[string]any:
		return compactPptistMapForPlanner(typed)
	case []any:
		limit := len(typed)
		if limit > pptistPlannerMaxListItems {
			limit = pptistPlannerMaxListItems
		}
		output := make([]any, 0, limit+1)
		for i := 0; i < limit; i++ {
			output = append(output, compactPptistValueForPlanner(key, typed[i]))
		}
		if len(typed) > limit {
			output = append(output, fmt.Sprintf("[%d items omitted]", len(typed)-limit))
		}
		return output
	case []map[string]any:
		limit := len(typed)
		if limit > pptistPlannerMaxListItems {
			limit = pptistPlannerMaxListItems
		}
		output := make([]map[string]any, 0, limit)
		for i := 0; i < limit; i++ {
			output = append(output, compactPptistMapForPlanner(typed[i]))
		}
		return output
	default:
		return value
	}
}

func compactPptistStringForPlanner(key string, value string) string {
	if value == "" {
		return value
	}
	lowerKey := strings.ToLower(key)
	prefix := strings.ToLower(value)
	if len(prefix) > 64 {
		prefix = prefix[:64]
	}
	if strings.HasPrefix(prefix, "data:image/") || strings.HasPrefix(prefix, "data:application/") || strings.Contains(lowerKey, "base64") || lowerKey == "src" || lowerKey == "image" || lowerKey == "imageurl" {
		return fmt.Sprintf("[image omitted: %d bytes]", len(value))
	}
	if len(value) <= pptistPlannerMaxStringBytes {
		return value
	}
	return truncatePptistPlannerString(value, pptistPlannerMaxStringBytes) + fmt.Sprintf("… [truncated %d bytes]", len(value)-pptistPlannerMaxStringBytes)
}

func truncatePptistPlannerString(value string, maxBytes int) string {
	if len(value) <= maxBytes {
		return value
	}
	var out strings.Builder
	out.Grow(maxBytes)
	for _, r := range value {
		next := string(r)
		if out.Len()+len(next) > maxBytes {
			break
		}
		out.WriteString(next)
	}
	return out.String()
}

func planPptistEditOp(input ModifyPptistDeckInput) (map[string]any, string, error) {
	prompt := strings.TrimSpace(input.Prompt)
	targetSlideIndex := resolvePptistTargetSlideIndex(input)
	if targetSlideIndex < 0 || targetSlideIndex >= len(input.Snapshot.Slides) {
		targetSlideIndex = 0
	}
	targetSlide := input.Snapshot.Slides[targetSlideIndex]
	element, _ := firstEditableTitleElement(targetSlide)
	if element == nil {
		return map[string]any{
			"type":    "element:add",
			"slideId": targetSlide.ID,
			"element": map[string]any{
				"id":      "ai-note-" + uuid.NewString(),
				"type":    "text",
				"left":    80,
				"top":     80,
				"width":   520,
				"height":  80,
				"content": htmlParagraph(prompt),
			},
		}, "Added a text element from the edit request.", nil
	}
	newText := requestedTitleText(prompt)
	if newText == "" {
		newText = prompt
	}
	elementID, _ := element["id"].(string)
	if elementID == "" {
		return nil, "", errors.New("modify pptist: target element has no id")
	}
	return map[string]any{
		"type":          "element:update-text",
		"slideId":       targetSlide.ID,
		"elementId":     elementID,
		"text":          newText,
		"preserveStyle": true,
	}, "Updated text in the live PPTist deck.", nil
}

var (
	pptistChineseSlideIndexRE = regexp.MustCompile(`第\s*([一二三四五六七八九十两0-9]+)\s*[页頁张張]`)
	pptistEnglishSlideIndexRE = regexp.MustCompile(`(?i)\bslide\s+([0-9]+)\b`)
)

func resolvePptistTargetSlideIndex(input ModifyPptistDeckInput) int {
	prompt := strings.TrimSpace(input.Prompt)
	if strings.Contains(prompt, "最后") || strings.Contains(strings.ToLower(prompt), "last slide") {
		return len(input.Snapshot.Slides) - 1
	}
	if index, ok := explicitPptistSlideIndexFromPrompt(prompt); ok {
		return index
	}
	if input.SelectedSlideID != "" {
		for i, slide := range input.Snapshot.Slides {
			if slide.ID == input.SelectedSlideID {
				return i
			}
		}
	}
	return input.Snapshot.SlideIndex
}

func explicitPptistSlideIndexFromPrompt(prompt string) (int, bool) {
	if match := pptistChineseSlideIndexRE.FindStringSubmatch(prompt); len(match) == 2 {
		if value, ok := parsePptistPageNumber(match[1]); ok && value > 0 {
			return value - 1, true
		}
	}
	if match := pptistEnglishSlideIndexRE.FindStringSubmatch(prompt); len(match) == 2 {
		if value, err := strconv.Atoi(match[1]); err == nil && value > 0 {
			return value - 1, true
		}
	}
	return 0, false
}

func parsePptistPageNumber(value string) (int, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, false
	}
	if numeric, err := strconv.Atoi(value); err == nil {
		return numeric, true
	}
	if value == "十" {
		return 10, true
	}
	digits := map[rune]int{'一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9}
	runes := []rune(value)
	if len(runes) == 1 {
		digit, ok := digits[runes[0]]
		return digit, ok
	}
	for i, r := range runes {
		if r != '十' {
			continue
		}
		tens := 1
		if i > 0 {
			parsed, ok := digits[runes[i-1]]
			if !ok {
				return 0, false
			}
			tens = parsed
		}
		ones := 0
		if i+1 < len(runes) {
			parsed, ok := digits[runes[i+1]]
			if !ok {
				return 0, false
			}
			ones = parsed
		}
		return tens*10 + ones, true
	}
	return 0, false
}

var htmlFontSizeRE = regexp.MustCompile(`(?i)font-size\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*px`)

func firstEditableTitleElement(slide PptistSlide) (map[string]any, bool) {
	type candidate struct {
		element     map[string]any
		isShapeText bool
		score       float64
	}
	var best *candidate
	for _, el := range slide.Elements {
		content, textType, isShapeText, ok := editableTextElementInfo(el)
		if !ok {
			continue
		}
		score := titleElementScore(el, content, textType)
		if best == nil || score > best.score {
			best = &candidate{element: el, isShapeText: isShapeText, score: score}
		}
	}
	if best == nil {
		return nil, false
	}
	return best.element, best.isShapeText
}

func editableTextElementInfo(el map[string]any) (content string, textType string, isShapeText bool, ok bool) {
	if typ, _ := el["type"].(string); typ == "text" {
		content, ok = el["content"].(string)
		textType, _ = el["textType"].(string)
		return content, textType, false, ok && strings.TrimSpace(stripHTML(content)) != ""
	}
	text, ok := el["text"].(map[string]any)
	if !ok {
		return "", "", false, false
	}
	content, ok = text["content"].(string)
	textType, _ = text["type"].(string)
	return content, textType, true, ok && strings.TrimSpace(stripHTML(content)) != ""
}

func titleElementScore(el map[string]any, content string, textType string) float64 {
	score := 0.0
	switch strings.ToLower(strings.TrimSpace(textType)) {
	case "title":
		score += 10000
	case "subtitle", "itemtitle":
		score += 4000
	case "footer", "header", "partnumber", "itemnumber", "notes":
		score -= 3000
	}

	fontSize := maxNumericValue(el["defaultFontSize"], fontSizeFromHTML(content))
	if text, ok := el["text"].(map[string]any); ok {
		fontSize = maxNumericValue(fontSize, text["defaultFontSize"], fontSizeFromHTML(content))
	}
	if fontSize > 0 {
		score += fontSize * 100
	}

	width := numericValue(el["width"])
	height := numericValue(el["height"])
	score += (width * height) / 100
	if top := numericValue(el["top"]); top > 0 {
		score += maxFloat(0, 320-top)
	}
	if left := numericValue(el["left"]); left > 0 {
		score += maxFloat(0, 180-left) * 0.2
	}
	if opacity := numericValue(el["opacity"]); opacity > 0 && opacity < 0.25 {
		score -= 5000
	}
	plainTextLength := len([]rune(strings.TrimSpace(stripHTML(content))))
	if plainTextLength <= 2 {
		score -= 300
	}
	return score
}

func fontSizeFromHTML(html string) float64 {
	matches := htmlFontSizeRE.FindAllStringSubmatch(html, -1)
	max := 0.0
	for _, match := range matches {
		if len(match) < 2 {
			continue
		}
		value, err := strconv.ParseFloat(match[1], 64)
		if err == nil && value > max {
			max = value
		}
	}
	return max
}

func stripHTML(html string) string {
	var out strings.Builder
	inTag := false
	for _, r := range html {
		switch r {
		case '<':
			inTag = true
		case '>':
			inTag = false
		default:
			if !inTag {
				out.WriteRune(r)
			}
		}
	}
	return out.String()
}

func numericValue(value any) float64 {
	switch v := value.(type) {
	case int:
		return float64(v)
	case int64:
		return float64(v)
	case float32:
		return float64(v)
	case float64:
		return v
	case json.Number:
		f, _ := v.Float64()
		return f
	default:
		return 0
	}
}

func maxNumericValue(values ...any) float64 {
	max := 0.0
	for _, value := range values {
		if numeric := numericValue(value); numeric > max {
			max = numeric
		}
	}
	return max
}

func maxFloat(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

func requestedTitleText(prompt string) string {
	lower := strings.ToLower(prompt)
	markers := []string{"改为", "改成", "修改为", "change to", "set to", "to "}
	for _, marker := range markers {
		idx := strings.LastIndex(lower, marker)
		if idx < 0 {
			continue
		}
		start := idx + len(marker)
		if marker != strings.ToLower(marker) {
			start = strings.LastIndex(prompt, marker) + len(marker)
		}
		if start >= 0 && start <= len(prompt) {
			return cleanRequestedTitleText(prompt[start:])
		}
	}
	return ""
}

func cleanRequestedTitleText(value string) string {
	text := strings.Trim(strings.TrimSpace(value), "“”\"'。.")
	constraintMarkers := []string{"，但", ", but", "，保持", ", keep", "，字体", "，颜色", "，样式", "，位置"}
	for _, marker := range constraintMarkers {
		idx := strings.Index(strings.ToLower(text), strings.ToLower(marker))
		if idx >= 0 {
			candidate := strings.Trim(strings.TrimSpace(text[:idx]), "“”\"'。.")
			if candidate != "" {
				return candidate
			}
		}
	}
	return text
}

func htmlParagraph(text string) string {
	replacer := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;")
	return "<p>" + replacer.Replace(text) + "</p>"
}

// ExportVibeTreePptxInput carries the vibe tree to render and the desired file name.
type ExportVibeTreePptxInput struct {
	TreeJSON string `json:"treeJSON"`
	FileName string `json:"fileName"`
}

// ExportVibeTreePptx renders the vibe tree via pptxgenjs on the backend and
// saves the resulting PPTX to the user's Downloads folder.
func (a *App) ExportVibeTreePptx(input ExportVibeTreePptxInput) (string, error) {
	if strings.TrimSpace(input.TreeJSON) == "" {
		return "", errors.New("export pptx: empty tree")
	}
	client := a.bridgeClient
	if client == nil {
		return "", errors.New("export pptx: bridge not connected")
	}
	result, err := client.ExportPptxFromTree(a.ctx, json.RawMessage(input.TreeJSON))
	if err != nil {
		return "", fmt.Errorf("export pptx: %w", err)
	}
	data, err := base64.StdEncoding.DecodeString(result.DataBase64)
	if err != nil {
		return "", fmt.Errorf("export pptx: decode: %w", err)
	}
	if len(data) == 0 {
		return "", errors.New("export pptx: empty result")
	}
	fileName := result.FileName
	if strings.TrimSpace(input.FileName) != "" {
		fileName = input.FileName
	}
	return a.SavePptx(SavePptxInput{
		DataBase64: result.DataBase64,
		FileName:   normalizePptxFileName(fileName),
	})
}

// normalizePptxFileName strips any path separators and guarantees a .pptx suffix.
func normalizePptxFileName(name string) string {
	name = strings.TrimSpace(name)
	name = filepath.Base(strings.ReplaceAll(name, "\\", "/"))
	if name == "" || name == "." || name == "/" {
		name = "deck.pptx"
	}
	if !strings.HasSuffix(strings.ToLower(name), ".pptx") {
		name += ".pptx"
	}
	return name
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
		emit(a.ctx, previewEventChannel, grant)
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

// CopyImageToClipboard writes a local image file to the system clipboard. Wails
// only exposes text clipboard helpers, and macOS WebKit does not reliably
// support navigator.clipboard.write for image blobs inside the app webview.
func (a *App) CopyImageToClipboard(filePath string) error {
	if filePath == "" {
		return errors.New("copy image to clipboard: empty path")
	}
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(filePath), "."))
	if _, ok := localImageMimeByExt[ext]; !ok {
		return fmt.Errorf("copy image to clipboard: unsupported extension %q", ext)
	}
	info, err := os.Stat(filePath)
	if err != nil {
		return fmt.Errorf("copy image to clipboard: %w", err)
	}
	if info.IsDir() {
		return errors.New("copy image to clipboard: path is a directory")
	}
	if runtime.GOOS != "darwin" {
		return errors.New("copy image to clipboard: native image clipboard is only supported on macOS")
	}
	return copyImageToClipboardDarwin(filePath)
}

func copyImageToClipboardDarwin(filePath string) error {
	const script = `
ObjC.import("AppKit");
function run(argv) {
  const path = argv[0];
  const image = $.NSImage.alloc.initWithContentsOfFile(path);
  if (!image) {
    throw new Error("copy image to clipboard: could not load image");
  }
  const pasteboard = $.NSPasteboard.generalPasteboard;
  pasteboard.clearContents;
  const ok = pasteboard.writeObjects($.NSArray.arrayWithObject(image));
  if (!ok) {
    throw new Error("copy image to clipboard: NSPasteboard write failed");
  }
}
`
	cmd := exec.Command("/usr/bin/osascript", "-l", "JavaScript", "-e", script, filePath)
	out, err := cmd.CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			return fmt.Errorf("copy image to clipboard: %w", err)
		}
		return fmt.Errorf("copy image to clipboard: %w: %s", err, msg)
	}
	return nil
}

// ─── Auth bindings ──────────────────────────────────────────────────────────

// LoginURLResult is the renderer-facing shape returned by Login.
type LoginURLResult struct {
	URL string `json:"url"`
}

type LoginInput struct {
	InviteCode string `json:"inviteCode,omitempty"`
}

// Login starts an OAuth flow if one is not already in progress, returns the
// verification URL the renderer can show / open in the browser.
func (a *App) Login(input LoginInput) (LoginURLResult, error) {
	a.mu.Lock()
	if a.pendingLoginURL != "" {
		url := a.pendingLoginURL
		a.mu.Unlock()
		return LoginURLResult{URL: url}, nil
	}
	manager := a.ensureLoginManagerLocked()
	a.mu.Unlock()

	url, err := manager.Start(a.ctx, input.InviteCode)
	if err != nil {
		return LoginURLResult{}, err
	}
	a.mu.Lock()
	a.pendingLoginURL = url
	a.mu.Unlock()

	if a.ctx != nil {
		emit(a.ctx, authEventChannel, types.AuthEvent{Type: types.AuthEventURL, URL: url})
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
	if whoami, _, _, ok := demoflow.SessionOverride(); ok {
		return whoami, nil
	}
	opts := a.runCommandOptions()
	return login.GetWhoAmI(a.ctx, opts)
}

// GetCreditStatus runs `officecli auth status` and returns the parsed quota
// snapshot (hosted credit balance, free trial / reward / paid-key counters,
// access mode, plan name). A non-zero exit from the CLI is reported as an
// anonymous status with zeroed counters rather than an error.
func (a *App) GetCreditStatus() (types.CreditStatus, error) {
	if _, credit, _, ok := demoflow.SessionOverride(); ok {
		return credit, nil
	}
	opts := a.runCommandOptions()
	return login.GetCreditStatus(a.ctx, opts)
}

// GetInviteInfo runs `officecli invite --json` and returns the current user's
// invite code.
func (a *App) GetInviteInfo() (types.InviteInfo, error) {
	opts := a.runCommandOptions()
	return login.GetInviteInfo(a.ctx, opts)
}

// Logout runs `officecli logout`.
func (a *App) Logout() error {
	if _, _, session, ok := demoflow.SessionOverride(); ok {
		credits := session.Credits
		if credits < 0 {
			credits = 0
		}
		_, err := demoflow.UpdateSession("anonymous", credits)
		return err
	}
	opts := a.runCommandOptions()
	if err := login.Logout(a.ctx, opts); err != nil {
		return err
	}
	a.resetBridgeRuntime()
	return nil
}

// Redeem runs `officecli redeem --json --source desktop <code>` to add hosted
// credits to the signed-in account. Errors surfaced by the platform (expired
// code, exhausted code, already-claimed, etc.) are returned as a normal error
// so the renderer can show the message to the user.
func (a *App) Redeem(code string) (types.RedeemResult, error) {
	opts := a.runCommandOptions()
	result, err := login.Redeem(a.ctx, opts, code)
	if err != nil {
		return types.RedeemResult{}, err
	}
	a.resetBridgeRuntime()
	return result, nil
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
	workspaceChanged := patch.WorkspaceDir != nil || patch.OutputDir != nil
	if workspaceChanged {
		if _, err := a.effectiveWorkspaceDir(merged); err != nil {
			workspaceChanged = false
		}
	}
	touchesBridge := patch.BridgeBinaryPath != nil ||
		workspaceChanged ||
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

	if patch.WorkspaceDir != nil || patch.OutputDir != nil {
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

func (a *App) ListWorkspaces() ([]types.WorkspaceSummary, error) {
	if a.localStore == nil {
		return nil, nil
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	if err := a.removeDefaultWorkspaceProject(ctx); err != nil {
		return nil, err
	}
	return a.localStore.QueryWorkspaceSummaries(ctx, 20)
}

func (a *App) ListChats() ([]types.WorkspaceConversationSummary, error) {
	if a.localStore == nil {
		return nil, nil
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	if err := a.removeDefaultWorkspaceProject(ctx); err != nil {
		return nil, err
	}
	return a.localStore.QueryChatSummaries(ctx, 50)
}

func (a *App) DeleteConversation(conversationID string) error {
	if a.localStore == nil {
		return errors.New("workspace store is unavailable")
	}
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return errors.New("conversation id is empty")
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	return a.localStore.RemoveConversation(ctx, conversationID)
}

func (a *App) AddWorkspace(workspacePath string) (types.WorkspaceSummary, error) {
	cleaned, err := cleanExistingWorkspaceDir(workspacePath)
	if err != nil {
		return types.WorkspaceSummary{}, err
	}
	if a.localStore == nil {
		return types.WorkspaceSummary{}, errors.New("workspace store is unavailable")
	}
	if sameCleanPath(cleaned, a.workspaceDir) {
		return types.WorkspaceSummary{}, errors.New("default app workspace is reserved for chats without a project")
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	ws, err := a.localStore.EnsureWorkspace(ctx, cleaned)
	if err != nil {
		return types.WorkspaceSummary{}, err
	}
	if _, err := a.localStore.ActivateWorkspace(ctx, ws.ID); err != nil {
		return types.WorkspaceSummary{}, err
	}
	if err := a.applyActiveWorkspace(cleaned); err != nil {
		return types.WorkspaceSummary{}, err
	}
	summaries, err := a.localStore.QueryWorkspaceSummaries(ctx, 20)
	if err != nil {
		return types.WorkspaceSummary{}, err
	}
	for _, summary := range summaries {
		if summary.ID == ws.ID {
			return summary, nil
		}
	}
	return types.WorkspaceSummary{ID: ws.ID, Path: ws.Path, Name: ws.Name, Active: true}, nil
}

func (a *App) RemoveWorkspace(workspaceID string) error {
	if a.localStore == nil {
		return errors.New("workspace store is unavailable")
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" {
		return errors.New("workspace id is empty")
	}
	active := false
	if ws, err := a.localStore.ActiveWorkspace(ctx); err == nil && ws.ID == workspaceID {
		active = true
	}
	if err := a.localStore.RemoveWorkspace(ctx, workspaceID); err != nil {
		return err
	}
	activePath := a.workspaceDir
	if active {
		if err := a.localStore.ClearActiveWorkspace(ctx); err != nil {
			return err
		}
	} else if ws, err := a.localStore.ActiveWorkspace(ctx); err == nil && ws.Path != "" {
		activePath = ws.Path
	}
	if err := a.applyActiveWorkspace(activePath); err != nil {
		return err
	}
	return nil
}

func (a *App) SelectWorkspace(workspaceID string) (types.WorkspaceSummary, error) {
	if a.localStore == nil {
		return types.WorkspaceSummary{}, errors.New("workspace store is unavailable")
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	ws, err := a.localStore.Workspace(ctx, workspaceID)
	if err != nil {
		return types.WorkspaceSummary{}, err
	}
	cleaned, err := cleanExistingWorkspaceDir(ws.Path)
	if err != nil {
		return types.WorkspaceSummary{}, err
	}
	if _, err := a.localStore.ActivateWorkspace(ctx, workspaceID); err != nil {
		return types.WorkspaceSummary{}, err
	}
	if err := a.applyActiveWorkspace(cleaned); err != nil {
		return types.WorkspaceSummary{}, err
	}
	summaries, err := a.localStore.QueryWorkspaceSummaries(ctx, 20)
	if err != nil {
		return types.WorkspaceSummary{}, err
	}
	for _, summary := range summaries {
		if summary.ID == workspaceID {
			return summary, nil
		}
	}
	return types.WorkspaceSummary{ID: ws.ID, Path: ws.Path, Name: ws.Name, Active: true}, nil
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
	if err := a.refreshPreviewTrustedRoots(a.cachedSettings); err != nil {
		return nil, err
	}
	entries, err := a.localStore.QueryRecentTaskHistory(ctx, limit)
	if err != nil {
		return nil, fmt.Errorf("get task history: list tasks: %w", err)
	}
	out := make([]types.TaskHistoryEntry, 0, len(entries))
	for _, entry := range entries {
		if len(entry.Events) == 0 {
			continue
		}
		// Re-register completed artifacts with the preview registry so the
		// renderer can issue preview tokens after an app restart. Without this,
		// `IssuePreviewToken` rejects historical artifacts with "artifact is not
		// registered" and the preview button appears to do nothing.
		for _, ev := range entry.Events {
			if ev.Type != "task.completed" {
				continue
			}
			if artifact := artifactFromCompletedEvent(ev); artifact != nil {
				if err := a.previewReg.AllowArtifact(*artifact); err != nil {
					wailsruntime.LogWarningf(ctx, "preview register (history): %v", err)
				}
			}
		}
		out = append(out, entry)
	}
	return out, nil
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

type RendererLogInput struct {
	Source  string         `json:"source"`
	Event   string         `json:"event"`
	AtMs    int            `json:"atMs,omitempty"`
	Details map[string]any `json:"details,omitempty"`
}

func (a *App) RecordRendererLog(input RendererLogInput) error {
	source := strings.TrimSpace(input.Source)
	event := strings.TrimSpace(input.Event)
	if source == "" || event == "" {
		return nil
	}
	if len(source) > 160 {
		source = source[:160]
	}
	if len(event) > 200 {
		event = event[:200]
	}

	details := input.Details
	if details == nil {
		details = map[string]any{}
	}
	detailsJSON, err := json.Marshal(details)
	if err != nil {
		detailsJSON = []byte(`{"marshalError":true}`)
	}
	if len(detailsJSON) > 65536 {
		detailsJSON = []byte(`{"truncated":true}`)
	}

	entry := map[string]any{
		"ts":      time.Now().UTC().Format(time.RFC3339Nano),
		"source":  source,
		"event":   event,
		"atMs":    input.AtMs,
		"details": json.RawMessage(detailsJSON),
	}
	line, err := json.Marshal(entry)
	if err != nil {
		return fmt.Errorf("record renderer log: marshal: %w", err)
	}

	logDir := filepath.Join(a.userDataDir, "logs")
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		return fmt.Errorf("record renderer log: mkdir: %w", err)
	}
	logPath := filepath.Join(logDir, "renderer-"+time.Now().Format("20060102")+".log")
	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return fmt.Errorf("record renderer log: open: %w", err)
	}
	defer f.Close()
	if _, err := f.Write(append(line, '\n')); err != nil {
		return fmt.Errorf("record renderer log: write: %w", err)
	}
	return nil
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
		WorkspaceDir:        a.effectiveWorkspaceDirForRuntime(currentSettings),
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

func mapField(payload map[string]any, keys ...string) map[string]any {
	if payload == nil {
		return nil
	}
	for _, k := range keys {
		v, ok := payload[k]
		if !ok {
			continue
		}
		if item, ok := v.(map[string]any); ok {
			return item
		}
	}
	return nil
}

func nestedStringField(payload map[string]any, fieldKeys []string, containerKeys ...string) string {
	if v := stringField(payload, fieldKeys...); v != "" {
		return v
	}
	for _, key := range containerKeys {
		if v := stringField(mapField(payload, key), fieldKeys...); v != "" {
			return v
		}
	}
	return ""
}

func recoverPromptFromPayload(payload map[string]any) string {
	return nestedStringField(payload, []string{"prompt"}, "text_input", "textInput", "content_input", "contentInput")
}

func recoverTopicFromPayload(payload map[string]any) string {
	return nestedStringField(payload, []string{"topic"}, "text_input", "textInput", "content_input", "contentInput")
}

func normalizeGenerateInputText(input types.GenerateInput) types.GenerateInput {
	out := input
	if strings.TrimSpace(out.Topic) == "" {
		out.Topic = strings.TrimSpace(out.Prompt)
	}
	if strings.TrimSpace(out.Prompt) == "" {
		out.Prompt = strings.TrimSpace(out.Topic)
	}
	return out
}

func intField(payload map[string]any, keys ...string) int {
	if payload == nil {
		return 0
	}
	for _, k := range keys {
		v, ok := payload[k]
		if !ok {
			continue
		}
		switch n := v.(type) {
		case int:
			return n
		case int64:
			return int(n)
		case float64:
			return int(n)
		case json.Number:
			if i, err := n.Int64(); err == nil {
				return int(i)
			}
		}
	}
	return 0
}

func boolField(payload map[string]any, keys ...string) bool {
	v, _ := optionalBoolField(payload, keys...)
	return v
}

func optionalBoolField(payload map[string]any, keys ...string) (bool, bool) {
	if payload == nil {
		return false, false
	}
	for _, k := range keys {
		v, ok := payload[k]
		if !ok {
			continue
		}
		switch b := v.(type) {
		case bool:
			return b, true
		case string:
			if strings.EqualFold(b, "true") {
				return true, true
			}
			if strings.EqualFold(b, "false") {
				return false, true
			}
		}
	}
	return false, false
}

func stringSliceField(payload map[string]any, keys ...string) []string {
	if payload == nil {
		return nil
	}
	for _, k := range keys {
		v, ok := payload[k]
		if !ok {
			continue
		}
		switch items := v.(type) {
		case []string:
			return append([]string(nil), items...)
		case []any:
			out := make([]string, 0, len(items))
			for _, item := range items {
				if s, ok := item.(string); ok && strings.TrimSpace(s) != "" {
					out = append(out, s)
				}
			}
			return out
		}
	}
	return nil
}

func generateInputEventPayload(input types.GenerateInput, taskCtx localstore.TaskContext) map[string]any {
	input = normalizeGenerateInputText(input)
	payload := map[string]any{
		"document_type": string(input.DocumentType),
		"documentType":  string(input.DocumentType),
		"topic":         input.Topic,
		"prompt":        input.Prompt,
		"noProject":     input.NoProject,
		"local_preview": input.LocalPreview,
		"localPreview":  input.LocalPreview,
	}
	if taskCtx.ConversationID != "" {
		payload["conversation_id"] = taskCtx.ConversationID
		payload["conversationId"] = taskCtx.ConversationID
	}
	if taskCtx.ParentTaskID != "" {
		payload["parent_task_id"] = taskCtx.ParentTaskID
		payload["parentTaskId"] = taskCtx.ParentTaskID
	}
	if taskCtx.WorkspaceID != "" {
		payload["workspace_id"] = taskCtx.WorkspaceID
		payload["workspaceId"] = taskCtx.WorkspaceID
	}
	if input.WorkspaceID != "" {
		payload["workspace_id"] = input.WorkspaceID
		payload["workspaceId"] = input.WorkspaceID
	}
	if input.ConversationID != "" && taskCtx.ConversationID == "" {
		payload["conversation_id"] = input.ConversationID
		payload["conversationId"] = input.ConversationID
	}
	if input.ParentTaskID != "" && taskCtx.ParentTaskID == "" {
		payload["parent_task_id"] = input.ParentTaskID
		payload["parentTaskId"] = input.ParentTaskID
	}
	if input.RuntimeMode != "" {
		payload["runtime_mode"] = input.RuntimeMode
		payload["runtimeMode"] = input.RuntimeMode
	}
	if input.GenerationMode != "" {
		payload["generation_mode"] = input.GenerationMode
		payload["generationMode"] = input.GenerationMode
	}
	if input.PromptTemplateID != "" {
		payload["prompt_template_id"] = input.PromptTemplateID
		payload["promptTemplateId"] = input.PromptTemplateID
	}
	if input.SourceFile != "" {
		payload["source_file"] = input.SourceFile
		payload["sourceFile"] = input.SourceFile
	}
	if len(input.ReferenceImages) > 0 {
		payload["reference_images"] = input.ReferenceImages
		payload["referenceImages"] = input.ReferenceImages
	}
	if strings.TrimSpace(input.ImageRatio) != "" {
		payload["image_ratio"] = strings.TrimSpace(input.ImageRatio)
		payload["imageRatio"] = strings.TrimSpace(input.ImageRatio)
	}
	if input.FPS > 0 {
		payload["fps"] = input.FPS
	}
	if input.OutputDir != "" {
		payload["output_dir"] = input.OutputDir
		payload["outputDir"] = input.OutputDir
	}
	if input.Publish {
		payload["publish"] = true
	}
	if input.EnableImages != nil {
		payload["enable_images"] = *input.EnableImages
		payload["enableImages"] = *input.EnableImages
	}
	if input.ImageQuality != "" {
		payload["image_quality"] = input.ImageQuality
		payload["imageQuality"] = input.ImageQuality
	}
	return payload
}

// ─── Internals ──────────────────────────────────────────────────────────────

func (a *App) ensureBridge() (*bridge.Client, error) {
	a.mu.Lock()
	settingsValue := a.cachedSettings
	a.mu.Unlock()
	return a.ensureBridgeForCwd(a.effectiveWorkspaceDirForRuntime(settingsValue))
}

func (a *App) ensureBridgeForTask(taskID string) (*bridge.Client, error) {
	if a.localStore == nil || strings.TrimSpace(taskID) == "" {
		return a.ensureBridge()
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	workspacePath, ok, err := a.localStore.TaskWorkspacePath(ctx, taskID)
	if err != nil {
		return nil, err
	}
	if !ok || strings.TrimSpace(workspacePath) == "" {
		return a.ensureBridge()
	}
	cwd, err := cleanExistingWorkspaceDir(workspacePath)
	if err != nil {
		return nil, err
	}
	return a.ensureBridgeForCwd(cwd)
}

func (a *App) ensureBridgeForCwd(cwd string) (*bridge.Client, error) {
	a.mu.Lock()
	if a.bridgeClient != nil && a.bridgeCwd == cwd {
		client := a.bridgeClient
		a.mu.Unlock()
		if !client.Connected() {
			if err := client.Start(a.ctx); err != nil {
				return nil, err
			}
		}
		return client, nil
	}
	if a.bridgeClient != nil {
		client := a.bridgeClient
		a.bridgeClient = nil
		a.bridgeCwd = ""
		a.mu.Unlock()
		client.Close()
		a.mu.Lock()
	}

	settingsValue := a.cachedSettings
	a.mu.Unlock()

	resolved := binresolver.Resolve(a.resolverOptions(settingsValue))
	if resolved.Source == binresolver.SourceFallback {
		message := "OfficeCLI binary is not configured. Install it or set a Bridge binary path in Settings."
		if a.ctx != nil {
			emit(a.ctx, bridgeEventChannel, types.BridgeEvent{
				Type:    "bridge.unconfigured",
				Payload: map[string]any{"message": message},
			})
		}
		return nil, errors.New(message)
	}

	env := appendPptxgenjsRuntimeEnv(llmProviderEnv(settingsValue), bundledPptxgenjsRuntimeEnv())

	a.mu.Lock()
	a.resolvedBinaryPath = resolved.Path
	a.resolvedBinaryEnv = env
	a.binaryResolvedAt = time.Now()
	a.mu.Unlock()

	client := bridge.New(bridge.Options{
		BinaryPath:     resolved.Path,
		Env:            env,
		Cwd:            cwd,
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
		if err := a.RecordAndEmitTaskEvent(ctx, event); err != nil {
			wailsruntime.LogWarningf(ctx, "record task event: %v", err)
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
	})

	if err := client.Start(a.ctx); err != nil {
		return nil, err
	}

	a.mu.Lock()
	a.bridgeClient = client
	a.bridgeCwd = cwd
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
			a.resetBridgeRuntime()
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

func (a *App) resetBridgeRuntime() {
	a.mu.Lock()
	client := a.bridgeClient
	a.bridgeClient = nil
	a.bridgeCwd = ""
	a.resolvedBinaryPath = ""
	a.resolvedBinaryEnv = nil
	a.binaryResolvedAt = time.Time{}
	a.mu.Unlock()

	if client != nil {
		client.Close()
	}
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
	base, err := a.effectiveWorkspaceDirForInput(input.WorkspaceID, input.NoProject, s)
	if err != nil {
		return types.GenerateInput{}, err
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

func cleanWorkspaceDir(workspaceDir string) (string, error) {
	cleaned := strings.TrimSpace(workspaceDir)
	if strings.ContainsRune(cleaned, 0) {
		return "", errors.New("workspace dir is invalid")
	}
	if !filepath.IsAbs(cleaned) {
		return "", errors.New("workspace dir must be absolute")
	}
	return cleaned, nil
}

func cleanExistingWorkspaceDir(workspaceDir string) (string, error) {
	cleaned, err := cleanWorkspaceDir(workspaceDir)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(cleaned)
	if err != nil {
		return "", fmt.Errorf("workspace dir is unavailable: %w", err)
	}
	if !info.IsDir() {
		return "", errors.New("workspace dir must be a directory")
	}
	return cleaned, nil
}

func (a *App) effectiveWorkspaceDirForInput(workspaceID string, noProject bool, s types.UserSettings) (string, error) {
	if noProject {
		return a.workspaceDir, nil
	}
	if a.localStore != nil {
		ctx := a.ctx
		if ctx == nil {
			ctx = context.Background()
		}
		if strings.TrimSpace(workspaceID) != "" {
			ws, err := a.localStore.Workspace(ctx, strings.TrimSpace(workspaceID))
			if err != nil {
				return "", err
			}
			cleaned, err := cleanExistingWorkspaceDir(ws.Path)
			if err != nil {
				return "", err
			}
			if _, err := a.localStore.ActivateWorkspace(ctx, ws.ID); err != nil {
				return "", err
			}
			return cleaned, nil
		}
		if ws, err := a.localStore.ActiveWorkspace(ctx); err == nil {
			return cleanExistingWorkspaceDir(ws.Path)
		}
	}
	return a.effectiveWorkspaceDir(s)
}

func (a *App) effectiveWorkspaceDir(s types.UserSettings) (string, error) {
	if a.localStore != nil {
		ctx := a.ctx
		if ctx == nil {
			ctx = context.Background()
		}
		if ws, err := a.localStore.ActiveWorkspace(ctx); err == nil {
			return cleanExistingWorkspaceDir(ws.Path)
		}
	}
	if s.WorkspaceDir != nil && strings.TrimSpace(*s.WorkspaceDir) != "" {
		return cleanWorkspaceDir(*s.WorkspaceDir)
	}
	if s.OutputDir != nil && strings.TrimSpace(*s.OutputDir) != "" {
		return cleanWorkspaceDir(*s.OutputDir)
	}
	return a.workspaceDir, nil
}

func (a *App) effectiveWorkspaceDirForRuntime(s types.UserSettings) string {
	workspaceDir, err := a.effectiveWorkspaceDir(s)
	if err != nil {
		return a.workspaceDir
	}
	return workspaceDir
}

func (a *App) initializeWorkspaces(ctx context.Context) error {
	if a.localStore == nil {
		return nil
	}
	if err := a.removeDefaultWorkspaceProject(ctx); err != nil {
		return err
	}
	activePath := a.workspaceDir
	if legacy, ok := validSettingsWorkspaceDir(a.cachedSettings); ok {
		if cleaned, err := cleanExistingWorkspaceDir(legacy); err == nil {
			if sameCleanPath(cleaned, a.workspaceDir) {
				activePath = a.workspaceDir
			} else if ws, err := a.localStore.EnsureWorkspace(ctx, cleaned); err == nil {
				if _, activeErr := a.localStore.ActiveWorkspace(ctx); activeErr != nil {
					_, _ = a.localStore.ActivateWorkspace(ctx, ws.ID)
				}
				activePath = ws.Path
			}
		}
	}
	if ws, err := a.localStore.ActiveWorkspace(ctx); err == nil && ws.Path != "" {
		activePath = ws.Path
	}
	return a.applyActiveWorkspace(activePath)
}

func (a *App) removeDefaultWorkspaceProject(ctx context.Context) error {
	if a.localStore == nil {
		return nil
	}
	if _, err := a.localStore.RemoveWorkspaceByPath(ctx, a.workspaceDir); err != nil {
		return err
	}
	return nil
}

func sameCleanPath(aPath, bPath string) bool {
	if strings.TrimSpace(aPath) == "" || strings.TrimSpace(bPath) == "" {
		return false
	}
	return filepath.Clean(aPath) == filepath.Clean(bPath)
}

func (a *App) applyActiveWorkspace(workspacePath string) error {
	workspacePath, err := cleanExistingWorkspaceDir(workspacePath)
	if err != nil {
		return err
	}
	if a.previewReg != nil {
		ctx := a.ctx
		if ctx == nil {
			ctx = context.Background()
		}
		if err := a.previewReg.SetTrustedRoots(a.previewTrustedRoots(ctx, workspacePath, a.cachedSettings)); err != nil {
			return err
		}
	}
	a.resetBridgeRuntime()
	return nil
}

func (a *App) recordTaskWorkspaceContext(taskID, workspaceID, conversationID, parentTaskID, title string, noProject bool) error {
	if a.localStore == nil || strings.TrimSpace(taskID) == "" {
		return nil
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	if strings.TrimSpace(workspaceID) != "" && !noProject {
		ws, err := a.localStore.Workspace(ctx, strings.TrimSpace(workspaceID))
		if err != nil {
			return err
		}
		if _, err := cleanExistingWorkspaceDir(ws.Path); err != nil {
			return err
		}
		if _, err := a.localStore.ActivateWorkspace(ctx, ws.ID); err != nil {
			return err
		}
	}
	resolvedWorkspaceID := ""
	if !noProject {
		ws, err := a.localStore.ActiveWorkspace(ctx)
		if err != nil {
			return err
		}
		resolvedWorkspaceID = ws.ID
	}
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		conversationID = taskID
	}
	if err := a.localStore.EnsureConversation(ctx, resolvedWorkspaceID, conversationID, title); err != nil {
		return err
	}
	return a.localStore.RecordTaskContext(ctx, taskID, localstore.TaskContext{
		WorkspaceID:    resolvedWorkspaceID,
		ConversationID: conversationID,
		ParentTaskID:   parentTaskID,
	})
}

func (a *App) RecordAndEmitTaskEvent(ctx context.Context, event types.BridgeEvent) error {
	completedArtifact := (*types.Artifact)(nil)
	if event.Type == "task.completed" {
		completedArtifact = artifactFromCompletedEvent(event)
	}
	if a.localStore != nil {
		if err := a.localStore.RecordEvent(event); err != nil {
			return err
		}
	}
	if event.Type == "task.completed" && completedArtifact != nil {
		if err := a.AllowArtifact(*completedArtifact); err != nil {
			return err
		}
		if err := a.RecordArtifact(*completedArtifact); err != nil {
			return err
		}
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
	return a.localStore.RecordArtifact(artifact)
}

func (a *App) UserDataDir() string {
	return a.userDataDir
}

func (a *App) WorkspaceDir() string {
	return a.workspaceDir
}

func (a *App) refreshPreviewTrustedRoots(s types.UserSettings) error {
	if a.previewReg == nil {
		return nil
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	activeWorkspace := a.workspaceDir
	if a.localStore != nil {
		if ws, err := a.localStore.ActiveWorkspace(ctx); err == nil && strings.TrimSpace(ws.Path) != "" {
			activeWorkspace = ws.Path
		}
	}
	roots, ok := a.previewTrustedRootsForUpdate(ctx, activeWorkspace, s)
	if !ok {
		return nil
	}
	if err := a.previewReg.SetTrustedRoots(roots); err != nil {
		return fmt.Errorf("refresh preview trusted roots: %w", err)
	}
	return nil
}

func (a *App) previewTrustedRoots(ctx context.Context, activeWorkspace string, s types.UserSettings) []string {
	roots := previewTrustedRoots(a.workspaceDir, s)
	if cleaned, err := cleanExistingWorkspaceDir(activeWorkspace); err == nil {
		roots = append(roots, cleaned)
	}
	if a.localStore == nil {
		return roots
	}
	summaries, err := a.localStore.QueryWorkspaceSummaries(ctx, 0)
	if err != nil {
		return roots
	}
	for _, summary := range summaries {
		if cleaned, err := cleanExistingWorkspaceDir(summary.Path); err == nil {
			roots = append(roots, cleaned)
		}
	}
	return roots
}

func (a *App) previewTrustedRootsForUpdate(ctx context.Context, activeWorkspace string, s types.UserSettings) ([]string, bool) {
	if hasInvalidWorkspaceDir(s) {
		return nil, false
	}
	return a.previewTrustedRoots(ctx, activeWorkspace, s), true
}

func previewTrustedRoots(workspaceDir string, s types.UserSettings) []string {
	roots := []string{workspaceDir}
	if custom, ok := validSettingsWorkspaceDir(s); ok {
		return append(roots, custom)
	}
	return roots
}

func previewTrustedRootsForUpdate(workspaceDir string, s types.UserSettings) ([]string, bool) {
	if hasInvalidWorkspaceDir(s) {
		return nil, false
	}
	return previewTrustedRoots(workspaceDir, s), true
}

func validSettingsWorkspaceDir(s types.UserSettings) (string, bool) {
	if s.WorkspaceDir != nil && strings.TrimSpace(*s.WorkspaceDir) != "" {
		workspaceDir, err := cleanWorkspaceDir(*s.WorkspaceDir)
		return workspaceDir, err == nil
	}
	if s.OutputDir != nil && strings.TrimSpace(*s.OutputDir) != "" {
		workspaceDir, err := cleanWorkspaceDir(*s.OutputDir)
		return workspaceDir, err == nil
	}
	return "", false
}

func hasInvalidWorkspaceDir(s types.UserSettings) bool {
	if s.WorkspaceDir != nil && strings.TrimSpace(*s.WorkspaceDir) != "" {
		_, err := cleanWorkspaceDir(*s.WorkspaceDir)
		return err != nil
	}
	if s.OutputDir != nil && strings.TrimSpace(*s.OutputDir) != "" {
		_, err := cleanWorkspaceDir(*s.OutputDir)
		return err != nil
	}
	return false
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
	out := developmentOfficeCLIEnv()
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

// developmentOfficeCLIEnv isolates officecli's os.UserConfigDir-backed
// auxiliary state (for example license-state.json) without changing HOME for
// the Wails build process itself. Production launches do not set the sentinel
// and therefore retain the normal user environment.
func developmentOfficeCLIEnv() []string {
	home := strings.TrimSpace(os.Getenv("OFFICEDEX_DEV_OFFICECLI_HOME"))
	if home == "" || !filepath.IsAbs(home) {
		return nil
	}
	home = filepath.Clean(home)
	return []string{
		"HOME=" + home,
		"XDG_CONFIG_HOME=" + filepath.Join(home, ".config"),
		"XDG_CACHE_HOME=" + filepath.Join(home, ".cache"),
		"XDG_DATA_HOME=" + filepath.Join(home, ".local", "share"),
	}
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
	if !canEmitWailsEvent(ctx) {
		return
	}
	wailsruntime.EventsEmit(ctx, channel, payload)
}

func canEmitWailsEvent(ctx context.Context) bool {
	if ctx == nil {
		return false
	}
	switch fmt.Sprintf("%T", ctx) {
	case "context.backgroundCtx", "context.todoCtx":
		return false
	default:
		return true
	}
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

func (a *App) refreshImageWatermarkSettingsForGenerate(current types.UserSettings) (types.UserSettings, *types.ImageWatermarkGenerateOptions) {
	credit, creditErr := a.GetCreditStatus()
	next, changed := syncImageWatermarkSettingsForCredit(current, credit, creditErr)
	if !changed {
		return next, imageWatermarkGenerateOptions(next, credit, creditErr)
	}
	updated, err := a.settingsStore.Update(settings.Patch{ImageWatermark: &next.ImageWatermark})
	if err != nil {
		if a.ctx != nil {
			wailsruntime.LogWarningf(a.ctx, "image watermark sync settings: %v", err)
		}
		return next, imageWatermarkGenerateOptions(next, credit, creditErr)
	}
	return updated, imageWatermarkGenerateOptions(updated, credit, creditErr)
}

func syncImageWatermarkSettingsForCredit(s types.UserSettings, credit types.CreditStatus, creditErr error) (types.UserSettings, bool) {
	next := s
	source := strings.ToLower(strings.TrimSpace(next.ImageWatermark.PreferenceSource))
	if source != "user" {
		source = "system"
	}
	next.ImageWatermark.PreferenceSource = source

	if source == "user" {
		return next, next.ImageWatermark.PreferenceSource != s.ImageWatermark.PreferenceSource
	}

	wantShow := true
	if hasImageWatermarkEntitlement(credit, creditErr) {
		wantShow = false
	}
	if next.ImageWatermark.ShowWatermark != wantShow {
		next.ImageWatermark.ShowWatermark = wantShow
		return next, true
	}
	return next, next.ImageWatermark.PreferenceSource != s.ImageWatermark.PreferenceSource
}

func imageWatermarkGenerateOptions(s types.UserSettings, credit types.CreditStatus, creditErr error) *types.ImageWatermarkGenerateOptions {
	paid := hasImageWatermarkEntitlement(credit, creditErr)
	return &types.ImageWatermarkGenerateOptions{
		Apply:           shouldRequestImageWatermark(s, credit, creditErr),
		PaidEntitlement: paid,
		CanDisable:      paid,
	}
}

func shouldRequestImageWatermark(s types.UserSettings, credit types.CreditStatus, creditErr error) bool {
	if s.ImageWatermark.ShowWatermark {
		return true
	}
	if creditErr != nil {
		return true
	}
	return !hasImageWatermarkEntitlement(credit, creditErr)
}

func hasImageWatermarkEntitlement(credit types.CreditStatus, creditErr error) bool {
	if creditErr != nil {
		return false
	}
	return credit.PaidEntitlement
}

// resolveUserDataDir mirrors what Electron's app.getPath("userData") returns.
func resolveUserDataDir(appName string) (string, error) {
	if override := strings.TrimSpace(os.Getenv("OFFICEDEX_DEV_USER_DATA_DIR")); override != "" {
		if !filepath.IsAbs(override) {
			return "", errors.New("OFFICEDEX_DEV_USER_DATA_DIR must be an absolute path")
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
