package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"officedex/internal/localstore"
	"officedex/internal/preview"
	"officedex/internal/types"
)

// An app that can actually import: OpenRecentFile needs a preview registry to
// clear the file with, and the registry only trusts paths under its roots.
func newLocalFileTestApp(t *testing.T) (*App, *localstore.Store, string) {
	t.Helper()
	root := t.TempDir()
	workspaceDir := filepath.Join(root, "OfficeDex")
	if err := os.MkdirAll(workspaceDir, 0o755); err != nil {
		t.Fatal(err)
	}
	store := localstore.New(filepath.Join(root, "officedex.db"))
	if err := store.Open(context.Background()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	reg, err := preview.New(preview.RegistryOptions{TrustedRoots: []string{root}})
	if err != nil {
		t.Fatalf("preview registry: %v", err)
	}
	return &App{localStore: store, workspaceDir: workspaceDir, previewReg: reg}, store, root
}

func writeLocalFile(t *testing.T, dir, name string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte("content"), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

// The seam this whole feature turns on: OpenRecentFile wrote recent_files and
// nothing else, so a file opened from disk was remembered as recent and listed
// nowhere. The file list reads the projection.
func TestImportLocalFileAppearsInTheDocumentList(t *testing.T) {
	app, _, root := newLocalFileTestApp(t)
	path := writeLocalFile(t, root, "interviews.docx")

	record, err := app.ImportLocalFile(path)
	if err != nil {
		t.Fatalf("ImportLocalFile: %v", err)
	}
	if record.DocumentType != "docx" || record.FileName != "interviews.docx" {
		t.Errorf("unexpected record: %+v", record)
	}

	page, err := app.ListDocuments(types.DocumentListInput{})
	if err != nil {
		t.Fatalf("ListDocuments: %v", err)
	}
	var found bool
	for _, item := range page.Items {
		if item.ID == record.ID {
			found = true
			if item.FilePath != path {
				t.Errorf("document points at %s, want %s", item.FilePath, path)
			}
		}
	}
	if !found {
		t.Fatalf("imported document is not in the list: %+v", page.Items)
	}
}

// The file stays where the user keeps it. Copying it into the workspace would
// leave two files that drift apart, and the new IA's promise is that what the
// app shows and what Finder shows are the same file.
func TestImportLocalFileDoesNotMoveTheFile(t *testing.T) {
	app, _, root := newLocalFileTestApp(t)
	outside := filepath.Join(root, "Desktop")
	if err := os.MkdirAll(outside, 0o755); err != nil {
		t.Fatal(err)
	}
	path := writeLocalFile(t, outside, "budget.xlsx")

	record, err := app.ImportLocalFile(path)
	if err != nil {
		t.Fatalf("ImportLocalFile: %v", err)
	}
	if record.FilePath != path {
		t.Errorf("document path = %s, want the original %s", record.FilePath, path)
	}
	if _, err := os.Stat(path); err != nil {
		t.Errorf("original file is gone: %v", err)
	}
	// No workspace: it is not inside any of the app's folders, and claiming one
	// would be a lie the first move exposed.
	if record.WorkspaceID != "" {
		t.Errorf("workspace = %q, want none", record.WorkspaceID)
	}
}

// Opening the same file twice must land on the row that already exists. A
// second identity for one path would show the user two entries for one file.
func TestImportLocalFileIsIdempotent(t *testing.T) {
	app, _, root := newLocalFileTestApp(t)
	path := writeLocalFile(t, root, "deck.pptx")

	first, err := app.ImportLocalFile(path)
	if err != nil {
		t.Fatalf("first import: %v", err)
	}
	second, err := app.ImportLocalFile(path)
	if err != nil {
		t.Fatalf("second import: %v", err)
	}
	if first.ID != second.ID {
		t.Errorf("id changed between imports: %s then %s", first.ID, second.ID)
	}
	if first.CreatedAt != second.CreatedAt {
		t.Errorf("created_at was rewritten: %s then %s", first.CreatedAt, second.CreatedAt)
	}

	page, err := app.ListDocuments(types.DocumentListInput{})
	if err != nil {
		t.Fatalf("ListDocuments: %v", err)
	}
	count := 0
	for _, item := range page.Items {
		if item.FilePath == path {
			count++
		}
	}
	if count != 1 {
		t.Errorf("got %d rows for one path, want 1", count)
	}
}

// Importing a file the agent generated earlier must reuse its document rather
// than fork one, so the run history attached to it survives.
func TestImportLocalFileReusesAGeneratedDocument(t *testing.T) {
	app, store, root := newLocalFileTestApp(t)
	path := writeLocalFile(t, root, "launch.pptx")
	seedDocument(t, store, "task-launch", "", path)

	page, err := app.ListDocuments(types.DocumentListInput{})
	if err != nil {
		t.Fatalf("ListDocuments: %v", err)
	}
	var before types.DocumentRecord
	for _, item := range page.Items {
		if item.FilePath == path {
			before = item
		}
	}
	if before.ID == "" {
		t.Fatalf("seeded document is missing: %+v", page.Items)
	}

	after, err := app.ImportLocalFile(path)
	if err != nil {
		t.Fatalf("ImportLocalFile: %v", err)
	}
	if after.ID != before.ID {
		t.Errorf("import forked a new document: %s vs %s", after.ID, before.ID)
	}
}

// The dialog's filters narrow the list, but a typed path slips past them on
// every platform. Registering a PDF would produce a document the file list then
// filters out — worse than refusing, because the user watched it succeed.
func TestImportLocalFileRefusesWhatThisAppCannotEdit(t *testing.T) {
	app, _, root := newLocalFileTestApp(t)
	path := writeLocalFile(t, root, "report.pdf")

	_, err := app.ImportLocalFile(path)
	if err == nil {
		t.Fatal("importing a pdf was allowed")
	}
	if !strings.Contains(err.Error(), "report.pdf") {
		t.Errorf("error does not name the file: %v", err)
	}
}

func TestImportLocalFileRefusesARelativePath(t *testing.T) {
	app, _, _ := newLocalFileTestApp(t)
	if _, err := app.ImportLocalFile("notes.docx"); err == nil {
		t.Fatal("a relative path was accepted")
	}
}

func TestImportLocalFileRefusesAFileThatIsNotThere(t *testing.T) {
	app, _, root := newLocalFileTestApp(t)
	if _, err := app.ImportLocalFile(filepath.Join(root, "ghost.docx")); err == nil {
		t.Fatal("a missing file was accepted")
	}
}
