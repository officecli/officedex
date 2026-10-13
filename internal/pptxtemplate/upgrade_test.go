package pptxtemplate

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// legacyTemplate lays out what an early import left on disk: the MOP package
// and a generic skill note, but no fill handbook and no slot catalog.
func legacyTemplate(t *testing.T) string {
	t.Helper()
	assetDir := t.TempDir()
	content, err := os.ReadFile(filepath.Join("testdata", "two-slides.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(assetDir, "source.mop"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(assetDir, "source.mop", "content.json"), content, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(assetDir, "skill"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(assetDir, "skill", "SKILL.md"), []byte("# Local PPT template skill\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	return assetDir
}

func TestEnsureDistilledRebuildsWhatAnOldImportLacks(t *testing.T) {
	assetDir := legacyTemplate(t)

	if err := EnsureDistilled(assetDir); err != nil {
		t.Fatalf("EnsureDistilled: %v", err)
	}

	raw, err := os.ReadFile(filepath.Join(assetDir, "skill", "handbook.json"))
	if err != nil {
		t.Fatalf("handbook was not rebuilt: %v", err)
	}
	var handbook struct {
		Pages []map[string]any `json:"pages"`
	}
	if err := json.Unmarshal(raw, &handbook); err != nil {
		t.Fatalf("handbook is not valid JSON: %v", err)
	}
	// Generation maps an outline onto these pages; an empty list is the same
	// failure as a missing file.
	if len(handbook.Pages) != 2 {
		t.Errorf("handbook pages = %d, want the template's 2 slides", len(handbook.Pages))
	}
	slots, err := os.ReadFile(filepath.Join(assetDir, "slots.json"))
	if err != nil || !strings.Contains(string(slots), "s1-t0") {
		t.Errorf("slot catalog was not rebuilt (err=%v): %s", err, slots)
	}
}

func TestEnsureDistilledLeavesACurrentTemplateAlone(t *testing.T) {
	assetDir := legacyTemplate(t)
	if err := EnsureDistilled(assetDir); err != nil {
		t.Fatalf("EnsureDistilled: %v", err)
	}
	// A current template may carry a model-refined handbook; re-deriving it
	// would silently replace that with the mechanical fallback.
	handbookPath := filepath.Join(assetDir, "skill", "handbook.json")
	refined := []byte(`{"pages":[{"index":1,"pageKind":"cover","note":"refined"}]}`)
	if err := os.WriteFile(handbookPath, refined, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(filepath.Join(assetDir, "source.mop")); err != nil {
		t.Fatal(err)
	}

	if err := EnsureDistilled(assetDir); err != nil {
		t.Fatalf("EnsureDistilled on a current template: %v", err)
	}
	if got, _ := os.ReadFile(handbookPath); string(got) != string(refined) {
		t.Errorf("a current handbook was rewritten: %s", got)
	}
}

func TestEnsureDistilledExplainsATemplateItCannotRebuild(t *testing.T) {
	assetDir := legacyTemplate(t)
	if err := os.RemoveAll(filepath.Join(assetDir, "source.mop")); err != nil {
		t.Fatal(err)
	}

	err := EnsureDistilled(assetDir)
	if err == nil || !strings.Contains(err.Error(), "import it again") {
		t.Fatalf("error = %v, want it to tell the user to import the template again", err)
	}
}
