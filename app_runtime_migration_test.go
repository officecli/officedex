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

func readResumableTaskManifest(t *testing.T, runtimeRoot string) (string, []string) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(runtimeRoot, resumableTaskManifestName))
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
	return manifest.ClientID, manifest.TaskIDs
}

func newManifestTestApp(t *testing.T) (*App, string) {
	t.Helper()
	root := t.TempDir()
	store := localstore.New(filepath.Join(root, "officedex.sqlite"))
	if err := store.Open(context.Background()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	runtimeRoot := filepath.Join(root, "runtime")
	if err := os.MkdirAll(runtimeRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	return &App{localStore: store, runtimeRoot: runtimeRoot, desktopInstanceID: "desktop-a"}, runtimeRoot
}

func TestPublishResumableTaskManifestListsOnlyNonTerminalDesktopTasks(t *testing.T) {
	ctx := context.Background()
	app, runtimeRoot := newManifestTestApp(t)
	for _, event := range []types.BridgeEvent{
		{TaskID: "task-running", Type: "task.started"},
		{TaskID: "task-question", Type: "task.question"},
		{TaskID: "task-plan", Type: "task.plan"},
		{TaskID: "task-done", Type: "task.started"},
		{TaskID: "task-done", Type: "task.completed"},
		{TaskID: "task-failed", Type: "task.started"},
		{TaskID: "task-failed", Type: "task.failed"},
	} {
		if err := app.localStore.RecordEvent(event); err != nil {
			t.Fatal(err)
		}
	}
	if err := app.publishResumableTaskManifest(ctx); err != nil {
		t.Fatal(err)
	}
	clientID, taskIDs := readResumableTaskManifest(t, runtimeRoot)
	if clientID != "desktop-a" {
		t.Fatalf("client_id = %q", clientID)
	}
	want := []string{"task-plan", "task-question", "task-running"}
	if !reflect.DeepEqual(taskIDs, want) {
		t.Fatalf("task_ids = %#v, want %#v", taskIDs, want)
	}
}

// The manifest is what tells the bridge which runs it may resume. Publishing
// it before failInterruptedTasks advertised the very tasks the app was about
// to declare dead, so the bridge resumed them and their progress events
// flipped them straight back to `running` -- the loop that made a desktop
// document impossible to delete.
func TestPublishResumableTaskManifestAfterFailingInterruptedTasksExcludesThem(t *testing.T) {
	ctx := context.Background()
	app, runtimeRoot := newManifestTestApp(t)
	for _, event := range []types.BridgeEvent{
		{TaskID: "task-interrupted", Type: "task.started"},
		{TaskID: "task-question", Type: "task.question"},
	} {
		if err := app.localStore.RecordEvent(event); err != nil {
			t.Fatal(err)
		}
	}
	if err := app.failInterruptedTasks(ctx); err != nil {
		t.Fatal(err)
	}
	if err := app.publishResumableTaskManifest(ctx); err != nil {
		t.Fatal(err)
	}
	_, taskIDs := readResumableTaskManifest(t, runtimeRoot)
	// A task parked on a question can be replayed from its persisted answers;
	// one that was mid-run cannot, and the fail pass just retired it.
	want := []string{"task-question"}
	if !reflect.DeepEqual(taskIDs, want) {
		t.Fatalf("task_ids = %#v, want %#v", taskIDs, want)
	}
}
