package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"officedex/internal/localstore"
	"officedex/internal/preview"
	"officedex/internal/types"
)

// blockEventWriter parks the writer goroutine on a queued write until the
// returned release function is called, so a test can observe what the
// listener does synchronously versus what it hands to the writer.
func blockEventWriter(t *testing.T, app *App) (release func()) {
	t.Helper()
	gate := make(chan struct{})
	entered := make(chan struct{})
	app.queueEventWrite(func() {
		close(entered)
		<-gate
	})
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("event writer never picked up the blocking write")
	}
	return func() { close(gate) }
}

// The renderer asks for a preview token the moment task.completed arrives.
// Granting the artifact used to happen on the writer goroutine, after emit, so
// under load the request raced the queue and failed with "artifact is not
// registered". The grant must be in place before the event is emitted.
func TestListenerGrantsCompletedArtifactBeforeThePersistenceQueueRuns(t *testing.T) {
	root := t.TempDir()
	artifactPath := filepath.Join(root, "deck.pptx")
	if err := os.WriteFile(artifactPath, []byte("pptx"), 0o600); err != nil {
		t.Fatal(err)
	}
	registry, err := preview.New(preview.RegistryOptions{TrustedRoots: []string{root}})
	if err != nil {
		t.Fatal(err)
	}
	app := &App{userDataDir: t.TempDir(), workspaceDir: root, previewReg: registry}
	app.startEventWriter()
	t.Cleanup(app.drainEventWrites)
	client, _ := poolTestClient(t, app)
	release := blockEventWriter(t, app)
	defer release()

	listener := app.bridgeEventListener(client)
	listener(types.BridgeEvent{
		TaskID: "task-1",
		Type:   "task.completed",
		TS:     time.Now().UTC().Format(time.RFC3339Nano),
		Payload: map[string]any{"result": map[string]any{
			"file_path": artifactPath, "file_name": "deck.pptx", "document_type": "pptx",
		}},
	})

	// The writer is still parked, so anything that happened is the listener's
	// own synchronous work.
	if _, err := registry.IssueToken(types.Artifact{FilePath: artifactPath, FileName: "deck.pptx", DocumentType: "pptx", TaskID: "task-1"}); err != nil {
		t.Fatalf("completed artifact not previewable right after the event was delivered: %v", err)
	}
}

// Locally synthesised events (task.user_input, task.cancelled) used to be
// written inline while bridge events went through the queue, so their rows
// could land in the wrong order. Both must take the same path, and a local
// event is stamped when it is created so its position is where it happened.
func TestRecordTaskEventBestEffortUsesTheSameQueueAsBridgeEvents(t *testing.T) {
	store := localstore.New(filepath.Join(t.TempDir(), "officedex.db"))
	if err := store.Open(context.Background()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	app := &App{localStore: store}
	app.startEventWriter()
	release := blockEventWriter(t, app)

	before := time.Now().UTC()
	app.recordTaskEventBestEffort(types.BridgeEvent{TaskID: "task-1", Type: "task.user_input", Payload: map[string]any{"prompt": "hello"}})

	events, err := store.QueryEventsByTask(context.Background(), "task-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 0 {
		t.Fatalf("local event was written inline (%d rows) while the writer was parked; it must go through the queue", len(events))
	}

	release()
	app.drainEventWrites()
	events, err = store.QueryEventsByTask(context.Background(), "task-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].Type != "task.user_input" {
		t.Fatalf("events after drain = %+v, want the one task.user_input", events)
	}
	ts, err := time.Parse(time.RFC3339Nano, events[0].TS)
	if err != nil {
		t.Fatalf("local event must be stamped when created, got TS %q: %v", events[0].TS, err)
	}
	if ts.Before(before.Add(-time.Second)) || ts.After(time.Now().UTC().Add(time.Second)) {
		t.Fatalf("local event TS %s is not the creation time", ts)
	}
}
