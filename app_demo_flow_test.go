package main

import (
	"context"
	"path/filepath"
	"testing"

	"officedex/internal/localstore"
	"officedex/internal/preview"
	"officedex/internal/types"
)

func TestRecordAndEmitTaskEventPersistsWithoutWailsContext(t *testing.T) {
	store := localstore.New(filepath.Join(t.TempDir(), "officedex.sqlite"))
	if err := store.Open(context.Background()); err != nil {
		t.Fatalf("Open local store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	reg, err := preview.New(preview.RegistryOptions{TrustedRoots: []string{t.TempDir()}})
	if err != nil {
		t.Fatalf("preview registry: %v", err)
	}
	app := &App{localStore: store, previewReg: reg}
	event := types.BridgeEvent{TaskID: "task-recorder", Type: "task.started", Payload: map[string]any{"document_type": "pptx"}}
	if err := app.RecordAndEmitTaskEvent(context.Background(), event); err != nil {
		t.Fatalf("RecordAndEmitTaskEvent: %v", err)
	}
	events, err := store.QueryEventsByTask(context.Background(), "task-recorder")
	if err != nil {
		t.Fatalf("QueryEventsByTask: %v", err)
	}
	if len(events) != 1 || events[0].Type != "task.started" {
		t.Fatalf("events = %#v", events)
	}
}
