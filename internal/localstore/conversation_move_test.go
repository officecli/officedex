package localstore

import (
	"context"
	"officedex/internal/types"
	"path/filepath"
	"testing"
)

func TestMoveConversationMovesResultsAndRejectsActiveRuns(t *testing.T) {
	ctx := context.Background()
	store := New(filepath.Join(t.TempDir(), "test.sqlite"))
	if err := store.Open(ctx); err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	from, err := store.EnsureWorkspace(ctx, filepath.Join(t.TempDir(), "from"))
	if err != nil {
		t.Fatal(err)
	}
	to, err := store.EnsureWorkspace(ctx, filepath.Join(t.TempDir(), "to"))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.RecordTaskContext(ctx, "task", TaskContext{WorkspaceID: from.ID, ConversationID: "chat"}); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordEvent(types.BridgeEvent{EventID: "start", TaskID: "task", Type: "task.started"}); err != nil {
		t.Fatal(err)
	}
	if err := store.MoveConversation(ctx, "chat", to.ID); err == nil {
		t.Fatal("moved active run")
	}
	if err := store.RecordEvent(types.BridgeEvent{EventID: "done", TaskID: "task", Type: "task.completed"}); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "result.docx")
	if err := store.RecordArtifact(types.Artifact{TaskID: "task", FilePath: path, FileName: "result.docx", DocumentType: "docx"}); err != nil {
		t.Fatal(err)
	}
	if err := store.MoveConversation(ctx, "chat", to.ID); err != nil {
		t.Fatal(err)
	}
	docs, err := store.QueryDocuments(ctx, types.DocumentListInput{WorkspaceID: to.ID})
	if err != nil || len(docs.Items) != 1 || docs.Items[0].FilePath != path {
		t.Fatalf("%+v %v", docs, err)
	}
}
