package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"officedex/internal/types"
)

func seededDocument(t *testing.T, app *App, taskID, path string) types.DocumentRecord {
	t.Helper()
	if err := os.WriteFile(path, []byte("content"), 0o644); err != nil {
		t.Fatal(err)
	}
	page, err := app.ListDocuments(types.DocumentListInput{})
	if err != nil {
		t.Fatalf("ListDocuments: %v", err)
	}
	for _, item := range page.Items {
		if item.FilePath == path {
			return item
		}
	}
	t.Fatalf("no document for %s in %+v", path, page.Items)
	return types.DocumentRecord{}
}

// The id used to be a pure function of the path, so a rename produced a
// different document and every reference the UI held went stale. The path is an
// attribute now.
func TestRenameDocumentKeepsTheIDAndMovesTheFile(t *testing.T) {
	app, store, workspaceDir := newFolderTestApp(t)
	original := filepath.Join(workspaceDir, "draft.pptx")
	seedDocument(t, store, "task-deck", "", original)
	before := seededDocument(t, app, "task-deck", original)

	after, err := app.RenameDocument(before.ID, "Q3 review")
	if err != nil {
		t.Fatalf("RenameDocument: %v", err)
	}
	if after.ID != before.ID {
		t.Errorf("id changed from %s to %s", before.ID, after.ID)
	}
	if after.FileName != "Q3 review.pptx" {
		t.Errorf("name = %q, want the extension preserved", after.FileName)
	}
	if _, err := os.Stat(after.FilePath); err != nil {
		t.Errorf("renamed file is not on disk: %v", err)
	}
	if _, err := os.Stat(original); !os.IsNotExist(err) {
		t.Errorf("original file still present: %v", err)
	}
	// Looking it up by the id the UI already had must still work.
	found, err := app.GetDocument(before.ID)
	if err != nil || found.FilePath != after.FilePath {
		t.Errorf("GetDocument(%s) = %+v, %v", before.ID, found, err)
	}
}

// Typing the extension the file already has should not double it.
func TestRenameDocumentDoesNotDoubleTheExtension(t *testing.T) {
	app, store, workspaceDir := newFolderTestApp(t)
	original := filepath.Join(workspaceDir, "draft.pptx")
	seedDocument(t, store, "task-deck", "", original)
	before := seededDocument(t, app, "task-deck", original)

	after, err := app.RenameDocument(before.ID, "Final.pptx")
	if err != nil {
		t.Fatalf("RenameDocument: %v", err)
	}
	if after.FileName != "Final.pptx" {
		t.Errorf("name = %q, want Final.pptx", after.FileName)
	}
}

func TestRenameDocumentRefusesCollisionsAndBadNames(t *testing.T) {
	app, store, workspaceDir := newFolderTestApp(t)
	original := filepath.Join(workspaceDir, "draft.pptx")
	taken := filepath.Join(workspaceDir, "taken.pptx")
	seedDocument(t, store, "task-deck", "", original)
	if err := os.WriteFile(taken, []byte("other"), 0o644); err != nil {
		t.Fatal(err)
	}
	before := seededDocument(t, app, "task-deck", original)

	if _, err := app.RenameDocument(before.ID, "taken"); err == nil {
		t.Error("expected a refusal when the destination name is taken")
	}
	// A name that turns into a different path is not the rename that was asked
	// for, so it is refused rather than quietly rewritten.
	for _, bad := range []string{"", "   ", "..", "sub/deck", "../escape"} {
		if _, err := app.RenameDocument(before.ID, bad); err == nil {
			t.Errorf("expected a refusal for name %q", bad)
		}
	}
	// The original is untouched by every one of those refusals.
	if _, err := os.Stat(original); err != nil {
		t.Errorf("a refused rename moved the file: %v", err)
	}
}

// A file deleted outside the app is reported rather than papered over: the row
// would otherwise point at a path that never existed.
func TestRenameDocumentReportsAFileDeletedOutsideTheApp(t *testing.T) {
	app, store, workspaceDir := newFolderTestApp(t)
	original := filepath.Join(workspaceDir, "draft.pptx")
	seedDocument(t, store, "task-deck", "", original)
	before := seededDocument(t, app, "task-deck", original)

	if err := os.Remove(original); err != nil {
		t.Fatal(err)
	}
	if _, err := app.RenameDocument(before.ID, "Anything"); err == nil {
		t.Error("expected an error when the file is gone")
	}
}

func TestMoveDocumentMovesTheFileAndKeepsTheID(t *testing.T) {
	app, store, workspaceDir := newFolderTestApp(t)
	original := filepath.Join(workspaceDir, "deck.pptx")
	seedDocument(t, store, "task-deck", "", original)
	before := seededDocument(t, app, "task-deck", original)

	folder, err := app.CreateFolder("Client work")
	if err != nil {
		t.Fatalf("CreateFolder: %v", err)
	}
	after, err := app.MoveDocument(before.ID, folder.ID)
	if err != nil {
		t.Fatalf("MoveDocument: %v", err)
	}
	if after.ID != before.ID {
		t.Errorf("id changed from %s to %s", before.ID, after.ID)
	}
	if filepath.Dir(after.FilePath) != folder.Path {
		t.Errorf("file is in %s, want %s", filepath.Dir(after.FilePath), folder.Path)
	}
	if after.FileName != before.FileName {
		t.Errorf("moving renamed the file: %q → %q", before.FileName, after.FileName)
	}
	if _, err := os.Stat(after.FilePath); err != nil {
		t.Errorf("moved file is not on disk: %v", err)
	}

	// Moving back to the default folder works by id too.
	back, err := app.MoveDocument(before.ID, DefaultFolderID)
	if err != nil {
		t.Fatalf("MoveDocument(default): %v", err)
	}
	if filepath.Dir(back.FilePath) != workspaceDir {
		t.Errorf("file is in %s, want the default folder %s", filepath.Dir(back.FilePath), workspaceDir)
	}
}

func TestMoveDocumentRefusesACollision(t *testing.T) {
	app, store, workspaceDir := newFolderTestApp(t)
	original := filepath.Join(workspaceDir, "deck.pptx")
	seedDocument(t, store, "task-deck", "", original)
	before := seededDocument(t, app, "task-deck", original)

	folder, err := app.CreateFolder("Client work")
	if err != nil {
		t.Fatalf("CreateFolder: %v", err)
	}
	if err := os.WriteFile(filepath.Join(folder.Path, "deck.pptx"), []byte("other"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := app.MoveDocument(before.ID, folder.ID); err == nil {
		t.Error("expected a refusal when the destination already has that name")
	}
	if _, err := os.Stat(original); err != nil {
		t.Errorf("a refused move still moved the file: %v", err)
	}
}

// The copy has no run behind it, so it is written through the artifacts table
// the projection reads — a rebuild has to reproduce it rather than drop it.
func TestDuplicateDocumentCopiesTheFileAndIsAnOwnDocument(t *testing.T) {
	app, store, workspaceDir := newFolderTestApp(t)
	original := filepath.Join(workspaceDir, "deck.pptx")
	seedDocument(t, store, "task-deck", "", original)
	before := seededDocument(t, app, "task-deck", original)

	copied, err := app.DuplicateDocument(before.ID)
	if err != nil {
		t.Fatalf("DuplicateDocument: %v", err)
	}
	if copied.ID == before.ID {
		t.Error("the copy shares the original's id")
	}
	if copied.FileName != "deck copy.pptx" {
		t.Errorf("copy name = %q, want \"deck copy.pptx\"", copied.FileName)
	}
	if copied.MigrationSource != "user" {
		t.Errorf("migration source = %q, want user", copied.MigrationSource)
	}
	for _, path := range []string{original, copied.FilePath} {
		if _, err := os.Stat(path); err != nil {
			t.Errorf("%s missing after duplicate: %v", path, err)
		}
	}
	// Both are listed, and the copy is reachable by its own id.
	page, err := app.ListDocuments(types.DocumentListInput{})
	if err != nil || len(page.Items) != 2 {
		t.Fatalf("ListDocuments = %+v, %v; want both", page.Items, err)
	}
	if _, err := app.GetDocument(copied.ID); err != nil {
		t.Errorf("GetDocument(copy): %v", err)
	}

	// Duplicating twice does not collide.
	second, err := app.DuplicateDocument(before.ID)
	if err != nil {
		t.Fatalf("second DuplicateDocument: %v", err)
	}
	if second.FilePath == copied.FilePath {
		t.Errorf("both copies landed at %s", second.FilePath)
	}
	if !strings.Contains(second.FileName, "copy") {
		t.Errorf("second copy name = %q", second.FileName)
	}
}

// Renaming must not rewrite history: task_events records what happened, and
// what happened happened at the old path.
func TestRelocatingLeavesTheActivityStreamAlone(t *testing.T) {
	app, store, workspaceDir := newFolderTestApp(t)
	original := filepath.Join(workspaceDir, "deck.pptx")
	seedDocument(t, store, "task-deck", "", original)
	before := seededDocument(t, app, "task-deck", original)

	activitiesBefore, err := app.ListDocumentActivities(types.DocumentActivityListInput{DocumentID: before.ID})
	if err != nil {
		t.Fatalf("ListDocumentActivities: %v", err)
	}
	if _, err := app.RenameDocument(before.ID, "Renamed"); err != nil {
		t.Fatalf("RenameDocument: %v", err)
	}
	activitiesAfter, err := app.ListDocumentActivities(types.DocumentActivityListInput{DocumentID: before.ID})
	if err != nil {
		t.Fatalf("ListDocumentActivities after rename: %v", err)
	}
	if len(activitiesAfter.Items) != len(activitiesBefore.Items) {
		t.Errorf("activity count changed from %d to %d", len(activitiesBefore.Items), len(activitiesAfter.Items))
	}
}
