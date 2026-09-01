package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"officedex/internal/bridge"
	"officedex/internal/localstore"
	"officedex/internal/types"
)

type cancelPersistBufferedPipe struct {
	mu   sync.Mutex
	cond *sync.Cond
	data []byte
}

func newCancelPersistBufferedPipe() *cancelPersistBufferedPipe {
	b := &cancelPersistBufferedPipe{}
	b.cond = sync.NewCond(&b.mu)
	return b
}

func (b *cancelPersistBufferedPipe) Write(p []byte) (int, error) {
	b.mu.Lock()
	b.data = append(b.data, p...)
	b.cond.Broadcast()
	b.mu.Unlock()
	return len(p), nil
}

func (b *cancelPersistBufferedPipe) readFrame() []byte {
	b.mu.Lock()
	defer b.mu.Unlock()
	for {
		headerEnd := bytes.Index(b.data, []byte("\r\n\r\n"))
		if headerEnd < 0 {
			b.cond.Wait()
			continue
		}
		header := string(b.data[:headerEnd])
		var length int
		if _, err := fmt.Sscanf(header, "Content-Length: %d", &length); err != nil || length <= 0 {
			b.cond.Wait()
			continue
		}
		start := headerEnd + 4
		if len(b.data) < start+length {
			b.cond.Wait()
			continue
		}
		body := append([]byte(nil), b.data[start:start+length]...)
		b.data = b.data[start+length:]
		return body
	}
}

type cancelPersistTransport struct {
	stdin   *cancelPersistBufferedPipe
	stdoutR *io.PipeReader
	stdoutW *io.PipeWriter
	stderrR *io.PipeReader
	stderrW *io.PipeWriter
	once    sync.Once
	done    chan struct{}
}

func newCancelPersistTransport() *cancelPersistTransport {
	stdoutR, stdoutW := io.Pipe()
	stderrR, stderrW := io.Pipe()
	return &cancelPersistTransport{
		stdin:   newCancelPersistBufferedPipe(),
		stdoutR: stdoutR,
		stdoutW: stdoutW,
		stderrR: stderrR,
		stderrW: stderrW,
		done:    make(chan struct{}),
	}
}

func (t *cancelPersistTransport) Stdin() io.Writer  { return t.stdin }
func (t *cancelPersistTransport) Stdout() io.Reader { return t.stdoutR }
func (t *cancelPersistTransport) Stderr() io.Reader { return t.stderrR }

func (t *cancelPersistTransport) Kill() error {
	t.once.Do(func() {
		_ = t.stdoutW.Close()
		_ = t.stderrW.Close()
		close(t.done)
	})
	return nil
}

func (t *cancelPersistTransport) Wait() (*int, string, error) {
	<-t.done
	zero := 0
	return &zero, "", nil
}

type cancelPersistRequest struct {
	ID     json.RawMessage `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

func (t *cancelPersistTransport) readRequest(tester *testing.T) cancelPersistRequest {
	tester.Helper()
	var req cancelPersistRequest
	if err := json.Unmarshal(t.stdin.readFrame(), &req); err != nil {
		tester.Fatalf("decode bridge request: %v", err)
	}
	return req
}

func (t *cancelPersistTransport) writeResponse(tester *testing.T, id json.RawMessage, result any) {
	tester.Helper()
	body, err := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"result":  result,
	})
	if err != nil {
		tester.Fatalf("marshal bridge response: %v", err)
	}
	if _, err := fmt.Fprintf(t.stdoutW, "Content-Length: %d\r\n\r\n", len(body)); err != nil {
		tester.Fatalf("write bridge header: %v", err)
	}
	if _, err := t.stdoutW.Write(body); err != nil {
		tester.Fatalf("write bridge body: %v", err)
	}
}

func (t *cancelPersistTransport) writeError(tester *testing.T, id json.RawMessage, message string) {
	tester.Helper()
	body, err := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"error": map[string]any{
			"code":    -32004,
			"message": message,
		},
	})
	if err != nil {
		tester.Fatalf("marshal bridge error: %v", err)
	}
	if _, err := fmt.Fprintf(t.stdoutW, "Content-Length: %d\r\n\r\n", len(body)); err != nil {
		tester.Fatalf("write bridge error header: %v", err)
	}
	if _, err := t.stdoutW.Write(body); err != nil {
		tester.Fatalf("write bridge error body: %v", err)
	}
}

func TestCancelPersistsLocalCancellationEvent(t *testing.T) {
	ctx := context.Background()
	taskID := "task-plan-cancel-persist"
	workspaceDir := t.TempDir()

	store := localstore.New(filepath.Join(t.TempDir(), "officedex.db"))
	if err := store.Open(ctx); err != nil {
		t.Fatalf("open local store: %v", err)
	}
	t.Cleanup(func() {
		_ = store.Close()
	})

	workspace, err := store.EnsureWorkspace(ctx, workspaceDir)
	if err != nil {
		t.Fatalf("EnsureWorkspace: %v", err)
	}
	if err := store.EnsureConversation(ctx, workspace.ID, "conversation-plan", "Review plan"); err != nil {
		t.Fatalf("EnsureConversation: %v", err)
	}
	if err := store.RecordTaskContext(ctx, taskID, localstore.TaskContext{
		WorkspaceID:    workspace.ID,
		ConversationID: "conversation-plan",
	}); err != nil {
		t.Fatalf("RecordTaskContext: %v", err)
	}
	if err := store.RecordEvent(types.BridgeEvent{
		EventID: "event-plan",
		TaskID:  taskID,
		Type:    "task.plan",
		Payload: map[string]any{
			"markdown":         "## Plan\n- Step",
			"execution_prompt": "Do the plan",
		},
	}); err != nil {
		t.Fatalf("RecordEvent plan: %v", err)
	}

	transport := newCancelPersistTransport()
	client := bridge.New(bridge.Options{
		RequestTimeout: 500 * time.Millisecond,
		CreateTransport: func(opts bridge.Options) (bridge.Transport, error) {
			return transport, nil
		},
		DisableAutoReconnect: true,
	})
	if err := client.Start(ctx); err != nil {
		t.Fatalf("start bridge client: %v", err)
	}
	t.Cleanup(client.Stop)

	app := &App{
		ctx:             ctx,
		userDataDir:     t.TempDir(),
		workspaceDir:    workspaceDir,
		localStore:      store,
		bridgeClients:   map[string]*bridge.Client{workspaceDir: client},
		bridgeRecentCwd: workspaceDir,
	}

	type cancelResult struct {
		raw []byte
		err error
	}
	done := make(chan cancelResult, 1)
	go func() {
		raw, err := app.Cancel(taskID)
		done <- cancelResult{raw: raw, err: err}
	}()

	req := transport.readRequest(t)
	if req.Method != "task/cancel" {
		t.Fatalf("bridge request method = %q, want task/cancel", req.Method)
	}
	var params map[string]string
	if err := json.Unmarshal(req.Params, &params); err != nil {
		t.Fatalf("decode task/cancel params: %v", err)
	}
	if params["task_id"] != taskID {
		t.Fatalf("task_id = %q, want %q", params["task_id"], taskID)
	}
	transport.writeResponse(t, req.ID, map[string]any{"ok": true})

	select {
	case out := <-done:
		if out.err != nil {
			t.Fatalf("Cancel: %v", out.err)
		}
		if !strings.Contains(string(out.raw), `"ok":true`) {
			t.Fatalf("Cancel raw response = %s, want ok response", string(out.raw))
		}
	case <-time.After(time.Second):
		t.Fatal("Cancel did not return")
	}

	history, err := store.QueryRecentTaskHistory(ctx, 10)
	if err != nil {
		t.Fatalf("QueryRecentTaskHistory: %v", err)
	}
	if len(history) != 1 {
		t.Fatalf("history entries = %d, want 1", len(history))
	}
	events := history[0].Events
	if len(events) != 2 {
		t.Fatalf("persisted events = %d, want plan plus cancelled; events=%#v", len(events), events)
	}
	if got := events[len(events)-1].Type; got != "task.cancelled" {
		t.Fatalf("last persisted event = %q, want task.cancelled", got)
	}
}

func TestCancelPersistsLocalCancellationEventWhenBridgeTaskIsGone(t *testing.T) {
	ctx := context.Background()
	taskID := "task-plan-cancel-not-found"
	workspaceDir := t.TempDir()

	store := localstore.New(filepath.Join(t.TempDir(), "officedex.db"))
	if err := store.Open(ctx); err != nil {
		t.Fatalf("open local store: %v", err)
	}
	t.Cleanup(func() {
		_ = store.Close()
	})

	workspace, err := store.EnsureWorkspace(ctx, workspaceDir)
	if err != nil {
		t.Fatalf("EnsureWorkspace: %v", err)
	}
	if err := store.EnsureConversation(ctx, workspace.ID, "conversation-plan", "Review plan"); err != nil {
		t.Fatalf("EnsureConversation: %v", err)
	}
	if err := store.RecordTaskContext(ctx, taskID, localstore.TaskContext{
		WorkspaceID:    workspace.ID,
		ConversationID: "conversation-plan",
	}); err != nil {
		t.Fatalf("RecordTaskContext: %v", err)
	}
	if err := store.RecordEvent(types.BridgeEvent{
		EventID: "event-plan",
		TaskID:  taskID,
		Type:    "task.plan",
		Payload: map[string]any{
			"markdown":         "## Plan\n- Step",
			"execution_prompt": "Do the plan",
		},
	}); err != nil {
		t.Fatalf("RecordEvent plan: %v", err)
	}

	transport := newCancelPersistTransport()
	client := bridge.New(bridge.Options{
		RequestTimeout: 500 * time.Millisecond,
		CreateTransport: func(opts bridge.Options) (bridge.Transport, error) {
			return transport, nil
		},
		DisableAutoReconnect: true,
	})
	if err := client.Start(ctx); err != nil {
		t.Fatalf("start bridge client: %v", err)
	}
	t.Cleanup(client.Stop)

	app := &App{
		ctx:             ctx,
		userDataDir:     t.TempDir(),
		workspaceDir:    workspaceDir,
		localStore:      store,
		bridgeClients:   map[string]*bridge.Client{workspaceDir: client},
		bridgeRecentCwd: workspaceDir,
	}

	done := make(chan error, 1)
	go func() {
		_, err := app.Cancel(taskID)
		done <- err
	}()

	req := transport.readRequest(t)
	if req.Method != "task/cancel" {
		t.Fatalf("bridge request method = %q, want task/cancel", req.Method)
	}
	transport.writeError(t, req.ID, "task not found")

	select {
	case err := <-done:
		if err == nil {
			t.Fatal("Cancel should return the bridge not found error")
		}
		if !strings.Contains(strings.ToLower(err.Error()), "not found") {
			t.Fatalf("Cancel error = %v, want not found", err)
		}
	case <-time.After(time.Second):
		t.Fatal("Cancel did not return")
	}

	history, err := store.QueryRecentTaskHistory(ctx, 10)
	if err != nil {
		t.Fatalf("QueryRecentTaskHistory: %v", err)
	}
	if len(history) != 1 {
		t.Fatalf("history entries = %d, want 1", len(history))
	}
	events := history[0].Events
	if len(events) != 2 {
		t.Fatalf("persisted events = %d, want plan plus cancelled; events=%#v", len(events), events)
	}
	if got := events[len(events)-1].Type; got != "task.cancelled" {
		t.Fatalf("last persisted event = %q, want task.cancelled", got)
	}
}
