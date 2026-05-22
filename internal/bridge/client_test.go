package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"officedex/internal/types"
)

// fakeTransport is a Transport implementation backed by an in-memory buffer
// on the stdin side (so the client's writes never block) and io.Pipe on the
// stdout / stderr sides (so the test goroutine can feed frames into the
// client at will).
type fakeTransport struct {
	stdin   *bufferedPipe
	stdoutR *io.PipeReader
	stdoutW *io.PipeWriter
	stderrR *io.PipeReader
	stderrW *io.PipeWriter

	mu       sync.Mutex
	killed   bool
	exitOnce sync.Once
	exitCh   chan exitStatus
}

type exitStatus struct {
	code   *int
	signal string
}

// bufferedPipe is a goroutine-safe append-only byte buffer with a Cond used
// to wake readers when bytes arrive.
type bufferedPipe struct {
	mu   sync.Mutex
	cond *sync.Cond
	data []byte
}

func newBufferedPipe() *bufferedPipe {
	b := &bufferedPipe{}
	b.cond = sync.NewCond(&b.mu)
	return b
}

func (b *bufferedPipe) Write(p []byte) (int, error) {
	b.mu.Lock()
	b.data = append(b.data, p...)
	b.cond.Broadcast()
	b.mu.Unlock()
	return len(p), nil
}

// readUntilFrame blocks until a full LSP frame is available and consumes it.
func (b *bufferedPipe) readUntilFrame() []byte {
	b.mu.Lock()
	defer b.mu.Unlock()
	for {
		body, ok := nextFrame(&b.data)
		if ok {
			return body
		}
		b.cond.Wait()
	}
}

func newFakeTransport() *fakeTransport {
	stdoutR, stdoutW := io.Pipe()
	stderrR, stderrW := io.Pipe()
	return &fakeTransport{
		stdin:   newBufferedPipe(),
		stdoutR: stdoutR,
		stdoutW: stdoutW,
		stderrR: stderrR,
		stderrW: stderrW,
		exitCh:  make(chan exitStatus, 1),
	}
}

func (f *fakeTransport) Stdin() io.Writer  { return f.stdin }
func (f *fakeTransport) Stdout() io.Reader { return f.stdoutR }
func (f *fakeTransport) Stderr() io.Reader { return f.stderrR }

func (f *fakeTransport) Kill() error {
	f.mu.Lock()
	f.killed = true
	f.mu.Unlock()
	zero := 0
	f.exitOnce.Do(func() {
		f.exitCh <- exitStatus{code: &zero, signal: ""}
		_ = f.stdoutW.Close()
		_ = f.stderrW.Close()
	})
	return nil
}

func (f *fakeTransport) Wait() (*int, string, error) {
	st := <-f.exitCh
	return st.code, st.signal, nil
}

func (f *fakeTransport) exit(code *int, signal string) {
	f.exitOnce.Do(func() {
		f.exitCh <- exitStatus{code: code, signal: signal}
		_ = f.stdoutW.Close()
		_ = f.stderrW.Close()
	})
}

// readRequest blocks until a complete LSP frame is on the stdin buffer and
// returns the decoded JSON-RPC request.
func (f *fakeTransport) readRequest(t *testing.T) jsonrpcMessage {
	t.Helper()
	body := f.stdin.readUntilFrame()
	var msg jsonrpcMessage
	if err := json.Unmarshal(body, &msg); err != nil {
		t.Fatalf("decode request: %v", err)
	}
	return msg
}

func (f *fakeTransport) writeResponse(t *testing.T, id any, result any, rpcErr *jsonrpcError) {
	t.Helper()
	payload := map[string]any{"jsonrpc": "2.0", "id": id}
	if rpcErr != nil {
		payload["error"] = rpcErr
	} else {
		payload["result"] = result
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal response: %v", err)
	}
	if _, err := fmt.Fprintf(f.stdoutW, "Content-Length: %d\r\n\r\n", len(body)); err != nil {
		t.Fatalf("write header: %v", err)
	}
	if _, err := f.stdoutW.Write(body); err != nil {
		t.Fatalf("write body: %v", err)
	}
}

func (f *fakeTransport) writeNotification(t *testing.T, method string, params any) {
	t.Helper()
	payload := map[string]any{"jsonrpc": "2.0", "method": method, "params": params}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal notification: %v", err)
	}
	if _, err := fmt.Fprintf(f.stdoutW, "Content-Length: %d\r\n\r\n", len(body)); err != nil {
		t.Fatalf("write header: %v", err)
	}
	if _, err := f.stdoutW.Write(body); err != nil {
		t.Fatalf("write body: %v", err)
	}
}

func newClientWithFake(t *testing.T) (*Client, *fakeTransport) {
	t.Helper()
	fake := newFakeTransport()
	client := New(Options{
		RequestTimeout: 500 * time.Millisecond,
		CreateTransport: func(opts Options) (Transport, error) {
			return fake, nil
		},
		DisableAutoReconnect: true,
	})
	if err := client.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	return client, fake
}

func TestRequestRoundTrip(t *testing.T) {
	client, fake := newClientWithFake(t)
	defer client.Stop()

	var result []byte
	var requestErr error
	done := make(chan struct{})
	go func() {
		result, requestErr = client.Request(context.Background(), "initialize", nil)
		close(done)
	}()

	req := fake.readRequest(t)
	if req.Method != "initialize" {
		t.Errorf("method = %q, want initialize", req.Method)
	}
	if req.idString() != "1" {
		t.Errorf("id = %q, want 1", req.idString())
	}
	fake.writeResponse(t, 1, map[string]any{"ok": true}, nil)
	<-done

	if requestErr != nil {
		t.Fatalf("Request: %v", requestErr)
	}
	var decoded map[string]bool
	if err := json.Unmarshal(result, &decoded); err != nil {
		t.Fatalf("decode result: %v", err)
	}
	if !decoded["ok"] {
		t.Errorf("expected ok=true in result, got %v", decoded)
	}
}

func TestRequestTimeout(t *testing.T) {
	client, _ := newClientWithFake(t)
	defer client.Stop()

	_, err := client.Request(context.Background(), "slow/op", nil)
	if err == nil {
		t.Fatal("expected timeout error")
	}
	if !strings.Contains(err.Error(), "timed out") {
		t.Errorf("error = %v, want timeout message", err)
	}
}

func TestRequestErrorResponse(t *testing.T) {
	client, fake := newClientWithFake(t)
	defer client.Stop()

	done := make(chan error, 1)
	go func() {
		_, err := client.Request(context.Background(), "broken", nil)
		done <- err
	}()
	req := fake.readRequest(t)
	fake.writeResponse(t, req.idString(), nil, &jsonrpcError{Code: -1, Message: "boom"})
	err := <-done
	if err == nil || !strings.Contains(err.Error(), "boom") {
		t.Errorf("error = %v, want to contain boom", err)
	}
}

func TestNotificationDispatchedToListeners(t *testing.T) {
	client, fake := newClientWithFake(t)
	defer client.Stop()

	got := make(chan types.BridgeEvent, 4)
	client.OnEvent(func(e types.BridgeEvent) {
		got <- e
	})

	fake.writeNotification(t, "task.progress", map[string]any{
		"task_id": "t1",
		"type":    "task.progress",
		"payload": map[string]any{"percent": 42},
	})

	select {
	case event := <-got:
		if event.Type != "task.progress" {
			t.Errorf("event type = %q, want task.progress", event.Type)
		}
		if event.TaskID != "t1" {
			t.Errorf("task_id = %q, want t1", event.TaskID)
		}
	case <-time.After(time.Second):
		t.Fatal("listener never invoked")
	}
}

func TestNotificationWithoutTypeUsesMethod(t *testing.T) {
	client, fake := newClientWithFake(t)
	defer client.Stop()

	got := make(chan types.BridgeEvent, 1)
	client.OnEvent(func(e types.BridgeEvent) { got <- e })

	fake.writeNotification(t, "bridge.hello", map[string]any{"foo": "bar"})

	select {
	case event := <-got:
		if event.Type != "bridge.hello" {
			t.Errorf("event type = %q, want bridge.hello", event.Type)
		}
		if got, ok := event.Payload["foo"].(string); !ok || got != "bar" {
			t.Errorf("payload.foo = %v, want bar", event.Payload["foo"])
		}
	case <-time.After(time.Second):
		t.Fatal("listener never invoked")
	}
}

func TestStopRejectsPending(t *testing.T) {
	client, _ := newClientWithFake(t)

	done := make(chan error, 1)
	go func() {
		_, err := client.Request(context.Background(), "slow", nil)
		done <- err
	}()
	time.Sleep(20 * time.Millisecond)
	client.Stop()

	select {
	case err := <-done:
		if err == nil {
			t.Fatal("expected error after Stop")
		}
		if !strings.Contains(err.Error(), "stopped") {
			t.Errorf("error = %v, want stopped message", err)
		}
	case <-time.After(time.Second):
		t.Fatal("Stop did not reject pending request")
	}
}

func TestExitEmitsExitEventAndDoesNotReconnectWhenDisabled(t *testing.T) {
	client, fake := newClientWithFake(t)
	defer client.Stop()

	got := make(chan types.BridgeEvent, 4)
	client.OnEvent(func(e types.BridgeEvent) { got <- e })

	code := 1
	fake.exit(&code, "")

	deadline := time.After(2 * time.Second)
	for {
		select {
		case event := <-got:
			if event.Type == "bridge.exited" {
				if msg, ok := event.Payload["message"].(string); !ok || !strings.Contains(msg, "code=1") {
					t.Errorf("exit message = %v, want to contain code=1", event.Payload["message"])
				}
				return
			}
		case <-deadline:
			t.Fatal("did not see bridge.exited event")
		}
	}
}

func TestOnEventUnsubscribe(t *testing.T) {
	client, fake := newClientWithFake(t)
	defer client.Stop()

	got := make(chan types.BridgeEvent, 4)
	unsub := client.OnEvent(func(e types.BridgeEvent) { got <- e })
	unsub()

	fake.writeNotification(t, "task.progress", map[string]any{"type": "task.progress"})

	select {
	case event := <-got:
		t.Errorf("listener fired after unsubscribe, got %v", event)
	case <-time.After(150 * time.Millisecond):
	}
}

func TestSessionIDOpenAndCache(t *testing.T) {
	client, fake := newClientWithFake(t)
	defer client.Stop()

	done := make(chan struct {
		id  string
		err error
	}, 1)
	go func() {
		id, err := client.OpenSession(context.Background())
		done <- struct {
			id  string
			err error
		}{id, err}
	}()
	req := fake.readRequest(t)
	if req.Method != "session/open" {
		t.Fatalf("method = %q, want session/open", req.Method)
	}
	fake.writeResponse(t, req.idString(), map[string]any{"id": "sess-42"}, nil)
	result := <-done
	if result.err != nil {
		t.Fatalf("OpenSession: %v", result.err)
	}
	if result.id != "sess-42" {
		t.Errorf("id = %q, want sess-42", result.id)
	}
	if cached := client.SessionID(); cached != "sess-42" {
		t.Errorf("SessionID() = %q, want sess-42", cached)
	}
}

func TestInvokeGenerateOpensSessionFirst(t *testing.T) {
	client, fake := newClientWithFake(t)
	defer client.Stop()

	done := make(chan error, 1)
	go func() {
		_, err := client.InvokeGenerate(context.Background(), types.GenerateInput{
			DocumentType: types.DocPPTX,
			Topic:        "Q3 review",
			Prompt:       "make a slide deck",
		})
		done <- err
	}()

	first := fake.readRequest(t)
	if first.Method != "session/open" {
		t.Fatalf("first method = %q, want session/open", first.Method)
	}
	fake.writeResponse(t, first.idString(), map[string]any{"id": "sess-1"}, nil)

	second := fake.readRequest(t)
	if second.Method != "task/invoke" {
		t.Fatalf("second method = %q, want task/invoke", second.Method)
	}
	var params map[string]any
	if err := json.Unmarshal(second.Params, &params); err != nil {
		t.Fatalf("decode params: %v", err)
	}
	if params["session_id"] != "sess-1" {
		t.Errorf("session_id = %v, want sess-1", params["session_id"])
	}
	args, _ := params["args"].(map[string]any)
	if args["document_type"] != "pptx" {
		t.Errorf("document_type = %v, want pptx", args["document_type"])
	}
	if args["local_preview"] != true {
		t.Errorf("local_preview = %v, want true", args["local_preview"])
	}
	fake.writeResponse(t, second.idString(), map[string]any{
		"task_id":    "task-x",
		"session_id": "sess-1",
		"status":     "starting",
	}, nil)
	if err := <-done; err != nil {
		t.Errorf("InvokeGenerate: %v", err)
	}
}

func TestBuildAttachmentArgsReportSourceFile(t *testing.T) {
	args := buildAttachmentArgs(types.GenerateInput{
		DocumentType: types.DocReport,
		SourceFile:   "/tmp/source.xlsx",
	})
	if args["file_path"] != "/tmp/source.xlsx" {
		t.Errorf("file_path = %v, want /tmp/source.xlsx", args["file_path"])
	}
}

func TestBuildAttachmentArgsImageReferenceCap(t *testing.T) {
	args := buildAttachmentArgs(types.GenerateInput{
		DocumentType:    types.DocIMG,
		ReferenceImages: []string{"a.png", "b.png", "", "c.png", "d.png", "e.png", "f.png", "g.png"},
	})
	refs, ok := args["reference_images"].([]string)
	if !ok {
		t.Fatalf("reference_images type = %T, want []string", args["reference_images"])
	}
	if len(refs) != 6 {
		t.Errorf("len = %d, want 6 (capped)", len(refs))
	}
	for _, r := range refs {
		if r == "" {
			t.Errorf("empty entry leaked through filter: %v", refs)
		}
	}
}

func TestBridgeResultToArtifact(t *testing.T) {
	raw := []byte(`{"file_path":"/tmp/out.pptx","file_name":"out.pptx","document_type":"pptx","access_url":"https://x/preview","file_id":"f1"}`)
	got := bridgeResultToArtifact(raw)
	if got == nil {
		t.Fatal("expected artifact, got nil")
	}
	if got.FilePath != "/tmp/out.pptx" || got.FileName != "out.pptx" || got.DocumentType != "pptx" {
		t.Errorf("unexpected artifact: %+v", got)
	}
	if got.PreviewURL != "https://x/preview" {
		t.Errorf("preview = %q, want https://x/preview", got.PreviewURL)
	}
	if got.FileID != "f1" {
		t.Errorf("fileID = %q, want f1", got.FileID)
	}
}

func TestBridgeResultToArtifactInfersFileNameAndType(t *testing.T) {
	raw := []byte(`{"file_path":"/tmp/foo.docx"}`)
	got := bridgeResultToArtifact(raw)
	if got == nil {
		t.Fatal("expected artifact")
	}
	if got.FileName != "foo.docx" {
		t.Errorf("fileName = %q, want foo.docx", got.FileName)
	}
	if got.DocumentType != "docx" {
		t.Errorf("documentType = %q, want docx", got.DocumentType)
	}
}

func TestBridgeResultToArtifactNilWithoutPath(t *testing.T) {
	if got := bridgeResultToArtifact([]byte(`{}`)); got != nil {
		t.Errorf("expected nil, got %+v", got)
	}
}

func TestBuildBridgeEnvIncludesSkipDefaults(t *testing.T) {
	env := BuildBridgeEnv(nil)
	wants := []string{
		"OFFICECLI_SKIP_SKILL_PREFLIGHT=1",
		"OFFICECLI_SKIP_PUBLISH_SETUP=1",
		"OFFICECLI_SKIP_UPDATE_CHECK=1",
	}
	for _, want := range wants {
		if !contains(env, want) {
			t.Errorf("env missing %q", want)
		}
	}
}

func TestBuildBridgeEnvExtraOverrides(t *testing.T) {
	env := BuildBridgeEnv([]string{"OFFICECLI_SKIP_UPDATE_CHECK=0", "EXTRA=val"})
	if !contains(env, "OFFICECLI_SKIP_UPDATE_CHECK=0") {
		t.Errorf("override missing in %v", env)
	}
	if contains(env, "OFFICECLI_SKIP_UPDATE_CHECK=1") {
		t.Errorf("default not overridden in %v", env)
	}
	if !contains(env, "EXTRA=val") {
		t.Errorf("extra missing in %v", env)
	}
}

func TestFrameParseMultiplePerChunk(t *testing.T) {
	buf := []byte("Content-Length: 17\r\n\r\n{\"jsonrpc\":\"2.0\"}Content-Length: 17\r\n\r\n{\"jsonrpc\":\"2.0\"}")
	body, ok := nextFrame(&buf)
	if !ok {
		t.Fatal("first frame not parsed")
	}
	if string(body) != `{"jsonrpc":"2.0"}` {
		t.Errorf("first body = %q", body)
	}
	body, ok = nextFrame(&buf)
	if !ok {
		t.Fatal("second frame not parsed")
	}
	if string(body) != `{"jsonrpc":"2.0"}` {
		t.Errorf("second body = %q", body)
	}
}

func TestFrameParsePartialReturnsFalse(t *testing.T) {
	buf := []byte("Content-Length: 100\r\n\r\n{\"only some bytes\"")
	if _, ok := nextFrame(&buf); ok {
		t.Fatal("expected partial frame to return false")
	}
}

func TestFrameParseInvalidHeaderSkipped(t *testing.T) {
	buf := []byte("Garbage\r\n\r\nContent-Length: 17\r\n\r\n{\"jsonrpc\":\"2.0\"}")
	body, ok := nextFrame(&buf)
	if !ok {
		t.Fatal("expected next frame after invalid header")
	}
	if string(body) != `{"jsonrpc":"2.0"}` {
		t.Errorf("body = %q", body)
	}
}

func TestRequestRejectsWhenNotStarted(t *testing.T) {
	client := New(Options{DisableAutoReconnect: true, RequestTimeout: 100 * time.Millisecond})
	_, err := client.Request(context.Background(), "anything", nil)
	if err == nil {
		t.Fatal("expected error when transport not started")
	}
	if !strings.Contains(err.Error(), "not running") {
		t.Errorf("error = %v, want 'not running'", err)
	}
}

func TestRequestContextCancel(t *testing.T) {
	client, _ := newClientWithFake(t)
	defer client.Stop()

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := client.Request(ctx, "slow", nil)
		done <- err
	}()
	time.Sleep(20 * time.Millisecond)
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Errorf("error = %v, want context.Canceled", err)
		}
	case <-time.After(time.Second):
		t.Fatal("Request did not honour context cancel")
	}
}

func contains(haystack []string, needle string) bool {
	for _, v := range haystack {
		if v == needle {
			return true
		}
	}
	return false
}
