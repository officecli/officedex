package pptxtemplate

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestHandbookFromFactsListsReplaceableSlots(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "two-slides.json"))
	if err != nil {
		t.Fatal(err)
	}
	facts, err := ExtractFactsJSON(raw)
	if err != nil {
		t.Fatal(err)
	}
	md := RenderHandbookMarkdown(HandbookFromFacts(facts))
	if !strings.Contains(md, "Template MOP fill handbook") {
		t.Fatalf("md=%s", md)
	}
	if strings.Contains(md, "DO:") || strings.Contains(md, "DON'T:") {
		t.Fatalf("handbook still has do/dont: %s", md)
	}
	if !strings.Contains(md, "s1-t0") {
		t.Fatalf("missing slot id: %s", md)
	}
}
