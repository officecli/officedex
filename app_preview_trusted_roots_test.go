package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"officedex/internal/preview"
	"officedex/internal/settings"
	"officedex/internal/types"
)

func TestUpdateSettingsOutputDirRefreshesPreviewTrustedRoots(t *testing.T) {
	dir := t.TempDir()
	workspaceDir := filepath.Join(dir, "workspace")
	customDir := filepath.Join(dir, "custom-output")
	if err := os.MkdirAll(workspaceDir, 0o755); err != nil {
		t.Fatalf("mkdir workspace: %v", err)
	}
	if err := os.MkdirAll(customDir, 0o755); err != nil {
		t.Fatalf("mkdir custom output: %v", err)
	}
	reg, err := preview.New(preview.RegistryOptions{TrustedRoots: []string{workspaceDir}})
	if err != nil {
		t.Fatalf("preview.New: %v", err)
	}
	app := &App{
		workspaceDir:   workspaceDir,
		settingsStore:  settings.New(filepath.Join(dir, "settings.json"), nil),
		previewReg:     reg,
		cachedSettings: settings.Defaults(),
	}

	if _, err := app.UpdateSettings(settings.Patch{OutputDir: &customDir}); err != nil {
		t.Fatalf("UpdateSettings: %v", err)
	}

	artifactPath := filepath.Join(customDir, "generated.docx")
	if err := os.WriteFile(artifactPath, []byte("x"), 0o644); err != nil {
		t.Fatalf("write artifact: %v", err)
	}
	err = app.PreviewArtifact(types.Artifact{FilePath: artifactPath})
	if err != nil {
		t.Fatalf("PreviewArtifact should accept custom output artifact, got %v", err)
	}
}

func TestUpdateSettingsInvalidOutputDirDoesNotReplacePreviewTrustedRoots(t *testing.T) {
	dir := t.TempDir()
	workspaceDir := filepath.Join(dir, "workspace")
	if err := os.MkdirAll(workspaceDir, 0o755); err != nil {
		t.Fatalf("mkdir workspace: %v", err)
	}
	workspacePath := filepath.Join(workspaceDir, "generated.docx")
	if err := os.WriteFile(workspacePath, []byte("x"), 0o644); err != nil {
		t.Fatalf("write workspace artifact: %v", err)
	}
	reg, err := preview.New(preview.RegistryOptions{TrustedRoots: []string{workspaceDir}})
	if err != nil {
		t.Fatalf("preview.New: %v", err)
	}
	app := &App{
		workspaceDir:   workspaceDir,
		settingsStore:  settings.New(filepath.Join(dir, "settings.json"), nil),
		previewReg:     reg,
		cachedSettings: settings.Defaults(),
	}

	invalid := "relative-output"
	if _, err := app.UpdateSettings(settings.Patch{OutputDir: &invalid}); err != nil {
		t.Fatalf("UpdateSettings should persist invalid outputDir for generate-time validation, got %v", err)
	}
	if err := app.PreviewArtifact(types.Artifact{FilePath: workspacePath}); err != nil {
		t.Fatalf("workspace root should remain trusted after invalid outputDir: %v", err)
	}

	outsideDir := filepath.Join(dir, "outside")
	if err := os.MkdirAll(outsideDir, 0o755); err != nil {
		t.Fatalf("mkdir outside: %v", err)
	}
	outsidePath := filepath.Join(outsideDir, "generated.docx")
	if err := os.WriteFile(outsidePath, []byte("x"), 0o644); err != nil {
		t.Fatalf("write outside artifact: %v", err)
	}
	err = app.PreviewArtifact(types.Artifact{FilePath: outsidePath})
	if err == nil || !strings.Contains(err.Error(), "outside trusted") {
		t.Fatalf("invalid outputDir should not trust arbitrary roots, got %v", err)
	}
}

func TestResolveGenerateInputRejectsInvalidOutputDir(t *testing.T) {
	cases := []struct {
		name      string
		outputDir string
	}{
		{name: "relative", outputDir: "relative-output"},
		{name: "nul-byte", outputDir: filepath.Join(t.TempDir(), "bad\x00dir")},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			app := &App{workspaceDir: t.TempDir()}
			_, err := app.resolveGenerateInput(
				types.GenerateInput{Topic: "demo", DocumentType: types.DocDOCX},
				types.UserSettings{OutputDir: &tc.outputDir},
			)
			if err == nil || !strings.Contains(err.Error(), "output dir") {
				t.Fatalf("expected output dir validation error, got %v", err)
			}
		})
	}
}
