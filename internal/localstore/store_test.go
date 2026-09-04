package localstore

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
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

func TestWorkspaceConversationMetadataPersists(t *testing.T) {
	store := newTempStore(t)
	ctx := context.Background()
	workspacePath := filepath.Join(t.TempDir(), "client-a")

	workspace, err := store.EnsureWorkspace(ctx, workspacePath)
	if err != nil {
		t.Fatalf("EnsureWorkspace: %v", err)
	}
	if workspace.ID == "" {
		t.Fatalf("workspace ID is empty")
	}
	if workspace.Name != "client-a" {
		t.Fatalf("workspace name = %q, want client-a", workspace.Name)
	}
	if err := store.EnsureConversation(ctx, workspace.ID, "conv-1", "Quarterly plan"); err != nil {
		t.Fatalf("EnsureConversation: %v", err)
	}
	if err := store.RecordTaskContext(ctx, "task-1", TaskContext{
		WorkspaceID:    workspace.ID,
		ConversationID: "conv-1",
	}); err != nil {
		t.Fatalf("RecordTaskContext root: %v", err)
	}
	if err := store.RecordTaskContext(ctx, "task-2", TaskContext{
		WorkspaceID:    workspace.ID,
		ConversationID: "conv-1",
		ParentTaskID:   "task-1",
	}); err != nil {
		t.Fatalf("RecordTaskContext child: %v", err)
	}
	for _, ev := range []types.BridgeEvent{
		{EventID: "e1", TaskID: "task-1", Type: "task.started", Payload: map[string]any{"document_type": "pptx", "topic": "Quarterly plan"}},
		{EventID: "e2", TaskID: "task-2", Type: "task.started", Payload: map[string]any{"document_type": "pptx", "topic": "Follow-up"}},
	} {
		if err := store.RecordEvent(ev); err != nil {
			t.Fatalf("RecordEvent(%s): %v", ev.EventID, err)
		}
	}

	entries, err := store.QueryRecentTaskHistory(ctx, 10)
	if err != nil {
		t.Fatalf("QueryRecentTaskHistory: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("history entries = %d, want 2", len(entries))
	}
	if entries[0].ConversationID != "conv-1" || entries[1].ConversationID != "conv-1" {
		t.Fatalf("conversation ids = %q,%q; want conv-1", entries[0].ConversationID, entries[1].ConversationID)
	}
	if entries[1].ParentTaskID != "task-1" {
		t.Fatalf("child parent = %q, want task-1", entries[1].ParentTaskID)
	}
	if entries[0].WorkspaceID != workspace.ID || entries[0].WorkspacePath != workspacePath {
		t.Fatalf("workspace metadata = %q %q, want %q %q", entries[0].WorkspaceID, entries[0].WorkspacePath, workspace.ID, workspacePath)
	}

	summaries, err := store.QueryWorkspaceSummaries(ctx, 10)
	if err != nil {
		t.Fatalf("QueryWorkspaceSummaries: %v", err)
	}
	if len(summaries) != 1 {
		t.Fatalf("workspace summaries = %d, want 1", len(summaries))
	}
}

func TestRecentFilesUpsertSortFilterAndRemove(t *testing.T) {
	store := newTempStore(t)
	ctx := context.Background()
	root := t.TempDir()
	olderPath := filepath.Join(root, "a.pptx")
	newerPath := filepath.Join(root, "b.docx")
	older := types.RecentFile{
		FilePath: olderPath, FileName: "a.pptx", DocumentType: "pptx",
		Source: "generated", WorkspaceID: "ws-a", LastOpenedAt: "2026-08-05T01:00:00Z",
	}
	newer := types.RecentFile{
		FilePath: newerPath, FileName: "b.docx", DocumentType: "docx",
		Source: "local", WorkspaceID: "ws-b", LastOpenedAt: "2026-08-05T02:00:00Z",
	}
	if err := store.UpsertRecentFile(ctx, older); err != nil {
		t.Fatal(err)
	}
	if err := store.UpsertRecentFile(ctx, newer); err != nil {
		t.Fatal(err)
	}
	got, err := store.QueryRecentFiles(ctx, "", 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].FilePath != newerPath || got[1].FilePath != olderPath {
		t.Fatalf("unexpected order: %#v", got)
	}
	filtered, err := store.QueryRecentFiles(ctx, "ws-a", 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(filtered) != 1 || filtered[0].FilePath != olderPath {
		t.Fatalf("unexpected filter: %#v", filtered)
	}
	if err := store.RemoveRecentFile(ctx, olderPath); err != nil {
		t.Fatal(err)
	}
	remaining, err := store.QueryRecentFiles(ctx, "", 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(remaining) != 1 || remaining[0].FilePath != newerPath {
		t.Fatalf("unexpected remaining files: %#v", remaining)
	}
}

func TestRecentFilesValidateInputAndDefaultLimit(t *testing.T) {
	store := newTempStore(t)
	ctx := context.Background()
	if err := store.UpsertRecentFile(ctx, types.RecentFile{FilePath: "relative.pptx", FileName: "relative.pptx", DocumentType: "pptx", Source: "generated", LastOpenedAt: "2026-08-05T01:00:00Z"}); err == nil {
		t.Fatal("expected relative file path to be rejected")
	}
	if err := store.UpsertRecentFile(ctx, types.RecentFile{FilePath: filepath.Join(t.TempDir(), "bad.pptx"), FileName: "bad.pptx", DocumentType: "pptx", Source: "remote", LastOpenedAt: "2026-08-05T01:00:00Z"}); err == nil {
		t.Fatal("expected invalid source to be rejected")
	}
	files, err := store.QueryRecentFiles(ctx, "", 0)
	if err != nil {
		t.Fatal(err)
	}
	if files == nil {
		t.Fatal("expected an empty slice, got nil")
	}
}

func TestRemoveDocumentByTaskIDRemovesMetadataButKeepsFile(t *testing.T) {
	store := newTempStore(t)
	ctx := context.Background()
	filePath := filepath.Join(t.TempDir(), "deck.pptx")
	if err := os.WriteFile(filePath, []byte("deck"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordTaskContext(ctx, "task-delete", TaskContext{ConversationID: "document-delete"}); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordEvent(types.BridgeEvent{TaskID: "task-delete", Type: "task.completed", Payload: map[string]any{"document_type": "pptx"}}); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordArtifact(types.Artifact{TaskID: "task-delete", FilePath: filePath, FileName: "deck.pptx", DocumentType: "pptx"}); err != nil {
		t.Fatal(err)
	}
	if err := store.UpsertRecentFile(ctx, types.RecentFile{FilePath: filePath, FileName: "deck.pptx", DocumentType: "pptx", Source: "generated", TaskID: "task-delete", ConversationID: "document-delete"}); err != nil {
		t.Fatal(err)
	}

	if err := store.RemoveDocumentByTaskID(ctx, "task-delete"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filePath); err != nil {
		t.Fatalf("generated file was removed: %v", err)
	}
	history, err := store.QueryRecentTaskHistory(ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(history) != 0 {
		t.Fatalf("task history = %#v, want empty", history)
	}
	recent, err := store.QueryRecentFiles(ctx, "", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(recent) != 0 {
		t.Fatalf("recent files = %#v, want empty", recent)
	}
	documents, err := store.QueryDocuments(ctx, types.DocumentListInput{})
	if err != nil {
		t.Fatal(err)
	}
	if len(documents.Items) != 0 {
		t.Fatalf("documents = %#v, want empty", documents.Items)
	}
}

func TestRemoveDocumentByTaskIDRejectsRunningTask(t *testing.T) {
	store := newTempStore(t)
	ctx := context.Background()
	if err := store.RecordTaskContext(ctx, "task-running", TaskContext{ConversationID: "document-running"}); err != nil {
		t.Fatal(err)
	}
	if err := store.RemoveDocumentByTaskID(ctx, "task-running"); err == nil || !strings.Contains(err.Error(), "running tasks") {
		t.Fatalf("RemoveDocumentByTaskID error = %v, want running task rejection", err)
	}
}

func TestRenameWorkspacePreservesPath(t *testing.T) {
	store := newTempStore(t)
	ctx := context.Background()
	workspace, err := store.EnsureWorkspace(ctx, filepath.Join(t.TempDir(), "client-a"))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.EnsureConversation(ctx, workspace.ID, "conv-rename", "Quarterly plan"); err != nil {
		t.Fatal(err)
	}
	renamed, err := store.RenameWorkspace(ctx, workspace.ID, "  New client name  ")
	if err != nil {
		t.Fatal(err)
	}
	if renamed.Name != "New client name" || renamed.Path != workspace.Path {
		t.Fatalf("renamed workspace = %#v, want preserved path and trimmed name", renamed)
	}
	summaries, err := store.QueryWorkspaceSummaries(ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(summaries) != 1 || summaries[0].Name != "New client name" {
		t.Fatalf("unexpected summaries after rename: %#v", summaries)
	}
	if _, err := store.RenameWorkspace(ctx, workspace.ID, "   "); err == nil {
		t.Fatal("expected empty workspace name to be rejected")
	}
}

func TestMigrateV5ToV6PreservesTasks(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "officedex.db")
	ctx := context.Background()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	for _, ddl := range []string{schema, schemaV1, schemaV2, schemaV3, schemaV4, schemaV5} {
		if _, err := db.ExecContext(ctx, ddl); err != nil {
			t.Fatalf("apply v5 fixture schema: %v", err)
		}
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO tasks(id, status, document_type, topic, updated_at, conversation_id, parent_task_id, workspace_id)
		VALUES ('legacy-task', 'completed', 'pptx', 'Legacy deck', '2026-08-01T00:00:00Z', '', '', '');
		PRAGMA user_version = 5;
	`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	store := New(path)
	if err := store.Open(ctx); err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	var version, taskCount, recentTableCount int
	if err := store.db.QueryRowContext(ctx, `PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM tasks WHERE id = 'legacy-task'`).Scan(&taskCount); err != nil {
		t.Fatal(err)
	}
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'recent_files'`).Scan(&recentTableCount); err != nil {
		t.Fatal(err)
	}
	if version != 8 || taskCount != 1 || recentTableCount != 1 {
		t.Fatalf("version=%d taskCount=%d recentTableCount=%d, want 8/1/1", version, taskCount, recentTableCount)
	}
}

func TestTaskAnswersPersistAndHydrateHistory(t *testing.T) {
	store := newTempStore(t)
	ctx := context.Background()

	if err := store.RecordEvent(types.BridgeEvent{
		EventID: "event-question",
		TaskID:  "task-answers",
		Type:    "task.question",
		Payload: map[string]any{
			"id":            "question-group",
			"question":      "Who is the audience?",
			"allowFreeform": true,
			"currentIndex":  1,
			"questions": []map[string]any{
				{
					"id":       "q-audience",
					"question": "Who is the audience?",
					"options":  []map[string]any{{"id": "leadership", "label": "Leadership"}},
				},
				{
					"id":            "q-context",
					"question":      "What context should be included?",
					"allowFreeform": true,
				},
			},
		},
	}); err != nil {
		t.Fatalf("RecordEvent question: %v", err)
	}

	if err := store.RecordTaskAnswers(ctx, "task-answers", []TaskAnswer{
		{QuestionGroupID: "question-group", QuestionID: "q-audience", OptionID: "leadership", Answer: "Leadership", QuestionIndex: 0},
		{QuestionGroupID: "question-group", QuestionID: "q-context", Answer: "Mention the 2026 launch plan.", QuestionIndex: 1},
	}); err != nil {
		t.Fatalf("RecordTaskAnswers: %v", err)
	}

	answers, err := store.QueryTaskAnswers(ctx, "task-answers")
	if err != nil {
		t.Fatalf("QueryTaskAnswers: %v", err)
	}
	if len(answers) != 2 {
		t.Fatalf("answers = %d, want 2", len(answers))
	}
	if answers[0].QuestionID != "q-audience" || answers[0].OptionID != "leadership" || answers[0].QuestionIndex != 0 {
		t.Fatalf("answer[0] = %#v", answers[0])
	}
	if answers[1].QuestionID != "q-context" || answers[1].Answer != "Mention the 2026 launch plan." || answers[1].QuestionIndex != 1 {
		t.Fatalf("answer[1] = %#v", answers[1])
	}

	entries, err := store.QueryRecentTaskHistory(ctx, 10)
	if err != nil {
		t.Fatalf("QueryRecentTaskHistory: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("history entries = %d, want 1", len(entries))
	}
	if len(entries[0].Events) != 2 {
		t.Fatalf("history events = %d, want question plus answers", len(entries[0].Events))
	}
	answerEvent := entries[0].Events[1]
	if answerEvent.Type != "task.answers" {
		t.Fatalf("history answer event type = %q, want task.answers", answerEvent.Type)
	}
	rawAnswers, ok := answerEvent.Payload["answers"].([]map[string]any)
	if !ok {
		t.Fatalf("history answers payload = %#v, want []map[string]any", answerEvent.Payload["answers"])
	}
	if rawAnswers[1]["answer"] != "Mention the 2026 launch plan." {
		t.Fatalf("history freeform answer = %#v", rawAnswers[1])
	}
}

func TestTaskWorkspacePathReturnsRecordedWorkspacePath(t *testing.T) {
	store := newTempStore(t)
	ctx := context.Background()
	workspacePath := filepath.Join(t.TempDir(), "client-a")
	workspace, err := store.EnsureWorkspace(ctx, workspacePath)
	if err != nil {
		t.Fatalf("EnsureWorkspace: %v", err)
	}
	if err := store.RecordTaskContext(ctx, "task-workspace", TaskContext{
		WorkspaceID:    workspace.ID,
		ConversationID: "conv-1",
	}); err != nil {
		t.Fatalf("RecordTaskContext workspace: %v", err)
	}
	if err := store.RecordTaskContext(ctx, "task-standalone", TaskContext{
		ConversationID: "task-standalone",
	}); err != nil {
		t.Fatalf("RecordTaskContext standalone: %v", err)
	}

	path, ok, err := store.TaskWorkspacePath(ctx, "task-workspace")
	if err != nil {
		t.Fatalf("TaskWorkspacePath workspace: %v", err)
	}
	if !ok || path != workspacePath {
		t.Fatalf("TaskWorkspacePath workspace = %q,%v want %q,true", path, ok, workspacePath)
	}
	path, ok, err = store.TaskWorkspacePath(ctx, "task-standalone")
	if err != nil {
		t.Fatalf("TaskWorkspacePath standalone: %v", err)
	}
	if !ok || path != "" {
		t.Fatalf("TaskWorkspacePath standalone = %q,%v want empty,true", path, ok)
	}
	_, ok, err = store.TaskWorkspacePath(ctx, "missing")
	if err != nil {
		t.Fatalf("TaskWorkspacePath missing: %v", err)
	}
	if ok {
		t.Fatal("TaskWorkspacePath missing ok = true, want false")
	}
}

func TestNoProjectConversationMetadataPersistsOutsideWorkspaces(t *testing.T) {
	store := newTempStore(t)
	ctx := context.Background()
	workspacePath := filepath.Join(t.TempDir(), "client-a")

	workspace, err := store.EnsureWorkspace(ctx, workspacePath)
	if err != nil {
		t.Fatalf("EnsureWorkspace: %v", err)
	}
	if err := store.EnsureConversation(ctx, "", "chat-1", "Standalone chat"); err != nil {
		t.Fatalf("EnsureConversation no-project: %v", err)
	}
	if err := store.RecordTaskContext(ctx, "task-chat-1", TaskContext{
		ConversationID: "chat-1",
	}); err != nil {
		t.Fatalf("RecordTaskContext no-project root: %v", err)
	}
	if err := store.RecordTaskContext(ctx, "task-chat-2", TaskContext{
		WorkspaceID:    workspace.ID,
		ConversationID: "project-conv",
	}); err != nil {
		t.Fatalf("RecordTaskContext project root: %v", err)
	}
	for _, ev := range []types.BridgeEvent{
		{EventID: "e-chat", TaskID: "task-chat-1", Type: "task.started", Payload: map[string]any{"document_type": "pptx", "topic": "Standalone chat"}},
		{EventID: "e-project", TaskID: "task-chat-2", Type: "task.started", Payload: map[string]any{"document_type": "docx", "topic": "Project chat"}},
	} {
		if err := store.RecordEvent(ev); err != nil {
			t.Fatalf("RecordEvent(%s): %v", ev.EventID, err)
		}
	}

	entries, err := store.QueryRecentTaskHistory(ctx, 10)
	if err != nil {
		t.Fatalf("QueryRecentTaskHistory: %v", err)
	}
	var standalone *types.TaskHistoryEntry
	for i := range entries {
		if entries[i].TaskID == "task-chat-1" {
			standalone = &entries[i]
		}
	}
	if standalone == nil {
		t.Fatalf("no-project task missing from history")
	}
	if standalone.WorkspaceID != "" || standalone.WorkspacePath != "" {
		t.Fatalf("no-project workspace metadata = %q %q, want empty", standalone.WorkspaceID, standalone.WorkspacePath)
	}

	workspaces, err := store.QueryWorkspaceSummaries(ctx, 10)
	if err != nil {
		t.Fatalf("QueryWorkspaceSummaries: %v", err)
	}
	if len(workspaces) != 1 {
		t.Fatalf("workspace summaries = %d, want 1", len(workspaces))
	}
}

func TestRemoveWorkspaceDetachesRunsFromWorkspace(t *testing.T) {
	store := newTempStore(t)
	ctx := context.Background()
	workspacePath := filepath.Join(t.TempDir(), "client-a")

	workspace, err := store.EnsureWorkspace(ctx, workspacePath)
	if err != nil {
		t.Fatalf("EnsureWorkspace: %v", err)
	}
	if err := store.EnsureConversation(ctx, workspace.ID, "conv-1", "Project chat"); err != nil {
		t.Fatalf("EnsureConversation: %v", err)
	}
	if err := store.RecordTaskContext(ctx, "task-1", TaskContext{
		WorkspaceID:    workspace.ID,
		ConversationID: "conv-1",
	}); err != nil {
		t.Fatalf("RecordTaskContext: %v", err)
	}
	if err := store.RecordEvent(types.BridgeEvent{
		EventID: "event-1",
		TaskID:  "task-1",
		Type:    "task.started",
		Payload: map[string]any{"document_type": "pptx", "topic": "Project chat"},
	}); err != nil {
		t.Fatalf("RecordEvent: %v", err)
	}

	if err := store.RemoveWorkspace(ctx, workspace.ID); err != nil {
		t.Fatalf("RemoveWorkspace: %v", err)
	}

	workspaces, err := store.QueryWorkspaceSummaries(ctx, 10)
	if err != nil {
		t.Fatalf("QueryWorkspaceSummaries: %v", err)
	}
	if len(workspaces) != 0 {
		t.Fatalf("workspace summaries = %#v, want empty", workspaces)
	}
	entries, err := store.QueryRecentTaskHistory(ctx, 10)
	if err != nil {
		t.Fatalf("QueryRecentTaskHistory: %v", err)
	}
	if len(entries) != 1 || entries[0].WorkspaceID != "" || entries[0].WorkspacePath != "" {
		t.Fatalf("history entries = %#v, want task detached from workspace", entries)
	}
}

func TestV7ProjectionReconcilesPostMigrationWritesOnReopen(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "officedex.db")
	ctx := context.Background()
	store := New(path)
	if err := store.Open(ctx); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordTaskContext(ctx, "task-later", TaskContext{ConversationID: "conv-later"}); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordEvent(types.BridgeEvent{EventID: "completed-later", TaskID: "task-later", Type: "task.completed"}); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordArtifact(types.Artifact{TaskID: "task-later", FilePath: "/tmp/later.pptx", FileName: "later.pptx", DocumentType: "pptx"}); err != nil {
		t.Fatal(err)
	}
	before, err := store.QueryDocuments(ctx, types.DocumentListInput{})
	if err != nil {
		t.Fatal(err)
	}
	if len(before.Items) != 1 || before.Items[0].CurrentArtifactTaskID != "task-later" {
		t.Fatalf("live projection did not reflect writes: %#v", before.Items)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	if err := store.Open(ctx); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	after, err := store.QueryDocuments(ctx, types.DocumentListInput{})
	if err != nil {
		t.Fatal(err)
	}
	if len(after.Items) != 1 || after.Items[0].CurrentArtifactTaskID != "task-later" {
		t.Fatalf("reconciled documents = %#v", after.Items)
	}
	runs, err := store.QueryDocumentRuns(ctx, after.Items[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 1 || runs[0].ID != "task-later" {
		t.Fatalf("reconciled runs = %#v", runs)
	}
}

func TestV7ProjectionIsLiveAfterLegacyWrites(t *testing.T) {
	store := newTempStore(t)
	ctx := context.Background()
	if err := store.RecordTaskContext(ctx, "live-task", TaskContext{ConversationID: "live-conversation"}); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordEvent(types.BridgeEvent{EventID: "started", TaskID: "live-task", Type: "task.started"}); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordArtifact(types.Artifact{TaskID: "live-task", FilePath: "/tmp/live.pptx", FileName: "live.pptx", DocumentType: "pptx"}); err != nil {
		t.Fatal(err)
	}
	docs, err := store.QueryDocuments(ctx, types.DocumentListInput{})
	if err != nil || len(docs.Items) != 1 || docs.Items[0].FilePath != "/tmp/live.pptx" {
		t.Fatalf("live documents = %#v, %v", docs, err)
	}
	runs, err := store.QueryDocumentRuns(ctx, docs.Items[0].ID)
	if err != nil || len(runs) != 1 || runs[0].ID != "live-task" {
		t.Fatalf("live runs = %#v, %v", runs, err)
	}
	activities, err := store.QueryDocumentActivities(ctx, types.DocumentActivityListInput{DocumentID: docs.Items[0].ID})
	if err != nil || len(activities.Items) != 1 || activities.Items[0].TaskID != "live-task" {
		t.Fatalf("live activities = %#v, %v", activities, err)
	}
}

func TestV7ProjectionSourceOnlyRunAndSharedStream(t *testing.T) {
	store := newTempStore(t)
	ctx := context.Background()
	for _, taskID := range []string{"root-a", "root-b"} {
		if err := store.RecordTaskContext(ctx, taskID, TaskContext{ConversationID: "shared-conversation"}); err != nil {
			t.Fatal(err)
		}
		if err := store.RecordEvent(types.BridgeEvent{EventID: "done-" + taskID, TaskID: taskID, Type: "task.completed"}); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.RecordArtifact(types.Artifact{TaskID: "root-a", FilePath: "/tmp/a.pptx", FileName: "a.pptx", DocumentType: "pptx"}); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordArtifact(types.Artifact{TaskID: "root-b", FilePath: "/tmp/b.pptx", FileName: "b.pptx", DocumentType: "pptx"}); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordTaskContext(ctx, "source-only", TaskContext{ConversationID: "shared-conversation"}); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordEvent(types.BridgeEvent{EventID: "source", TaskID: "source-only", Type: "task.user_input", Payload: map[string]any{"source_file": "/tmp/a.pptx"}}); err != nil {
		t.Fatal(err)
	}
	runs, err := store.QueryDocumentRuns(ctx, documentIDForPath("/tmp/a.pptx"))
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, run := range runs {
		if run.ID == "source-only" {
			found = true
			if run.DocumentID != documentIDForPath("/tmp/a.pptx") {
				t.Fatalf("source-only document = %q", run.DocumentID)
			}
		}
	}
	if !found {
		t.Fatalf("source-only run missing: %#v", runs)
	}
	for _, path := range []string{"/tmp/a.pptx", "/tmp/b.pptx"} {
		page, err := store.QueryDocumentActivities(ctx, types.DocumentActivityListInput{DocumentID: documentIDForPath(path)})
		if err != nil || len(page.Items) == 0 {
			t.Fatalf("activities for %s = %#v, %v", path, page, err)
		}
		for _, activity := range page.Items {
			if activity.ActivityStreamID != "activity:shared-conversation" {
				t.Fatalf("activity stream for %s = %q", path, activity.ActivityStreamID)
			}
		}
	}
}

func TestV7ProjectionAttachesLiveSourceOnlyRunAcrossConversations(t *testing.T) {
	store := newTempStore(t)
	ctx := context.Background()
	if err := store.RecordTaskContext(ctx, "root-document", TaskContext{ConversationID: "document-conversation"}); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordEvent(types.BridgeEvent{EventID: "root-completed", TaskID: "root-document", Type: "task.completed"}); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordArtifact(types.Artifact{TaskID: "root-document", FilePath: "/tmp/cross-conversation.pptx", FileName: "cross-conversation.pptx", DocumentType: "pptx"}); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordTaskContext(ctx, "source-rewrite", TaskContext{ConversationID: "rewrite-conversation"}); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordEvent(types.BridgeEvent{TaskID: "source-rewrite", Type: "task.user_input", TS: "2026-08-27T00:00:00Z", Payload: map[string]any{"source_file": "/tmp/cross-conversation.pptx"}}); err != nil {
		t.Fatal(err)
	}
	runs, err := store.QueryDocumentRuns(ctx, documentIDForPath("/tmp/cross-conversation.pptx"))
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 2 || runs[1].ID != "source-rewrite" || runs[1].SourceConversationID != "rewrite-conversation" {
		t.Fatalf("cross-conversation runs = %#v", runs)
	}
	activities, err := store.QueryDocumentActivities(ctx, types.DocumentActivityListInput{DocumentID: documentIDForPath("/tmp/cross-conversation.pptx")})
	if err != nil {
		t.Fatal(err)
	}
	streams := map[string]bool{}
	for _, activity := range activities.Items {
		streams[activity.ActivityStreamID] = true
	}
	if !streams["activity:document-conversation"] || !streams["activity:rewrite-conversation"] {
		t.Fatalf("cross-conversation activity streams = %#v", streams)
	}
}

func TestV7ProjectionEventIdentityAndDuplicateWritesAreStable(t *testing.T) {
	store := newTempStore(t)
	ctx := context.Background()
	if err := store.RecordTaskContext(ctx, "stable-task", TaskContext{ConversationID: "stable-conversation"}); err != nil {
		t.Fatal(err)
	}
	// No TS on purpose: an event without its own timestamp is ordered by write
	// time, which is what lets the replace below move it after the named event
	// (an event carrying a TS keeps its place; see TestRecordEventOrdersByEventTimestamp).
	event := types.BridgeEvent{TaskID: "stable-task", Type: "task.progress", Payload: map[string]any{"stage": "one"}}
	if err := store.RecordEvent(event); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordEvent(event); err != nil {
		t.Fatal(err)
	}
	page, err := store.QueryDocumentActivities(ctx, types.DocumentActivityListInput{DocumentID: documentIDForPath("/tmp/absent")})
	if err != nil || len(page.Items) != 0 {
		t.Fatalf("unexpected absent document activities = %#v, %v", page, err)
	}
	var count int
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM activities WHERE task_id = 'stable-task'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("duplicate event activities = %d, want 1", count)
	}
	var activityID, eventID string
	if err := store.db.QueryRowContext(ctx, `SELECT id, COALESCE(event_id, '') FROM activities WHERE task_id = 'stable-task'`).Scan(&activityID, &eventID); err != nil {
		t.Fatal(err)
	}
	if activityID != "stable-task:event:0:task.progress" || eventID != "" || strings.Contains(activityID, "2026") {
		t.Fatalf("unstable event identity: activity=%q event=%q", activityID, eventID)
	}
	if err := store.RecordEvent(types.BridgeEvent{EventID: "second", TaskID: "stable-task", Type: "task.progress", Payload: map[string]any{"stage": "two"}}); err != nil {
		t.Fatal(err)
	}
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM activities WHERE task_id = 'stable-task'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("activities after second event = %d, want 2", count)
	}
	// Replacing the id-less event moves it after the named event. Its ordinal
	// identity changes from event:0 to event:1; the obsolete projection row must
	// be removed instead of accumulating alongside the new identity.
	if err := store.RecordEvent(event); err != nil {
		t.Fatal(err)
	}
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM activities WHERE task_id = 'stable-task'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("activities after ordinal shift = %d, want 2", count)
	}
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM activities WHERE id = 'stable-task:event:0:task.progress'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("stale ordinal activity survived reprojection")
	}
	rows, err := store.db.QueryContext(ctx, `SELECT ordinal FROM activities WHERE task_id = 'stable-task' ORDER BY ordinal`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for want := 0; rows.Next(); want++ {
		var ordinal int
		if err := rows.Scan(&ordinal); err != nil {
			t.Fatal(err)
		}
		if ordinal != want {
			t.Fatalf("ordinal = %d, want %d", ordinal, want)
		}
	}
}

func TestSchemaMigrationFromV1DB(t *testing.T) {
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
	if version != 8 {
		t.Errorf("user_version = %d, want 8", version)
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

func TestMigrateV7BackfillsDocumentsRunsAndActivitiesIdempotently(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "officedex.db")
	ctx := context.Background()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	for _, ddl := range []string{schema, schemaV1, schemaV2, schemaV3, schemaV4, schemaV5, schemaV6} {
		if _, err := db.ExecContext(ctx, ddl); err != nil {
			t.Fatalf("apply legacy schema: %v", err)
		}
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO workspaces(id, path, name, created_at, updated_at) VALUES ('ws-1', '/workspace', 'Workspace', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
		INSERT INTO conversations(id, workspace_id, title, created_at, updated_at) VALUES
			('conv-a', 'ws-1', 'Two documents', '2026-01-01T00:00:00Z', '2026-01-03T00:00:00Z'),
			('conv-b', 'ws-1', 'Rewrite', '2026-01-02T00:00:00Z', '2026-01-04T00:00:00Z'),
			('conv-c', 'ws-1', 'No artifact', '2026-01-03T00:00:00Z', '2026-01-05T00:00:00Z');
		INSERT INTO tasks(id, status, document_type, topic, updated_at, conversation_id, parent_task_id, workspace_id) VALUES
			('task-a', 'completed', 'pptx', 'A', '2026-01-01T00:00:01Z', 'conv-a', '', 'ws-1'),
			('task-b', 'completed', 'docx', 'B', '2026-01-01T00:00:02Z', 'conv-a', '', 'ws-1'),
			('task-c', 'completed', 'pptx', 'C', '2026-01-02T00:00:01Z', 'conv-b', '', 'ws-1'),
			('task-d', 'completed', 'pptx', 'D', '2026-01-03T00:00:01Z', 'conv-c', '', 'ws-1'),
			('task-e', 'completed', 'pptx', 'E', '2026-01-02T00:00:00Z', 'conv-b', '', 'ws-1');
		INSERT INTO artifacts(file_path, task_id, file_id, file_name, document_type, preview_url, edit_url, synced_at) VALUES
			('/tmp/shared.pptx', 'task-a', 'file-a', 'shared.pptx', 'pptx', 'preview-a', 'edit-a', '2026-01-01T00:01:00Z'),
			('/tmp/second.docx', 'task-b', 'file-b', 'second.docx', 'docx', 'preview-b', 'edit-b', '2026-01-01T00:02:00Z');
		INSERT INTO task_events(event_id, task_id, type, payload_json, created_at, request_id) VALUES
			('task-a:e1', 'task-a', 'task.user_input', '{"source_file":""}', '2026-01-01T00:00:00Z', ''),
			('task-a:e2', 'task-a', 'task.completed', '{}', '2026-01-01T00:00:01Z', ''),
			('', 'task-b', 'task.completed', '{}', '2026-01-01T00:00:02Z', ''),
			('task-c:e1', 'task-c', 'task.user_input', '{"source_file":"/tmp/shared.pptx"}', '2026-01-02T00:00:00Z', ''),
			('task-d:e1', 'task-d', 'task.completed', '{}', '2026-01-03T00:00:01Z', ''),
			('task-e:e1', 'task-e', 'task.completed', '{}', '2026-01-02T00:00:02Z', '');
		PRAGMA user_version = 6;
	`)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	store := New(path)
	if err := store.Open(ctx); err != nil {
		t.Fatalf("Open v7: %v", err)
	}
	defer store.Close()
	assertV7Backfill(t, store)
	if _, err := store.db.ExecContext(ctx, `
		INSERT INTO activities(id, activity_stream_id, source_conversation_id, task_id, ordinal, kind, event_type, payload_json, created_at)
		VALUES ('stale-ordinal-activity', 'activity:conv-b', 'conv-b', 'task-c', 99, 'event', 'task.failed', '{}', '2026-01-02T00:00:03Z')
	`); err != nil {
		t.Fatalf("seed stale activity projection: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store = New(path)
	if err := store.Open(ctx); err != nil {
		t.Fatalf("reopen v7: %v", err)
	}
	defer store.Close()
	assertV7Backfill(t, store)
}

func assertV7Backfill(t *testing.T, store *Store) {
	t.Helper()
	ctx := context.Background()
	var count int
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM documents`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("documents = %d, want 2", count)
	}
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM runs`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 5 {
		t.Fatalf("runs = %d, want 5 tasks including unassociated terminal run", count)
	}
	var documentID, streamID, sourceFile string
	if err := store.db.QueryRowContext(ctx, `SELECT document_id, activity_stream_id, source_file FROM runs WHERE id = 'task-c'`).Scan(&documentID, &streamID, &sourceFile); err != nil {
		t.Fatal(err)
	}
	if documentID != "document:%2Ftmp%2Fshared.pptx" || streamID != "activity:conv-b" || sourceFile != "/tmp/shared.pptx" {
		t.Fatalf("source-only run = %q, %q, %q", documentID, streamID, sourceFile)
	}
	if err := store.db.QueryRowContext(ctx, `SELECT document_id FROM runs WHERE id = 'task-e'`).Scan(&documentID); err != nil {
		t.Fatal(err)
	}
	if documentID != "document:%2Ftmp%2Fshared.pptx" {
		t.Fatalf("same-conversation fallback run document = %q", documentID)
	}
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM document_activity_streams WHERE document_id = 'document:%2Ftmp%2Fshared.pptx'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("shared document streams = %d, want 2", count)
	}
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM activities`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 6 {
		t.Fatalf("activities = %d, want 6", count)
	}
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM activities WHERE id = 'task-b:event:0:task.completed'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatal("missing event ID did not use task-local event index")
	}
	var streamCreated, streamUpdated, documentUpdated string
	if err := store.db.QueryRowContext(ctx, `SELECT created_at, updated_at FROM activity_streams WHERE id = 'activity:conv-b'`).Scan(&streamCreated, &streamUpdated); err != nil {
		t.Fatal(err)
	}
	if streamCreated != "2026-01-02T00:00:00Z" || streamUpdated != "2026-01-02T00:00:02Z" {
		t.Fatalf("conv-b stream times = %q, %q", streamCreated, streamUpdated)
	}
	if err := store.db.QueryRowContext(ctx, `SELECT updated_at FROM documents WHERE id = 'document:%2Ftmp%2Fshared.pptx'`).Scan(&documentUpdated); err != nil {
		t.Fatal(err)
	}
	if documentUpdated != "2026-01-02T00:00:01Z" {
		t.Fatalf("document latest run time = %q, want source-only task-c time", documentUpdated)
	}
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM tasks WHERE id = 'task-d'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatal("legacy task was not preserved")
	}
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM legacy_migrations WHERE marker = 'documents-v1'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("migration marker count = %d, want 1", count)
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

func TestQueryDocumentsPaginatesAndFiltersWorkspace(t *testing.T) {
	store := newTempStore(t)
	ctx := context.Background()
	for _, row := range []struct{ id, path, name, workspace, updated string }{
		{"document:new", "/tmp/new.pptx", "new.pptx", "ws-a", "2026-08-27T12:00:00Z"},
		{"document:old", "/tmp/old.docx", "old.docx", "ws-a", "2026-08-27T10:00:00Z"},
		{"document:other", "/tmp/other.xlsx", "other.xlsx", "ws-b", "2026-08-27T11:00:00Z"},
	} {
		if _, err := store.db.ExecContext(ctx, `INSERT INTO documents(id, file_path, file_name, document_type, current_artifact_task_id, workspace_id, created_at, updated_at, migration_source) VALUES (?, ?, ?, 'pptx', 'task', ?, '2026-08-27T09:00:00Z', ?, 'test')`, row.id, row.path, row.name, row.workspace, row.updated); err != nil {
			t.Fatal(err)
		}
	}

	first, err := store.QueryDocuments(ctx, types.DocumentListInput{WorkspaceID: "ws-a", Limit: 1})
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Items) != 1 || first.Items[0].ID != "document:new" || first.NextCursor == "" {
		t.Fatalf("first page = %#v", first)
	}
	second, err := store.QueryDocuments(ctx, types.DocumentListInput{WorkspaceID: "ws-a", Limit: 1, Cursor: first.NextCursor})
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Items) != 1 || second.Items[0].ID != "document:old" || second.NextCursor != "" {
		t.Fatalf("second page = %#v", second)
	}
	document, found, err := store.GetDocument(ctx, "document:new")
	if err != nil || !found || document.FilePath != "/tmp/new.pptx" {
		t.Fatalf("GetDocument = %#v, %v, %v", document, found, err)
	}
}

func TestQueryDocumentRunsAndActivity(t *testing.T) {
	store := newTempStore(t)
	ctx := context.Background()
	_, err := store.db.ExecContext(ctx, `
		INSERT INTO documents(id, file_path, file_name, document_type, created_at, updated_at, migration_source) VALUES ('document:one', '/tmp/one.pptx', 'one.pptx', 'pptx', '2026-08-27T09:00:00Z', '2026-08-27T12:00:00Z', 'test');
		INSERT INTO activity_streams(id, source_conversation_id, created_at, updated_at) VALUES ('activity:one', 'conversation-one', '2026-08-27T09:00:00Z', '2026-08-27T12:00:00Z');
		INSERT INTO document_activity_streams(document_id, activity_stream_id) VALUES ('document:one', 'activity:one');
		INSERT INTO runs(id, document_id, activity_stream_id, source_conversation_id, status, created_at, updated_at) VALUES
			('run-1', 'document:one', 'activity:one', 'conversation-one', 'completed', '2026-08-27T09:00:00Z', '2026-08-27T10:00:00Z'),
			('run-2', 'document:one', 'activity:one', 'conversation-one', 'running', '2026-08-27T11:00:00Z', '2026-08-27T12:00:00Z');
		INSERT INTO activities(id, activity_stream_id, source_conversation_id, task_id, ordinal, kind, event_type, payload_json, created_at) VALUES
			('activity-1', 'activity:one', 'conversation-one', 'run-1', 0, 'event', 'task.started', '{}', '2026-08-27T09:00:00Z'),
			('activity-2', 'activity:one', 'conversation-one', 'run-2', 1, 'event', 'task.started', '{}', '2026-08-27T11:00:00Z');
	`)
	if err != nil {
		t.Fatal(err)
	}
	runs, err := store.QueryDocumentRuns(ctx, "document:one")
	if err != nil || len(runs) != 2 || runs[0].ID != "run-1" || runs[1].ID != "run-2" {
		t.Fatalf("runs = %#v, %v", runs, err)
	}
	first, err := store.QueryDocumentActivities(ctx, types.DocumentActivityListInput{DocumentID: "document:one", Limit: 1})
	if err != nil || len(first.Items) != 1 || first.Items[0].ID != "activity-1" || first.NextCursor == "" {
		t.Fatalf("first activities = %#v, %v", first, err)
	}
	second, err := store.QueryDocumentActivities(ctx, types.DocumentActivityListInput{DocumentID: "document:one", Limit: 1, Cursor: first.NextCursor})
	if err != nil || len(second.Items) != 1 || second.Items[0].ID != "activity-2" || second.NextCursor != "" {
		t.Fatalf("second activities = %#v, %v", second, err)
	}
}

func TestQueryTaskHistoryByIDIsExact(t *testing.T) {
	store := newTempStore(t)
	ctx := context.Background()
	if err := store.RecordTaskContext(ctx, "task-exact", TaskContext{ConversationID: "conversation-exact", WorkspaceID: ""}); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordEvent(types.BridgeEvent{EventID: "exact-started", TaskID: "task-exact", Type: "task.started", Payload: map[string]any{"topic": "Exact"}}); err != nil {
		t.Fatal(err)
	}
	entry, found, err := store.QueryTaskHistoryByID(ctx, "task-exact")
	if err != nil || !found || entry.TaskID != "task-exact" || entry.ConversationID != "conversation-exact" || len(entry.Events) != 1 {
		t.Fatalf("exact history = %#v, %v, %v", entry, found, err)
	}
	_, found, err = store.QueryTaskHistoryByID(ctx, "missing")
	if err != nil || found {
		t.Fatalf("missing found=%v err=%v", found, err)
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

func TestTaskCreatedAtIsImmutableAndExposedInHistory(t *testing.T) {
	store := newTempStore(t)
	ctx := context.Background()
	if err := store.RecordEvent(types.BridgeEvent{EventID: "evt-1", TaskID: "task-created", Type: "task.started"}); err != nil {
		t.Fatalf("first RecordEvent: %v", err)
	}
	var createdAt string
	if err := store.db.QueryRow(`SELECT created_at FROM tasks WHERE id = ?`, "task-created").Scan(&createdAt); err != nil {
		t.Fatalf("read created_at: %v", err)
	}
	if createdAt == "" {
		t.Fatal("created_at is empty")
	}
	if err := store.RecordEvent(types.BridgeEvent{EventID: "evt-2", TaskID: "task-created", Type: "task.completed"}); err != nil {
		t.Fatalf("second RecordEvent: %v", err)
	}
	var after string
	if err := store.db.QueryRow(`SELECT created_at FROM tasks WHERE id = ?`, "task-created").Scan(&after); err != nil {
		t.Fatalf("read updated created_at: %v", err)
	}
	if after != createdAt {
		t.Fatalf("created_at changed from %q to %q", createdAt, after)
	}
	entry, found, err := store.QueryTaskHistoryByID(ctx, "task-created")
	if err != nil || !found {
		t.Fatalf("QueryTaskHistoryByID found=%v err=%v", found, err)
	}
	if entry.CreatedAt != createdAt {
		t.Fatalf("history CreatedAt = %q, want %q", entry.CreatedAt, createdAt)
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
			'idx_task_events_task_created', 'idx_task_events_created', 'idx_tasks_created'
		)`).Scan(&count)
	if err != nil {
		t.Fatal(err)
	}
	if count != 3 {
		t.Errorf("expected 3 indices, got %d", count)
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
	if version != 8 {
		t.Errorf("user_version = %d, want 8", version)
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

// The bridge's events are persisted by a writer goroutine and locally
// synthesised events used to be written inline, so write order and event order
// diverged. Recovery reads a task's history ORDER BY created_at and trusts the
// last row, so created_at has to be the moment the event happened.
func TestRecordEventOrdersByEventTimestamp(t *testing.T) {
	store := newTempStore(t)
	ctx := context.Background()
	later := types.BridgeEvent{EventID: "cancelled", TaskID: "ts-task", Type: "task.cancelled", TS: "2026-09-04T10:00:05Z"}
	earlier := types.BridgeEvent{EventID: "question", TaskID: "ts-task", Type: "task.question", TS: "2026-09-04T10:00:01Z", Payload: map[string]any{"prompt": "which style?"}}
	// Written in the wrong order, as a queued bridge event landing after an
	// inline local one would have been.
	if err := store.RecordEvent(later); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordEvent(earlier); err != nil {
		t.Fatal(err)
	}
	rows, err := store.db.QueryContext(ctx, `SELECT type, created_at FROM task_events WHERE task_id = 'ts-task' ORDER BY created_at ASC`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var got []string
	for rows.Next() {
		var typ, createdAt string
		if err := rows.Scan(&typ, &createdAt); err != nil {
			t.Fatal(err)
		}
		got = append(got, typ+"@"+createdAt)
	}
	want := []string{"task.question@2026-09-04T10:00:01Z", "task.cancelled@2026-09-04T10:00:05Z"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("events ordered by created_at = %v, want %v (event TS, not write time)", got, want)
	}

	// Re-recording an event with a TS must not move it.
	if err := store.RecordEvent(earlier); err != nil {
		t.Fatal(err)
	}
	var createdAt string
	if err := store.db.QueryRowContext(ctx, `SELECT created_at FROM task_events WHERE task_id = 'ts-task' AND type = 'task.question'`).Scan(&createdAt); err != nil {
		t.Fatal(err)
	}
	if createdAt != "2026-09-04T10:00:01Z" {
		t.Fatalf("re-recording moved the event to %s", createdAt)
	}

	// An unparseable TS falls back to write time rather than failing the write.
	if err := store.RecordEvent(types.BridgeEvent{EventID: "odd", TaskID: "ts-task", Type: "task.progress", TS: "yesterday-ish"}); err != nil {
		t.Fatalf("unparseable TS must not fail the write: %v", err)
	}
}
