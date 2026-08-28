package localstore

import (
	"context"
	"path/filepath"
	"testing"

	"officedex/internal/types"
)

// TestDocumentsProjectionSurvivesRestart verifies the user-visible document
// contract across a real Store close/reopen. This catches regressions where
// legacy task events remain on disk but the Documents, Runs, or Activity
// projections are only present in process memory.
func TestDocumentsProjectionSurvivesRestart(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "officedex.sqlite")
	workspacePath := filepath.Join(dir, "workspace")
	artifactPath := filepath.Join(workspacePath, "launch-plan.pptx")

	store := New(dbPath)
	if err := store.Open(ctx); err != nil {
		t.Fatalf("first Open: %v", err)
	}
	workspace, err := store.EnsureWorkspace(ctx, workspacePath)
	if err != nil {
		t.Fatalf("EnsureWorkspace: %v", err)
	}
	if err := store.EnsureConversation(ctx, workspace.ID, "conversation-1", "Launch plan"); err != nil {
		t.Fatalf("EnsureConversation: %v", err)
	}
	if err := store.RecordTaskContext(ctx, "task-1", TaskContext{
		WorkspaceID: workspace.ID, ConversationID: "conversation-1",
	}); err != nil {
		t.Fatalf("RecordTaskContext: %v", err)
	}
	if err := store.RecordEvent(types.BridgeEvent{
		EventID: "event-started", TaskID: "task-1", Type: "task.started",
		Payload: map[string]any{"document_type": "pptx", "topic": "Launch plan"},
	}); err != nil {
		t.Fatalf("RecordEvent started: %v", err)
	}
	if err := store.RecordArtifact(types.Artifact{
		TaskID: "task-1", FilePath: artifactPath, FileName: "launch-plan.pptx", DocumentType: "pptx",
	}); err != nil {
		t.Fatalf("RecordArtifact: %v", err)
	}
	if err := store.RecordEvent(types.BridgeEvent{
		EventID: "event-completed", TaskID: "task-1", Type: "task.completed",
		Payload: map[string]any{"document_type": "pptx", "topic": "Launch plan"},
	}); err != nil {
		t.Fatalf("RecordEvent completed: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("first Close: %v", err)
	}

	reopened := New(dbPath)
	if err := reopened.Open(ctx); err != nil {
		t.Fatalf("reopen: %v", err)
	}
	t.Cleanup(func() { _ = reopened.Close() })

	documents, err := reopened.QueryDocuments(ctx, types.DocumentListInput{WorkspaceID: workspace.ID})
	if err != nil {
		t.Fatalf("QueryDocuments after restart: %v", err)
	}
	if len(documents.Items) != 1 {
		t.Fatalf("documents after restart = %#v, want one document", documents.Items)
	}
	document := documents.Items[0]
	if document.FilePath != artifactPath || document.FileName != "launch-plan.pptx" || document.DocumentType != "pptx" {
		t.Fatalf("document after restart = %#v", document)
	}

	runs, err := reopened.QueryDocumentRuns(ctx, document.ID)
	if err != nil {
		t.Fatalf("QueryDocumentRuns after restart: %v", err)
	}
	if len(runs) != 1 || runs[0].ID != "task-1" || runs[0].Status != "completed" {
		t.Fatalf("runs after restart = %#v", runs)
	}

	activities, err := reopened.QueryDocumentActivities(ctx, types.DocumentActivityListInput{DocumentID: document.ID})
	if err != nil {
		t.Fatalf("QueryDocumentActivities after restart: %v", err)
	}
	if len(activities.Items) < 2 {
		t.Fatalf("activities after restart = %#v, want started and completed", activities.Items)
	}
}
