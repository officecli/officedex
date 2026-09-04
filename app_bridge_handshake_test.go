package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"officedex/internal/bridge"
	"officedex/internal/types"
)

// The protocol check used to run only when the renderer called Initialize at
// startup. A bridge started for a task (or restarted after it exited) was
// never checked, so an old officecli failed partway through a generation. The
// task path must refuse it up front and not leave the process running.
func TestEnsureBridgeForCwdRefusesAnOldBridgeBeforeAnyTask(t *testing.T) {
	app := &App{userDataDir: t.TempDir(), workspaceDir: t.TempDir()}
	app.startEventWriter()
	transport := newHandshakeFakeTransport()
	client := bridge.New(bridge.Options{
		RequestTimeout:       2 * time.Second,
		CreateTransport:      func(bridge.Options) (bridge.Transport, error) { return transport, nil },
		DisableAutoReconnect: true,
	})
	client.OnEvent(app.bridgeEventListener(client))
	app.bridges.seed("/ws", map[string]*bridge.Client{"/ws": client})
	go answerInitializeWithProtocol(t, transport, "2020-01-01", "0.1.0")

	_, err := app.ensureBridgeForCwd("/ws")
	if err == nil {
		t.Fatal("an officecli announcing protocol 2020-01-01 was accepted for task work")
	}
	if !strings.Contains(err.Error(), "2020-01-01") || !strings.Contains(err.Error(), bridge.MinProtocolVersion) {
		t.Fatalf("error = %v, want the announced and required protocol versions named", err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && transport.kills.Load() == 0 {
		time.Sleep(5 * time.Millisecond)
	}
	if transport.kills.Load() == 0 {
		t.Fatal("the rejected bridge process was left running")
	}
}

// handshakeFakeTransport is a bridge process stand-in whose stdin can be read
// back (to see the initialize request) and whose Wait blocks until killed, so
// the client does not see a premature exit while the test composes its reply.
type handshakeFakeTransport struct {
	stdin   *providerTestBufferedPipe
	stdoutR *io.PipeReader
	stdoutW *io.PipeWriter
	stderrR *io.PipeReader
	stderrW *io.PipeWriter
	waitCh  chan struct{}
	once    sync.Once
	kills   atomic.Int32
}

func newHandshakeFakeTransport() *handshakeFakeTransport {
	stdoutR, stdoutW := io.Pipe()
	stderrR, stderrW := io.Pipe()
	return &handshakeFakeTransport{stdin: newProviderTestBufferedPipe(), stdoutR: stdoutR, stdoutW: stdoutW, stderrR: stderrR, stderrW: stderrW, waitCh: make(chan struct{})}
}

func (f *handshakeFakeTransport) Stdin() io.Writer  { return f.stdin }
func (f *handshakeFakeTransport) Stdout() io.Reader { return f.stdoutR }
func (f *handshakeFakeTransport) Stderr() io.Reader { return f.stderrR }
func (f *handshakeFakeTransport) Kill() error {
	f.kills.Add(1)
	f.once.Do(func() {
		close(f.waitCh)
		_ = f.stdoutW.Close()
		_ = f.stderrW.Close()
	})
	return nil
}
func (f *handshakeFakeTransport) Wait() (*int, string, error) {
	<-f.waitCh
	zero := 0
	return &zero, "", nil
}

func answerInitializeWithProtocol(t *testing.T, f *handshakeFakeTransport, protocol, server string) {
	var req struct {
		ID     int    `json:"id"`
		Method string `json:"method"`
	}
	if err := json.Unmarshal(f.stdin.readFrame(), &req); err != nil {
		t.Errorf("decode bridge request: %v", err)
		return
	}
	if req.Method != bridge.MethodInitialize {
		t.Errorf("first bridge request = %q, want initialize before any task", req.Method)
		return
	}
	body, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0", "id": req.ID,
		"result": map[string]any{"server_name": "fake", "server_version": server, "protocol_version": protocol},
	})
	fmt.Fprintf(f.stdoutW, "Content-Length: %d\r\n\r\n", len(body))
	_, _ = f.stdoutW.Write(body)
}

// A bridge error is recognised by the code it carries, not by its message.
func TestBridgeTaskNotFoundIsDecidedByErrorData(t *testing.T) {
	byCode := &bridge.RPCError{Code: -32000, Message: "something went missing", Data: json.RawMessage(`{"code":"task_not_found"}`)}
	if !isBridgeTaskNotFoundError(fmt.Errorf("wrapped: %w", byCode)) {
		t.Fatal("task_not_found data code not recognised through wrapping")
	}
	byTextOnly := &bridge.RPCError{Code: -32000, Message: "task not found: t-1"}
	if isBridgeTaskNotFoundError(byTextOnly) {
		t.Fatal("message text alone must not classify an error as task-not-found")
	}
	if isBridgeTaskNotFoundError(errors.New("file not found")) {
		t.Fatal("an unrelated 'not found' error was classified as a missing task")
	}
}

// Recovery recognises its own cancellations by a machine-readable reason, not
// by the English sentence it once wrote.
func TestRecoverySourceTaskIsDecidedByReason(t *testing.T) {
	withReason := []types.BridgeEvent{{Type: types.EventTaskCancelled, Payload: map[string]any{"message": "anything", "reason": types.CancelReasonRecoveredAfterRestart}}}
	if !wasRecoverySourceTask(withReason) {
		t.Fatal("reason marker not recognised")
	}
	textOnly := []types.BridgeEvent{{Type: types.EventTaskCancelled, Payload: map[string]any{"message": "Task was recovered after the application restarted"}}}
	if wasRecoverySourceTask(textOnly) {
		t.Fatal("the message text alone must not decide recovery provenance")
	}
}
