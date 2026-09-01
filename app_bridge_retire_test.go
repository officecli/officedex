package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"path/filepath"
	"testing"
	"time"

	"officedex/internal/bridge"
	"officedex/internal/localstore"
	"officedex/internal/types"
)

func writeRetireNotification(t *testing.T, w io.Writer, taskID, eventType string) {
	t.Helper()
	body, err := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"method":  eventType,
		"params": map[string]any{
			"task_id": taskID,
			"type":    eventType,
			"payload": map[string]any{},
		},
	})
	if err != nil {
		t.Fatalf("marshal notification: %v", err)
	}
	if _, err := fmt.Fprintf(w, "Content-Length: %d\r\n\r\n", len(body)); err != nil {
		t.Fatalf("write header: %v", err)
	}
	if _, err := w.Write(body); err != nil {
		t.Fatalf("write body: %v", err)
	}
}

// newRetireApp wires an App to a bridge client backed by a fake transport,
// using the same event listener production code registers.
func newRetireApp(t *testing.T) (*App, *bridge.Client, *authResetBridgeTransport) {
	t.Helper()
	transport := newAuthResetBridgeTransport()
	client := bridge.New(bridge.Options{
		RequestTimeout: 500 * time.Millisecond,
		CreateTransport: func(opts bridge.Options) (bridge.Transport, error) {
			return transport, nil
		},
		DisableAutoReconnect: true,
	})
	workspaceDir := t.TempDir()
	app := &App{
		userDataDir:     t.TempDir(),
		workspaceDir:    workspaceDir,
		bridgeClients:   map[string]*bridge.Client{workspaceDir: client},
		bridgeRecentCwd: workspaceDir,
	}
	client.OnEvent(app.bridgeEventListener(client))
	if err := client.Start(context.Background()); err != nil {
		t.Fatalf("start bridge client: %v", err)
	}
	t.Cleanup(func() { client.Close() })
	return app, client, transport
}

func waitForKills(t *testing.T, transport *authResetBridgeTransport, want int32) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if transport.kills.Load() == want {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("kills = %d, want %d", transport.kills.Load(), want)
}

func waitForBusy(t *testing.T, client *bridge.Client, want bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if client.HasActiveWork() == want {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("HasActiveWork() never became %v", want)
}

// Regression: swapping the bridge (a second generation, or any call resolving
// to a different cwd) used to kill the child process mid-task, leaving the
// first task running forever with no terminal event.
func TestRetireBridgeKeepsTaskRunningUntilItFinishes(t *testing.T) {
	app, client, transport := newRetireApp(t)

	writeRetireNotification(t, transport.stdoutW, "task-1", "task.started")
	waitForBusy(t, client, true)

	app.retireBridge(client)

	if got := transport.kills.Load(); got != 0 {
		t.Fatalf("a busy bridge was killed on retire (kills = %d)", got)
	}

	writeRetireNotification(t, transport.stdoutW, "task-1", "task.completed")
	waitForKills(t, transport, 1)
}

func TestRetireBridgeClosesIdleClientImmediately(t *testing.T) {
	app, client, transport := newRetireApp(t)

	app.retireBridge(client)
	waitForKills(t, transport, 1)
}

// Regression: ListImageTemplates and friends resolved their own cwd, so opening
// the template panel while a generation ran swapped — and killed — the bridge.
func TestBridgeForMetadataReusesTheConnectedClient(t *testing.T) {
	app, client, transport := newRetireApp(t)

	writeRetireNotification(t, transport.stdoutW, "task-1", "task.started")
	waitForBusy(t, client, true)

	got, err := app.bridgeForMetadata()
	if err != nil {
		t.Fatalf("bridgeForMetadata: %v", err)
	}
	if got != client {
		t.Fatal("bridgeForMetadata should reuse the connected client")
	}
	if kills := transport.kills.Load(); kills != 0 {
		t.Fatalf("metadata lookup killed the running bridge (kills = %d)", kills)
	}
}

// Regression: no bridge child survives a restart, so tasks left as `running`
// belonged to a dead process and could never reach a terminal event.
func TestFailInterruptedTasksMarksRunningTasksFailed(t *testing.T) {
	ctx := context.Background()
	store := localstore.New(filepath.Join(t.TempDir(), "officedex.db"))
	if err := store.Open(ctx); err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	if err := store.RecordEvent(types.BridgeEvent{TaskID: "stuck", Type: "task.started"}); err != nil {
		t.Fatalf("record started: %v", err)
	}
	if err := store.RecordEvent(types.BridgeEvent{TaskID: "done", Type: "task.started"}); err != nil {
		t.Fatalf("record started: %v", err)
	}
	if err := store.RecordEvent(types.BridgeEvent{TaskID: "done", Type: "task.completed"}); err != nil {
		t.Fatalf("record completed: %v", err)
	}

	app := &App{userDataDir: t.TempDir(), workspaceDir: t.TempDir(), localStore: store}
	if err := app.failInterruptedTasks(ctx); err != nil {
		t.Fatalf("failInterruptedTasks: %v", err)
	}

	running, err := store.QueryTaskIDsByStatus(ctx, "running")
	if err != nil {
		t.Fatalf("query running: %v", err)
	}
	if len(running) != 0 {
		t.Fatalf("tasks still running after recovery: %v", running)
	}

	events, err := store.QueryEventsByTask(ctx, "stuck")
	if err != nil {
		t.Fatalf("query events: %v", err)
	}
	last := events[len(events)-1]
	if last.Type != "task.failed" {
		t.Fatalf("last event = %q, want task.failed", last.Type)
	}
	if got, _ := last.Payload["code"].(string); got != bridge.StrandedTaskCode {
		t.Fatalf("payload.code = %v, want %s", last.Payload["code"], bridge.StrandedTaskCode)
	}

	doneEvents, err := store.QueryEventsByTask(ctx, "done")
	if err != nil {
		t.Fatalf("query events: %v", err)
	}
	if len(doneEvents) != 2 {
		t.Fatalf("a completed task should be left alone, got %d events", len(doneEvents))
	}
}

// A task parked on a question survives a restart: stale-respond recovery can
// replay it, so the startup pass must not fail it.
func TestFailInterruptedTasksLeavesInteractiveTasksAlone(t *testing.T) {
	ctx := context.Background()
	store := localstore.New(filepath.Join(t.TempDir(), "officedex.db"))
	if err := store.Open(ctx); err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	if err := store.RecordEvent(types.BridgeEvent{TaskID: "asking", Type: "task.question"}); err != nil {
		t.Fatalf("record question: %v", err)
	}

	app := &App{userDataDir: t.TempDir(), workspaceDir: t.TempDir(), localStore: store}
	if err := app.failInterruptedTasks(ctx); err != nil {
		t.Fatalf("failInterruptedTasks: %v", err)
	}

	events, err := store.QueryEventsByTask(ctx, "asking")
	if err != nil {
		t.Fatalf("query events: %v", err)
	}
	if len(events) != 1 || events[0].Type != "task.question" {
		t.Fatalf("interactive task was modified: %v", events)
	}
}
