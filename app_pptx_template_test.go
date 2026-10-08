package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"officedex/internal/pptxtemplate"
	"officedex/internal/settings"
)

type templateImportEditor struct {
	fakePptxEditorService
}

func (s *templateImportEditor) ImportTemplate(_ context.Context, _, mop string) error {
	if err := os.MkdirAll(mop, 0o700); err != nil {
		return err
	}
	fixture, err := os.ReadFile(filepath.Join("internal", "pptxtemplate", "testdata", "two-slides.json"))
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(mop, "content.json"), fixture, 0o600)
}

func TestImportPptxTemplateReportsConversionAndSkillProgress(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "brand.pptx")
	if err := os.WriteFile(source, []byte("pptx-bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	var stages []string
	app := &App{
		workspaceDir:         dir,
		settingsStore:        settings.New(filepath.Join(dir, "settings.json"), nil),
		pptxEditorService:    &templateImportEditor{},
		pptxTemplateProgress: func(progress PptxTemplateProgress) { stages = append(stages, progress.Stage) },
		analyzePptxTemplate:  func(context.Context, pptxtemplate.Facts) (json.RawMessage, error) { return nil, context.Canceled },
	}
	result, err := app.ImportPptxTemplate(ImportPptxTemplateInput{SourcePath: source})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "ready" {
		t.Fatalf("status = %q, want ready", result.Status)
	}
	want := []string{"copy", "convert", "extract", "analyze", "skill", "ready"}
	if strings.Join(stages, ",") != strings.Join(want, ",") {
		t.Fatalf("stages = %v, want %v", stages, want)
	}
}

func TestImportPptxTemplateReportsFailureProgress(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "brand.pptx")
	if err := os.WriteFile(source, []byte("pptx-bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	var last PptxTemplateProgress
	app := &App{
		workspaceDir:      dir,
		settingsStore:     settings.New(filepath.Join(dir, "settings.json"), nil),
		pptxEditorService: &fakePptxEditorService{},
		pptxTemplateProgress: func(progress PptxTemplateProgress) {
			last = progress
		},
	}
	if _, err := app.ImportPptxTemplate(ImportPptxTemplateInput{SourcePath: source}); err == nil {
		t.Fatal("expected analysis failure")
	}
	if last.Status != "failed" || last.Stage != "failed" {
		t.Fatalf("progress = %+v", last)
	}
}

func TestImportPptxTemplateMergesLLMDistillation(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "brand.pptx")
	if err := os.WriteFile(source, []byte("pptx-bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	app := &App{
		workspaceDir:      dir,
		settingsStore:     settings.New(filepath.Join(dir, "settings.json"), nil),
		pptxEditorService: &templateImportEditor{},
		analyzePptxTemplate: func(_ context.Context, facts pptxtemplate.Facts) (json.RawMessage, error) {
			primary := "#2A3033"
			if len(facts.Palette) > 0 {
				primary = facts.Palette[0]
			}
			return json.RawMessage(`{"visualProfile":{"primary":"` + primary + `","secondary":"` + primary + `","text":"` + primary + `","background":"#FAFBFA"},"handbook":{"pages":[{"index":1,"pageKind":"cover","purpose":"封面","slots":[{"slotId":"s1-t0","role":"title","fillWith":"本次主题","dataKind":"title","maxChars":12,"sample":"旧标题"}]}]}}`), nil
		},
	}
	result, err := app.ImportPptxTemplate(ImportPptxTemplateInput{SourcePath: source})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(result.LocalAssetDir, "visual-profile.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"source": "llm"`) {
		t.Fatalf("profile=%s", raw)
	}
	skill, err := os.ReadFile(filepath.Join(result.LocalAssetDir, "skill", "SKILL.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(skill), "Template MOP fill handbook") {
		t.Fatalf("skill=%s", skill)
	}
	if _, err := os.Stat(filepath.Join(result.LocalAssetDir, "template-facts.json")); err != nil {
		t.Fatal(err)
	}
}

func TestDeletePptxTemplateRemovesWorkspaceChild(t *testing.T) {
	dir := t.TempDir()
	asset := filepath.Join(dir, "ppt-templates", "tpl-company")
	if err := os.MkdirAll(asset, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(asset, "source.pptx"), []byte("pptx"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := (&App{}).DeletePptxTemplate(asset); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(asset); !os.IsNotExist(err) {
		t.Fatalf("template directory still exists: %v", err)
	}
}

func TestDeletePptxTemplateRefusesPathsOutsideTheLibrary(t *testing.T) {
	if err := (&App{}).DeletePptxTemplate("/tmp/not-templates/tpl-company"); err == nil {
		t.Fatal("deleted a path outside ppt-templates")
	}
}
