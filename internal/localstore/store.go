// Package localstore is the Go port of src/main/localStore.ts.
//
// The store owns a SQLite database with three tables (tasks, task_events,
// artifacts) used to persist bridge events and generated artifacts. The
// modernc.org/sqlite driver is used (pure Go, no CGO) so the resulting binary
// stays cross-compile friendly across all desktop targets.
package localstore

import (
	"context"
	"crypto/sha1"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
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

// schemaV2 adds request_id storage to task_events. The new column is
// independent of payload_json (which preserves the raw bridge envelope) and
// is the canonical source for the minimal report flow's "give support a
// pointer to the server-side trace" need.
const schemaV2 = `
ALTER TABLE task_events ADD COLUMN request_id TEXT NOT NULL DEFAULT '';
`

const schemaV3 = `
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
ALTER TABLE tasks ADD COLUMN conversation_id TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN parent_task_id TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN workspace_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_tasks_workspace_updated ON tasks(workspace_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_tasks_conversation_updated ON tasks(conversation_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_conversations_workspace_updated ON conversations(workspace_id, updated_at);
`

const schemaV4 = `
CREATE INDEX IF NOT EXISTS idx_conversations_no_project_updated ON conversations(workspace_id, updated_at);
`

const schemaV5 = `
CREATE TABLE IF NOT EXISTS task_answers (
  task_id TEXT NOT NULL,
  question_group_id TEXT NOT NULL DEFAULT '',
  question_id TEXT NOT NULL,
  option_id TEXT NOT NULL DEFAULT '',
  answer TEXT NOT NULL,
  question_index INTEGER NOT NULL DEFAULT -1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(task_id, question_group_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_task_answers_task_order ON task_answers(task_id, question_index, updated_at);
`

const schemaV6 = `
CREATE TABLE IF NOT EXISTS recent_files (
  file_path TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  document_type TEXT NOT NULL,
  source TEXT NOT NULL,
  workspace_id TEXT NOT NULL DEFAULT '',
  task_id TEXT NOT NULL DEFAULT '',
  conversation_id TEXT NOT NULL DEFAULT '',
  last_opened_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recent_files_opened ON recent_files(last_opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_recent_files_workspace_opened ON recent_files(workspace_id, last_opened_at DESC);
`

// schemaV7 is the additive Document projection. The legacy tables remain the
// source of truth during the rollout; these tables make the projection
// durable and queryable without changing the old task/event APIs.
const schemaV7 = `
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  document_type TEXT NOT NULL,
  current_artifact_task_id TEXT,
  workspace_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  migration_source TEXT NOT NULL DEFAULT 'legacy'
);
CREATE INDEX IF NOT EXISTS idx_documents_workspace_updated ON documents(workspace_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  document_id TEXT,
  activity_stream_id TEXT NOT NULL,
  source_conversation_id TEXT NOT NULL,
  parent_run_id TEXT,
  status TEXT NOT NULL,
  document_type TEXT,
  source_file TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_document_updated ON runs(document_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_conversation_updated ON runs(source_conversation_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS activity_streams (
  id TEXT PRIMARY KEY,
  source_conversation_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  activity_stream_id TEXT NOT NULL,
  source_conversation_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  kind TEXT NOT NULL,
  event_id TEXT,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activities_stream_ordinal ON activities(activity_stream_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_activities_task_created ON activities(task_id, created_at);
CREATE TABLE IF NOT EXISTS document_activity_streams (
  document_id TEXT NOT NULL,
  activity_stream_id TEXT NOT NULL,
  PRIMARY KEY(document_id, activity_stream_id)
);
CREATE INDEX IF NOT EXISTS idx_document_activity_streams_stream ON document_activity_streams(activity_stream_id);
CREATE TABLE IF NOT EXISTS legacy_migrations (
  marker TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
`

// schemaV8 adds the immutable task creation timestamp used to order task
// history. Existing rows are backfilled from their earliest persisted event;
// tasks without events fall back to updated_at.
const schemaV8 = `
ALTER TABLE tasks ADD COLUMN created_at TEXT NOT NULL DEFAULT '';
UPDATE tasks
SET created_at = COALESCE(
  (SELECT MIN(created_at) FROM task_events WHERE task_events.task_id = tasks.id),
  updated_at
)
WHERE created_at = '';
CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC, id ASC);
`

// Store wraps a SQLite database used to persist bridge events and artifacts.
// Safe for concurrent use.
type Store struct {
	dbPath string

	mu sync.Mutex
	db *sql.DB
}

type Workspace struct {
	ID           string
	Path         string
	Name         string
	UpdatedAt    string
	LastActiveAt string
}

type TaskContext struct {
	WorkspaceID    string
	ConversationID string
	ParentTaskID   string
}

type TaskAnswer struct {
	QuestionGroupID string
	QuestionID      string
	OptionID        string
	Answer          string
	QuestionIndex   int
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
	if current < 2 {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("begin v2: %w", err)
		}
		if _, err := tx.ExecContext(ctx, schemaV2); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("v2 ddl: %w", err)
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (2, ?)`,
			time.Now().UTC().Format(time.RFC3339Nano),
		); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("v2 stamp: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "PRAGMA user_version = 2"); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("v2 set user_version: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("v2 commit: %w", err)
		}
	}
	if current < 3 {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("begin v3: %w", err)
		}
		if _, err := tx.ExecContext(ctx, schemaV3); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("v3 ddl: %w", err)
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (3, ?)`,
			time.Now().UTC().Format(time.RFC3339Nano),
		); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("v3 stamp: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "PRAGMA user_version = 3"); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("v3 set user_version: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("v3 commit: %w", err)
		}
	}
	if current < 4 {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("begin v4: %w", err)
		}
		if _, err := tx.ExecContext(ctx, schemaV4); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("v4 ddl: %w", err)
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (4, ?)`,
			time.Now().UTC().Format(time.RFC3339Nano),
		); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("v4 stamp: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "PRAGMA user_version = 4"); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("v4 set user_version: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("v4 commit: %w", err)
		}
	}
	if current < 5 {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("begin v5: %w", err)
		}
		if _, err := tx.ExecContext(ctx, schemaV5); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("v5 ddl: %w", err)
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (5, ?)`,
			time.Now().UTC().Format(time.RFC3339Nano),
		); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("v5 stamp: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "PRAGMA user_version = 5"); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("v5 set user_version: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("v5 commit: %w", err)
		}
	}
	if current < 6 {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("begin v6: %w", err)
		}
		if _, err := tx.ExecContext(ctx, schemaV6); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("v6 ddl: %w", err)
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (6, ?)`,
			time.Now().UTC().Format(time.RFC3339Nano),
		); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("v6 stamp: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "PRAGMA user_version = 6"); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("v6 set user_version: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("v6 commit: %w", err)
		}
	}
	if current < 7 {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("begin v7: %w", err)
		}
		if _, err := tx.ExecContext(ctx, schemaV7); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("v7 ddl: %w", err)
		}
		if err := backfillV7(ctx, tx); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("v7 backfill: %w", err)
		}
		if err := validateV7(ctx, tx); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("v7 validate: %w", err)
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT OR IGNORE INTO legacy_migrations(marker, applied_at) VALUES ('documents-v1', ?)`,
			time.Now().UTC().Format(time.RFC3339Nano),
		); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("v7 stamp: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "PRAGMA user_version = 7"); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("v7 set user_version: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("v7 commit: %w", err)
		}
	} else {
		// V7 is an additive projection over legacy tables. Reconcile it on every
		// open so documents and runs created after the original schema upgrade
		// become queryable on the next launch. backfillV7 is idempotent and does
		// not rewrite or delete legacy rows.
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("begin v7 reconcile: %w", err)
		}
		if err := backfillV7(ctx, tx); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("v7 reconcile: %w", err)
		}
		if err := validateV7(ctx, tx); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("v7 reconcile validate: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("v7 reconcile commit: %w", err)
		}
	}
	if current < 8 {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("begin v8: %w", err)
		}
		if _, err := tx.ExecContext(ctx, schemaV8); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("v8 ddl/backfill: %w", err)
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (8, ?)`,
			time.Now().UTC().Format(time.RFC3339Nano),
		); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("v8 stamp: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "PRAGMA user_version = 8"); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("v8 set user_version: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("v8 commit: %w", err)
		}
	}
	return nil
}

type legacyV7Task struct {
	id, status, documentType, conversationID, parentTaskID, workspaceID, updatedAt string
	sourceFile                                                                     string
}

type legacyV7Artifact struct {
	path, taskID, fileID, fileName, documentType, previewURL, editURL, syncedAt string
}

type legacyV7Event struct {
	storedID, taskID, conversationID, eventType, payload, createdAt string
}

func backfillV7(ctx context.Context, tx *sql.Tx) error {
	// activities is a fully derived projection of task_events. Rebuild it on
	// every reconcile so ordinal-based identities for events without a bridge
	// event ID cannot leave stale rows behind when later events change their
	// task-local position.
	if _, err := tx.ExecContext(ctx, `DELETE FROM activities`); err != nil {
		return fmt.Errorf("reset activities projection: %w", err)
	}
	tasks := map[string]legacyV7Task{}
	rows, err := tx.QueryContext(ctx, `SELECT id, status, COALESCE(document_type, ''), COALESCE(conversation_id, ''), COALESCE(parent_task_id, ''), COALESCE(workspace_id, ''), updated_at FROM tasks`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var task legacyV7Task
		if err := rows.Scan(&task.id, &task.status, &task.documentType, &task.conversationID, &task.parentTaskID, &task.workspaceID, &task.updatedAt); err != nil {
			rows.Close()
			return err
		}
		if strings.TrimSpace(task.conversationID) == "" {
			task.conversationID = task.id
		}
		tasks[task.id] = task
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()

	events := make([]legacyV7Event, 0)
	rows, err = tx.QueryContext(ctx, `SELECT event_id, task_id, type, payload_json, created_at FROM task_events ORDER BY created_at ASC, task_id ASC, event_id ASC`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var event legacyV7Event
		if err := rows.Scan(&event.storedID, &event.taskID, &event.eventType, &event.payload, &event.createdAt); err != nil {
			rows.Close()
			return err
		}
		task, ok := tasks[event.taskID]
		if ok {
			event.conversationID = task.conversationID
		} else {
			// Some early stores contain an event without its task row. Keep the
			// event in the additive activity projection rather than dropping it.
			event.conversationID = event.taskID
		}
		if ok && event.eventType == "task.user_input" && task.sourceFile == "" {
			var payload map[string]any
			if json.Unmarshal([]byte(event.payload), &payload) == nil {
				task.sourceFile = firstPayloadString(payload, "source_file", "sourceFile")
				tasks[event.taskID] = task
			}
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()

	artifacts := make([]legacyV7Artifact, 0)
	rows, err = tx.QueryContext(ctx, `SELECT file_path, COALESCE(task_id, ''), COALESCE(file_id, ''), file_name, document_type, COALESCE(preview_url, ''), COALESCE(edit_url, ''), synced_at FROM artifacts ORDER BY file_path ASC`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var artifact legacyV7Artifact
		if err := rows.Scan(&artifact.path, &artifact.taskID, &artifact.fileID, &artifact.fileName, &artifact.documentType, &artifact.previewURL, &artifact.editURL, &artifact.syncedAt); err != nil {
			rows.Close()
			return err
		}
		artifact.path = strings.TrimSpace(artifact.path)
		if artifact.path != "" {
			artifacts = append(artifacts, artifact)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()

	docByPath := map[string]string{}
	for _, artifact := range artifacts {
		id := documentIDForPath(artifact.path)
		docByPath[artifact.path] = id
		workspaceID, createdAt := "", artifact.syncedAt
		if task, ok := tasks[artifact.taskID]; ok {
			workspaceID = task.workspaceID
			if createdAt == "" {
				createdAt = task.updatedAt
			}
		}
		if createdAt == "" {
			createdAt = "1970-01-01T00:00:00Z"
		}
		updatedAt := artifact.syncedAt
		if updatedAt == "" {
			updatedAt = createdAt
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO documents(id, file_path, file_name, document_type, current_artifact_task_id, workspace_id, created_at, updated_at, migration_source) VALUES (?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), ?, ?, 'legacy') ON CONFLICT(id) DO UPDATE SET file_path=excluded.file_path, file_name=excluded.file_name, document_type=excluded.document_type, current_artifact_task_id=excluded.current_artifact_task_id, workspace_id=excluded.workspace_id, updated_at=excluded.updated_at`, id, artifact.path, artifact.fileName, artifact.documentType, artifact.taskID, workspaceID, createdAt, updatedAt); err != nil {
			return err
		}
	}

	// One stream exists for every legacy conversation represented by a task.
	// For streams with events, timestamps come exclusively from the historical
	// event rows; task timestamps are only a fallback for an empty stream.
	streamFirst := map[string]string{}
	streamLast := map[string]string{}
	streamEventCount := map[string]int{}
	for _, event := range events {
		if streamEventCount[event.conversationID] == 0 || event.createdAt < streamFirst[event.conversationID] {
			streamFirst[event.conversationID] = event.createdAt
		}
		if streamEventCount[event.conversationID] == 0 || event.createdAt > streamLast[event.conversationID] {
			streamLast[event.conversationID] = event.createdAt
		}
		streamEventCount[event.conversationID]++
	}
	for _, task := range tasks {
		if streamEventCount[task.conversationID] == 0 {
			if _, ok := streamFirst[task.conversationID]; !ok || task.updatedAt < streamFirst[task.conversationID] {
				streamFirst[task.conversationID] = task.updatedAt
			}
			if task.updatedAt > streamLast[task.conversationID] {
				streamLast[task.conversationID] = task.updatedAt
			}
		}
	}
	for conversationID, timestamp := range streamFirst {
		if timestamp == "" {
			timestamp = "1970-01-01T00:00:00Z"
		}
		updatedAt := streamLast[conversationID]
		if updatedAt == "" {
			updatedAt = timestamp
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO activity_streams(id, source_conversation_id, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at, updated_at=excluded.updated_at`, "activity:"+conversationID, conversationID, timestamp, updatedAt); err != nil {
			return err
		}
	}

	// Resolve each task to an artifact by direct output, source_file, parent
	// lineage, or a single unambiguous document in its conversation.
	taskDoc := map[string]string{}
	conversationDocs := map[string]map[string]bool{}
	for _, artifact := range artifacts {
		if task, ok := tasks[artifact.taskID]; ok {
			taskDoc[artifact.taskID] = docByPath[artifact.path]
			if conversationDocs[task.conversationID] == nil {
				conversationDocs[task.conversationID] = map[string]bool{}
			}
			conversationDocs[task.conversationID][docByPath[artifact.path]] = true
		}
	}
	for id, task := range tasks {
		if _, ok := taskDoc[id]; ok {
			continue
		}
		if source := strings.TrimSpace(task.sourceFile); source != "" {
			taskDoc[id] = docByPath[source]
		}
	}
	// Parent links can be encountered in either order in the legacy table, so
	// resolve them to a fixed point before applying the single-document
	// conversation fallback.
	for changed := true; changed; {
		changed = false
		for id, task := range tasks {
			if taskDoc[id] == "" && task.parentTaskID != "" && taskDoc[task.parentTaskID] != "" {
				taskDoc[id] = taskDoc[task.parentTaskID]
				changed = true
			}
		}
	}
	for id, task := range tasks {
		if taskDoc[id] == "" && len(conversationDocs[task.conversationID]) == 1 {
			for docID := range conversationDocs[task.conversationID] {
				taskDoc[id] = docID
			}
		}
	}
	// A source-only Run can be the only bridge between a conversation and a
	// Document. Propagate that association before materializing other Runs so
	// their single-document fallback and stream links are deterministic.
	for id, documentID := range taskDoc {
		if documentID == "" {
			continue
		}
		conversationID := tasks[id].conversationID
		if conversationDocs[conversationID] == nil {
			conversationDocs[conversationID] = map[string]bool{}
		}
		conversationDocs[conversationID][documentID] = true
	}
	for id, task := range tasks {
		if taskDoc[id] == "" && len(conversationDocs[task.conversationID]) == 1 {
			for documentID := range conversationDocs[task.conversationID] {
				taskDoc[id] = documentID
			}
		}
	}
	documentLatestRun := map[string]string{}
	for id, task := range tasks {
		var documentID any
		if taskDoc[id] != "" {
			documentID = taskDoc[id]
		}
		var sourceFile any
		if strings.TrimSpace(task.sourceFile) != "" {
			sourceFile = strings.TrimSpace(task.sourceFile)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO runs(id, document_id, activity_stream_id, source_conversation_id, parent_run_id, status, document_type, source_file, created_at, updated_at) VALUES (?, ?, ?, ?, NULLIF(?, ''), ?, NULLIF(?, ''), ?, ?, ?) ON CONFLICT(id) DO UPDATE SET document_id=excluded.document_id, activity_stream_id=excluded.activity_stream_id, source_conversation_id=excluded.source_conversation_id, parent_run_id=excluded.parent_run_id, status=excluded.status, document_type=excluded.document_type, source_file=excluded.source_file, updated_at=excluded.updated_at`, id, documentID, "activity:"+task.conversationID, task.conversationID, task.parentTaskID, task.status, task.documentType, sourceFile, task.updatedAt, task.updatedAt); err != nil {
			return err
		}
		if documentIDString, ok := documentID.(string); ok && documentIDString != "" && task.updatedAt > documentLatestRun[documentIDString] {
			documentLatestRun[documentIDString] = task.updatedAt
		}
	}
	for documentID, updatedAt := range documentLatestRun {
		if _, err := tx.ExecContext(ctx, `UPDATE documents SET updated_at = CASE WHEN updated_at < ? THEN ? ELSE updated_at END WHERE id = ?`, updatedAt, updatedAt, documentID); err != nil {
			return err
		}
	}

	// Event order is deterministic from persisted historical fields only.
	sort.SliceStable(events, func(i, j int) bool {
		if events[i].conversationID != events[j].conversationID {
			return events[i].conversationID < events[j].conversationID
		}
		if events[i].createdAt != events[j].createdAt {
			return events[i].createdAt < events[j].createdAt
		}
		if events[i].taskID != events[j].taskID {
			return events[i].taskID < events[j].taskID
		}
		return events[i].storedID < events[j].storedID
	})
	streamOrdinal := map[string]int{}
	taskEventIndex := map[string]int{}
	for _, event := range events {
		streamID := "activity:" + event.conversationID
		ordinal := streamOrdinal[event.conversationID]
		streamOrdinal[event.conversationID] = ordinal + 1
		originalID := migratedOriginalEventID(event.taskID, event.storedID, event.eventType)
		activityID := event.taskID + ":" + originalID
		if strings.TrimSpace(originalID) == "" {
			eventIndex := taskEventIndex[event.taskID]
			activityID = fmt.Sprintf("%s:event:%d:%s", event.taskID, eventIndex, event.eventType)
		}
		taskEventIndex[event.taskID]++
		kind := "event"
		if event.eventType == "task.user_input" {
			kind = "user_input"
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO activities(id, activity_stream_id, source_conversation_id, task_id, ordinal, kind, event_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, NULLIF(?, ''), ?, ?, ?) ON CONFLICT(id) DO UPDATE SET activity_stream_id=excluded.activity_stream_id, source_conversation_id=excluded.source_conversation_id, task_id=excluded.task_id, ordinal=excluded.ordinal, kind=excluded.kind, event_id=excluded.event_id, event_type=excluded.event_type, payload_json=excluded.payload_json, created_at=excluded.created_at`, activityID, streamID, event.conversationID, event.taskID, ordinal, kind, originalID, event.eventType, event.payload, event.createdAt); err != nil {
			return err
		}
	}
	for taskID, documentID := range taskDoc {
		if documentID == "" {
			continue
		}
		conversationID := tasks[taskID].conversationID
		if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO document_activity_streams(document_id, activity_stream_id) VALUES (?, ?)`, documentID, "activity:"+conversationID); err != nil {
			return err
		}
	}
	return nil
}

func validateV7(ctx context.Context, tx *sql.Tx) error {
	var expected, actual int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(DISTINCT TRIM(file_path)) FROM artifacts WHERE TRIM(file_path) != ''`).Scan(&expected); err != nil {
		return err
	}
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM documents`).Scan(&actual); err != nil {
		return err
	}
	if expected != actual {
		return fmt.Errorf("documents count %d != artifacts %d", actual, expected)
	}
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM tasks`).Scan(&expected); err != nil {
		return err
	}
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM runs`).Scan(&actual); err != nil {
		return err
	}
	if expected != actual {
		return fmt.Errorf("runs count %d != tasks %d", actual, expected)
	}
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM task_events`).Scan(&expected); err != nil {
		return err
	}
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM activities`).Scan(&actual); err != nil {
		return err
	}
	if expected != actual {
		return fmt.Errorf("activities count %d != task_events %d", actual, expected)
	}
	var dangling int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM runs r LEFT JOIN documents d ON d.id = r.document_id WHERE r.document_id IS NOT NULL AND d.id IS NULL`).Scan(&dangling); err != nil {
		return err
	}
	if dangling != 0 {
		return fmt.Errorf("%d runs reference missing documents", dangling)
	}
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM activities a LEFT JOIN activity_streams s ON s.id = a.activity_stream_id WHERE s.id IS NULL`).Scan(&dangling); err != nil {
		return err
	}
	if dangling != 0 {
		return fmt.Errorf("%d activities reference missing streams", dangling)
	}
	return nil
}

func documentIDForPath(path string) string {
	return "document:" + url.PathEscape(strings.TrimSpace(path))
}

func migratedOriginalEventID(taskID, storedID, eventType string) string {
	storedID = strings.TrimSpace(storedID)
	if storedID == "" {
		return ""
	}
	originalID := originalEventID(taskID, storedID)
	// RecordEvent synthesizes task:type:timestamp when the bridge omitted an
	// event ID. Recognize that durable legacy form so V7 emits the contract's
	// ordinal-based ID rather than baking wall-clock text into the identity.
	prefix := taskID + ":" + eventType + ":"
	if strings.HasPrefix(storedID, prefix) {
		if _, err := time.Parse(time.RFC3339Nano, strings.TrimPrefix(storedID, prefix)); err == nil {
			return ""
		}
	}
	// Current legacy writes use a payload hash to make an omitted bridge event
	// idempotent. That storage key is not the bridge's original event ID; the
	// Document contract still uses the task-local ordinal fallback.
	if strings.HasPrefix(storedID, taskID+":generated:") {
		return ""
	}
	return originalID
}

func firstPayloadString(payload map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := payload[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

// ensureConversationTx is the transaction-scoped counterpart of
// ensureConversationLocked. Projection writes must commit (or roll back) with
// the legacy task write, so they cannot use the Store's db handle here.
func ensureConversationTx(ctx context.Context, tx *sql.Tx, workspaceID, conversationID, title string) error {
	workspaceID = strings.TrimSpace(workspaceID)
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return nil
	}
	title = strings.TrimSpace(title)
	if title == "" {
		title = conversationID
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO conversations(id, workspace_id, title, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
		   workspace_id=excluded.workspace_id,
		   title=CASE WHEN conversations.title = conversations.id OR conversations.title = '' THEN excluded.title ELSE conversations.title END,
		   updated_at=excluded.updated_at`, conversationID, workspaceID, title, now, now,
	); err != nil {
		return fmt.Errorf("localstore: ensure conversation: %w", err)
	}
	if workspaceID != "" {
		if _, err := tx.ExecContext(ctx, `UPDATE workspaces SET updated_at = ? WHERE id = ?`, now, workspaceID); err != nil {
			return fmt.Errorf("localstore: touch workspace: %w", err)
		}
	}
	return nil
}

type liveProjectionTask struct {
	id, status, documentType, conversationID, parentTaskID, workspaceID, updatedAt, sourceFile string
}

type liveProjectionArtifact struct {
	path, taskID, fileName, documentType, syncedAt string
}

type liveProjectionEvent struct {
	storedID, taskID, conversationID, eventType, payload, createdAt string
}

// projectTaskTx refreshes only the affected activity stream and its related
// tasks/documents. It intentionally does not scan unrelated conversations or
// rebuild the whole V7 projection on every legacy write.
func projectTaskTx(ctx context.Context, tx *sql.Tx, taskID string) error {
	var seed liveProjectionTask
	err := tx.QueryRowContext(ctx, `SELECT id, status, COALESCE(document_type, ''), COALESCE(conversation_id, ''), COALESCE(parent_task_id, ''), COALESCE(workspace_id, ''), updated_at FROM tasks WHERE id = ?`, taskID).
		Scan(&seed.id, &seed.status, &seed.documentType, &seed.conversationID, &seed.parentTaskID, &seed.workspaceID, &seed.updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if seed.conversationID == "" {
		seed.conversationID = seed.id
	}

	tasks := map[string]liveProjectionTask{}
	rows, err := tx.QueryContext(ctx, `SELECT id, status, COALESCE(document_type, ''), COALESCE(conversation_id, ''), COALESCE(parent_task_id, ''), COALESCE(workspace_id, ''), updated_at FROM tasks WHERE COALESCE(NULLIF(conversation_id, ''), id) = ?`, seed.conversationID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var task liveProjectionTask
		if err := rows.Scan(&task.id, &task.status, &task.documentType, &task.conversationID, &task.parentTaskID, &task.workspaceID, &task.updatedAt); err != nil {
			rows.Close()
			return err
		}
		if task.conversationID == "" {
			task.conversationID = task.id
		}
		tasks[task.id] = task
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	if _, ok := tasks[seed.id]; !ok {
		tasks[seed.id] = seed
	}

	artifacts := map[string]liveProjectionArtifact{}
	rows, err = tx.QueryContext(ctx, `SELECT a.file_path, COALESCE(a.task_id, ''), a.file_name, a.document_type, a.synced_at FROM artifacts a LEFT JOIN tasks t ON t.id = a.task_id WHERE TRIM(a.file_path) != '' AND COALESCE(NULLIF(t.conversation_id, ''), t.id) = ?`, seed.conversationID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var artifact liveProjectionArtifact
		if err := rows.Scan(&artifact.path, &artifact.taskID, &artifact.fileName, &artifact.documentType, &artifact.syncedAt); err != nil {
			rows.Close()
			return err
		}
		artifacts[artifact.path] = artifact
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()

	// Recover source_file from the legacy user-input event for each task.
	for id, task := range tasks {
		var payload string
		if err := tx.QueryRowContext(ctx, `SELECT payload_json FROM task_events WHERE task_id = ? AND type = 'task.user_input' ORDER BY created_at ASC, event_id ASC LIMIT 1`, id).Scan(&payload); err == nil {
			var decoded map[string]any
			if json.Unmarshal([]byte(payload), &decoded) == nil {
				task.sourceFile = firstPayloadString(decoded, "source_file", "sourceFile")
			}
		}
		tasks[id] = task
	}

	// Materialize/update documents for artifacts in this stream's conversation.
	docByPath := map[string]string{}
	conversationDocs := map[string]bool{}
	for path, artifact := range artifacts {
		task, ok := tasks[artifact.taskID]
		if !ok {
			continue
		}
		docID := documentIDForPath(path)
		docByPath[path] = docID
		conversationDocs[docID] = true
		createdAt := artifact.syncedAt
		if createdAt == "" {
			createdAt = task.updatedAt
		}
		if createdAt == "" {
			createdAt = "1970-01-01T00:00:00Z"
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO documents(id, file_path, file_name, document_type, current_artifact_task_id, workspace_id, created_at, updated_at, migration_source) VALUES (?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), ?, ?, 'legacy') ON CONFLICT(id) DO UPDATE SET file_name=excluded.file_name, document_type=excluded.document_type, current_artifact_task_id=excluded.current_artifact_task_id, workspace_id=excluded.workspace_id, updated_at=excluded.updated_at`, docID, path, artifact.fileName, artifact.documentType, artifact.taskID, task.workspaceID, createdAt, createdAt); err != nil {
			return err
		}
	}

	taskDoc := map[string]string{}
	for id, task := range tasks {
		for path, artifact := range artifacts {
			if artifact.taskID == id {
				taskDoc[id] = docByPath[path]
				break
			}
		}
		if taskDoc[id] == "" && task.sourceFile != "" {
			if localDocumentID := docByPath[task.sourceFile]; localDocumentID != "" {
				taskDoc[id] = localDocumentID
			} else {
				var resolvedDocumentID string
				_ = tx.QueryRowContext(ctx, `SELECT id FROM documents WHERE file_path = ?`, task.sourceFile).Scan(&resolvedDocumentID)
				taskDoc[id] = resolvedDocumentID
			}
			if taskDoc[id] != "" {
				conversationDocs[taskDoc[id]] = true
			}
		}
		if taskDoc[id] == "" && task.parentTaskID != "" {
			var resolvedDocumentID string
			_ = tx.QueryRowContext(ctx, `SELECT COALESCE(document_id, '') FROM runs WHERE id = ?`, task.parentTaskID).Scan(&resolvedDocumentID)
			taskDoc[id] = resolvedDocumentID
			if taskDoc[id] != "" {
				conversationDocs[taskDoc[id]] = true
			}
		}
	}
	for changed := true; changed; {
		changed = false
		for id, task := range tasks {
			if taskDoc[id] == "" && task.parentTaskID != "" && taskDoc[task.parentTaskID] != "" {
				taskDoc[id] = taskDoc[task.parentTaskID]
				changed = true
			}
		}
	}
	if len(conversationDocs) == 1 {
		for id := range tasks {
			if taskDoc[id] == "" {
				for docID := range conversationDocs {
					taskDoc[id] = docID
				}
			}
		}
	}

	// Stream timestamps are derived from this conversation only.
	var streamCreated, streamUpdated string
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MIN(e.created_at), ''), COALESCE(MAX(e.created_at), '') FROM task_events e JOIN tasks t ON t.id = e.task_id WHERE COALESCE(NULLIF(t.conversation_id, ''), t.id) = ?`, seed.conversationID).Scan(&streamCreated, &streamUpdated); err != nil {
		return err
	}
	if streamCreated == "" {
		streamCreated = seed.updatedAt
		streamUpdated = seed.updatedAt
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO activity_streams(id, source_conversation_id, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at, updated_at=excluded.updated_at`, "activity:"+seed.conversationID, seed.conversationID, streamCreated, streamUpdated); err != nil {
		return err
	}

	// Runs for the affected stream are cheap to refresh and keep source-only
	// runs visible as soon as their context/event arrives.
	documentLatest := map[string]string{}
	for id, task := range tasks {
		var sourceFile any
		if task.sourceFile != "" {
			sourceFile = task.sourceFile
		}
		var documentID any
		if taskDoc[id] != "" {
			documentID = taskDoc[id]
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO runs(id, document_id, activity_stream_id, source_conversation_id, parent_run_id, status, document_type, source_file, created_at, updated_at) VALUES (?, ?, ?, ?, NULLIF(?, ''), ?, NULLIF(?, ''), ?, ?, ?) ON CONFLICT(id) DO UPDATE SET document_id=excluded.document_id, activity_stream_id=excluded.activity_stream_id, source_conversation_id=excluded.source_conversation_id, parent_run_id=excluded.parent_run_id, status=excluded.status, document_type=excluded.document_type, source_file=excluded.source_file, updated_at=excluded.updated_at`, id, documentID, "activity:"+seed.conversationID, seed.conversationID, task.parentTaskID, task.status, task.documentType, sourceFile, task.updatedAt, task.updatedAt); err != nil {
			return err
		}
		if taskDoc[id] != "" {
			if task.updatedAt > documentLatest[taskDoc[id]] {
				documentLatest[taskDoc[id]] = task.updatedAt
			}
			if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO document_activity_streams(document_id, activity_stream_id) VALUES (?, ?)`, taskDoc[id], "activity:"+seed.conversationID); err != nil {
				return err
			}
		}
	}
	for documentID, updatedAt := range documentLatest {
		if _, err := tx.ExecContext(ctx, `UPDATE documents SET updated_at = CASE WHEN updated_at < ? THEN ? ELSE updated_at END WHERE id = ?`, updatedAt, updatedAt, documentID); err != nil {
			return err
		}
	}

	// Recompute ordinals only within the affected stream. Ordering includes the
	// legacy task-local event id, making missing bridge IDs deterministic.
	if _, err := tx.ExecContext(ctx, `DELETE FROM activities WHERE activity_stream_id = ?`, "activity:"+seed.conversationID); err != nil {
		return fmt.Errorf("reset stream activities projection: %w", err)
	}
	var events []liveProjectionEvent
	rows, err = tx.QueryContext(ctx, `SELECT e.event_id, e.task_id, e.type, e.payload_json, e.created_at FROM task_events e JOIN tasks t ON t.id = e.task_id WHERE COALESCE(NULLIF(t.conversation_id, ''), t.id) = ? ORDER BY e.created_at ASC, e.task_id ASC, e.event_id ASC`, seed.conversationID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var event liveProjectionEvent
		if err := rows.Scan(&event.storedID, &event.taskID, &event.eventType, &event.payload, &event.createdAt); err != nil {
			rows.Close()
			return err
		}
		event.conversationID = seed.conversationID
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	taskEventIndex := map[string]int{}
	for ordinal, event := range events {
		originalID := migratedOriginalEventID(event.taskID, event.storedID, event.eventType)
		activityID := event.taskID + ":" + originalID
		if originalID == "" {
			activityID = fmt.Sprintf("%s:event:%d:%s", event.taskID, taskEventIndex[event.taskID], event.eventType)
		}
		taskEventIndex[event.taskID]++
		kind := "event"
		if event.eventType == "task.user_input" {
			kind = "user_input"
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO activities(id, activity_stream_id, source_conversation_id, task_id, ordinal, kind, event_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, NULLIF(?, ''), ?, ?, ?) ON CONFLICT(id) DO UPDATE SET activity_stream_id=excluded.activity_stream_id, source_conversation_id=excluded.source_conversation_id, task_id=excluded.task_id, ordinal=excluded.ordinal, kind=excluded.kind, event_id=excluded.event_id, event_type=excluded.event_type, payload_json=excluded.payload_json, created_at=excluded.created_at`, activityID, "activity:"+seed.conversationID, seed.conversationID, event.taskID, ordinal, kind, originalID, event.eventType, event.payload, event.createdAt); err != nil {
			return err
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

func (s *Store) EnsureWorkspace(ctx context.Context, workspacePath string) (Workspace, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return Workspace{}, fmt.Errorf("localstore: not open")
	}
	path := filepath.Clean(strings.TrimSpace(workspacePath))
	if path == "." || path == "" {
		return Workspace{}, fmt.Errorf("localstore: workspace path is empty")
	}
	id := workspaceID(path)
	name := filepath.Base(path)
	if strings.TrimSpace(name) == "" || name == string(filepath.Separator) {
		name = "Workspace"
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO workspaces(id, path, name, created_at, updated_at, last_active_at)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
		   path=excluded.path,
		   name=excluded.name,
		   updated_at=excluded.updated_at`,
		id, path, name, now, now, now,
	); err != nil {
		return Workspace{}, fmt.Errorf("localstore: ensure workspace: %w", err)
	}
	return Workspace{ID: id, Path: path, Name: name, UpdatedAt: now, LastActiveAt: now}, nil
}

func (s *Store) RenameWorkspace(ctx context.Context, workspaceID, name string) (Workspace, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return Workspace{}, fmt.Errorf("localstore: not open")
	}
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" {
		return Workspace{}, fmt.Errorf("localstore: workspace id is empty")
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return Workspace{}, fmt.Errorf("localstore: workspace name is empty")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	result, err := s.db.ExecContext(ctx,
		`UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ?`, name, now, workspaceID,
	)
	if err != nil {
		return Workspace{}, fmt.Errorf("localstore: rename workspace: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return Workspace{}, fmt.Errorf("localstore: rename workspace rows affected: %w", err)
	}
	if rows == 0 {
		return Workspace{}, fmt.Errorf("localstore: workspace not found")
	}
	return s.queryWorkspaceLocked(ctx, workspaceID)
}

func (s *Store) UpsertRecentFile(ctx context.Context, file types.RecentFile) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return fmt.Errorf("localstore: not open")
	}
	filePath := filepath.Clean(strings.TrimSpace(file.FilePath))
	if filePath == "." || filePath == "" || !filepath.IsAbs(filePath) {
		return fmt.Errorf("localstore: recent file path must be absolute")
	}
	fileName := strings.TrimSpace(file.FileName)
	if fileName == "" {
		return fmt.Errorf("localstore: recent file name is empty")
	}
	source := strings.TrimSpace(file.Source)
	if source != "generated" && source != "local" {
		return fmt.Errorf("localstore: recent file source must be generated or local")
	}
	lastOpenedAt := strings.TrimSpace(file.LastOpenedAt)
	if lastOpenedAt == "" {
		lastOpenedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO recent_files(file_path, file_name, document_type, source, workspace_id, task_id, conversation_id, last_opened_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(file_path) DO UPDATE SET
		   file_name=excluded.file_name,
		   document_type=excluded.document_type,
		   source=excluded.source,
		   workspace_id=excluded.workspace_id,
		   task_id=excluded.task_id,
		   conversation_id=excluded.conversation_id,
		   last_opened_at=excluded.last_opened_at`,
		filePath, fileName, strings.TrimSpace(file.DocumentType), source,
		strings.TrimSpace(file.WorkspaceID), strings.TrimSpace(file.TaskID),
		strings.TrimSpace(file.ConversationID), lastOpenedAt,
	); err != nil {
		return fmt.Errorf("localstore: upsert recent file: %w", err)
	}
	return nil
}

func (s *Store) QueryRecentFiles(ctx context.Context, workspaceID string, limit int) ([]types.RecentFile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return nil, fmt.Errorf("localstore: not open")
	}
	if limit <= 0 {
		limit = 50
	}
	workspaceID = strings.TrimSpace(workspaceID)
	query := `SELECT file_path, file_name, document_type, source, workspace_id, task_id, conversation_id, last_opened_at
		FROM recent_files`
	args := []any{}
	if workspaceID != "" {
		query += ` WHERE workspace_id = ?`
		args = append(args, workspaceID)
	}
	query += ` ORDER BY last_opened_at DESC, file_path ASC LIMIT ?`
	args = append(args, limit)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("localstore: query recent files: %w", err)
	}
	defer rows.Close()
	out := make([]types.RecentFile, 0)
	for rows.Next() {
		var file types.RecentFile
		if err := rows.Scan(
			&file.FilePath, &file.FileName, &file.DocumentType, &file.Source,
			&file.WorkspaceID, &file.TaskID, &file.ConversationID, &file.LastOpenedAt,
		); err != nil {
			return nil, fmt.Errorf("localstore: scan recent file: %w", err)
		}
		out = append(out, file)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("localstore: iterate recent files: %w", err)
	}
	return out, nil
}

func (s *Store) RemoveRecentFile(ctx context.Context, filePath string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return fmt.Errorf("localstore: not open")
	}
	filePath = filepath.Clean(strings.TrimSpace(filePath))
	if filePath == "." || filePath == "" || !filepath.IsAbs(filePath) {
		return fmt.Errorf("localstore: recent file path must be absolute")
	}
	if _, err := s.db.ExecContext(ctx, `DELETE FROM recent_files WHERE file_path = ?`, filePath); err != nil {
		return fmt.Errorf("localstore: remove recent file: %w", err)
	}
	return nil
}

// RemoveDocumentByTaskID deletes the local metadata for the document lineage
// containing taskID. Generated files are never removed from disk.
func (s *Store) RemoveDocumentByTaskID(ctx context.Context, taskID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return fmt.Errorf("localstore: not open")
	}
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return fmt.Errorf("localstore: task id is empty")
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("localstore: begin remove document: %w", err)
	}
	rollback := func(err error) error {
		_ = tx.Rollback()
		return err
	}

	var conversationID string
	if err := tx.QueryRowContext(ctx,
		`SELECT COALESCE(NULLIF(conversation_id, ''), id) FROM tasks WHERE id = ?`, taskID,
	).Scan(&conversationID); errors.Is(err, sql.ErrNoRows) {
		_ = tx.Rollback()
		return nil
	} else if err != nil {
		return rollback(fmt.Errorf("localstore: resolve document lineage: %w", err))
	}

	var pendingTasks int
	if err := tx.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM tasks WHERE COALESCE(NULLIF(conversation_id, ''), id) = ? AND status IN ('starting', 'running', 'question', 'plan_review')`,
		conversationID,
	).Scan(&pendingTasks); err != nil {
		return rollback(fmt.Errorf("localstore: check pending document tasks: %w", err))
	}
	if pendingTasks > 0 {
		return rollback(fmt.Errorf("localstore: document has running tasks"))
	}

	rows, err := tx.QueryContext(ctx,
		`SELECT id FROM tasks WHERE COALESCE(NULLIF(conversation_id, ''), id) = ?`, conversationID,
	)
	if err != nil {
		return rollback(fmt.Errorf("localstore: query document tasks: %w", err))
	}
	var taskIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			_ = rows.Close()
			return rollback(fmt.Errorf("localstore: scan document task: %w", err))
		}
		taskIDs = append(taskIDs, id)
	}
	if err := rows.Close(); err != nil {
		return rollback(fmt.Errorf("localstore: close document tasks: %w", err))
	}

	artifactPaths := make([]string, 0)
	for _, id := range taskIDs {
		artifactRows, err := tx.QueryContext(ctx, `SELECT file_path FROM artifacts WHERE task_id = ?`, id)
		if err != nil {
			return rollback(fmt.Errorf("localstore: query document artifacts: %w", err))
		}
		for artifactRows.Next() {
			var path string
			if err := artifactRows.Scan(&path); err != nil {
				_ = artifactRows.Close()
				return rollback(fmt.Errorf("localstore: scan document artifact: %w", err))
			}
			artifactPaths = append(artifactPaths, path)
		}
		if err := artifactRows.Close(); err != nil {
			return rollback(fmt.Errorf("localstore: close document artifacts: %w", err))
		}
	}

	streamID := "activity:" + conversationID
	if _, err := tx.ExecContext(ctx, `DELETE FROM document_activity_streams WHERE activity_stream_id = ?`, streamID); err != nil {
		return rollback(fmt.Errorf("localstore: remove document activity links: %w", err))
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM activities WHERE source_conversation_id = ?`, conversationID); err != nil {
		return rollback(fmt.Errorf("localstore: remove document activities: %w", err))
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM runs WHERE source_conversation_id = ?`, conversationID); err != nil {
		return rollback(fmt.Errorf("localstore: remove document runs: %w", err))
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM activity_streams WHERE source_conversation_id = ?`, conversationID); err != nil {
		return rollback(fmt.Errorf("localstore: remove document activity stream: %w", err))
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM recent_files WHERE conversation_id = ?`, conversationID); err != nil {
		return rollback(fmt.Errorf("localstore: remove document recent files: %w", err))
	}

	for _, id := range taskIDs {
		if _, err := tx.ExecContext(ctx, `DELETE FROM recent_files WHERE task_id = ?`, id); err != nil {
			return rollback(fmt.Errorf("localstore: remove task recent files: %w", err))
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM task_answers WHERE task_id = ?`, id); err != nil {
			return rollback(fmt.Errorf("localstore: remove document answers: %w", err))
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM task_events WHERE task_id = ?`, id); err != nil {
			return rollback(fmt.Errorf("localstore: remove document events: %w", err))
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM task_credit_records WHERE task_id = ?`, id); err != nil {
			return rollback(fmt.Errorf("localstore: remove document credit records: %w", err))
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM document_activity_streams WHERE document_id IN (SELECT id FROM documents WHERE current_artifact_task_id = ?)`, id); err != nil {
			return rollback(fmt.Errorf("localstore: remove projected document links: %w", err))
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM documents WHERE current_artifact_task_id = ?`, id); err != nil {
			return rollback(fmt.Errorf("localstore: remove projected document: %w", err))
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM artifacts WHERE task_id = ?`, id); err != nil {
			return rollback(fmt.Errorf("localstore: remove document artifacts: %w", err))
		}
	}
	for _, path := range artifactPaths {
		if _, err := tx.ExecContext(ctx, `DELETE FROM recent_files WHERE file_path = ?`, path); err != nil {
			return rollback(fmt.Errorf("localstore: remove artifact recent file: %w", err))
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM document_activity_streams WHERE document_id IN (SELECT id FROM documents WHERE file_path = ?)`, path); err != nil {
			return rollback(fmt.Errorf("localstore: remove artifact document links: %w", err))
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM documents WHERE file_path = ?`, path); err != nil {
			return rollback(fmt.Errorf("localstore: remove artifact document: %w", err))
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM tasks WHERE COALESCE(NULLIF(conversation_id, ''), id) = ?`, conversationID); err != nil {
		return rollback(fmt.Errorf("localstore: remove document tasks: %w", err))
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM conversations WHERE id = ?`, conversationID); err != nil {
		return rollback(fmt.Errorf("localstore: remove document conversation metadata: %w", err))
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("localstore: commit remove document: %w", err)
	}
	return nil
}

func (s *Store) RemoveWorkspace(ctx context.Context, workspaceID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return fmt.Errorf("localstore: not open")
	}
	return s.removeWorkspaceLocked(ctx, strings.TrimSpace(workspaceID), true)
}

func (s *Store) RemoveWorkspaceByPath(ctx context.Context, workspacePath string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return false, fmt.Errorf("localstore: not open")
	}
	path := filepath.Clean(strings.TrimSpace(workspacePath))
	if path == "." || path == "" {
		return false, fmt.Errorf("localstore: workspace path is empty")
	}
	var id string
	err := s.db.QueryRowContext(ctx, `SELECT id FROM workspaces WHERE path = ?`, path).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("localstore: query workspace by path: %w", err)
	}
	if err := s.removeWorkspaceLocked(ctx, id, false); err != nil {
		return false, err
	}
	return true, nil
}

func (s *Store) ClearActiveWorkspace(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return fmt.Errorf("localstore: not open")
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE workspaces SET last_active_at = ''`); err != nil {
		return fmt.Errorf("localstore: clear active workspace: %w", err)
	}
	return nil
}

func (s *Store) ActivateWorkspace(ctx context.Context, workspaceID string) (Workspace, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return Workspace{}, fmt.Errorf("localstore: not open")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	res, err := s.db.ExecContext(ctx,
		`UPDATE workspaces SET last_active_at = ?, updated_at = ? WHERE id = ?`,
		now, now, workspaceID,
	)
	if err != nil {
		return Workspace{}, fmt.Errorf("localstore: activate workspace: %w", err)
	}
	if rows, _ := res.RowsAffected(); rows == 0 {
		return Workspace{}, fmt.Errorf("localstore: workspace not found")
	}
	return s.queryWorkspaceLocked(ctx, workspaceID)
}

func (s *Store) Workspace(ctx context.Context, workspaceID string) (Workspace, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return Workspace{}, fmt.Errorf("localstore: not open")
	}
	return s.queryWorkspaceLocked(ctx, workspaceID)
}

func (s *Store) ActiveWorkspace(ctx context.Context) (Workspace, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return Workspace{}, fmt.Errorf("localstore: not open")
	}
	var id string
	err := s.db.QueryRowContext(ctx,
		`SELECT id FROM workspaces WHERE last_active_at != '' ORDER BY last_active_at DESC, updated_at DESC LIMIT 1`,
	).Scan(&id)
	if err != nil {
		return Workspace{}, err
	}
	return s.queryWorkspaceLocked(ctx, id)
}

func (s *Store) EnsureConversation(ctx context.Context, workspaceID, conversationID, title string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.ensureConversationLocked(ctx, workspaceID, conversationID, title)
}

func (s *Store) RecordTaskContext(ctx context.Context, taskID string, taskCtx TaskContext) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return fmt.Errorf("localstore: not open")
	}
	if strings.TrimSpace(taskID) == "" {
		return nil
	}
	conversationID := strings.TrimSpace(taskCtx.ConversationID)
	if conversationID == "" {
		conversationID = taskID
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("localstore: begin record task context: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO tasks(id, status, document_type, topic, updated_at, created_at, conversation_id, parent_task_id, workspace_id)
		 VALUES (?, 'starting', NULL, NULL, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
		   conversation_id = CASE WHEN excluded.conversation_id != '' THEN excluded.conversation_id ELSE tasks.conversation_id END,
		   parent_task_id = CASE WHEN excluded.parent_task_id != '' THEN excluded.parent_task_id ELSE tasks.parent_task_id END,
		   workspace_id = CASE WHEN excluded.workspace_id != '' THEN excluded.workspace_id ELSE tasks.workspace_id END,
		   updated_at = excluded.updated_at`,
		taskID, now, now, conversationID, strings.TrimSpace(taskCtx.ParentTaskID), strings.TrimSpace(taskCtx.WorkspaceID),
	); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("localstore: record task context: %w", err)
	}
	if taskCtx.WorkspaceID != "" {
		if err := ensureConversationTx(ctx, tx, taskCtx.WorkspaceID, conversationID, taskID); err != nil {
			_ = tx.Rollback()
			return err
		}
	}
	if err := projectTaskTx(ctx, tx, taskID); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("localstore: project task context: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("localstore: commit record task context: %w", err)
	}
	return nil
}

func (s *Store) TaskContext(ctx context.Context, taskID string) (TaskContext, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return TaskContext{}, false, fmt.Errorf("localstore: not open")
	}
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return TaskContext{}, false, nil
	}
	var out TaskContext
	err := s.db.QueryRowContext(ctx,
		`SELECT workspace_id, conversation_id, parent_task_id FROM tasks WHERE id = ?`,
		taskID,
	).Scan(&out.WorkspaceID, &out.ConversationID, &out.ParentTaskID)
	if errors.Is(err, sql.ErrNoRows) {
		return TaskContext{}, false, nil
	}
	if err != nil {
		return TaskContext{}, false, fmt.Errorf("localstore: query task context: %w", err)
	}
	return out, true, nil
}

func (s *Store) TaskWorkspacePath(ctx context.Context, taskID string) (string, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return "", false, fmt.Errorf("localstore: not open")
	}
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return "", false, nil
	}
	var workspaceID string
	err := s.db.QueryRowContext(ctx, `SELECT workspace_id FROM tasks WHERE id = ?`, taskID).Scan(&workspaceID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("localstore: query task workspace: %w", err)
	}
	if strings.TrimSpace(workspaceID) == "" {
		return "", true, nil
	}
	var path string
	err = s.db.QueryRowContext(ctx, `SELECT path FROM workspaces WHERE id = ?`, workspaceID).Scan(&path)
	if errors.Is(err, sql.ErrNoRows) {
		return "", true, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("localstore: query task workspace path: %w", err)
	}
	return path, true, nil
}

func (s *Store) RecordTaskAnswers(ctx context.Context, taskID string, answers []TaskAnswer) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return fmt.Errorf("localstore: not open")
	}
	taskID = strings.TrimSpace(taskID)
	if taskID == "" || len(answers) == 0 {
		return nil
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("localstore: begin record task answers: %w", err)
	}
	for _, item := range answers {
		questionID := strings.TrimSpace(item.QuestionID)
		answer := strings.TrimSpace(item.Answer)
		if questionID == "" || (strings.TrimSpace(item.OptionID) == "" && answer == "") {
			continue
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO task_answers(task_id, question_group_id, question_id, option_id, answer, question_index, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(task_id, question_group_id, question_id) DO UPDATE SET
			   option_id=excluded.option_id,
			   answer=excluded.answer,
			   question_index=excluded.question_index,
			   updated_at=excluded.updated_at`,
			taskID,
			strings.TrimSpace(item.QuestionGroupID),
			questionID,
			strings.TrimSpace(item.OptionID),
			answer,
			item.QuestionIndex,
			now,
		); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("localstore: record task answer: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("localstore: commit task answers: %w", err)
	}
	return nil
}

func (s *Store) QueryTaskAnswers(ctx context.Context, taskID string) ([]TaskAnswer, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return nil, fmt.Errorf("localstore: not open")
	}
	return s.queryTaskAnswersLocked(ctx, taskID)
}

func (s *Store) queryTaskAnswersLocked(ctx context.Context, taskID string) ([]TaskAnswer, error) {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return nil, nil
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT question_group_id, question_id, option_id, answer, question_index
		 FROM task_answers WHERE task_id = ?
		 ORDER BY CASE WHEN question_index < 0 THEN 999999 ELSE question_index END, updated_at ASC, question_id ASC`,
		taskID,
	)
	if err != nil {
		return nil, fmt.Errorf("localstore: query task answers: %w", err)
	}
	defer rows.Close()
	var out []TaskAnswer
	for rows.Next() {
		var item TaskAnswer
		if err := rows.Scan(&item.QuestionGroupID, &item.QuestionID, &item.OptionID, &item.Answer, &item.QuestionIndex); err != nil {
			return nil, fmt.Errorf("localstore: scan task answer: %w", err)
		}
		out = append(out, item)
	}
	return out, rows.Err()
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
	// Order events by when they happened, not by when the writer goroutine
	// got to them: recovery reads a task's history back ORDER BY created_at
	// and treats the last row as the current state.
	recordedAt := eventRecordedAt(event, now)
	status := statusFromEvent(event.Type)
	documentType := nullableString(stringPayload(event, "document_type"))
	topic := nullableString(stringPayload(event, "topic"))
	tx, err := s.db.BeginTx(context.Background(), nil)
	if err != nil {
		return fmt.Errorf("localstore: begin record event: %w", err)
	}
	if _, err := tx.Exec(
		`INSERT INTO tasks(id, status, document_type, topic, updated_at, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
		   status=excluded.status,
		   document_type=COALESCE(excluded.document_type, tasks.document_type),
		   topic=COALESCE(excluded.topic, tasks.topic),
		   updated_at=excluded.updated_at`,
		event.TaskID, status, documentType, topic, now, now,
	); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("localstore: upsert task: %w", err)
	}

	payloadJSON, err := json.Marshal(orEmptyPayload(event.Payload))
	if err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("localstore: marshal payload: %w", err)
	}
	eventID := storedEventID(event, recordedAt)
	if _, err := tx.Exec(
		`INSERT OR REPLACE INTO task_events(event_id, task_id, type, payload_json, created_at, request_id)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		eventID, event.TaskID, event.Type, string(payloadJSON), recordedAt, event.RequestID,
	); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("localstore: insert event: %w", err)
	}
	if err := projectTaskTx(context.Background(), tx, event.TaskID); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("localstore: project event: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("localstore: commit record event: %w", err)
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
		`SELECT event_id, task_id, type, payload_json, created_at, request_id
		 FROM task_events WHERE task_id = ? ORDER BY created_at ASC`, taskID)
	if err != nil {
		return nil, fmt.Errorf("localstore: query events by task: %w", err)
	}
	defer rows.Close()
	return scanEvents(rows)
}

// QueryTaskIDsByStatus returns the ids of tasks currently stored with the given
// status, oldest first.
func (s *Store) QueryTaskIDsByStatus(ctx context.Context, status string) ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return nil, fmt.Errorf("localstore: not open")
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT id FROM tasks WHERE status = ? ORDER BY updated_at ASC`, status)
	if err != nil {
		return nil, fmt.Errorf("localstore: query tasks by status: %w", err)
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("localstore: scan task id: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("localstore: iterate tasks by status: %w", err)
	}
	return ids, nil
}

// QueryRecentTaskIDs returns task ids ordered by tasks.updated_at ASC,
// so callers can replay them chronologically (oldest first). The result is
// capped at `limit` of the most recent rows; passing a non-positive limit
// returns the empty slice.
func (s *Store) QueryRecentTaskIDs(ctx context.Context, limit int) ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return nil, fmt.Errorf("localstore: not open")
	}
	if limit <= 0 {
		return nil, nil
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT id FROM (
		   SELECT id, updated_at FROM tasks
		   ORDER BY updated_at DESC LIMIT ?
		 ) ORDER BY updated_at ASC`, limit)
	if err != nil {
		return nil, fmt.Errorf("localstore: query recent task ids: %w", err)
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("localstore: scan recent task id: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (s *Store) QueryRecentTaskHistory(ctx context.Context, limit int) ([]types.TaskHistoryEntry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return nil, fmt.Errorf("localstore: not open")
	}
	if limit <= 0 {
		return nil, nil
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, COALESCE(NULLIF(conversation_id, ''), id), parent_task_id, workspace_id, created_at
		 FROM (
		   SELECT id, conversation_id, parent_task_id, workspace_id, created_at, updated_at FROM tasks
		   ORDER BY updated_at DESC, id ASC LIMIT ?
		 ) ORDER BY updated_at ASC, id ASC`, limit)
	if err != nil {
		return nil, fmt.Errorf("localstore: query recent task history: %w", err)
	}
	defer rows.Close()
	var entries []types.TaskHistoryEntry
	for rows.Next() {
		var entry types.TaskHistoryEntry
		if err := rows.Scan(&entry.TaskID, &entry.ConversationID, &entry.ParentTaskID, &entry.WorkspaceID, &entry.CreatedAt); err != nil {
			return nil, fmt.Errorf("localstore: scan recent task history: %w", err)
		}
		if entry.WorkspaceID != "" {
			_ = s.db.QueryRowContext(ctx, `SELECT path FROM workspaces WHERE id = ?`, entry.WorkspaceID).Scan(&entry.WorkspacePath)
		}
		events, err := s.queryEventsByTaskLocked(ctx, entry.TaskID)
		if err != nil {
			return nil, err
		}
		if answers, err := s.queryTaskAnswersLocked(ctx, entry.TaskID); err != nil {
			return nil, err
		} else if len(answers) > 0 {
			events = append(events, taskAnswersEvent(entry.TaskID, answers))
		}
		entry.Events = events
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

type documentQueryCursor struct {
	Timestamp string `json:"timestamp"`
	ID        string `json:"id"`
}

func encodeDocumentCursor(timestamp, id string) string {
	payload, _ := json.Marshal(documentQueryCursor{Timestamp: timestamp, ID: id})
	return base64.RawURLEncoding.EncodeToString(payload)
}

func decodeDocumentCursor(value string) (documentQueryCursor, error) {
	if strings.TrimSpace(value) == "" {
		return documentQueryCursor{}, nil
	}
	payload, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return documentQueryCursor{}, fmt.Errorf("localstore: invalid document cursor")
	}
	var cursor documentQueryCursor
	if err := json.Unmarshal(payload, &cursor); err != nil || cursor.Timestamp == "" || cursor.ID == "" {
		return documentQueryCursor{}, fmt.Errorf("localstore: invalid document cursor")
	}
	return cursor, nil
}

func clampDocumentLimit(limit int) int {
	if limit <= 0 {
		return 50
	}
	if limit > 200 {
		return 200
	}
	return limit
}

func scanDocument(rows *sql.Rows) (types.DocumentRecord, error) {
	var record types.DocumentRecord
	err := rows.Scan(
		&record.ID, &record.FilePath, &record.FileName, &record.DocumentType,
		&record.CurrentArtifactTaskID, &record.WorkspaceID, &record.CreatedAt,
		&record.UpdatedAt, &record.MigrationSource,
	)
	return record, err
}

func (s *Store) QueryDocuments(ctx context.Context, input types.DocumentListInput) (types.DocumentPage, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return types.DocumentPage{}, fmt.Errorf("localstore: not open")
	}
	cursor, err := decodeDocumentCursor(input.Cursor)
	if err != nil {
		return types.DocumentPage{}, err
	}
	limit := clampDocumentLimit(input.Limit)
	query := `SELECT id, file_path, file_name, document_type, COALESCE(current_artifact_task_id, ''), COALESCE(workspace_id, ''), created_at, updated_at, migration_source FROM documents WHERE 1=1`
	args := []any{}
	if workspaceID := strings.TrimSpace(input.WorkspaceID); workspaceID != "" {
		query += ` AND workspace_id = ?`
		args = append(args, workspaceID)
	}
	if cursor.Timestamp != "" {
		query += ` AND (updated_at < ? OR (updated_at = ? AND id > ?))`
		args = append(args, cursor.Timestamp, cursor.Timestamp, cursor.ID)
	}
	query += ` ORDER BY updated_at DESC, id ASC LIMIT ?`
	args = append(args, limit+1)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return types.DocumentPage{}, fmt.Errorf("localstore: query documents: %w", err)
	}
	defer rows.Close()
	items := make([]types.DocumentRecord, 0, limit+1)
	for rows.Next() {
		record, err := scanDocument(rows)
		if err != nil {
			return types.DocumentPage{}, fmt.Errorf("localstore: scan document: %w", err)
		}
		items = append(items, record)
	}
	if err := rows.Err(); err != nil {
		return types.DocumentPage{}, fmt.Errorf("localstore: iterate documents: %w", err)
	}
	page := types.DocumentPage{Items: items}
	if len(items) > limit {
		page.Items = items[:limit]
		last := page.Items[len(page.Items)-1]
		page.NextCursor = encodeDocumentCursor(last.UpdatedAt, last.ID)
	}
	return page, nil
}

func (s *Store) GetDocument(ctx context.Context, documentID string) (types.DocumentRecord, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return types.DocumentRecord{}, false, fmt.Errorf("localstore: not open")
	}
	documentID = strings.TrimSpace(documentID)
	if documentID == "" {
		return types.DocumentRecord{}, false, nil
	}
	row := s.db.QueryRowContext(ctx, `SELECT id, file_path, file_name, document_type, COALESCE(current_artifact_task_id, ''), COALESCE(workspace_id, ''), created_at, updated_at, migration_source FROM documents WHERE id = ?`, documentID)
	var record types.DocumentRecord
	err := row.Scan(&record.ID, &record.FilePath, &record.FileName, &record.DocumentType, &record.CurrentArtifactTaskID, &record.WorkspaceID, &record.CreatedAt, &record.UpdatedAt, &record.MigrationSource)
	if errors.Is(err, sql.ErrNoRows) {
		return types.DocumentRecord{}, false, nil
	}
	if err != nil {
		return types.DocumentRecord{}, false, fmt.Errorf("localstore: get document: %w", err)
	}
	return record, true, nil
}

func (s *Store) QueryDocumentRuns(ctx context.Context, documentID string) ([]types.RunRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return nil, fmt.Errorf("localstore: not open")
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, COALESCE(document_id, ''), activity_stream_id, source_conversation_id, COALESCE(parent_run_id, ''), status, COALESCE(document_type, ''), COALESCE(source_file, ''), created_at, updated_at FROM runs WHERE document_id = ? ORDER BY created_at ASC, id ASC`, strings.TrimSpace(documentID))
	if err != nil {
		return nil, fmt.Errorf("localstore: query document runs: %w", err)
	}
	defer rows.Close()
	runs := []types.RunRecord{}
	for rows.Next() {
		var run types.RunRecord
		if err := rows.Scan(&run.ID, &run.DocumentID, &run.ActivityStreamID, &run.SourceConversationID, &run.ParentRunID, &run.Status, &run.DocumentType, &run.SourceFile, &run.CreatedAt, &run.UpdatedAt); err != nil {
			return nil, fmt.Errorf("localstore: scan document run: %w", err)
		}
		runs = append(runs, run)
	}
	return runs, rows.Err()
}

func (s *Store) QueryDocumentActivities(ctx context.Context, input types.DocumentActivityListInput) (types.ActivityPage, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return types.ActivityPage{}, fmt.Errorf("localstore: not open")
	}
	cursor, err := decodeDocumentCursor(input.Cursor)
	if err != nil {
		return types.ActivityPage{}, err
	}
	limit := clampDocumentLimit(input.Limit)
	query := `SELECT a.id, a.activity_stream_id, a.source_conversation_id, a.task_id, a.ordinal, a.kind, COALESCE(a.event_id, ''), a.event_type, a.payload_json, a.created_at FROM activities a JOIN document_activity_streams das ON das.activity_stream_id = a.activity_stream_id WHERE das.document_id = ?`
	args := []any{strings.TrimSpace(input.DocumentID)}
	if cursor.Timestamp != "" {
		query += ` AND (a.created_at > ? OR (a.created_at = ? AND a.id > ?))`
		args = append(args, cursor.Timestamp, cursor.Timestamp, cursor.ID)
	}
	query += ` ORDER BY a.created_at ASC, a.id ASC LIMIT ?`
	args = append(args, limit+1)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return types.ActivityPage{}, fmt.Errorf("localstore: query document activities: %w", err)
	}
	defer rows.Close()
	items := make([]types.ActivityRecord, 0, limit+1)
	for rows.Next() {
		var activity types.ActivityRecord
		if err := rows.Scan(&activity.ID, &activity.ActivityStreamID, &activity.SourceConversationID, &activity.TaskID, &activity.Ordinal, &activity.Kind, &activity.EventID, &activity.EventType, &activity.PayloadJSON, &activity.CreatedAt); err != nil {
			return types.ActivityPage{}, fmt.Errorf("localstore: scan document activity: %w", err)
		}
		items = append(items, activity)
	}
	if err := rows.Err(); err != nil {
		return types.ActivityPage{}, fmt.Errorf("localstore: iterate document activities: %w", err)
	}
	page := types.ActivityPage{Items: items}
	if len(items) > limit {
		page.Items = items[:limit]
		last := page.Items[len(page.Items)-1]
		page.NextCursor = encodeDocumentCursor(last.CreatedAt, last.ID)
	}
	return page, nil
}

func (s *Store) QueryTaskHistoryByID(ctx context.Context, taskID string) (types.TaskHistoryEntry, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return types.TaskHistoryEntry{}, false, fmt.Errorf("localstore: not open")
	}
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return types.TaskHistoryEntry{}, false, nil
	}
	var entry types.TaskHistoryEntry
	err := s.db.QueryRowContext(ctx, `SELECT id, COALESCE(NULLIF(conversation_id, ''), id), parent_task_id, workspace_id, created_at FROM tasks WHERE id = ?`, taskID).Scan(&entry.TaskID, &entry.ConversationID, &entry.ParentTaskID, &entry.WorkspaceID, &entry.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return types.TaskHistoryEntry{}, false, nil
	}
	if err != nil {
		return types.TaskHistoryEntry{}, false, fmt.Errorf("localstore: query task history by id: %w", err)
	}
	if entry.WorkspaceID != "" {
		_ = s.db.QueryRowContext(ctx, `SELECT path FROM workspaces WHERE id = ?`, entry.WorkspaceID).Scan(&entry.WorkspacePath)
	}
	events, err := s.queryEventsByTaskLocked(ctx, entry.TaskID)
	if err != nil {
		return types.TaskHistoryEntry{}, false, err
	}
	answers, err := s.queryTaskAnswersLocked(ctx, entry.TaskID)
	if err != nil {
		return types.TaskHistoryEntry{}, false, err
	}
	if len(answers) > 0 {
		events = append(events, taskAnswersEvent(entry.TaskID, answers))
	}
	entry.Events = events
	return entry, true, nil
}

func (s *Store) QueryWorkspaceSummaries(ctx context.Context, _ int) ([]types.WorkspaceSummary, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return nil, fmt.Errorf("localstore: not open")
	}
	activeID := ""
	_ = s.db.QueryRowContext(ctx, `SELECT id FROM workspaces WHERE last_active_at != '' ORDER BY last_active_at DESC, updated_at DESC LIMIT 1`).Scan(&activeID)
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, path, name, updated_at, last_active_at
		 FROM workspaces ORDER BY last_active_at DESC, updated_at DESC, name ASC`)
	if err != nil {
		return nil, fmt.Errorf("localstore: query workspaces: %w", err)
	}
	defer rows.Close()
	var out []types.WorkspaceSummary
	for rows.Next() {
		var ws types.WorkspaceSummary
		if err := rows.Scan(&ws.ID, &ws.Path, &ws.Name, &ws.UpdatedAt, &ws.LastActiveAt); err != nil {
			return nil, fmt.Errorf("localstore: scan workspace: %w", err)
		}
		ws.Active = ws.ID == activeID
		out = append(out, ws)
	}
	return out, rows.Err()
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
		`SELECT event_id, task_id, type, payload_json, created_at, request_id
		 FROM task_events ORDER BY created_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, fmt.Errorf("localstore: query recent events: %w", err)
	}
	defer rows.Close()
	return scanEvents(rows)
}

// LatestRequestID returns the most recent non-empty request_id for the given
// task, or empty string when none exists. The minimal report flow uses it to
// give support a pointer into the server-side trace.
func (s *Store) LatestRequestID(ctx context.Context, taskID string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return "", fmt.Errorf("localstore: not open")
	}
	if taskID == "" {
		return "", nil
	}
	var requestID string
	err := s.db.QueryRowContext(ctx,
		`SELECT request_id FROM task_events
		 WHERE task_id = ? AND request_id != ''
		 ORDER BY rowid DESC LIMIT 1`, taskID).Scan(&requestID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", nil
		}
		return "", fmt.Errorf("localstore: latest request id: %w", err)
	}
	return requestID, nil
}

func (s *Store) queryWorkspaceLocked(ctx context.Context, id string) (Workspace, error) {
	var ws Workspace
	err := s.db.QueryRowContext(ctx,
		`SELECT id, path, name, updated_at, last_active_at FROM workspaces WHERE id = ?`, id,
	).Scan(&ws.ID, &ws.Path, &ws.Name, &ws.UpdatedAt, &ws.LastActiveAt)
	if err != nil {
		return Workspace{}, fmt.Errorf("localstore: query workspace: %w", err)
	}
	return ws, nil
}

func (s *Store) removeWorkspaceLocked(ctx context.Context, workspaceID string, requireExisting bool) error {
	if workspaceID == "" {
		return fmt.Errorf("localstore: workspace id is empty")
	}
	var exists string
	err := s.db.QueryRowContext(ctx, `SELECT id FROM workspaces WHERE id = ?`, workspaceID).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		if requireExisting {
			return fmt.Errorf("localstore: workspace not found")
		}
		return nil
	}
	if err != nil {
		return fmt.Errorf("localstore: query workspace: %w", err)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("localstore: begin remove workspace: %w", err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	for _, stmt := range []string{
		`UPDATE conversations SET workspace_id = '', updated_at = ? WHERE workspace_id = ?`,
		`UPDATE tasks SET workspace_id = '', updated_at = ? WHERE workspace_id = ?`,
		`DELETE FROM workspaces WHERE id = ?`,
	} {
		var execErr error
		if strings.HasPrefix(stmt, "DELETE") {
			_, execErr = tx.ExecContext(ctx, stmt, workspaceID)
		} else {
			_, execErr = tx.ExecContext(ctx, stmt, now, workspaceID)
		}
		if execErr != nil {
			_ = tx.Rollback()
			return fmt.Errorf("localstore: remove workspace: %w", execErr)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("localstore: commit remove workspace: %w", err)
	}
	return nil
}

func (s *Store) ensureConversationLocked(ctx context.Context, workspaceID, conversationID, title string) error {
	if s.db == nil {
		return fmt.Errorf("localstore: not open")
	}
	workspaceID = strings.TrimSpace(workspaceID)
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return nil
	}
	title = strings.TrimSpace(title)
	if title == "" {
		title = conversationID
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO conversations(id, workspace_id, title, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
		   workspace_id=excluded.workspace_id,
		   title=CASE WHEN conversations.title = conversations.id OR conversations.title = '' THEN excluded.title ELSE conversations.title END,
		   updated_at=excluded.updated_at`,
		conversationID, workspaceID, title, now, now,
	); err != nil {
		return fmt.Errorf("localstore: ensure conversation: %w", err)
	}
	if workspaceID != "" {
		if _, err := s.db.ExecContext(ctx,
			`UPDATE workspaces SET updated_at = ? WHERE id = ?`, now, workspaceID,
		); err != nil {
			return fmt.Errorf("localstore: touch workspace: %w", err)
		}
	}
	return nil
}

func (s *Store) queryEventsByTaskLocked(ctx context.Context, taskID string) ([]types.BridgeEvent, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT event_id, task_id, type, payload_json, created_at, request_id
		 FROM task_events WHERE task_id = ? ORDER BY created_at ASC`, taskID)
	if err != nil {
		return nil, fmt.Errorf("localstore: query events by task: %w", err)
	}
	defer rows.Close()
	return scanEvents(rows)
}

func workspaceID(path string) string {
	sum := sha1.Sum([]byte(filepath.Clean(path)))
	return "ws_" + hex.EncodeToString(sum[:8])
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
			requestID   string
		)
		if err := rows.Scan(&eventID, &taskID, &eventType, &payloadJSON, &createdAt, &requestID); err != nil {
			return nil, fmt.Errorf("localstore: scan event: %w", err)
		}
		var payload map[string]any
		_ = json.Unmarshal([]byte(payloadJSON), &payload)
		events = append(events, types.BridgeEvent{
			EventID:   originalEventID(taskID, eventID),
			TaskID:    taskID,
			RequestID: requestID,
			Type:      eventType,
			TS:        createdAt,
			Payload:   payload,
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
	tx, err := s.db.BeginTx(context.Background(), nil)
	if err != nil {
		return fmt.Errorf("localstore: begin record artifact: %w", err)
	}
	if _, err := tx.Exec(
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
		_ = tx.Rollback()
		return fmt.Errorf("localstore: upsert artifact: %w", err)
	}
	if strings.TrimSpace(artifact.TaskID) != "" {
		if err := projectTaskTx(context.Background(), tx, artifact.TaskID); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("localstore: project artifact: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("localstore: commit record artifact: %w", err)
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
	case "task.plan":
		return "plan_review"
	default:
		return "running"
	}
}

func taskAnswersEvent(taskID string, answers []TaskAnswer) types.BridgeEvent {
	raw := make([]map[string]any, 0, len(answers))
	for _, item := range answers {
		answer := map[string]any{
			"questionId":    item.QuestionID,
			"answer":        item.Answer,
			"questionIndex": item.QuestionIndex,
		}
		if item.QuestionGroupID != "" {
			answer["questionGroupId"] = item.QuestionGroupID
		}
		if item.OptionID != "" {
			answer["optionId"] = item.OptionID
		}
		raw = append(raw, answer)
	}
	return types.BridgeEvent{
		EventID: "local-answers-" + taskID,
		TaskID:  taskID,
		Type:    "task.answers",
		Payload: map[string]any{"answers": raw},
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

// eventRecordedAt is the event's own timestamp when it carries a parseable
// one, otherwise the write time.
func eventRecordedAt(event types.BridgeEvent, fallback string) string {
	ts := strings.TrimSpace(event.TS)
	if ts == "" {
		return fallback
	}
	parsed, err := time.Parse(time.RFC3339Nano, ts)
	if err != nil {
		if parsed, err = time.Parse(time.RFC3339, ts); err != nil {
			return fallback
		}
	}
	return parsed.UTC().Format(time.RFC3339Nano)
}

func storedEventID(event types.BridgeEvent, now string) string {
	if event.EventID != "" {
		return event.TaskID + ":" + event.EventID
	}
	// Legacy callers frequently omit event_id. Use the event's stable envelope
	// rather than wall-clock time so retrying the same bridge event is idempotent
	// and its projected activity identity does not change between writes.
	payload, _ := json.Marshal(orEmptyPayload(event.Payload))
	material := event.Type + "\x00" + event.TS + "\x00" + string(payload)
	sum := sha1.Sum([]byte(material))
	return fmt.Sprintf("%s:generated:%s", event.TaskID, hex.EncodeToString(sum[:8]))
}

func originalEventID(taskID string, stored string) string {
	prefix := taskID + ":"
	if strings.HasPrefix(stored, prefix) {
		return strings.TrimPrefix(stored, prefix)
	}
	return stored
}

func orEmptyPayload(p map[string]any) map[string]any {
	if p == nil {
		return map[string]any{}
	}
	return p
}
