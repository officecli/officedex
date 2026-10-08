package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"officedex/internal/localstore"
	"officedex/internal/preview"
	"officedex/internal/types"
)

func newRecentFilesTestApp(t *testing.T) (*App, *localstore.Store) {
	t.Helper()
	root := t.TempDir()
	store := localstore.New(filepath.Join(root, "officedex.db"))
	if err := store.Open(context.Background()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	trusted := filepath.Join(root, "trusted")
	if err := os.MkdirAll(trusted, 0o755); err != nil {
		t.Fatal(err)
	}
	reg, err := preview.New(preview.RegistryOptions{TrustedRoots: []string{trusted}})
	if err != nil {
		t.Fatal(err)
	}
	return &App{localStore: store, previewReg: reg, workspaceDir: trusted}, store
}

func TestListRecentFilesFiltersByWorkspaceAndRemoveKeepsDiskFile(t *testing.T) {
	app, store := newRecentFilesTestApp(t)
	ctx := context.Background()
	root := t.TempDir()
	firstPath := filepath.Join(root, "first.pptx")
	secondPath := filepath.Join(root, "second.docx")
	for _, path := range []string{firstPath, secondPath} {
		if err := os.WriteFile(path, []byte("content"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.UpsertRecentFile(ctx, types.RecentFile{FilePath: firstPath, FileName: "first.pptx", DocumentType: "pptx", Source: "generated", WorkspaceID: "ws-a", LastOpenedAt: "2026-08-05T01:00:00Z"}); err != nil {
		t.Fatal(err)
	}
	if err := store.UpsertRecentFile(ctx, types.RecentFile{FilePath: secondPath, FileName: "second.docx", DocumentType: "docx", Source: "local", WorkspaceID: "ws-b", LastOpenedAt: "2026-08-05T02:00:00Z"}); err != nil {
		t.Fatal(err)
	}
	files, err := app.ListRecentFiles("ws-a")
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 1 || files[0].FilePath != firstPath {
		t.Fatalf("filtered files = %#v", files)
	}
	if err := app.RemoveRecentFile(firstPath); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(firstPath); err != nil {
		t.Fatalf("RemoveRecentFile touched disk file: %v", err)
	}
	files, err = app.ListRecentFiles("")
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 1 || files[0].FilePath != secondPath {
		t.Fatalf("remaining files = %#v", files)
	}
}

func TestRenameWorkspaceTrimsNameAndPreservesSummary(t *testing.T) {
	app, store := newRecentFilesTestApp(t)
	ctx := context.Background()
	workspacePath := t.TempDir()
	workspace, err := store.EnsureWorkspace(ctx, workspacePath)
	if err != nil {
		t.Fatal(err)
	}
	renamed, err := app.RenameWorkspace(workspace.ID, "  Product launch  ")
	if err != nil {
		t.Fatal(err)
	}
	if renamed.Name != "Product launch" || renamed.Path != workspacePath {
		t.Fatalf("renamed workspace = %#v", renamed)
	}
}

func TestOpenRecentFileAuthorizesSelectedFileAndRefreshesTimestamp(t *testing.T) {
	app, store := newRecentFilesTestApp(t)
	ctx := context.Background()
	selected := filepath.Join(t.TempDir(), "selected.pdf")
	if err := os.WriteFile(selected, []byte("pdf"), 0o644); err != nil {
		t.Fatal(err)
	}
	recent := types.RecentFile{FilePath: selected, FileName: "selected.pdf", DocumentType: "", Source: "local", LastOpenedAt: "2026-08-01T00:00:00Z"}
	artifact, err := app.OpenRecentFile(recent)
	if err != nil {
		t.Fatal(err)
	}
	if artifact.FilePath != selected || artifact.DocumentType != "pdf" {
		t.Fatalf("artifact = %#v", artifact)
	}
	if _, err := app.IssuePreviewToken(artifact); err != nil {
		t.Fatalf("selected artifact was not previewable: %v", err)
	}
	files, err := store.QueryRecentFiles(ctx, "", 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 1 || files[0].LastOpenedAt == recent.LastOpenedAt || files[0].Source != "local" {
		t.Fatalf("recent file was not refreshed: %#v", files)
	}
}

func TestOpenRecentFileInfersConcretePreviewTypeForGeneratedReport(t *testing.T) {
	app, _ := newRecentFilesTestApp(t)
	selected := filepath.Join(t.TempDir(), "report.pdf")
	if err := os.WriteFile(selected, []byte("pdf"), 0o644); err != nil {
		t.Fatal(err)
	}
	artifact, err := app.OpenRecentFile(types.RecentFile{
		FilePath: selected, FileName: "report.pdf", DocumentType: "report",
		Source: "generated", LastOpenedAt: "2026-08-01T00:00:00Z",
	})
	if err != nil {
		t.Fatal(err)
	}
	if artifact.DocumentType != "pdf" {
		t.Fatalf("document type = %q, want pdf", artifact.DocumentType)
	}
}

func TestRecordArtifactAddsGeneratedRecentFileWithTaskContext(t *testing.T) {
	app, store := newRecentFilesTestApp(t)
	ctx := context.Background()
	filePath := filepath.Join(app.workspaceDir, "generated.pptx")
	if err := os.WriteFile(filePath, []byte("pptx"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordTaskContext(ctx, "task-generated", localstore.TaskContext{WorkspaceID: "ws-a", ConversationID: "conv-a"}); err != nil {
		t.Fatal(err)
	}
	if err := app.RecordArtifact(types.Artifact{TaskID: "task-generated", FilePath: filePath, FileName: "generated.pptx", DocumentType: "pptx"}); err != nil {
		t.Fatal(err)
	}
	files, err := app.ListRecentFiles("ws-a")
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 1 || files[0].Source != "generated" || files[0].ConversationID != "conv-a" || files[0].TaskID != "task-generated" {
		t.Fatalf("generated recent file = %#v", files)
	}
}
