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
	"errors"
	"fmt"
	"math"
	"strings"
	"sync"
	"time"

	"officedex/internal/types"
)

// Defaults mirror the TypeScript constructor defaults.
const (
	DefaultRequestTimeout       = 30 * time.Second
	DefaultMaxReconnectAttempts = 8
	DefaultBaseReconnectDelay   = 1 * time.Second
	maxReconnectDelay           = 30 * time.Second
	stderrTailBytes             = 8192
)

// Options configures a new Client.
//
// Either BinaryPath or ResolveBinary should be set for the default transport
// to find the officecli executable. Tests supply CreateTransport directly to
// avoid spawning processes.
type Options struct {
	BinaryPath           string
	ResolveBinary        func() string
	Cwd                  string
	Env                  []string
	CreateTransport      TransportFactory
	RequestTimeout       time.Duration
	DisableAutoReconnect bool
	MaxReconnectAttempts int
	BaseReconnectDelay   time.Duration
}

// EventListener is the callback shape registered via OnEvent.
type EventListener func(types.BridgeEvent)

// Client is a high-level wrapper around the agent-bridge child process. Safe
// for concurrent use; all exported methods take the internal mutex.
type Client struct {
	options Options

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
	if opts.MaxReconnectAttempts == 0 {
		opts.MaxReconnectAttempts = DefaultMaxReconnectAttempts
	}
	if opts.BaseReconnectDelay == 0 {
		opts.BaseReconnectDelay = DefaultBaseReconnectDelay
	}
	return &Client{
		options:   opts,
		nextID:    1,
		pending:   make(map[string]*pendingRequest),
		sessionID: "default",
	}
}

// Connected reports whether the bridge process is currently running.
func (c *Client) Connected() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.transport != nil
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
	transport, err := factory(c.options)
	if err != nil {
		c.mu.Unlock()
		return fmt.Errorf("bridge: start: %w", err)
	}
	c.transport = transport
	c.outputBuffer = nil
	c.stderrBuffer = ""
	c.mu.Unlock()

	go c.readStdout(transport)
	go c.readStderr(transport)
	go c.waitExit(transport)
	return nil
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
}

// Request sends a JSON-RPC call and waits for the response. Returns the raw
// `result` payload, which the caller decodes into a typed shape.
func (c *Client) Request(ctx context.Context, method string, params any) ([]byte, error) {
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
	timer := time.AfterFunc(c.options.RequestTimeout, func() {
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

// Initialize calls the "initialize" RPC.
func (c *Client) Initialize(ctx context.Context) ([]byte, error) {
	return c.Request(ctx, "initialize", nil)
}

// GetCapabilities calls "capabilities/get".
func (c *Client) GetCapabilities(ctx context.Context) ([]byte, error) {
	return c.Request(ctx, "capabilities/get", nil)
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
	mode := string(input.Mode)
	if mode == "" {
		mode = "fast"
	}
	args := map[string]any{
		"document_type": input.DocumentType,
		"topic":         input.Topic,
		"prompt":        input.Prompt,
		"mode":          mode,
		"runtime_mode":  input.RuntimeMode,
		"out":           input.OutputDir,
		"publish":       input.Publish,
		"enable_images": input.EnableImages,
		"image_quality": input.ImageQuality,
		// LocalPreview is forced to true to match the TS origin's
		// `input.localPreview ?? true`. The boolean field can't distinguish
		// "renderer omitted" from "renderer sent false" once it lands here,
		// so we keep the safer default that the local preview pipeline relies
		// on. Renderer code that needs to opt out should be revisited as part
		// of the Wails binding rewrite.
		"local_preview": true,
	}
	for k, v := range buildAttachmentArgs(input) {
		args[k] = v
	}
	raw, err := c.Request(ctx, "task/invoke", map[string]any{
		"session_id":    sessionID,
		"tool":          "office.generate",
		"interactive":   true,
		"output_format": "bundle",
		"args":          args,
	})
	if err != nil {
		return TaskInvokeResult{}, err
	}
	var result TaskInvokeResult
	if err := decodeJSON(raw, &result); err != nil {
		return TaskInvokeResult{}, fmt.Errorf("bridge: decode task/invoke: %w", err)
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
	})
}

// CancelTask calls "task/cancel".
func (c *Client) CancelTask(ctx context.Context, taskID string) ([]byte, error) {
	return c.Request(ctx, "task/cancel", map[string]any{"task_id": taskID})
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
}

func (c *Client) readStdout(transport Transport) {
	buf := make([]byte, 4096)
	for {
		n, err := transport.Stdout().Read(buf)
		if n > 0 {
			c.appendStdout(buf[:n])
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
		}
		if err != nil {
			return
		}
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
