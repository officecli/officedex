package pptxtemplate

import (
	"strings"
	"testing"
)

func TestMergeLLMKeepsValidColorAndDropsUnknown(t *testing.T) {
	facts := Facts{Version: 1, PageCount: 1, Palette: []string{"#2A3033", "#FAFBFA"}, Slides: []SlideFact{{Index: 1}}}
	raw := []byte(`{"visualProfile":{"primary":"#2A3033","secondary":"#FF00FF","text":"#2A3033","background":"#FAFBFA"},"layouts":[{"layoutId":"cover-with-logo","contentRelation":"single-conclusion","sourceSlides":[1],"roles":["title"]}],"handbook":{"pages":[{"index":1,"pageKind":"cover","purpose":"封面","slots":[{"slotId":"s1-t0","role":"title","fillWith":"本次主题","dataKind":"title","maxChars":12,"sample":"旧标题"}]}]},"capabilities":{"supported":["text"],"fallback":[],"warnings":[]}}`)
	got, err := MergeLLM(facts, raw)
	if err != nil {
		t.Fatal(err)
	}
	if got.VisualProfile["primary"] != "#2A3033" {
		t.Fatalf("primary=%v", got.VisualProfile["primary"])
	}
	if !strings.Contains(strings.Join(got.Warnings, ","), "dropped-color:secondary") {
		t.Fatalf("warnings=%v", got.Warnings)
	}
	if got.Layouts[0]["layoutId"] != "cover-with-logo" {
		t.Fatalf("layouts=%v", got.Layouts)
	}
	if !strings.Contains(got.SkillMarkdown, "Template MOP fill handbook") {
		t.Fatalf("skill=%s", got.SkillMarkdown)
	}
}
