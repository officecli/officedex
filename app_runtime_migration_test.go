package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"officedex/internal/localstore"
	"officedex/internal/types"
)

func TestPrepareLegacyRuntimeMigrationListsOnlyNonTerminalDesktopTasks(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	store := localstore.New(filepath.Join(root, "officedex.sqlite"))
	if err := store.Open(ctx); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	for _, event := range []types.BridgeEvent{
		{TaskID: "task-running", Type: "task.started"},
		{TaskID: "task-question", Type: "task.question"},
		{TaskID: "task-plan", Type: "task.plan"},
		{TaskID: "task-done", Type: "task.started"},
		{TaskID: "task-done", Type: "task.completed"},
	} {
		if err := store.RecordEvent(event); err != nil {
			t.Fatal(err)
		}
	}
	runtimeRoot := filepath.Join(root, "runtime")
	if err := os.MkdirAll(runtimeRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	app := &App{localStore: store, runtimeRoot: runtimeRoot, desktopInstanceID: "desktop-a"}
	if err := app.prepareLegacyRuntimeMigration(ctx); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(runtimeRoot, "legacy-migration.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		ClientID string   `json:"client_id"`
		TaskIDs  []string `json:"task_ids"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.ClientID != "desktop-a" {
		t.Fatalf("client_id = %q", manifest.ClientID)
	}
	want := []string{"task-plan", "task-question", "task-running"}
	if !reflect.DeepEqual(manifest.TaskIDs, want) {
		t.Fatalf("task_ids = %#v, want %#v", manifest.TaskIDs, want)
	}
}
