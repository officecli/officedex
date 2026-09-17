package pptxtemplate

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestApplyFillsToMOPReplacesFirstTextRun(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "two-slides.json"))
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "content.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}
	facts, err := ExtractFacts(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(facts.Slides) == 0 || len(facts.Slides[0].Texts) == 0 {
		t.Fatal("expected text slots")
	}
	slot := facts.Slides[0].Texts[0]
	if err := ApplyFillsToMOP(dir, []SlotFill{{SlotID: slot.SlotID, Text: "石墨文档"}}); err != nil {
		t.Fatal(err)
	}
	updated, err := os.ReadFile(filepath.Join(dir, "content.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(updated), "石墨文档") {
		t.Fatalf("filled MOP missing replacement: %s", slot.SlotID)
	}
}
