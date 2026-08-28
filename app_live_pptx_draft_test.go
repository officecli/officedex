package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"officedex/internal/preview"
)

func newLiveDraftApp(t *testing.T) *App {
	t.Helper()
	workspace := t.TempDir()
	registry, err := preview.New(preview.RegistryOptions{TrustedRoots: []string{workspace}})
	if err != nil {
		t.Fatal(err)
	}
	return &App{workspaceDir: workspace, previewReg: registry}
}

func TestCreateLivePptxDraftWritesBlankDeckAndAllowsPreview(t *testing.T) {
	app := newLiveDraftApp(t)
	draft, err := app.CreateLivePptxDraft("task-123")
	if err != nil {
		t.Fatal(err)
	}
	if draft.FileName != "live-task-123-1.pptx" {
		t.Fatalf("fileName = %q", draft.FileName)
	}
	data, err := os.ReadFile(draft.FilePath)
	if err != nil {
		t.Fatal(err)
	}
	if len(data) < 4 || string(data[:2]) != "PK" {
		t.Fatal("draft is not a pptx zip")
	}
	if filepath.Dir(draft.FilePath) != filepath.Join(app.workspaceDir, "live") {
		t.Fatalf("draft path = %q", draft.FilePath)
	}
	// A second call for the same task resets the draft to blank.
	if _, err := app.CreateLivePptxDraft("task-123"); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{"", "../escape", "a b", strings.Repeat("x", 80)} {
		if _, err := app.CreateLivePptxDraft(bad); err == nil {
			t.Fatalf("task id %q must be rejected", bad)
		}
	}
}

func TestCreateLivePptxDraftReusesADraftNothingHasDrawnInto(t *testing.T) {
	app := newLiveDraftApp(t)

	first, err := app.CreateLivePptxDraft("task-1")
	if err != nil {
		t.Fatal(err)
	}
	second, err := app.CreateLivePptxDraft("task-1")
	if err != nil {
		t.Fatal(err)
	}

	// Asked twice for the same fresh draft, hand back the same file: replacing
	// it would pull the document out from under a drawing already using it.
	if first.FilePath != second.FilePath || second.FileName != "live-task-1-1.pptx" {
		t.Fatalf("drafts = %q, %q", first.FileName, second.FileName)
	}
	if _, err := os.Stat(second.FilePath); err != nil {
		t.Fatalf("the draft is missing: %v", err)
	}
}

func TestCreateLivePptxDraftGivesEachDrawingItsOwnFile(t *testing.T) {
	app := newLiveDraftApp(t)

	first, err := app.CreateLivePptxDraft("task-1")
	if err != nil {
		t.Fatal(err)
	}
	// A drawing has happened, so the next one starts somewhere else — reusing
	// the name would replace a file an editor session had fingerprinted.
	if err := os.WriteFile(first.FilePath, []byte("PK drawn deck"), 0o644); err != nil {
		t.Fatal(err)
	}
	second, err := app.CreateLivePptxDraft("task-1")
	if err != nil {
		t.Fatal(err)
	}

	if first.FileName != "live-task-1-1.pptx" || second.FileName != "live-task-1-2.pptx" {
		t.Fatalf("drafts = %q, %q", first.FileName, second.FileName)
	}
	if _, err := os.Stat(first.FilePath); !os.IsNotExist(err) {
		t.Fatalf("the previous draft survived: %v", err)
	}
	if _, err := os.Stat(second.FilePath); err != nil {
		t.Fatalf("the new draft is missing: %v", err)
	}
}

// closerStub records the drafts whose sessions were retired.
type closerStub struct {
	pptxEditorService
	closed []string
}

func (c *closerStub) CloseByFile(filePath string) error {
	c.closed = append(c.closed, filePath)
	return nil
}

func TestCreateLivePptxDraftRetiresSessionsOnTheDraftsItRemoves(t *testing.T) {
	app := newLiveDraftApp(t)
	closer := &closerStub{}
	app.pptxEditorService = closer

	first, err := app.CreateLivePptxDraft("task-1")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(first.FilePath, []byte("PK drawn deck"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := app.CreateLivePptxDraft("task-1"); err != nil {
		t.Fatal(err)
	}

	// Removing the file under a live session leaves it failing every save it
	// attempts, so the session is retired before the file goes.
	if len(closer.closed) != 1 || closer.closed[0] != first.FilePath {
		t.Fatalf("retired = %v, want %s", closer.closed, first.FilePath)
	}
}

func TestCreateLivePptxDraftKeepsOtherTasksAlone(t *testing.T) {
	app := newLiveDraftApp(t)

	mine, err := app.CreateLivePptxDraft("task-1")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := app.CreateLivePptxDraft("task-2"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(mine.FilePath); err != nil {
		t.Fatalf("another task's draft was removed: %v", err)
	}
}

func TestCreateLivePptxDraftSupersedesTheOlderSingleFileName(t *testing.T) {
	app := newLiveDraftApp(t)
	legacy := filepath.Join(app.workspaceDir, "live", "live-task-1.pptx")
	if err := os.MkdirAll(filepath.Dir(legacy), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(legacy, []byte("older build"), 0o644); err != nil {
		t.Fatal(err)
	}

	draft, err := app.CreateLivePptxDraft("task-1")
	if err != nil {
		t.Fatal(err)
	}
	if draft.FileName != "live-task-1-1.pptx" {
		t.Fatalf("draft = %q", draft.FileName)
	}
	if _, err := os.Stat(legacy); !os.IsNotExist(err) {
		t.Fatal("a draft from an older build was left behind")
	}
}
