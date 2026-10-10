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

// A project's Assets are references. Adding a file to a project changes which
// folder lists it and nothing else: the id, the name and the file on disk all
// stay where they were (WORKSPACE-STANDARD: "不自动搬走或复制", "原文件仍可在 Local 打开").
// The earlier version moved the file and never changed the folder, so the file
// vanished from where the user kept it and never appeared in the project.
func TestMoveDocumentRefilesWithoutTouchingTheDisk(t *testing.T) {
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
	if after.WorkspaceID != folder.ID {
		t.Errorf("workspace = %q, want the folder %q", after.WorkspaceID, folder.ID)
	}
	if after.FilePath != original || after.FileName != before.FileName {
		t.Errorf("moving relocated the file: %s → %s", original, after.FilePath)
	}
	if _, err := os.Stat(original); err != nil {
		t.Errorf("original file is gone: %v", err)
	}
	if entries, _ := os.ReadDir(folder.Path); len(entries) != 0 {
		t.Errorf("a reference was copied into the folder directory: %v", entries)
	}
	inFolder, err := app.ListDocuments(types.DocumentListInput{WorkspaceID: folder.ID})
	if err != nil || len(inFolder.Items) != 1 || inFolder.Items[0].ID != before.ID {
		t.Fatalf("project listing = %+v, %v; want the moved document", inFolder.Items, err)
	}

	// "Remove project reference" is the move back to the default folder.
	back, err := app.MoveDocument(before.ID, DefaultFolderID)
	if err != nil {
		t.Fatalf("MoveDocument(default): %v", err)
	}
	if back.WorkspaceID != "" {
		t.Errorf("workspace after removing the reference = %q, want none", back.WorkspaceID)
	}
	if back.FilePath != original {
		t.Errorf("removing the reference relocated the file to %s", back.FilePath)
	}
	inFolder, err = app.ListDocuments(types.DocumentListInput{WorkspaceID: folder.ID})
	if err != nil || len(inFolder.Items) != 0 {
		t.Errorf("project still lists the document after the reference was removed: %+v, %v", inFolder.Items, err)
	}
}

// A file the agent wrote into a project's directory stays there when its
// reference is removed; the directory is not the library.
func TestMoveDocumentToDefaultLeavesAProjectFileInPlace(t *testing.T) {
	app, store, _ := newFolderTestApp(t)
	folder, err := app.CreateFolder("Client work")
	if err != nil {
		t.Fatalf("CreateFolder: %v", err)
	}
	generated := filepath.Join(folder.Path, "report.docx")
	seedDocument(t, store, "task-report", folder.ID, generated)
	before := seededDocument(t, app, "task-report", generated)
	if before.WorkspaceID != folder.ID {
		t.Fatalf("seeded document is filed under %q, want %q", before.WorkspaceID, folder.ID)
	}

	after, err := app.MoveDocument(before.ID, DefaultFolderID)
	if err != nil {
		t.Fatalf("MoveDocument(default): %v", err)
	}
	if after.WorkspaceID != "" || after.FilePath != generated {
		t.Errorf("after removing the reference: workspace=%q path=%s; want no workspace and the same path", after.WorkspaceID, after.FilePath)
	}
	if _, err := os.Stat(generated); err != nil {
		t.Errorf("file left the project directory: %v", err)
	}
}

func TestMoveDocumentRefusesAnUnknownFolder(t *testing.T) {
	app, store, workspaceDir := newFolderTestApp(t)
	original := filepath.Join(workspaceDir, "deck.pptx")
	seedDocument(t, store, "task-deck", "", original)
	before := seededDocument(t, app, "task-deck", original)

	if _, err := app.MoveDocument(before.ID, "folder:nowhere"); err == nil {
		t.Error("expected a refusal for a folder that does not exist")
	}
	unchanged, err := app.GetDocument(before.ID)
	if err != nil || unchanged.WorkspaceID != "" {
		t.Errorf("a refused move changed the document: %+v, %v", unchanged, err)
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

func TestArtifactSuggestionApplyAndUndoRestoresSource(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "source.docx")
	artifact := filepath.Join(dir, "source.modified.docx")
	if err := os.WriteFile(source, []byte("before"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(artifact, []byte("after"), 0o644); err != nil {
		t.Fatal(err)
	}
	app := &App{artifactSuggestionBackups: make(map[string]artifactSuggestionBackup)}
	input := ArtifactSuggestionFileInput{SuggestionID: "task-1", SourceFile: source, ArtifactFile: artifact, ExpectedSourceSHA256: sha256Hex([]byte("before"))}
	if err := app.ApplyArtifactSuggestion(input); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "after" {
		t.Fatalf("applied source = %q, want after", got)
	}
	if err := app.UndoArtifactSuggestion(input); err != nil {
		t.Fatal(err)
	}
	got, err = os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "before" {
		t.Fatalf("restored source = %q, want before", got)
	}
	if err := app.UndoArtifactSuggestion(input); err == nil {
		t.Fatal("second undo unexpectedly succeeded")
	}
}

func TestArtifactSuggestionProtectsSourceAndUndo(t *testing.T) {
	for _, scenario := range []string{"changed-before-apply", "readonly-apply", "changed-before-undo", "wrong-undo-target", "preserve-mode", "no-baseline"} {
		t.Run(scenario, func(t *testing.T) {
			dir := t.TempDir()
			source, artifact := filepath.Join(dir, "source.docx"), filepath.Join(dir, "source.modified.docx")
			if err := os.WriteFile(source, []byte("original"), 0o600); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(artifact, []byte("proposal"), 0o600); err != nil {
				t.Fatal(err)
			}
			app := &App{}
			input := ArtifactSuggestionFileInput{SuggestionID: t.Name(), SourceFile: source, ArtifactFile: artifact, ExpectedSourceSHA256: sha256Hex([]byte("original"))}
			assertContent := func(want string) {
				t.Helper()
				got, err := os.ReadFile(source)
				if err != nil || string(got) != want {
					t.Fatalf("source = %q, %v; want %q", got, err, want)
				}
			}
			switch scenario {
			case "changed-before-apply":
				if err := os.WriteFile(source, []byte("external"), 0o600); err != nil {
					t.Fatal(err)
				}
				if err := app.ApplyArtifactSuggestion(input); err == nil {
					t.Fatal("overwrote external change")
				}
				assertContent("external")
			case "readonly-apply":
				if err := os.Chmod(source, 0o444); err != nil {
					t.Fatal(err)
				}
				if err := app.ApplyArtifactSuggestion(input); err == nil {
					t.Fatal("replaced read-only source")
				}
				assertContent("original")
			case "no-baseline":
				input.ExpectedSourceSHA256 = ""
				if err := app.ApplyArtifactSuggestion(input); err == nil {
					t.Fatal("applied without source baseline")
				}
				assertContent("original")
			default:
				if err := app.ApplyArtifactSuggestion(input); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() {
					for _, backup := range app.artifactSuggestionBackups {
						os.Remove(backup.Path)
					}
				})
				assertContent("proposal")
				if scenario == "changed-before-undo" {
					if err := os.WriteFile(source, []byte("later edit"), 0o600); err != nil {
						t.Fatal(err)
					}
					if err := app.UndoArtifactSuggestion(input); err == nil {
						t.Fatal("undo discarded later edit")
					}
					assertContent("later edit")
				} else if scenario == "wrong-undo-target" {
					other := filepath.Join(dir, "other.docx")
					if err := os.WriteFile(other, []byte("unrelated"), 0o600); err != nil {
						t.Fatal(err)
					}
					wrong := input
					wrong.SourceFile = other
					if err := app.UndoArtifactSuggestion(wrong); err == nil {
						t.Fatal("undo wrote another target")
					}
					data, _ := os.ReadFile(other)
					if string(data) != "unrelated" {
						t.Fatal("other file changed")
					}
				} else {
					info, _ := os.Stat(source)
					if info.Mode().Perm() != 0o600 {
						t.Fatalf("mode changed: %v", info.Mode())
					}
					if err := app.UndoArtifactSuggestion(input); err != nil {
						t.Fatal(err)
					}
					assertContent("original")
				}
			}
		})
	}
}

func TestArtifactSuggestionReport23RealDOCXRoundTrip(t *testing.T) {
	before, err := os.ReadFile("testdata/acceptance/OD23-single.docx")
	if err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile("testdata/acceptance/OD23-single.modified.docx")
	if err != nil {
		t.Fatal(err)
	}
	if sha256Hex(before) != "8debfcad754b255ed20793608ef713bd7548451a81baa027f6e7994f82dab663" || sha256Hex(after) != "5de971501965f3c3e46d75c15ed0e56a01b75a9c76c1983e759e8a05e03817e0" {
		t.Fatal("QA evidence changed")
	}
	dir := t.TempDir()
	source, artifact := filepath.Join(dir, "original.docx"), filepath.Join(dir, "proposal.docx")
	if err := os.WriteFile(source, before, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(artifact, after, 0600); err != nil {
		t.Fatal(err)
	}
	app := &App{}
	input := ArtifactSuggestionFileInput{SuggestionID: "real-docx", SourceFile: source, ArtifactFile: artifact, ExpectedSourceSHA256: sha256Hex(before)}
	if err := app.ApplyArtifactSuggestion(input); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		for _, b := range app.artifactSuggestionBackups {
			os.Remove(b.Path)
		}
	})
	saved, _ := os.ReadFile(source)
	if sha256Hex(saved) != sha256Hex(after) {
		t.Fatal("Complete without actual source write")
	}
	if err := app.UndoArtifactSuggestion(input); err != nil {
		t.Fatal(err)
	}
	restored, _ := os.ReadFile(source)
	if sha256Hex(restored) != sha256Hex(before) {
		t.Fatal("Undo did not restore original package")
	}
}
