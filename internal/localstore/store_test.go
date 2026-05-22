package localstore

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	"officedex/internal/types"
)

func newTempStore(t *testing.T) *Store {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "officedex.db")
	store := New(path)
	if err := store.Open(context.Background()); err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() {
		_ = store.Close()
	})
	return store
}

func TestOpenCloseReopen(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "officedex.db")
	store := New(path)
	ctx := context.Background()
	if err := store.Open(ctx); err != nil {
		t.Fatalf("first Open: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if err := store.Open(ctx); err != nil {
		t.Fatalf("second Open: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("second Close: %v", err)
	}
}

func TestRecordEventInsertsTaskAndEvent(t *testing.T) {
	store := newTempStore(t)
	event := types.BridgeEvent{
		EventID: "evt-1",
		TaskID:  "task-1",
		Type:    "task.started",
		Payload: map[string]any{
			"document_type": "pptx",
			"topic":         "quarterly review",
		},
	}
	if err := store.RecordEvent(event); err != nil {
		t.Fatalf("RecordEvent: %v", err)
	}

	var status, documentType, topic string
	row := store.db.QueryRow(`SELECT status, document_type, topic FROM tasks WHERE id = ?`, "task-1")
	if err := row.Scan(&status, &documentType, &topic); err != nil {
		t.Fatalf("scan tasks row: %v", err)
	}
	if status != "running" {
		t.Errorf("status = %q, want running", status)
	}
	if documentType != "pptx" {
		t.Errorf("document_type = %q, want pptx", documentType)
	}
	if topic != "quarterly review" {
		t.Errorf("topic = %q, want quarterly review", topic)
	}

	var eventCount int
	if err := store.db.QueryRow(`SELECT COUNT(*) FROM task_events WHERE task_id = ?`, "task-1").Scan(&eventCount); err != nil {
		t.Fatalf("scan event count: %v", err)
	}
	if eventCount != 1 {
		t.Errorf("event count = %d, want 1", eventCount)
	}
}

func TestRecordEventUpsertUpdatesStatus(t *testing.T) {
	store := newTempStore(t)
	if err := store.RecordEvent(types.BridgeEvent{
		EventID: "evt-1",
		TaskID:  "task-1",
		Type:    "task.started",
		Payload: map[string]any{"document_type": "pptx", "topic": "first"},
	}); err != nil {
		t.Fatalf("first RecordEvent: %v", err)
	}
	if err := store.RecordEvent(types.BridgeEvent{
		EventID: "evt-2",
		TaskID:  "task-1",
		Type:    "task.completed",
	}); err != nil {
		t.Fatalf("second RecordEvent: %v", err)
	}

	var status, documentType, topic string
	row := store.db.QueryRow(`SELECT status, document_type, topic FROM tasks WHERE id = ?`, "task-1")
	if err := row.Scan(&status, &documentType, &topic); err != nil {
		t.Fatalf("scan: %v", err)
	}
	if status != "completed" {
		t.Errorf("status = %q, want completed", status)
	}
	if documentType != "pptx" {
		t.Errorf("document_type should be preserved via COALESCE, got %q", documentType)
	}
	if topic != "first" {
		t.Errorf("topic should be preserved via COALESCE, got %q", topic)
	}
}

func TestStatusFromEventTypeMapping(t *testing.T) {
	cases := []struct {
		eventType string
		want      string
	}{
		{"task.completed", "completed"},
		{"task.failed", "failed"},
		{"task.cancelled", "cancelled"},
		{"task.question", "question"},
		{"task.started", "running"},
		{"task.progress", "running"},
		{"", "running"},
	}
	for _, tc := range cases {
		if got := statusFromEvent(tc.eventType); got != tc.want {
			t.Errorf("statusFromEvent(%q) = %q, want %q", tc.eventType, got, tc.want)
		}
	}
}

func TestRecordEventEmptyTaskIDIsNoop(t *testing.T) {
	store := newTempStore(t)
	if err := store.RecordEvent(types.BridgeEvent{Type: "task.started"}); err != nil {
		t.Fatalf("RecordEvent: %v", err)
	}
	var tasks, events int
	if err := store.db.QueryRow(`SELECT COUNT(*) FROM tasks`).Scan(&tasks); err != nil {
		t.Fatal(err)
	}
	if err := store.db.QueryRow(`SELECT COUNT(*) FROM task_events`).Scan(&events); err != nil {
		t.Fatal(err)
	}
	if tasks != 0 || events != 0 {
		t.Errorf("expected empty store, got tasks=%d events=%d", tasks, events)
	}
}

func TestRecordArtifactUpsert(t *testing.T) {
	store := newTempStore(t)
	if err := store.RecordArtifact(types.Artifact{
		TaskID:       "task-1",
		FilePath:     "/tmp/out.pptx",
		FileName:     "out.pptx",
		DocumentType: "pptx",
		PreviewURL:   "https://example.com/preview/1",
	}); err != nil {
		t.Fatalf("first RecordArtifact: %v", err)
	}
	if err := store.RecordArtifact(types.Artifact{
		TaskID:       "task-2",
		FilePath:     "/tmp/out.pptx",
		FileName:     "out-v2.pptx",
		DocumentType: "pptx",
		PreviewURL:   "https://example.com/preview/2",
		EditURL:      "https://example.com/edit/2",
	}); err != nil {
		t.Fatalf("second RecordArtifact: %v", err)
	}

	var (
		count       int
		taskID      string
		fileName    string
		previewURL  string
		editURL     sql.NullString
	)
	if err := store.db.QueryRow(`SELECT COUNT(*) FROM artifacts`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Errorf("artifact count = %d, want 1 (upsert keyed by file_path)", count)
	}
	row := store.db.QueryRow(
		`SELECT task_id, file_name, preview_url, edit_url FROM artifacts WHERE file_path = ?`,
		"/tmp/out.pptx",
	)
	if err := row.Scan(&taskID, &fileName, &previewURL, &editURL); err != nil {
		t.Fatalf("scan: %v", err)
	}
	if taskID != "task-2" {
		t.Errorf("task_id = %q, want task-2", taskID)
	}
	if fileName != "out-v2.pptx" {
		t.Errorf("file_name = %q, want out-v2.pptx", fileName)
	}
	if previewURL != "https://example.com/preview/2" {
		t.Errorf("preview_url = %q, want updated value", previewURL)
	}
	if !editURL.Valid || editURL.String != "https://example.com/edit/2" {
		t.Errorf("edit_url = %+v, want updated value", editURL)
	}
}

func TestRecordEventGeneratesFallbackEventID(t *testing.T) {
	store := newTempStore(t)
	if err := store.RecordEvent(types.BridgeEvent{
		TaskID: "task-1",
		Type:   "task.progress",
	}); err != nil {
		t.Fatalf("RecordEvent: %v", err)
	}
	var eventID string
	if err := store.db.QueryRow(`SELECT event_id FROM task_events WHERE task_id = ?`, "task-1").Scan(&eventID); err != nil {
		t.Fatalf("scan event_id: %v", err)
	}
	if eventID == "" {
		t.Error("expected synthesized event_id, got empty string")
	}
}
