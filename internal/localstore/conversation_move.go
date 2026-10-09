package localstore

import (
	"context"
	"fmt"
	"strings"
)

// MoveConversation changes project membership without moving document bytes.
// Active runs must finish first because their output location is already fixed.
func (s *Store) MoveConversation(ctx context.Context, conversationID, workspaceID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return fmt.Errorf("localstore: not open")
	}
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return fmt.Errorf("conversation id is required")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if workspaceID != "" {
		var exists int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM workspaces WHERE id=?`, workspaceID).Scan(&exists); err != nil {
			return err
		}
		if exists != 1 {
			return fmt.Errorf("workspace not found")
		}
	}
	var active int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM tasks WHERE (conversation_id=? OR (conversation_id='' AND id=?)) AND status IN ('starting','running','question','plan_review')`, conversationID, conversationID).Scan(&active); err != nil {
		return err
	}
	if active > 0 {
		return fmt.Errorf("finish or stop the running task before moving this chat")
	}
	for _, query := range []string{
		`UPDATE conversations SET workspace_id=? WHERE id=?`,
		`UPDATE recent_files SET workspace_id=? WHERE conversation_id=?`,
	} {
		if _, err := tx.ExecContext(ctx, query, workspaceID, conversationID); err != nil {
			return err
		}
	}
	for _, query := range []string{
		`UPDATE documents SET workspace_id=NULLIF(?, '') WHERE current_artifact_task_id IN (SELECT id FROM tasks WHERE conversation_id=? OR (conversation_id='' AND id=?))`,
		`UPDATE tasks SET workspace_id=? WHERE conversation_id=? OR (conversation_id='' AND id=?)`,
	} {
		if _, err := tx.ExecContext(ctx, query, workspaceID, conversationID, conversationID); err != nil {
			return err
		}
	}
	return tx.Commit()
}
