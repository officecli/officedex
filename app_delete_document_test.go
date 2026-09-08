package main

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"officedex/internal/localstore"
	"officedex/internal/types"
)

func newDeleteDocumentTestApp(t *testing.T) (*App, *localstore.Store) {
	t.Helper()
	store := localstore.New(filepath.Join(t.TempDir(), "officedex.db"))
	if err := store.Open(context.Background()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	app := &App{localStore: store}
	app.startEventWriter()
	t.Cleanup(app.drainEventWrites)
	return app, store
}

// The confirmation dialog promises that deleting a document cancels its
// running work. A task whose bridge process is gone can never be cancelled
// remotely -- and that is the usual state of a document someone wants to
// delete -- so the delete has to settle the lineage locally instead of
// failing with "document has running tasks".
func TestDeleteDocumentSettlesAStuckLineageInsteadOfRefusing(t *testing.T) {
	app, store := newDeleteDocumentTestApp(t)
	ctx := context.Background()
	for _, taskID := range []string{"task-open", "task-parked"} {
		if err := store.RecordTaskContext(ctx, taskID, localstore.TaskContext{ConversationID: "document-a"}); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.RecordEvent(types.BridgeEvent{TaskID: "task-open", Type: "task.started"}); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordEvent(types.BridgeEvent{TaskID: "task-parked", Type: "task.question"}); err != nil {
		t.Fatal(err)
	}
	// No bridge is configured, so every cancel attempt fails the way it does
	// for a task whose process died -- exactly the case that used to block.
	if err := app.DeleteDocument("task-open"); err != nil {
		t.Fatalf("DeleteDocument: %v", err)
	}
	history, err := store.QueryRecentTaskHistory(ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(history) != 0 {
		t.Fatalf("task history = %#v, want the document gone", history)
	}
}

// Deleting one document must not settle or remove another's work.
func TestDeleteDocumentLeavesOtherDocumentsRunning(t *testing.T) {
	app, store := newDeleteDocumentTestApp(t)
	ctx := context.Background()
	if err := store.RecordTaskContext(ctx, "task-a", localstore.TaskContext{ConversationID: "document-a"}); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordTaskContext(ctx, "task-b", localstore.TaskContext{ConversationID: "document-b"}); err != nil {
		t.Fatal(err)
	}
	for _, taskID := range []string{"task-a", "task-b"} {
		if err := store.RecordEvent(types.BridgeEvent{TaskID: taskID, Type: "task.started"}); err != nil {
			t.Fatal(err)
		}
	}
	if err := app.DeleteDocument("task-a"); err != nil {
		t.Fatalf("DeleteDocument: %v", err)
	}
	stillRunning, err := store.QueryTaskIDsByStatus(ctx, "running")
	if err != nil {
		t.Fatal(err)
	}
	if len(stillRunning) != 1 || stillRunning[0] != "task-b" {
		t.Fatalf("running tasks = %#v, want only task-b untouched", stillRunning)
	}
}

func TestDeleteDocumentRejectsAnEmptyTaskID(t *testing.T) {
	app, _ := newDeleteDocumentTestApp(t)
	if err := app.DeleteDocument("  "); err == nil || !strings.Contains(err.Error(), "task id is empty") {
		t.Fatalf("DeleteDocument(\"\") error = %v, want an empty-id rejection", err)
	}
}
