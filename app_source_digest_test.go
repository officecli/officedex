package main

import (
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"officedex/internal/preview"
	"officedex/internal/types"
)

// savePptxHarness builds an app whose workspace is a trusted root, with one
// deck already in it, and returns the app and the deck's path.
func savePptxHarness(t *testing.T, contents string) (*App, string) {
	t.Helper()
	workspaceDir := t.TempDir()
	registry, err := preview.New(preview.RegistryOptions{TrustedRoots: []string{workspaceDir}})
	if err != nil {
		t.Fatalf("preview.New: %v", err)
	}
	app := &App{workspaceDir: workspaceDir, previewReg: registry, sourceDigests: newSourceDigests()}
	deck := filepath.Join(workspaceDir, "deck.pptx")
	if err := os.WriteFile(deck, []byte(contents), 0o644); err != nil {
		t.Fatalf("seed deck: %v", err)
	}
	return app, deck
}

func savePptx(t *testing.T, app *App, target, contents string) (string, error) {
	t.Helper()
	return app.SavePptx(SavePptxInput{
		DataBase64:     base64.StdEncoding.EncodeToString([]byte(contents)),
		FileName:       filepath.Base(target),
		TargetFilePath: target,
	})
}

// openDeck is what the workbench does before editing: read the bytes through
// the preview token, which is where the overwrite baseline comes from.
func openDeck(t *testing.T, app *App, deck string) string {
	t.Helper()
	artifact := types.Artifact{FilePath: deck, FileName: filepath.Base(deck), DocumentType: "pptx"}
	if err := app.previewReg.AllowArtifact(artifact); err != nil {
		t.Fatalf("allow artifact: %v", err)
	}
	grant, err := app.previewReg.IssueToken(artifact)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	if _, err := app.ReadArtifactFile(grant.Token); err != nil {
		t.Fatalf("ReadArtifactFile: %v", err)
	}
	return grant.Token
}

// The presentation workbench autosaves on every change. A deck edited in
// PowerPoint while OfficeDex held it open used to lose those edits within
// seconds, without a message.
func TestSavePptxRefusesToOverwriteAnExternallyChangedDeck(t *testing.T) {
	app, deck := savePptxHarness(t, "as opened")
	openDeck(t, app, deck)

	if err := os.WriteFile(deck, []byte("edited in PowerPoint"), 0o644); err != nil {
		t.Fatalf("simulate external edit: %v", err)
	}

	_, err := savePptx(t, app, deck, "editor bytes")
	if err == nil {
		t.Fatal("SavePptx overwrote a deck that changed outside OfficeDex")
	}
	if !errors.Is(err, errSourceChangedExternally) {
		t.Fatalf("SavePptx error = %v, want a source-changed error", err)
	}
	current, readErr := os.ReadFile(deck)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if string(current) != "edited in PowerPoint" {
		t.Fatalf("the external edit was destroyed: deck holds %q", current)
	}
}

// Consecutive autosaves must keep working: each one rewrites the file, so the
// baseline has to follow what this app itself just wrote.
func TestSavePptxKeepsSavingAfterItsOwnWrites(t *testing.T) {
	app, deck := savePptxHarness(t, "as opened")
	openDeck(t, app, deck)

	for _, revision := range []string{"first", "second", "third"} {
		if _, err := savePptx(t, app, deck, revision); err != nil {
			t.Fatalf("SavePptx(%s): %v", revision, err)
		}
	}
	current, err := os.ReadFile(deck)
	if err != nil {
		t.Fatal(err)
	}
	if string(current) != "third" {
		t.Fatalf("deck holds %q, want the last save", current)
	}
}

// A path this app never read is not a conflict. The guard exists to protect
// edits in flight, and the Downloads copy has no baseline at all.
func TestSavePptxWritesAPathItHasNeverSeen(t *testing.T) {
	app, deck := savePptxHarness(t, "untracked")
	if _, err := savePptx(t, app, deck, "editor bytes"); err != nil {
		t.Fatalf("SavePptx: %v", err)
	}
}

// Closing the preview ends the editing session, so the next save adopts the
// file as it now stands instead of failing against a reading nobody is editing
// from any more.
func TestRevokePreviewTokenClearsTheOverwriteBaseline(t *testing.T) {
	app, deck := savePptxHarness(t, "as opened")
	token := openDeck(t, app, deck)

	if err := os.WriteFile(deck, []byte("edited in PowerPoint"), 0o644); err != nil {
		t.Fatalf("simulate external edit: %v", err)
	}
	app.RevokePreviewToken(token)

	if _, err := savePptx(t, app, deck, "editor bytes"); err != nil {
		t.Fatalf("SavePptx after revoke: %v", err)
	}
}

// The message has to say what to do; a bare "conflict" leaves the user staring
// at a deck that will not save.
func TestSourceChangedErrorTellsTheUserWhatToDo(t *testing.T) {
	if !strings.Contains(errSourceChangedExternally.Error(), "reopen") {
		t.Fatalf("error does not suggest a remedy: %v", errSourceChangedExternally)
	}
}

// The renderer matches this substring to recognise a conflict; rewording the
// message without updating both sides turns the conflict bar back into a
// silent, endlessly retried failure.
func TestSourceChangedErrorKeepsItsMarker(t *testing.T) {
	app, deck := savePptxHarness(t, "as opened")
	openDeck(t, app, deck)
	if err := os.WriteFile(deck, []byte("edited elsewhere"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := savePptx(t, app, deck, "editor bytes")
	if err == nil {
		t.Fatal("expected a conflict")
	}
	if !strings.Contains(err.Error(), SourceChangedMarker) {
		t.Fatalf("error %q no longer carries %q", err, SourceChangedMarker)
	}
}
