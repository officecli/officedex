package pptxtemplate

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestExtractFactsReadsThemeTextAndPictures(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "two-slides.json"))
	if err != nil {
		t.Fatal(err)
	}
	facts, err := ExtractFactsJSON(raw)
	if err != nil {
		t.Fatal(err)
	}
	if facts.PageCount != 2 {
		t.Fatalf("pageCount=%d", facts.PageCount)
	}
	if facts.Canvas.WidthPt < 900 || facts.Canvas.HeightPt < 500 {
		t.Fatalf("canvas=%+v", facts.Canvas)
	}
	if facts.Theme.Colors["dark1"] != "#2A3033" || facts.Theme.Colors["light1"] != "#FAFBFA" {
		t.Fatalf("theme colors=%v", facts.Theme.Colors)
	}
	if facts.Theme.MajorFont == "" || facts.Theme.MinorFont == "" {
		t.Fatalf("fonts %+v", facts.Theme)
	}
	if facts.TextCount == 0 {
		t.Fatal("expected extracted text")
	}
	if len(facts.Slides[0].Texts) == 0 {
		t.Fatal("cover has no text boxes")
	}
	found := false
	for _, text := range facts.Slides[0].Texts {
		if text.Text != "" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("cover texts=%v", facts.Slides[0].Texts)
	}
	if facts.Slides[0].Texts[0].SlotID != "s1-t0" {
		t.Fatalf("slotId=%q", facts.Slides[0].Texts[0].SlotID)
	}
	if !facts.Slides[0].Texts[0].Replaceable {
		t.Fatal("cover title should be replaceable")
	}
	if len(facts.Palette) == 0 {
		t.Fatal("empty palette")
	}
}

func TestFallbackDistilledHasProfileAndLayouts(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "two-slides.json"))
	if err != nil {
		t.Fatal(err)
	}
	facts, err := ExtractFactsJSON(raw)
	if err != nil {
		t.Fatal(err)
	}
	distilled := FallbackDistilled(facts)
	if distilled.VisualProfile["primary"] == "" {
		t.Fatalf("profile=%v", distilled.VisualProfile)
	}
	if len(distilled.Layouts) == 0 {
		t.Fatal("no layouts")
	}
	if distilled.SkillMarkdown == "" || !strings.Contains(distilled.SkillMarkdown, "Template MOP fill handbook") {
		t.Fatal("empty or old-style skill")
	}
	if strings.Contains(distilled.SkillMarkdown, "DO:") {
		t.Fatal("fallback skill still uses DO/DONT")
	}
	dir := t.TempDir()
	if err := WriteDistilled(dir, facts, distilled); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"template-facts.json", "visual-profile.json", "layout-library.json", "skill/SKILL.md"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Fatal(name, err)
		}
	}
}
