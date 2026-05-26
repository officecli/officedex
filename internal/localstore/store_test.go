package localstore

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"testing"
	"time"

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

func TestRequestIDPersistsThroughRecordAndQuery(t *testing.T) {
	store := newTempStore(t)
	ctx := context.Background()

	events := []types.BridgeEvent{
		{EventID: "e1", TaskID: "task-req", RequestID: "req-001", Type: "task.started", Payload: map[string]any{"topic": "t"}},
		{EventID: "e2", TaskID: "task-req", RequestID: "req-001", Type: "task.progress"},
		{EventID: "e3", TaskID: "task-req", RequestID: "", Type: "task.progress"},
		{EventID: "e4", TaskID: "task-req", RequestID: "req-002", Type: "task.failed", Payload: map[string]any{"error_code": "rate_limit"}},
	}
	for _, ev := range events {
		if err := store.RecordEvent(ev); err != nil {
			t.Fatalf("RecordEvent(%s): %v", ev.EventID, err)
		}
	}

	got, err := store.QueryEventsByTask(ctx, "task-req")
	if err != nil {
		t.Fatalf("QueryEventsByTask: %v", err)
	}
	if len(got) != 4 {
		t.Fatalf("expected 4 events, got %d", len(got))
	}
	want := []string{"req-001", "req-001", "", "req-002"}
	for i, ev := range got {
		if ev.RequestID != want[i] {
			t.Errorf("event[%d].RequestID = %q, want %q", i, ev.RequestID, want[i])
		}
	}

	latest, err := store.LatestRequestID(ctx, "task-req")
	if err != nil {
		t.Fatalf("LatestRequestID: %v", err)
	}
	if latest != "req-002" {
		t.Errorf("LatestRequestID = %q, want req-002 (most recent non-empty)", latest)
	}

	missing, err := store.LatestRequestID(ctx, "nope")
	if err != nil {
		t.Fatalf("LatestRequestID nope: %v", err)
	}
	if missing != "" {
		t.Errorf("LatestRequestID(nope) = %q, want empty", missing)
	}

	if empty, err := store.LatestRequestID(ctx, ""); err != nil || empty != "" {
		t.Errorf("LatestRequestID(\"\") = %q,%v, want \"\",nil", empty, err)
	}
}

func TestSchemaV2MigrationFromV1DB(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "officedex.db")
	ctx := context.Background()

	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, status TEXT NOT NULL, document_type TEXT, topic TEXT, updated_at TEXT NOT NULL);
		CREATE TABLE IF NOT EXISTS task_events (event_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, type TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);
		CREATE TABLE IF NOT EXISTS artifacts (file_path TEXT PRIMARY KEY, task_id TEXT, file_id TEXT, file_name TEXT NOT NULL, document_type TEXT NOT NULL, preview_url TEXT, edit_url TEXT, synced_at TEXT NOT NULL);
		CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
		CREATE TABLE IF NOT EXISTS task_credit_records (task_id TEXT PRIMARY KEY, credits_charged INTEGER, credit_mode TEXT, recorded_at TEXT NOT NULL);
		INSERT INTO schema_migrations(version, applied_at) VALUES (1, '2024-01-01T00:00:00Z');
		PRAGMA user_version = 1;
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(
		`INSERT INTO task_events(event_id, task_id, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)`,
		"legacy-evt", "legacy-task", "task.started", `{"topic":"t"}`, "2024-06-01T00:00:00Z",
	); err != nil {
		t.Fatal(err)
	}
	_ = db.Close()

	store := New(path)
	if err := store.Open(ctx); err != nil {
		t.Fatalf("Open with v2 migration: %v", err)
	}
	defer store.Close()

	var version int
	if err := store.db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != 2 {
		t.Errorf("user_version = %d, want 2", version)
	}

	events, err := store.QueryEventsByTask(ctx, "legacy-task")
	if err != nil {
		t.Fatalf("QueryEventsByTask: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("expected 1 legacy event, got %d", len(events))
	}
	if events[0].RequestID != "" {
		t.Errorf("legacy event RequestID = %q, want empty (DEFAULT '')", events[0].RequestID)
	}

	if err := store.RecordEvent(types.BridgeEvent{
		EventID: "post-mig", TaskID: "legacy-task", RequestID: "req-post", Type: "task.failed",
	}); err != nil {
		t.Fatalf("RecordEvent after v2: %v", err)
	}
	latest, err := store.LatestRequestID(ctx, "legacy-task")
	if err != nil {
		t.Fatal(err)
	}
	if latest != "req-post" {
		t.Errorf("LatestRequestID after v2 = %q, want req-post", latest)
	}
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

func TestRecordEventAllowsSameBridgeEventIDAcrossTasks(t *testing.T) {
	store := newTempStore(t)
	ctx := context.Background()

	for _, taskID := range []string{"task-a", "task-b"} {
		if err := store.RecordEvent(types.BridgeEvent{
			EventID: "event-000002",
			TaskID:  taskID,
			Type:    "task.started",
			Payload: map[string]any{"document_type": "docx"},
		}); err != nil {
			t.Fatalf("RecordEvent(%s): %v", taskID, err)
		}
	}

	for _, taskID := range []string{"task-a", "task-b"} {
		events, err := store.QueryEventsByTask(ctx, taskID)
		if err != nil {
			t.Fatalf("QueryEventsByTask(%s): %v", taskID, err)
		}
		if len(events) != 1 {
			t.Fatalf("task %s event count = %d, want 1", taskID, len(events))
		}
		if events[0].EventID != "event-000002" {
			t.Errorf("task %s event id = %q, want original event-000002", taskID, events[0].EventID)
		}
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
		count      int
		taskID     string
		fileName   string
		previewURL string
		editURL    sql.NullString
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

func TestQueryEventsByTask(t *testing.T) {
	store := newTempStore(t)
	ctx := context.Background()

	events := []types.BridgeEvent{
		{EventID: "e1", TaskID: "task-1", Type: "task.started", Payload: map[string]any{"topic": "test"}},
		{EventID: "e2", TaskID: "task-1", Type: "task.progress", Payload: map[string]any{"stage": "generating"}},
		{EventID: "e3", TaskID: "task-2", Type: "task.started", Payload: map[string]any{"topic": "other"}},
		{EventID: "e4", TaskID: "task-1", Type: "task.completed"},
	}
	for _, ev := range events {
		if err := store.RecordEvent(ev); err != nil {
			t.Fatalf("RecordEvent(%s): %v", ev.EventID, err)
		}
	}

	got, err := store.QueryEventsByTask(ctx, "task-1")
	if err != nil {
		t.Fatalf("QueryEventsByTask: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("expected 3 events for task-1, got %d", len(got))
	}
	if got[0].EventID != "e1" {
		t.Errorf("first event = %q, want e1", got[0].EventID)
	}
	if got[2].EventID != "e4" {
		t.Errorf("last event = %q, want e4", got[2].EventID)
	}
	if got[0].Payload == nil || got[0].Payload["topic"] != "test" {
		t.Error("payload not reconstructed")
	}
}

func TestQueryEventsByTaskEmpty(t *testing.T) {
	store := newTempStore(t)
	ctx := context.Background()

	got, err := store.QueryEventsByTask(ctx, "nonexistent")
	if err != nil {
		t.Fatalf("QueryEventsByTask: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("expected 0 events, got %d", len(got))
	}
}

func TestQueryRecentEvents(t *testing.T) {
	store := newTempStore(t)
	ctx := context.Background()

	for i := 0; i < 5; i++ {
		ev := types.BridgeEvent{
			EventID: fmt.Sprintf("e%d", i),
			TaskID:  fmt.Sprintf("task-%d", i%2),
			Type:    "task.progress",
			Payload: map[string]any{"index": float64(i)},
		}
		if err := store.RecordEvent(ev); err != nil {
			t.Fatalf("RecordEvent: %v", err)
		}
	}

	got, err := store.QueryRecentEvents(ctx, 3)
	if err != nil {
		t.Fatalf("QueryRecentEvents: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("expected 3 events, got %d", len(got))
	}
}

func TestQueryRecentEventsReturnsAll(t *testing.T) {
	store := newTempStore(t)
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		if err := store.RecordEvent(types.BridgeEvent{
			EventID: fmt.Sprintf("e%d", i),
			TaskID:  "task-1",
			Type:    "task.progress",
		}); err != nil {
			t.Fatal(err)
		}
	}

	got, err := store.QueryRecentEvents(ctx, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Errorf("expected 3 events, got %d", len(got))
	}
}

func TestIndicesExist(t *testing.T) {
	store := newTempStore(t)
	var count int
	err := store.db.QueryRow(
		`SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name IN (
			'idx_task_events_task_created', 'idx_task_events_created'
		)`).Scan(&count)
	if err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Errorf("expected 2 indices, got %d", count)
	}
}

func TestSchemaV1MigrationFromLegacyDB(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "officedex.db")
	ctx := context.Background()

	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, status TEXT, document_type TEXT, topic TEXT, updated_at TEXT);
		PRAGMA user_version = 0;
	`); err != nil {
		t.Fatal(err)
	}
	_ = db.Close()

	store := New(path)
	if err := store.Open(ctx); err != nil {
		t.Fatalf("first Open with migration: %v", err)
	}
	since, err := store.GetCreditFeatureSince(ctx)
	if err != nil {
		t.Fatalf("GetCreditFeatureSince: %v", err)
	}
	if since == "" {
		t.Error("expected schema_migrations row after v1 migration")
	}
	var version int
	if err := store.db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != 2 {
		t.Errorf("user_version = %d, want 2", version)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	store2 := New(path)
	if err := store2.Open(ctx); err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer store2.Close()
	since2, err := store2.GetCreditFeatureSince(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if since2 != since {
		t.Errorf("applied_at changed on reopen: %q vs %q", since, since2)
	}
	var rowCount int
	if err := store2.db.QueryRow(`SELECT COUNT(*) FROM schema_migrations WHERE version = 1`).Scan(&rowCount); err != nil {
		t.Fatal(err)
	}
	if rowCount != 1 {
		t.Errorf("schema_migrations row count = %d, want 1 (idempotent)", rowCount)
	}
}

func TestRecordTaskCredit(t *testing.T) {
	store := newTempStore(t)
	ctx := context.Background()

	charged := 7
	if err := store.RecordTaskCredit("task-hosted", &charged, "hosted"); err != nil {
		t.Fatalf("RecordTaskCredit hosted: %v", err)
	}
	if err := store.RecordTaskCredit("task-legacy", nil, ""); err != nil {
		t.Fatalf("RecordTaskCredit legacy: %v", err)
	}
	zero := 0
	if err := store.RecordTaskCredit("task-failed", &zero, "anonymous"); err != nil {
		t.Fatalf("RecordTaskCredit zero: %v", err)
	}

	var (
		chargedSQL sql.NullInt64
		modeSQL    sql.NullString
	)
	row := store.db.QueryRowContext(ctx,
		`SELECT credits_charged, credit_mode FROM task_credit_records WHERE task_id = ?`, "task-hosted")
	if err := row.Scan(&chargedSQL, &modeSQL); err != nil {
		t.Fatal(err)
	}
	if !chargedSQL.Valid || chargedSQL.Int64 != 7 {
		t.Errorf("hosted credits_charged = %+v, want 7", chargedSQL)
	}
	if !modeSQL.Valid || modeSQL.String != "hosted" {
		t.Errorf("hosted credit_mode = %+v, want hosted", modeSQL)
	}

	row = store.db.QueryRowContext(ctx,
		`SELECT credits_charged, credit_mode FROM task_credit_records WHERE task_id = ?`, "task-legacy")
	if err := row.Scan(&chargedSQL, &modeSQL); err != nil {
		t.Fatal(err)
	}
	if chargedSQL.Valid {
		t.Errorf("legacy credits_charged should be NULL, got %+v", chargedSQL)
	}
	if modeSQL.Valid {
		t.Errorf("legacy credit_mode should be NULL, got %+v", modeSQL)
	}

	row = store.db.QueryRowContext(ctx,
		`SELECT credits_charged FROM task_credit_records WHERE task_id = ?`, "task-failed")
	if err := row.Scan(&chargedSQL); err != nil {
		t.Fatal(err)
	}
	if !chargedSQL.Valid || chargedSQL.Int64 != 0 {
		t.Errorf("failed task credits_charged = %+v, want 0", chargedSQL)
	}

	updated := 999
	if err := store.RecordTaskCredit("task-hosted", &updated, "api_key"); err != nil {
		t.Fatal(err)
	}
	row = store.db.QueryRowContext(ctx,
		`SELECT credits_charged FROM task_credit_records WHERE task_id = ?`, "task-hosted")
	if err := row.Scan(&chargedSQL); err != nil {
		t.Fatal(err)
	}
	if chargedSQL.Int64 != 7 {
		t.Errorf("INSERT OR IGNORE should preserve original; got %d", chargedSQL.Int64)
	}
}

func TestRecordTaskCreditEmptyTaskIDIsNoop(t *testing.T) {
	store := newTempStore(t)
	if err := store.RecordTaskCredit("", nil, ""); err != nil {
		t.Fatalf("RecordTaskCredit empty: %v", err)
	}
	var count int
	if err := store.db.QueryRow(`SELECT COUNT(*) FROM task_credit_records`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Errorf("expected no rows for empty task id, got %d", count)
	}
}

func TestGetCreditFeatureSinceReturnsValidTimestamp(t *testing.T) {
	store := newTempStore(t)
	ctx := context.Background()
	since, err := store.GetCreditFeatureSince(ctx)
	if err != nil {
		t.Fatalf("GetCreditFeatureSince: %v", err)
	}
	if since == "" {
		t.Fatal("expected non-empty applied_at after fresh Open")
	}
	if _, err := time.Parse(time.RFC3339Nano, since); err != nil {
		t.Errorf("applied_at %q is not RFC3339Nano: %v", since, err)
	}
}

func TestExistingRowsSurviveNewSchema(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "officedex.db")
	ctx := context.Background()

	oldSchema := `
	CREATE TABLE IF NOT EXISTS tasks (
	  id TEXT PRIMARY KEY, status TEXT NOT NULL, document_type TEXT,
	  topic TEXT, updated_at TEXT NOT NULL
	);
	CREATE TABLE IF NOT EXISTS task_events (
	  event_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, type TEXT NOT NULL,
	  payload_json TEXT NOT NULL, created_at TEXT NOT NULL
	);
	CREATE TABLE IF NOT EXISTS artifacts (
	  file_path TEXT PRIMARY KEY, task_id TEXT, file_id TEXT,
	  file_name TEXT NOT NULL, document_type TEXT NOT NULL,
	  preview_url TEXT, edit_url TEXT, synced_at TEXT NOT NULL
	);`

	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, oldSchema); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(
		`INSERT INTO task_events(event_id, task_id, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)`,
		"old-evt", "old-task", "task.started", `{"topic":"old"}`, "2024-01-01T00:00:00Z",
	); err != nil {
		t.Fatal(err)
	}
	_ = db.Close()

	store := New(path)
	if err := store.Open(ctx); err != nil {
		t.Fatalf("Open with new schema: %v", err)
	}
	defer store.Close()

	events, err := store.QueryEventsByTask(ctx, "old-task")
	if err != nil {
		t.Fatalf("QueryEventsByTask: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("expected 1 old event, got %d", len(events))
	}
	if events[0].EventID != "old-evt" {
		t.Errorf("event_id = %q, want old-evt", events[0].EventID)
	}
	if events[0].Payload["topic"] != "old" {
		t.Error("old payload not preserved")
	}
}
