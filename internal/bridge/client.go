// Package bridge is the Go port of src/main/bridgeClient.ts.
//
// The bridge owns the lifecycle of an `officecli agent-bridge` child process
// and speaks JSON-RPC 2.0 over its stdio using LSP-style framing
// (`Content-Length` header + CRLF + body). Higher-level helpers wrap the raw
// request/response calls into the renderer-facing API (initialize, sessions,
// task invoke / respond / cancel).
//
// Style conventions inherited from internal/settings:
//
//   - Errors use fmt.Errorf with the "bridge: <action>: %w" prefix.
//   - Concurrency-sensitive state (transport, pending map, listeners, buffers)
//     is guarded by a single sync.Mutex on Client.
//   - All renderer-facing methods accept a context.Context for cancellation.
//   - Transport is an injectable interface; tests use fake transports backed
//     by io.Pipe and never spawn a real process.
package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"officedex/internal/types"
)

// Defaults mirror the TypeScript constructor defaults.
const (
	DefaultRequestTimeout       = 30 * time.Second
	DefaultTaskInvokeTimeout    = 30 * time.Minute
	DefaultPptxJSPlanTimeout    = 45 * time.Second
	DefaultMaxReconnectAttempts = 8
	DefaultBaseReconnectDelay   = 1 * time.Second
	maxReconnectDelay           = 30 * time.Second
	stderrTailBytes             = 8192
)

// StrandedTaskCode tags the synthetic task.failed events emitted when the child
// process goes away while tasks are still running.
const StrandedTaskCode = "BRIDGE_PROCESS_GONE"

// taskInvokeMethod is the JSON-RPC method that starts a task.
const taskInvokeMethod = "task/invoke"

const (
	strandedStoppedMessage = "OfficeCLI agent-bridge was stopped before this task finished. Please run it again."
	strandedExitedMessage  = "OfficeCLI agent-bridge exited before this task finished. Please run it again."
)

// Options configures a new Client.
//
// Either BinaryPath or ResolveBinary should be set for the default transport
// to find the officecli executable. Tests supply CreateTransport directly to
// avoid spawning processes.
type Options struct {
	ClientID             string
	BridgeInstanceID     string
	RuntimeRoot          string
	NewBridgeInstanceID  func() string
	BinaryPath           string
	ResolveBinary        func() string
	Cwd                  string
	Env                  []string
	CreateTransport      TransportFactory
	RequestTimeout       time.Duration
	TaskInvokeTimeout    time.Duration
	PptxJSPlanTimeout    time.Duration
	DisableAutoReconnect bool
	MaxReconnectAttempts int
	BaseReconnectDelay   time.Duration
	// LogDir, when non-empty, enables async tee of stdout/stderr chunks to
	// rotating per-day files under that directory (`bridge-YYYYMMDD.log`).
	// Writes are non-blocking; see Logfile.
	LogDir string
}

// EventListener is the callback shape registered via OnEvent.
type EventListener func(types.BridgeEvent)

// Client is a high-level wrapper around the agent-bridge child process. Safe
// for concurrent use; all exported methods take the internal mutex.
type Client struct {
	options          Options
	bridgeInstanceID string

	mu               sync.Mutex
	transport        Transport
	nextID           int
	pending          map[string]*pendingRequest
	listeners        []listenerEntry
	listenerNextKey  int
	sessionID        string
	outputBuffer     []byte
	stderrBuffer     string
	reconnectAttempt int
	reconnectTimer   *time.Timer
	stoppedManually  bool
	initialized      bool
	capabilities     bridgeCapabilities
	logfile          *Logfile
	// activeTasks holds the tasks whose completion still depends on this
	// child process: killing it now strands them with no terminal event.
	// Interactive waits (task.question / task.plan) are deliberately not
	// counted, because the app replays those against a fresh process.
	activeTasks map[string]struct{}
	// pendingInvokes counts in-flight task/invoke calls, closing the window
	// between "invoke written" and "task.started received".
	pendingInvokes int
}

type bridgeCapabilities struct {
	loaded                  bool
	imageWatermarkSupported bool
}

type listenerEntry struct {
	key int
	cb  EventListener
}

type pendingRequest struct {
	timer  *time.Timer
	result chan rpcResponse
	method string
}

// New constructs a Client with sensible defaults filled in.
func New(opts Options) *Client {
	if opts.RequestTimeout == 0 {
		opts.RequestTimeout = DefaultRequestTimeout
	}
	if opts.TaskInvokeTimeout == 0 {
		opts.TaskInvokeTimeout = DefaultTaskInvokeTimeout
	}
	if opts.PptxJSPlanTimeout == 0 {
		opts.PptxJSPlanTimeout = DefaultPptxJSPlanTimeout
	}
	if opts.MaxReconnectAttempts == 0 {
		opts.MaxReconnectAttempts = DefaultMaxReconnectAttempts
	}
	if opts.BaseReconnectDelay == 0 {
		opts.BaseReconnectDelay = DefaultBaseReconnectDelay
	}
	if opts.NewBridgeInstanceID == nil {
		opts.NewBridgeInstanceID = uuid.NewString
	}
	return &Client{
		options:     opts,
		nextID:      1,
		pending:     make(map[string]*pendingRequest),
		sessionID:   "default",
		activeTasks: make(map[string]struct{}),
	}
}

// Connected reports whether the bridge process is currently running.
func (c *Client) Connected() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.transport != nil
}

// HasActiveWork reports whether killing the child process right now would
// strand work: either a task/invoke is still in flight or a task has started
// and not yet reached a terminal or interactive-wait state. Callers that swap
// clients (see App.ensureBridgeForCwd) use this to keep a busy process alive
// instead of orphaning its tasks.
func (c *Client) HasActiveWork() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.pendingInvokes > 0 || len(c.activeTasks) > 0
}

// ActiveTaskIDs returns the tasks currently tracked as mid-flight. The order is
// unspecified.
func (c *Client) ActiveTaskIDs() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	ids := make([]string, 0, len(c.activeTasks))
	for id := range c.activeTasks {
		ids = append(ids, id)
	}
	return ids
}

// takeActiveTasks atomically drains the active set so a single stranded-task
// notification wins the race between Stop and waitExit.
func (c *Client) takeActiveTasks() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.activeTasks) == 0 {
		return nil
	}
	ids := make([]string, 0, len(c.activeTasks))
	for id := range c.activeTasks {
		ids = append(ids, id)
	}
	c.activeTasks = make(map[string]struct{})
	return ids
}

// failStrandedTasks synthesizes a task.failed for every task the dead process
// still owed an answer for. Without it those tasks keep their `running` status
// forever and the UI spins with no way to recover.
func (c *Client) failStrandedTasks(taskIDs []string, message string) {
	for _, taskID := range taskIDs {
		c.emitEvent(types.BridgeEvent{
			TaskID: taskID,
			Type:   "task.failed",
			TS:     time.Now().UTC().Format(time.RFC3339Nano),
			Payload: map[string]any{
				"message":  message,
				"code":     StrandedTaskCode,
				"stranded": true,
			},
		})
	}
}

// trackTaskEvent maintains activeTasks from the bridge's own event stream.
func (c *Client) trackTaskEvent(event types.BridgeEvent) {
	taskID := strings.TrimSpace(event.TaskID)
	if taskID == "" || !strings.HasPrefix(event.Type, "task.") {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	switch event.Type {
	case "task.completed", "task.failed", "task.cancelled", "task.question", "task.plan":
		delete(c.activeTasks, taskID)
	default:
		c.activeTasks[taskID] = struct{}{}
	}
}

// LogfileDroppedBytes returns the cumulative bytes dropped by the async logfile
// tee due to channel pressure, or 0 when no logfile is attached. Used by the
// diagnostics bundle to expose `runtimeDroppedBytes` in meta.json.
func (c *Client) LogfileDroppedBytes() int64 {
	c.mu.Lock()
	lf := c.logfile
	c.mu.Unlock()
	if lf == nil {
		return 0
	}
	return lf.DroppedBytes()
}

// OnEvent registers a listener for bridge events. Returns an unsubscribe
// function.
func (c *Client) OnEvent(cb EventListener) func() {
	c.mu.Lock()
	c.listenerNextKey++
	key := c.listenerNextKey
	c.listeners = append(c.listeners, listenerEntry{key: key, cb: cb})
	c.mu.Unlock()
	return func() {
		c.mu.Lock()
		defer c.mu.Unlock()
		filtered := c.listeners[:0]
		for _, entry := range c.listeners {
			if entry.key != key {
				filtered = append(filtered, entry)
			}
		}
		c.listeners = filtered
	}
}

// Start spawns the child process (or invokes the injected transport factory)
// and begins reading its stdio. Idempotent if already started.
func (c *Client) Start(ctx context.Context) error {
	c.mu.Lock()
	if c.transport != nil {
		c.mu.Unlock()
		return nil
	}
	c.stoppedManually = false
	factory := c.options.CreateTransport
	if factory == nil {
		factory = defaultProcessTransport
	}
	if c.options.NewBridgeInstanceID != nil {
		c.options.BridgeInstanceID = c.options.NewBridgeInstanceID()
	}
	c.bridgeInstanceID = c.options.BridgeInstanceID
	transport, err := factory(c.options)
	if err != nil {
		c.mu.Unlock()
		return fmt.Errorf("bridge: start: %w", err)
	}
	c.transport = transport
	c.outputBuffer = nil
	c.stderrBuffer = ""
	if c.logfile == nil && c.options.LogDir != "" {
		lf, lfErr := NewLogfile(c.options.LogDir, nil)
		if lfErr != nil {
			fmt.Fprintf(os.Stderr, "bridge: open logfile: %v\n", lfErr)
		} else {
			c.logfile = lf
		}
	}
	c.mu.Unlock()

	go c.readStdout(transport)
	go c.readStderr(transport)
	go c.waitExit(transport)
	return nil
}

// BridgeInstanceID identifies the currently running child process.
func (c *Client) BridgeInstanceID() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.bridgeInstanceID
}

// Stop kills the child process (if any), rejects all pending requests, and
// disables auto-reconnect until the next Start.
func (c *Client) Stop() {
	c.mu.Lock()
	c.stoppedManually = true
	if c.reconnectTimer != nil {
		c.reconnectTimer.Stop()
		c.reconnectTimer = nil
	}
	c.reconnectAttempt = 0
	pending := c.pending
	c.pending = make(map[string]*pendingRequest)
	transport := c.transport
	c.transport = nil
	c.outputBuffer = nil
	c.mu.Unlock()

	for _, req := range pending {
		req.timer.Stop()
		select {
		case req.result <- rpcResponse{err: errors.New("bridge: officecli agent-bridge stopped")}:
		default:
		}
	}
	if transport != nil {
		_ = transport.Kill()
	}
	// Emitted synchronously so Close (which detaches listeners right after
	// Stop returns) still delivers the failures to the app.
	c.failStrandedTasks(c.takeActiveTasks(), strandedStoppedMessage)
}

// Close stops the child process and additionally detaches all listeners so the
// caller's OnEvent closures stop referencing the old context. Use this instead
// of Stop when discarding the client (e.g. when settings change requires a
// fresh client with fresh callbacks); the goroutines holding `transport` will
// observe EOF and exit on their own once Kill closes the pipes.
func (c *Client) Close() {
	c.Stop()
	c.mu.Lock()
	c.listeners = nil
	lf := c.logfile
	c.logfile = nil
	c.mu.Unlock()
	if lf != nil {
		_ = lf.Close()
	}
}

// Request sends a JSON-RPC call and waits for the response. Returns the raw
// `result` payload, which the caller decodes into a typed shape.
func (c *Client) Request(ctx context.Context, method string, params any) ([]byte, error) {
	return c.requestWithTimeout(ctx, method, params, c.options.RequestTimeout)
}

func (c *Client) requestWithTimeout(ctx context.Context, method string, params any, timeout time.Duration) ([]byte, error) {
	if method == taskInvokeMethod {
		c.mu.Lock()
		c.pendingInvokes++
		c.mu.Unlock()
		defer func() {
			c.mu.Lock()
			if c.pendingInvokes > 0 {
				c.pendingInvokes--
			}
			c.mu.Unlock()
		}()
	}
	c.mu.Lock()
	if c.transport == nil {
		tail := strings.TrimSpace(c.stderrBuffer)
		c.mu.Unlock()
		suffix := ""
		if tail != "" {
			suffix = "\nstderr:\n" + tail
		}
		return nil, fmt.Errorf("bridge: officecli agent-bridge is not running%s", suffix)
	}
	id := c.nextID
	c.nextID++
	transport := c.transport
	key := fmt.Sprintf("%d", id)
	respChan := make(chan rpcResponse, 1)
	timer := time.AfterFunc(timeout, func() {
		c.mu.Lock()
		pending, ok := c.pending[key]
		if ok {
			delete(c.pending, key)
		}
		c.mu.Unlock()
		if ok {
			pending.result <- rpcResponse{err: fmt.Errorf("bridge: officecli bridge request timed out: %s", method)}
		}
	})
	c.pending[key] = &pendingRequest{timer: timer, result: respChan, method: method}
	c.mu.Unlock()

	if err := writeJSONRPC(transport, jsonrpcRequest{JSONRPC: "2.0", ID: id, Method: method, Params: params}); err != nil {
		c.mu.Lock()
		delete(c.pending, key)
		c.mu.Unlock()
		timer.Stop()
		return nil, fmt.Errorf("bridge: write request: %w", err)
	}

	select {
	case <-ctx.Done():
		c.mu.Lock()
		delete(c.pending, key)
		c.mu.Unlock()
		timer.Stop()
		return nil, ctx.Err()
	case resp := <-respChan:
		return resp.result, resp.err
	}
}

// Initialize calls the "initialize" RPC and refuses a bridge whose protocol is
// older than this app can talk to. Failing here, before any work is queued,
// is the point: the alternative is a "method not found" partway through a
// generation the user has already waited on.
func (c *Client) Initialize(ctx context.Context) ([]byte, error) {
	raw, err := c.Request(ctx, "initialize", nil)
	if err != nil {
		return nil, err
	}
	if err := checkProtocolVersion(raw); err != nil {
		return nil, err
	}
	return raw, nil
}

// GetCapabilities calls "capabilities/get".
func (c *Client) GetCapabilities(ctx context.Context) ([]byte, error) {
	raw, err := c.Request(ctx, "capabilities/get", nil)
	if err != nil {
		return nil, err
	}
	c.rememberCapabilities(raw)
	return raw, nil
}

type bridgeImagePromptSlot struct {
	Key          string `json:"key"`
	Label        string `json:"label"`
	DefaultValue string `json:"default_value,omitempty"`
	HelpText     string `json:"help_text,omitempty"`
	Required     bool   `json:"required,omitempty"`
	Multiline    bool   `json:"multiline,omitempty"`
}

type bridgeImagePromptTemplate struct {
	ID           uint64                  `json:"id"`
	OwnerUserID  uint64                  `json:"owner_user_id,omitempty"`
	Visibility   string                  `json:"visibility,omitempty"`
	Slug         string                  `json:"slug"`
	Title        string                  `json:"title"`
	Description  string                  `json:"description"`
	PromptPreset string                  `json:"prompt_preset"`
	ThumbnailURL string                  `json:"thumbnail_url,omitempty"`
	SortOrder    int                     `json:"sort_order"`
	Enabled      bool                    `json:"enabled"`
	Tags         []string                `json:"tags,omitempty"`
	Slots        []bridgeImagePromptSlot `json:"slots,omitempty"`
}

type bridgeImageTemplatePublishRequest struct {
	ID                uint64 `json:"id"`
	PrivateTemplateID uint64 `json:"private_template_id"`
	RequesterUserID   uint64 `json:"requester_user_id"`
	ProvenanceID      uint64 `json:"provenance_id"`
	Status            string `json:"status"`
	SubmitterNote     string `json:"submitter_note"`
	PublicTemplateID  uint64 `json:"public_template_id"`
	CreatedAt         string `json:"created_at"`
	UpdatedAt         string `json:"updated_at"`
}

// ListImageTemplates calls "image_templates/list" and maps bridge snake_case
// fields to the renderer-facing camelCase shape.
func (c *Client) ListImageTemplates(ctx context.Context) ([]types.ImagePromptTemplate, error) {
	raw, err := c.Request(ctx, "image_templates/list", nil)
	if err != nil {
		return nil, err
	}
	var bridgeItems []bridgeImagePromptTemplate
	if err := decodeJSON(raw, &bridgeItems); err != nil {
		return nil, fmt.Errorf("bridge: decode image_templates/list: %w", err)
	}
	items := make([]types.ImagePromptTemplate, 0, len(bridgeItems))
	for _, item := range bridgeItems {
		var slots []types.ImagePromptSlot
		if len(item.Slots) > 0 {
			slots = make([]types.ImagePromptSlot, 0, len(item.Slots))
			for _, s := range item.Slots {
				slots = append(slots, types.ImagePromptSlot{
					Key:          s.Key,
					Label:        s.Label,
					DefaultValue: s.DefaultValue,
					HelpText:     s.HelpText,
					Required:     s.Required,
					Multiline:    s.Multiline,
				})
			}
		}
		items = append(items, types.ImagePromptTemplate{
			ID:           item.ID,
			OwnerUserID:  item.OwnerUserID,
			Visibility:   item.Visibility,
			Slug:         item.Slug,
			Title:        item.Title,
			Description:  item.Description,
			PromptPreset: item.PromptPreset,
			ThumbnailURL: item.ThumbnailURL,
			SortOrder:    item.SortOrder,
			Enabled:      item.Enabled,
			Tags:         append([]string(nil), item.Tags...),
			Slots:        slots,
		})
	}
	return items, nil
}

func (c *Client) CreateImageTemplate(ctx context.Context, input types.CreateUserImageTemplateInput) (*types.ImagePromptTemplate, error) {
	params := map[string]any{
		"source_template_id": input.SourceTemplateID,
		"slug":               input.Slug,
		"title":              input.Title,
		"description":        input.Description,
		"prompt_preset":      input.PromptPreset,
		"sort_order":         input.SortOrder,
	}
	if len(input.Tags) > 0 {
		params["tags"] = append([]string(nil), input.Tags...)
	}
	if len(input.Slots) > 0 {
		slots := make([]map[string]any, 0, len(input.Slots))
		for _, slot := range input.Slots {
			slots = append(slots, map[string]any{
				"key":           slot.Key,
				"label":         slot.Label,
				"default_value": slot.DefaultValue,
				"help_text":     slot.HelpText,
				"required":      slot.Required,
				"multiline":     slot.Multiline,
			})
		}
		params["slots"] = slots
	}
	raw, err := c.Request(ctx, "image_templates/create", params)
	if err != nil {
		return nil, err
	}
	var item bridgeImagePromptTemplate
	if err := decodeJSON(raw, &item); err != nil {
		return nil, fmt.Errorf("bridge: decode image_templates/create: %w", err)
	}
	mapped := types.ImagePromptTemplate{
		ID:           item.ID,
		OwnerUserID:  item.OwnerUserID,
		Visibility:   item.Visibility,
		Slug:         item.Slug,
		Title:        item.Title,
		Description:  item.Description,
		PromptPreset: item.PromptPreset,
		ThumbnailURL: item.ThumbnailURL,
		SortOrder:    item.SortOrder,
		Enabled:      item.Enabled,
		Tags:         append([]string(nil), item.Tags...),
	}
	return &mapped, nil
}

func (c *Client) CreateImageTemplatePublishRequest(ctx context.Context, input types.CreateImageTemplatePublishRequestInput) (*types.ImageTemplatePublishRequest, error) {
	params := map[string]any{
		"private_template_id": input.PrivateTemplateID,
		"provenance_id":       input.ProvenanceID,
		"request_id":          input.RequestID,
		"submitter_note":      input.SubmitterNote,
	}
	raw, err := c.Request(ctx, "image_template_publish_requests/create", params)
	if err != nil {
		return nil, err
	}
	var item bridgeImageTemplatePublishRequest
	if err := decodeJSON(raw, &item); err != nil {
		return nil, fmt.Errorf("bridge: decode image_template_publish_requests/create: %w", err)
	}
	mapped := types.ImageTemplatePublishRequest{
		ID:                item.ID,
		PrivateTemplateID: item.PrivateTemplateID,
		RequesterUserID:   item.RequesterUserID,
		ProvenanceID:      item.ProvenanceID,
		Status:            item.Status,
		SubmitterNote:     item.SubmitterNote,
		PublicTemplateID:  item.PublicTemplateID,
		CreatedAt:         item.CreatedAt,
		UpdatedAt:         item.UpdatedAt,
	}
	return &mapped, nil
}

// OpenSession calls "session/open" and caches the returned session id.
func (c *Client) OpenSession(ctx context.Context) (string, error) {
	raw, err := c.Request(ctx, "session/open", nil)
	if err != nil {
		return "", err
	}
	id := decodeStringField(raw, "id")
	if id == "" {
		id = "default"
	}
	c.mu.Lock()
	c.sessionID = id
	c.mu.Unlock()
	return id, nil
}

// SessionID returns the cached session id (default "default" until OpenSession
// completes).
func (c *Client) SessionID() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.sessionID
}

// InvokeGenerate calls "task/invoke" with the office.generate tool args
// projected from the GenerateInput.
func (c *Client) InvokeGenerate(ctx context.Context, input types.GenerateInput) (TaskInvokeResult, error) {
	ratio, err := imageRatioArg(input)
	if err != nil {
		return TaskInvokeResult{}, err
	}
	fps, err := gifFPSArg(input)
	if err != nil {
		return TaskInvokeResult{}, err
	}
	officeMode, interactive, err := officeGenerateModeArgs(input)
	if err != nil {
		return TaskInvokeResult{}, err
	}
	c.mu.Lock()
	sessionID := c.sessionID
	c.mu.Unlock()
	if sessionID == "default" {
		opened, err := c.OpenSession(ctx)
		if err != nil {
			return TaskInvokeResult{}, err
		}
		sessionID = opened
	}
	args := map[string]any{
		"document_type":      input.DocumentType,
		"topic":              input.Topic,
		"prompt":             input.Prompt,
		"prompt_template_id": input.PromptTemplateID,
		"out":                input.OutputDir,
		"publish":            input.Publish,
		"enable_images":      input.EnableImages,
		"image_quality":      input.ImageQuality,
		// LocalPreview is forced to true to match the TS origin's
		// `input.localPreview ?? true`. The boolean field can't distinguish
		// "renderer omitted" from "renderer sent false" once it lands here,
		// so we keep the safer default that the local preview pipeline relies
		// on. Renderer code that needs to opt out should be revisited as part
		// of the Wails binding rewrite.
		"local_preview": true,
	}
	if input.RuntimeMode != "" {
		args["runtime_mode"] = input.RuntimeMode
	}
	if strings.TrimSpace(input.PPTXBackend) != "" {
		args["pptx_backend"] = input.PPTXBackend
	} else if input.DocumentType == types.DocPPTX {
		// OfficeDex's primary PPTX path is op-driven MOP authoring: the
		// OfficeCLI worker emits ordered vibe_ops while PowerPoint.run authors
		// the editable deck. Keep officegen available only as an explicit
		// compatibility choice.
		args["pptx_backend"] = "mop-skill"
	}
	if officeMode != "" {
		args["mode"] = officeMode
	}
	if isOfficeDocumentType(input.DocumentType) && strings.EqualFold(strings.TrimSpace(input.GenerationMode), "plan") {
		args["generation_mode"] = "plan"
	}
	if ratio != "" {
		args["ratio"] = ratio
	}
	if fps > 0 {
		args["fps"] = fps
	}
	if watermark := c.imageWatermarkArg(ctx, input); watermark != nil {
		args["image_watermark"] = watermark
	}
	for k, v := range buildAttachmentArgs(input) {
		args[k] = v
	}
	raw, err := c.requestWithTimeout(ctx, taskInvokeMethod, map[string]any{
		"session_id":    sessionID,
		"tool":          "office.generate",
		"interactive":   interactive,
		"output_format": "bundle",
		"args":          args,
	}, c.options.TaskInvokeTimeout)
	if err != nil {
		return TaskInvokeResult{}, err
	}
	var result TaskInvokeResult
	if err := decodeJSON(raw, &result); err != nil {
		return TaskInvokeResult{}, fmt.Errorf("bridge: decode task/invoke: %w", err)
	}
	return result, nil
}

func officeGenerateModeArgs(input types.GenerateInput) (string, bool, error) {
	if !isOfficeDocumentType(input.DocumentType) {
		return "", false, nil
	}
	switch strings.ToLower(strings.TrimSpace(input.GenerationMode)) {
	case "", "fast", "plan":
		return "best", true, nil
	default:
		return "", false, fmt.Errorf("bridge: unsupported generation mode: %s", input.GenerationMode)
	}
}

func isOfficeDocumentType(documentType types.DocumentType) bool {
	switch documentType {
	case types.DocPPTX, types.DocDOCX, types.DocXLSX, types.DocReport:
		return true
	default:
		return false
	}
}

func imageRatioArg(input types.GenerateInput) (string, error) {
	ratio := strings.ToLower(strings.TrimSpace(input.ImageRatio))
	if ratio == "" || input.DocumentType != types.DocIMG {
		return "", nil
	}
	switch ratio {
	case "square", "landscape", "portrait":
		return ratio, nil
	default:
		return "", fmt.Errorf("bridge: unsupported image ratio: %s", input.ImageRatio)
	}
}

func gifFPSArg(input types.GenerateInput) (int, error) {
	if input.DocumentType != types.DocGIF || input.FPS == 0 {
		return 0, nil
	}
	if input.FPS < 4 || input.FPS > 24 {
		return 0, fmt.Errorf("bridge: unsupported gif fps: %d", input.FPS)
	}
	return input.FPS, nil
}

func (c *Client) imageWatermarkArg(ctx context.Context, input types.GenerateInput) map[string]any {
	if input.DocumentType != types.DocIMG || input.ImageWatermark == nil {
		return nil
	}
	if !c.supportsImageWatermark(ctx) {
		return nil
	}
	return map[string]any{
		"apply":           input.ImageWatermark.Apply,
		"paidEntitlement": input.ImageWatermark.PaidEntitlement,
		"canDisable":      input.ImageWatermark.CanDisable,
	}
}

func (c *Client) supportsImageWatermark(ctx context.Context) bool {
	c.mu.Lock()
	caps := c.capabilities
	c.mu.Unlock()
	if caps.loaded {
		return caps.imageWatermarkSupported
	}
	raw, err := c.GetCapabilities(ctx)
	if err != nil {
		c.mu.Lock()
		c.capabilities.loaded = true
		c.capabilities.imageWatermarkSupported = false
		c.mu.Unlock()
		return false
	}
	return bridgeCapabilitiesFromPayload(raw).imageWatermarkSupported
}

func (c *Client) rememberCapabilities(raw []byte) {
	caps := bridgeCapabilitiesFromPayload(raw)
	c.mu.Lock()
	c.capabilities = caps
	c.mu.Unlock()
}

func bridgeCapabilitiesFromPayload(raw []byte) bridgeCapabilities {
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return bridgeCapabilities{loaded: true}
	}
	return bridgeCapabilities{
		loaded:                  true,
		imageWatermarkSupported: nestedBool(payload, true, "image_generation", "watermark", "supported") || nestedBool(payload, true, "document_generation", "img", "image_generation", "watermark", "supported"),
	}
}

func nestedBool(root map[string]any, want bool, path ...string) bool {
	var current any = root
	for _, key := range path {
		next, ok := current.(map[string]any)
		if !ok {
			return false
		}
		current, ok = next[key]
		if !ok {
			return false
		}
	}
	got, ok := current.(bool)
	return ok && got == want
}

// InvokeModify calls "task/invoke" with the office.modify tool args projected
// from a ModifyInput. This is the "继续修改" path: an LLM-driven in-place edit
// of an existing pptx/docx/xlsx artifact. officecli writes the result as
// <base>.modified.<ext> next to the source (or under `out` when provided).
func (c *Client) InvokeModify(ctx context.Context, input types.ModifyInput) (TaskInvokeResult, error) {
	c.mu.Lock()
	sessionID := c.sessionID
	c.mu.Unlock()
	if sessionID == "default" {
		opened, err := c.OpenSession(ctx)
		if err != nil {
			return TaskInvokeResult{}, err
		}
		sessionID = opened
	}
	args := map[string]any{
		"source_file": input.SourceFile,
		"prompt":      input.Prompt,
		"format":      input.DocumentType,
		"out":         input.OutputDir,
		// Mirror InvokeGenerate: run the local preview pipeline so the renderer
		// can show the modified file.
		"local_preview": true,
	}
	if strings.TrimSpace(input.Language) != "" {
		args["lang"] = input.Language
	}
	if strings.TrimSpace(input.Style) != "" {
		args["style"] = input.Style
	}
	raw, err := c.requestWithTimeout(ctx, taskInvokeMethod, map[string]any{
		"session_id":    sessionID,
		"tool":          "office.modify",
		"interactive":   true,
		"output_format": "bundle",
		"args":          args,
	}, c.options.TaskInvokeTimeout)
	if err != nil {
		return TaskInvokeResult{}, err
	}
	var result TaskInvokeResult
	if err := decodeJSON(raw, &result); err != nil {
		return TaskInvokeResult{}, fmt.Errorf("bridge: decode task/invoke: %w", err)
	}
	return result, nil
}

// InvokeArtifactStageEdit starts the versioned scoped-artifact workflow.
func (c *Client) InvokeArtifactStageEdit(ctx context.Context, input types.ArtifactStageEditInput) (TaskInvokeResult, error) {
	c.mu.Lock()
	sessionID := c.sessionID
	c.mu.Unlock()
	if sessionID == "default" {
		opened, err := c.OpenSession(ctx)
		if err != nil {
			return TaskInvokeResult{}, err
		}
		sessionID = opened
	}
	raw, err := c.requestWithTimeout(ctx, taskInvokeMethod, map[string]any{
		"session_id": sessionID, "tool": "artifact_stage_edit.v1", "interactive": true,
		"output_format": "bundle", "args": map[string]any{"artifact_stage": input.ArtifactStage},
	}, c.options.TaskInvokeTimeout)
	if err != nil {
		return TaskInvokeResult{}, err
	}
	var result TaskInvokeResult
	if err := decodeJSON(raw, &result); err != nil {
		return TaskInvokeResult{}, fmt.Errorf("bridge: decode artifact stage task/invoke: %w", err)
	}
	return result, nil
}

// RespondTask calls "task/respond".
func (c *Client) RespondTask(ctx context.Context, params RespondParams) ([]byte, error) {
	return c.Request(ctx, "task/respond", map[string]any{
		"task_id":     params.TaskID,
		"question_id": params.QuestionID,
		"option_id":   params.OptionID,
		"answer":      params.Answer,
		"answers":     params.Answers,
	})
}

func (c *Client) TaskStatus(ctx context.Context, taskID string) (TaskStatusResult, error) {
	raw, err := c.Request(ctx, "task/status", map[string]any{"task_id": taskID})
	if err != nil {
		return TaskStatusResult{}, err
	}
	var result TaskStatusResult
	if err := decodeJSON(raw, &result); err != nil {
		return TaskStatusResult{}, fmt.Errorf("bridge: decode task/status: %w", err)
	}
	return result, nil
}

// CancelTask calls "task/cancel".
func (c *Client) CancelTask(ctx context.Context, taskID string) ([]byte, error) {
	return c.Request(ctx, "task/cancel", map[string]any{"task_id": taskID})
}

type PlanPptxJSTurn struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type PlanPptxJSInput struct {
	Prompt  string           `json:"prompt"`
	Context any              `json:"context"`
	History []PlanPptxJSTurn `json:"history,omitempty"`
}

type PlanPptxJSResult struct {
	Summary              string                  `json:"summary"`
	Source               string                  `json:"source"`
	Confidence           string                  `json:"confidence,omitempty"`
	RequiresConfirmation bool                    `json:"requires_confirmation,omitempty"`
	Confirmation         *PlanPptxJSConfirmation `json:"confirmation,omitempty"`
	Warnings             []string                `json:"warnings,omitempty"`
}

type PlanPptxJSConfirmation struct {
	Title     string   `json:"title,omitempty"`
	Message   string   `json:"message,omitempty"`
	Target    string   `json:"target,omitempty"`
	Changes   []string `json:"changes,omitempty"`
	Preserved []string `json:"preserved,omitempty"`
}

func (c *Client) PlanPptxJS(ctx context.Context, input PlanPptxJSInput) (PlanPptxJSResult, error) {
	params := map[string]any{"prompt": strings.TrimSpace(input.Prompt), "context": input.Context}
	if len(input.History) > 0 {
		params["history"] = input.History
	}
	if params["prompt"] == "" {
		return PlanPptxJSResult{}, errors.New("bridge: pptx planner prompt is empty")
	}
	raw, err := c.requestWithTimeout(ctx, "pptx/plan-js", params, c.options.PptxJSPlanTimeout)
	if err != nil {
		return PlanPptxJSResult{}, err
	}
	var result PlanPptxJSResult
	if err := decodeJSON(raw, &result); err != nil {
		return PlanPptxJSResult{}, fmt.Errorf("bridge: decode pptx/plan-js: %w", err)
	}
	if strings.TrimSpace(result.Source) == "" {
		return PlanPptxJSResult{}, errors.New("bridge: pptx planner returned empty source")
	}
	return result, nil
}

// TaskInvokeResult is the shape returned by InvokeGenerate.
type TaskInvokeResult struct {
	TaskID    string `json:"task_id"`
	SessionID string `json:"session_id"`
	Status    string `json:"status"`
}

// RespondParams collects optional fields for RespondTask.
type RespondParams struct {
	TaskID     string
	QuestionID string
	OptionID   string
	Answer     string
	Answers    []RespondAnswer
}

type RespondAnswer struct {
	QuestionID string `json:"question_id"`
	OptionID   string `json:"option_id,omitempty"`
	Answer     string `json:"answer"`
}

type TaskStatusResult struct {
	TaskID          string          `json:"task_id"`
	SessionID       string          `json:"session_id"`
	Status          string          `json:"status"`
	CurrentQuestion json.RawMessage `json:"current_question,omitempty"`
	CurrentPlan     json.RawMessage `json:"current_plan,omitempty"`
}

func (c *Client) readStdout(transport Transport) {
	buf := make([]byte, 4096)
	for {
		n, err := transport.Stdout().Read(buf)
		if n > 0 {
			c.appendStdout(buf[:n])
			c.teeLog(buf[:n])
			c.drainFrames()
		}
		if err != nil {
			return
		}
	}
}

func (c *Client) readStderr(transport Transport) {
	buf := make([]byte, 4096)
	for {
		n, err := transport.Stderr().Read(buf)
		if n > 0 {
			c.appendStderr(buf[:n])
			c.teeLog(buf[:n])
		}
		if err != nil {
			return
		}
	}
}

func (c *Client) teeLog(chunk []byte) {
	c.mu.Lock()
	lf := c.logfile
	c.mu.Unlock()
	if lf != nil {
		lf.Write(chunk)
	}
}

func (c *Client) waitExit(transport Transport) {
	code, signal, _ := transport.Wait()

	c.mu.Lock()
	stderr := strings.TrimSpace(c.stderrBuffer)
	pending := c.pending
	c.pending = make(map[string]*pendingRequest)
	currentTransport := c.transport
	if currentTransport == transport {
		c.transport = nil
		c.outputBuffer = nil
	}
	stopped := c.stoppedManually
	c.mu.Unlock()

	suffix := ""
	if stderr != "" {
		suffix = "\nstderr:\n" + stderr
	}
	exitErr := fmt.Errorf("bridge: officecli agent-bridge exited: code=%s signal=%s%s",
		formatCode(code), formatSignal(signal), suffix)

	for _, req := range pending {
		req.timer.Stop()
		select {
		case req.result <- rpcResponse{err: exitErr}:
		default:
		}
	}

	c.failStrandedTasks(c.takeActiveTasks(), strandedExitedMessage)
	c.emitExitEvent(code, signal, stderr)

	if !c.options.DisableAutoReconnect && !stopped {
		c.scheduleReconnect()
	}
}

func (c *Client) appendStdout(chunk []byte) {
	c.mu.Lock()
	c.outputBuffer = append(c.outputBuffer, chunk...)
	c.mu.Unlock()
}

func (c *Client) appendStderr(chunk []byte) {
	c.mu.Lock()
	combined := c.stderrBuffer + string(chunk)
	if len(combined) > stderrTailBytes {
		combined = combined[len(combined)-stderrTailBytes:]
	}
	c.stderrBuffer = combined
	c.mu.Unlock()
}

// drainFrames parses as many complete LSP-framed JSON-RPC messages as the
// buffer currently holds and dispatches them.
func (c *Client) drainFrames() {
	for {
		c.mu.Lock()
		body, ok := nextFrame(&c.outputBuffer)
		c.mu.Unlock()
		if !ok {
			return
		}
		c.handleMessageBody(body)
	}
}

func (c *Client) handleMessageBody(body []byte) {
	msg, ok := parseJSONRPCMessage(body)
	if !ok {
		return
	}
	if msg.hasID() {
		key := msg.idString()
		c.mu.Lock()
		pending, ok := c.pending[key]
		if ok {
			delete(c.pending, key)
		}
		c.mu.Unlock()
		if !ok {
			return
		}
		pending.timer.Stop()
		if msg.Error != nil {
			message := msg.Error.Message
			if message == "" {
				message = "officecli bridge request failed"
			}
			pending.result <- rpcResponse{err: fmt.Errorf("bridge: %s", message)}
			return
		}
		pending.result <- rpcResponse{result: msg.Result}
		return
	}
	if msg.Method != "" {
		event := normalizeBridgeEvent(msg.Method, msg.Params)
		c.emitEvent(event)
	}
}

func (c *Client) scheduleReconnect() {
	c.mu.Lock()
	stderr := strings.TrimSpace(c.stderrBuffer)
	if isBinaryMissing(stderr) {
		c.reconnectAttempt = 0
		c.mu.Unlock()
		extra := map[string]any{}
		if stderr != "" {
			extra["stderr"] = stderr
		}
		c.emitStatusEvent("bridge.unconfigured", "OfficeCLI binary not found. Set a binary path or install it from Settings.", extra)
		return
	}
	if c.reconnectAttempt >= c.options.MaxReconnectAttempts {
		c.reconnectAttempt = 0
		c.mu.Unlock()
		extra := map[string]any{}
		if stderr != "" {
			extra["stderr"] = stderr
		}
		c.emitStatusEvent("bridge.reconnect_exhausted",
			fmt.Sprintf("Reconnection failed after %d attempts", c.options.MaxReconnectAttempts),
			extra)
		return
	}
	delay := time.Duration(math.Min(
		float64(c.options.BaseReconnectDelay)*math.Pow(2, float64(c.reconnectAttempt)),
		float64(maxReconnectDelay),
	))
	c.reconnectAttempt++
	attempt := c.reconnectAttempt
	c.reconnectTimer = time.AfterFunc(delay, c.doReconnect)
	c.mu.Unlock()
	c.emitStatusEvent("bridge.reconnecting",
		fmt.Sprintf("Reconnect attempt %d, retrying in %ds", attempt, int(delay.Seconds())), nil)
}

func (c *Client) doReconnect() {
	c.mu.Lock()
	c.reconnectTimer = nil
	c.stderrBuffer = ""
	c.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), c.options.RequestTimeout)
	defer cancel()

	if err := c.Start(ctx); err != nil {
		c.afterReconnectFailure()
		return
	}
	if _, err := c.Initialize(ctx); err != nil {
		c.afterReconnectFailure()
		return
	}
	if _, err := c.OpenSession(ctx); err != nil {
		c.afterReconnectFailure()
		return
	}
	c.mu.Lock()
	c.reconnectAttempt = 0
	c.initialized = true
	c.mu.Unlock()
	c.emitStatusEvent("bridge.reconnected", "Bridge reconnected", nil)
}

func (c *Client) afterReconnectFailure() {
	c.mu.Lock()
	stopped := c.stoppedManually
	c.mu.Unlock()
	if !stopped {
		c.scheduleReconnect()
	}
}

func (c *Client) emitEvent(event types.BridgeEvent) {
	c.trackTaskEvent(event)
	c.mu.Lock()
	listeners := make([]EventListener, len(c.listeners))
	for i, e := range c.listeners {
		listeners[i] = e.cb
	}
	c.mu.Unlock()
	for _, cb := range listeners {
		cb(event)
	}
}

func (c *Client) emitStatusEvent(eventType, message string, extra map[string]any) {
	payload := map[string]any{"message": message}
	for k, v := range extra {
		payload[k] = v
	}
	c.emitEvent(types.BridgeEvent{Type: eventType, Payload: payload})
}

func (c *Client) emitExitEvent(code *int, signal string, stderr string) {
	payload := map[string]any{
		"code":    code,
		"signal":  signal,
		"message": fmt.Sprintf("officecli agent-bridge exited: code=%s signal=%s", formatCode(code), formatSignal(signal)),
	}
	if stderr != "" {
		payload["stderr"] = stderr
	}
	c.emitEvent(types.BridgeEvent{Type: "bridge.exited", Payload: payload})
}

func formatCode(code *int) string {
	if code == nil {
		return "null"
	}
	return fmt.Sprintf("%d", *code)
}

func formatSignal(signal string) string {
	if signal == "" {
		return "null"
	}
	return signal
}

func isBinaryMissing(stderr string) bool {
	lower := strings.ToLower(stderr)
	return strings.Contains(lower, "enoent") || strings.Contains(lower, "no such file or directory") || strings.Contains(lower, "executable file not found")
}

// rpcResponse is the cross-goroutine value handed back to Request.
type rpcResponse struct {
	result []byte
	err    error
}
