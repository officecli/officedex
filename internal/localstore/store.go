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
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
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

func (s *Store) RemoveConversation(ctx context.Context, conversationID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return fmt.Errorf("localstore: not open")
	}
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return fmt.Errorf("localstore: conversation id is empty")
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id FROM tasks WHERE conversation_id = ?`, conversationID)
	if err != nil {
		return fmt.Errorf("localstore: query conversation tasks: %w", err)
	}
	var taskIDs []string
	for rows.Next() {
		var taskID string
		if err := rows.Scan(&taskID); err != nil {
			_ = rows.Close()
			return fmt.Errorf("localstore: scan conversation task: %w", err)
		}
		taskIDs = append(taskIDs, taskID)
	}
	if err := rows.Close(); err != nil {
		return err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("localstore: begin remove conversation: %w", err)
	}
	for _, taskID := range taskIDs {
		if _, err := tx.ExecContext(ctx, `DELETE FROM task_events WHERE task_id = ?`, taskID); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("localstore: remove conversation events: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM artifacts WHERE task_id = ?`, taskID); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("localstore: remove conversation artifacts: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM task_credit_records WHERE task_id = ?`, taskID); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("localstore: remove conversation credit records: %w", err)
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM tasks WHERE conversation_id = ?`, conversationID); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("localstore: remove conversation tasks: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM conversations WHERE id = ?`, conversationID); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("localstore: remove conversation: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("localstore: commit remove conversation: %w", err)
	}
	return nil
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
	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO tasks(id, status, document_type, topic, updated_at, conversation_id, parent_task_id, workspace_id)
		 VALUES (?, 'starting', NULL, NULL, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
		   conversation_id = CASE WHEN excluded.conversation_id != '' THEN excluded.conversation_id ELSE tasks.conversation_id END,
		   parent_task_id = CASE WHEN excluded.parent_task_id != '' THEN excluded.parent_task_id ELSE tasks.parent_task_id END,
		   workspace_id = CASE WHEN excluded.workspace_id != '' THEN excluded.workspace_id ELSE tasks.workspace_id END,
		   updated_at = excluded.updated_at`,
		taskID, now, conversationID, strings.TrimSpace(taskCtx.ParentTaskID), strings.TrimSpace(taskCtx.WorkspaceID),
	); err != nil {
		return fmt.Errorf("localstore: record task context: %w", err)
	}
	if taskCtx.WorkspaceID != "" {
		if err := s.ensureConversationLocked(ctx, taskCtx.WorkspaceID, conversationID, taskID); err != nil {
			return err
		}
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
	eventID := storedEventID(event, now)
	if _, err := s.db.Exec(
		`INSERT OR REPLACE INTO task_events(event_id, task_id, type, payload_json, created_at, request_id)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		eventID, event.TaskID, event.Type, string(payloadJSON), now, event.RequestID,
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
		`SELECT event_id, task_id, type, payload_json, created_at, request_id
		 FROM task_events WHERE task_id = ? ORDER BY created_at ASC`, taskID)
	if err != nil {
		return nil, fmt.Errorf("localstore: query events by task: %w", err)
	}
	defer rows.Close()
	return scanEvents(rows)
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
		`SELECT id, COALESCE(NULLIF(conversation_id, ''), id), parent_task_id, workspace_id
		 FROM (
		   SELECT id, conversation_id, parent_task_id, workspace_id, updated_at FROM tasks
		   ORDER BY updated_at DESC LIMIT ?
		 ) ORDER BY updated_at ASC`, limit)
	if err != nil {
		return nil, fmt.Errorf("localstore: query recent task history: %w", err)
	}
	defer rows.Close()
	var entries []types.TaskHistoryEntry
	for rows.Next() {
		var entry types.TaskHistoryEntry
		if err := rows.Scan(&entry.TaskID, &entry.ConversationID, &entry.ParentTaskID, &entry.WorkspaceID); err != nil {
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

func (s *Store) QueryWorkspaceSummaries(ctx context.Context, conversationLimit int) ([]types.WorkspaceSummary, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return nil, fmt.Errorf("localstore: not open")
	}
	if conversationLimit <= 0 {
		conversationLimit = 20
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
		conversations, err := s.queryWorkspaceConversationsLocked(ctx, ws.ID, conversationLimit)
		if err != nil {
			return nil, err
		}
		ws.Conversations = conversations
		out = append(out, ws)
	}
	return out, rows.Err()
}

func (s *Store) QueryChatSummaries(ctx context.Context, conversationLimit int) ([]types.WorkspaceConversationSummary, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return nil, fmt.Errorf("localstore: not open")
	}
	if conversationLimit <= 0 {
		conversationLimit = 20
	}
	return s.queryWorkspaceConversationsLocked(ctx, "", conversationLimit)
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

func (s *Store) queryWorkspaceConversationsLocked(ctx context.Context, workspaceID string, limit int) ([]types.WorkspaceConversationSummary, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, title, updated_at
		 FROM conversations
		 WHERE workspace_id = ?
		 ORDER BY updated_at DESC LIMIT ?`, workspaceID, limit)
	if err != nil {
		return nil, fmt.Errorf("localstore: query workspace conversations: %w", err)
	}
	defer rows.Close()
	var out []types.WorkspaceConversationSummary
	for rows.Next() {
		var conversationID, title, updatedAt string
		if err := rows.Scan(&conversationID, &title, &updatedAt); err != nil {
			return nil, fmt.Errorf("localstore: scan workspace conversation: %w", err)
		}
		summary := types.WorkspaceConversationSummary{
			ConversationID: conversationID,
			Title:          title,
			UpdatedAt:      updatedAt,
		}
		taskRows, err := s.db.QueryContext(ctx,
			`SELECT id, status, COALESCE(document_type, ''), COALESCE(topic, ''), updated_at
			 FROM tasks
			 WHERE conversation_id = ?
			 ORDER BY updated_at ASC`, conversationID)
		if err != nil {
			return nil, fmt.Errorf("localstore: query conversation tasks: %w", err)
		}
		for taskRows.Next() {
			var taskID, status, documentType, topic, taskUpdatedAt string
			if err := taskRows.Scan(&taskID, &status, &documentType, &topic, &taskUpdatedAt); err != nil {
				_ = taskRows.Close()
				return nil, fmt.Errorf("localstore: scan conversation task: %w", err)
			}
			if summary.FirstTaskID == "" {
				summary.FirstTaskID = taskID
				if summary.Title == "" || summary.Title == conversationID {
					summary.Title = topic
				}
			}
			summary.LatestTaskID = taskID
			summary.Status = status
			summary.DocumentType = documentType
			summary.UpdatedAt = taskUpdatedAt
		}
		if err := taskRows.Close(); err != nil {
			return nil, err
		}
		if summary.FirstTaskID == "" {
			summary.FirstTaskID = conversationID
			summary.LatestTaskID = conversationID
			summary.Status = "completed"
		}
		if strings.TrimSpace(summary.Title) == "" {
			summary.Title = conversationID
		}
		out = append(out, summary)
	}
	return out, rows.Err()
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

func storedEventID(event types.BridgeEvent, now string) string {
	if event.EventID != "" {
		return event.TaskID + ":" + event.EventID
	}
	return fmt.Sprintf("%s:%s:%s", event.TaskID, event.Type, now)
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
