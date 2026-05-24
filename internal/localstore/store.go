// Package localstore is the Go port of src/main/localStore.ts.
//
// The store owns a SQLite database with three tables (tasks, task_events,
// artifacts) used to persist bridge events and generated artifacts. The
// modernc.org/sqlite driver is used (pure Go, no CGO) so the resulting binary
// stays cross-compile friendly across all desktop targets.
package localstore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	_ "modernc.org/sqlite"

	"officedex/internal/types"
)

const schema = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  document_type TEXT,
  topic TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS task_events (
  event_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS artifacts (
  file_path TEXT PRIMARY KEY,
  task_id TEXT,
  file_id TEXT,
  file_name TEXT NOT NULL,
  document_type TEXT NOT NULL,
  preview_url TEXT,
  edit_url TEXT,
  synced_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_events_task_created ON task_events(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_task_events_created ON task_events(created_at);
`

// schemaV1 adds bookkeeping for the per-task credit feature. Applied via a
// PRAGMA user_version-gated migration in Open() so existing databases upgrade
// in place exactly once.
const schemaV1 = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS task_credit_records (
  task_id TEXT PRIMARY KEY,
  credits_charged INTEGER,
  credit_mode TEXT,
  recorded_at TEXT NOT NULL
);
`

// Store wraps a SQLite database used to persist bridge events and artifacts.
// Safe for concurrent use.
type Store struct {
	dbPath string

	mu sync.Mutex
	db *sql.DB
}

// New creates a Store bound to dbPath. The database file is not opened until
// Open is called.
func New(dbPath string) *Store {
	return &Store{dbPath: dbPath}
}

// Open creates the parent directory, opens the SQLite database, and applies
// the schema. Safe to call multiple times.
func (s *Store) Open(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db != nil {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(s.dbPath), 0o755); err != nil {
		return fmt.Errorf("localstore: mkdir parent: %w", err)
	}
	db, err := sql.Open("sqlite", s.dbPath)
	if err != nil {
		return fmt.Errorf("localstore: open: %w", err)
	}
	if _, err := db.ExecContext(ctx, schema); err != nil {
		_ = db.Close()
		return fmt.Errorf("localstore: apply schema: %w", err)
	}
	if err := applyMigrations(ctx, db); err != nil {
		_ = db.Close()
		return fmt.Errorf("localstore: apply migrations: %w", err)
	}
	s.db = db
	return nil
}

// applyMigrations advances the database to the latest schema_version. Each
// migration is wrapped in its own transaction so a partial failure leaves the
// previous schema intact. Re-running Open is idempotent.
func applyMigrations(ctx context.Context, db *sql.DB) error {
	var current int
	if err := db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&current); err != nil {
		return fmt.Errorf("read user_version: %w", err)
	}
	if current < 1 {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("begin v1: %w", err)
		}
		if _, err := tx.ExecContext(ctx, schemaV1); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("v1 ddl: %w", err)
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, ?)`,
			time.Now().UTC().Format(time.RFC3339Nano),
		); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("v1 stamp: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "PRAGMA user_version = 1"); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("v1 set user_version: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("v1 commit: %w", err)
		}
	}
	return nil
}

// Close releases the underlying database handle.
func (s *Store) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return nil
	}
	err := s.db.Close()
	s.db = nil
	if err != nil {
		return fmt.Errorf("localstore: close: %w", err)
	}
	return nil
}

// RecordEvent upserts a row into tasks and inserts/replaces a row into
// task_events. Events without a task_id are silently dropped, matching the
// behaviour of the TypeScript source.
func (s *Store) RecordEvent(event types.BridgeEvent) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil || event.TaskID == "" {
		return nil
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	status := statusFromEvent(event.Type)
	documentType := nullableString(stringPayload(event, "document_type"))
	topic := nullableString(stringPayload(event, "topic"))

	if _, err := s.db.Exec(
		`INSERT INTO tasks(id, status, document_type, topic, updated_at)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
		   status=excluded.status,
		   document_type=COALESCE(excluded.document_type, tasks.document_type),
		   topic=COALESCE(excluded.topic, tasks.topic),
		   updated_at=excluded.updated_at`,
		event.TaskID, status, documentType, topic, now,
	); err != nil {
		return fmt.Errorf("localstore: upsert task: %w", err)
	}

	payloadJSON, err := json.Marshal(orEmptyPayload(event.Payload))
	if err != nil {
		return fmt.Errorf("localstore: marshal payload: %w", err)
	}
	eventID := event.EventID
	if eventID == "" {
		eventID = fmt.Sprintf("%s:%s:%s", event.TaskID, event.Type, now)
	}
	if _, err := s.db.Exec(
		`INSERT OR REPLACE INTO task_events(event_id, task_id, type, payload_json, created_at)
		 VALUES (?, ?, ?, ?, ?)`,
		eventID, event.TaskID, event.Type, string(payloadJSON), now,
	); err != nil {
		return fmt.Errorf("localstore: insert event: %w", err)
	}
	return nil
}

// QueryEventsByTask returns all BridgeEvent rows for the given task, ordered
// by created_at ascending.
func (s *Store) QueryEventsByTask(ctx context.Context, taskID string) ([]types.BridgeEvent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return nil, fmt.Errorf("localstore: not open")
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT event_id, task_id, type, payload_json, created_at
		 FROM task_events WHERE task_id = ? ORDER BY created_at ASC`, taskID)
	if err != nil {
		return nil, fmt.Errorf("localstore: query events by task: %w", err)
	}
	defer rows.Close()
	return scanEvents(rows)
}

// QueryRecentEvents returns the most recent events across all tasks, ordered
// by created_at descending, limited to the given count.
func (s *Store) QueryRecentEvents(ctx context.Context, limit int) ([]types.BridgeEvent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return nil, fmt.Errorf("localstore: not open")
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT event_id, task_id, type, payload_json, created_at
		 FROM task_events ORDER BY created_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, fmt.Errorf("localstore: query recent events: %w", err)
	}
	defer rows.Close()
	return scanEvents(rows)
}

func scanEvents(rows *sql.Rows) ([]types.BridgeEvent, error) {
	var events []types.BridgeEvent
	for rows.Next() {
		var (
			eventID     string
			taskID      string
			eventType   string
			payloadJSON string
			createdAt   string
		)
		if err := rows.Scan(&eventID, &taskID, &eventType, &payloadJSON, &createdAt); err != nil {
			return nil, fmt.Errorf("localstore: scan event: %w", err)
		}
		var payload map[string]any
		_ = json.Unmarshal([]byte(payloadJSON), &payload)
		events = append(events, types.BridgeEvent{
			EventID: eventID,
			TaskID:  taskID,
			Type:    eventType,
			TS:      createdAt,
			Payload: payload,
		})
	}
	return events, rows.Err()
}

// RecordArtifact upserts a row into the artifacts table keyed by file_path.
func (s *Store) RecordArtifact(artifact types.Artifact) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return nil
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := s.db.Exec(
		`INSERT INTO artifacts(file_path, task_id, file_id, file_name, document_type, preview_url, edit_url, synced_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(file_path) DO UPDATE SET
		   task_id=excluded.task_id,
		   file_id=excluded.file_id,
		   file_name=excluded.file_name,
		   document_type=excluded.document_type,
		   preview_url=excluded.preview_url,
		   edit_url=excluded.edit_url,
		   synced_at=excluded.synced_at`,
		artifact.FilePath,
		nullableString(artifact.TaskID),
		nullableString(artifact.FileID),
		artifact.FileName,
		artifact.DocumentType,
		nullableString(artifact.PreviewURL),
		nullableString(artifact.EditURL),
		now,
	); err != nil {
		return fmt.Errorf("localstore: upsert artifact: %w", err)
	}
	return nil
}

// RecordTaskCredit persists the per-task credit charge reported by the agent
// bridge on task.completed / task.failed. INSERT OR IGNORE keeps the first
// observation per task immutable — server-side settled credits are
// authoritative and never need updating. charged may be nil for legacy bridges
// that do not report the field (stored as SQL NULL).
func (s *Store) RecordTaskCredit(taskID string, charged *int, mode string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil || taskID == "" {
		return nil
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	var chargedArg any
	if charged != nil {
		chargedArg = *charged
	}
	if _, err := s.db.Exec(
		`INSERT OR IGNORE INTO task_credit_records(task_id, credits_charged, credit_mode, recorded_at)
		 VALUES (?, ?, ?, ?)`,
		taskID, chargedArg, nullableString(mode), now,
	); err != nil {
		return fmt.Errorf("localstore: insert task credit: %w", err)
	}
	return nil
}

// GetCreditFeatureSince returns the timestamp at which the v1 migration
// applied — i.e. the earliest moment per-task credit tracking became
// available for this user. Useful for distinguishing "missing because legacy"
// from "missing because zero" in the UI.
func (s *Store) GetCreditFeatureSince(ctx context.Context) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return "", fmt.Errorf("localstore: not open")
	}
	var appliedAt string
	err := s.db.QueryRowContext(ctx,
		`SELECT applied_at FROM schema_migrations WHERE version = 1`).Scan(&appliedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", nil
		}
		return "", fmt.Errorf("localstore: query credit feature since: %w", err)
	}
	return appliedAt, nil
}

func statusFromEvent(eventType string) string {
	switch eventType {
	case "task.completed":
		return "completed"
	case "task.failed":
		return "failed"
	case "task.cancelled":
		return "cancelled"
	case "task.question":
		return "question"
	default:
		return "running"
	}
}

func stringPayload(event types.BridgeEvent, key string) string {
	if event.Payload == nil {
		return ""
	}
	if v, ok := event.Payload[key].(string); ok {
		return v
	}
	return ""
}

func nullableString(v string) any {
	if v == "" {
		return nil
	}
	return v
}

func orEmptyPayload(p map[string]any) map[string]any {
	if p == nil {
		return map[string]any{}
	}
	return p
}
