package main

import (
	"context"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"officedex/internal/localstore"
	"officedex/internal/preview"
	"officedex/internal/settings"
	"officedex/internal/types"
)

func TestUpdateSettingsWorkspaceDirRefreshesPreviewTrustedRoots(t *testing.T) {
	dir := t.TempDir()
	workspaceDir := filepath.Join(dir, "workspace")
	customDir := filepath.Join(dir, "custom-workspace")
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

	if _, err := app.UpdateSettings(settings.Patch{WorkspaceDir: &customDir}); err != nil {
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

func TestSavePptxCanOverwriteTrustedArtifactTarget(t *testing.T) {
	dir := t.TempDir()
	workspaceDir := filepath.Join(dir, "workspace")
	if err := os.MkdirAll(workspaceDir, 0o755); err != nil {
		t.Fatalf("mkdir workspace: %v", err)
	}
	reg, err := preview.New(preview.RegistryOptions{TrustedRoots: []string{workspaceDir}})
	if err != nil {
		t.Fatalf("preview.New: %v", err)
	}
	app := &App{workspaceDir: workspaceDir, previewReg: reg}
	target := filepath.Join(workspaceDir, "generated.pptx")
	if err := os.WriteFile(target, []byte("old"), 0o644); err != nil {
		t.Fatalf("seed target: %v", err)
	}

	got, err := app.SavePptx(SavePptxInput{
		DataBase64:     base64.StdEncoding.EncodeToString([]byte("new pptx bytes")),
		FileName:       "ignored-name.pptx",
		TargetFilePath: target,
	})
	if err != nil {
		t.Fatalf("SavePptx: %v", err)
	}
	if got != target {
		t.Fatalf("SavePptx path = %q, want %q", got, target)
	}
	data, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("read target: %v", err)
	}
	if string(data) != "new pptx bytes" {
		t.Fatalf("target bytes = %q", string(data))
	}
}

func TestSavePptxRejectsTargetOutsideTrustedRoots(t *testing.T) {
	dir := t.TempDir()
	workspaceDir := filepath.Join(dir, "workspace")
	outsideDir := filepath.Join(dir, "outside")
	if err := os.MkdirAll(workspaceDir, 0o755); err != nil {
		t.Fatalf("mkdir workspace: %v", err)
	}
	if err := os.MkdirAll(outsideDir, 0o755); err != nil {
		t.Fatalf("mkdir outside: %v", err)
	}
	reg, err := preview.New(preview.RegistryOptions{TrustedRoots: []string{workspaceDir}})
	if err != nil {
		t.Fatalf("preview.New: %v", err)
	}
	app := &App{workspaceDir: workspaceDir, previewReg: reg}

	_, err = app.SavePptx(SavePptxInput{
		DataBase64:     base64.StdEncoding.EncodeToString([]byte("new pptx bytes")),
		FileName:       "generated.pptx",
		TargetFilePath: filepath.Join(outsideDir, "generated.pptx"),
	})
	if err == nil || !strings.Contains(err.Error(), "outside trusted") {
		t.Fatalf("SavePptx should reject outside target, got %v", err)
	}
}

func TestUpdateSettingsInvalidWorkspaceDirDoesNotReplacePreviewTrustedRoots(t *testing.T) {
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
	if _, err := app.UpdateSettings(settings.Patch{WorkspaceDir: &invalid}); err != nil {
		t.Fatalf("UpdateSettings should persist invalid workspaceDir for generate-time validation, got %v", err)
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
		t.Fatalf("invalid workspaceDir should not trust arbitrary roots, got %v", err)
	}
}

func TestResolveGenerateInputRejectsInvalidWorkspaceDir(t *testing.T) {
	cases := []struct {
		name         string
		workspaceDir string
	}{
		{name: "relative", workspaceDir: "relative-output"},
		{name: "nul-byte", workspaceDir: filepath.Join(t.TempDir(), "bad\x00dir")},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			app := &App{workspaceDir: t.TempDir()}
			_, err := app.resolveGenerateInput(
				types.GenerateInput{Topic: "demo", DocumentType: types.DocDOCX},
				types.UserSettings{WorkspaceDir: &tc.workspaceDir},
			)
			if err == nil || !strings.Contains(err.Error(), "workspace dir") {
				t.Fatalf("expected workspace dir validation error, got %v", err)
			}
		})
	}
}

func TestResolveGenerateInputUsesDefaultWorkspaceWhenUnset(t *testing.T) {
	defaultWorkspace := t.TempDir()
	app := &App{workspaceDir: defaultWorkspace}

	resolved, err := app.resolveGenerateInput(
		types.GenerateInput{Topic: "demo memo", DocumentType: types.DocDOCX},
		types.UserSettings{},
	)
	if err != nil {
		t.Fatalf("resolveGenerateInput: %v", err)
	}
	if !strings.HasPrefix(resolved.OutputDir, defaultWorkspace+string(os.PathSeparator)) {
		t.Fatalf("OutputDir = %q, want under default workspace %q", resolved.OutputDir, defaultWorkspace)
	}
}

func TestSelectWorkspaceRefreshesPreviewRootsAndGenerationBase(t *testing.T) {
	dir := t.TempDir()
	defaultWorkspace := filepath.Join(dir, "default-workspace")
	selectedWorkspace := filepath.Join(dir, "selected-workspace")
	if err := os.MkdirAll(defaultWorkspace, 0o755); err != nil {
		t.Fatalf("mkdir default workspace: %v", err)
	}
	if err := os.MkdirAll(selectedWorkspace, 0o755); err != nil {
		t.Fatalf("mkdir selected workspace: %v", err)
	}
	reg, err := preview.New(preview.RegistryOptions{TrustedRoots: []string{defaultWorkspace}})
	if err != nil {
		t.Fatalf("preview.New: %v", err)
	}
	store := localstore.New(filepath.Join(dir, "officedex.db"))
	ctx := context.Background()
	if err := store.Open(ctx); err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	app := &App{
		workspaceDir:   defaultWorkspace,
		settingsStore:  settings.New(filepath.Join(dir, "settings.json"), nil),
		localStore:     store,
		previewReg:     reg,
		cachedSettings: settings.Defaults(),
	}

	workspace, err := app.AddWorkspace(selectedWorkspace)
	if err != nil {
		t.Fatalf("AddWorkspace: %v", err)
	}
	if _, err := app.SelectWorkspace(workspace.ID); err != nil {
		t.Fatalf("SelectWorkspace: %v", err)
	}

	artifactPath := filepath.Join(selectedWorkspace, "generated.docx")
	if err := os.WriteFile(artifactPath, []byte("x"), 0o644); err != nil {
		t.Fatalf("write selected artifact: %v", err)
	}
	if err := app.PreviewArtifact(types.Artifact{FilePath: artifactPath}); err != nil {
		t.Fatalf("selected workspace should be trusted, got %v", err)
	}

	resolved, err := app.resolveGenerateInput(types.GenerateInput{Topic: "demo", DocumentType: types.DocDOCX}, settings.Defaults())
	if err != nil {
		t.Fatalf("resolveGenerateInput: %v", err)
	}
	if !strings.HasPrefix(resolved.OutputDir, selectedWorkspace+string(os.PathSeparator)) {
		t.Fatalf("OutputDir = %q, want under selected workspace %q", resolved.OutputDir, selectedWorkspace)
	}
}

func TestTaskHistoryRegistersArtifactsFromStoredWorkspaceRoots(t *testing.T) {
	dir := t.TempDir()
	defaultWorkspace := filepath.Join(dir, "default-workspace")
	projectWorkspace := filepath.Join(dir, "project-workspace")
	if err := os.MkdirAll(defaultWorkspace, 0o755); err != nil {
		t.Fatalf("mkdir default workspace: %v", err)
	}
	if err := os.MkdirAll(projectWorkspace, 0o755); err != nil {
		t.Fatalf("mkdir project workspace: %v", err)
	}
	artifactPath := filepath.Join(projectWorkspace, "generated.png")
	if err := os.WriteFile(artifactPath, []byte("x"), 0o644); err != nil {
		t.Fatalf("write artifact: %v", err)
	}
	reg, err := preview.New(preview.RegistryOptions{TrustedRoots: []string{defaultWorkspace}})
	if err != nil {
		t.Fatalf("preview.New: %v", err)
	}
	store := localstore.New(filepath.Join(dir, "officedex.db"))
	ctx := context.Background()
	if err := store.Open(ctx); err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	project, err := store.EnsureWorkspace(ctx, projectWorkspace)
	if err != nil {
		t.Fatalf("EnsureWorkspace project: %v", err)
	}
	if err := store.RecordTaskContext(ctx, "task-image", localstore.TaskContext{
		WorkspaceID:    project.ID,
		ConversationID: "conversation-image",
	}); err != nil {
		t.Fatalf("RecordTaskContext: %v", err)
	}
	if err := store.RecordEvent(types.BridgeEvent{
		EventID: "event-completed",
		TaskID:  "task-image",
		Type:    "task.completed",
		Payload: map[string]any{
			"result": map[string]any{
				"file_path":     artifactPath,
				"file_name":     "generated.png",
				"document_type": "png",
			},
		},
	}); err != nil {
		t.Fatalf("RecordEvent: %v", err)
	}
	app := &App{
		workspaceDir:   defaultWorkspace,
		settingsStore:  settings.New(filepath.Join(dir, "settings.json"), nil),
		localStore:     store,
		previewReg:     reg,
		cachedSettings: settings.Defaults(),
	}

	if _, err := app.GetTaskHistory(10); err != nil {
		t.Fatalf("GetTaskHistory: %v", err)
	}
	if _, err := app.IssuePreviewToken(types.Artifact{FilePath: artifactPath}); err != nil {
		t.Fatalf("historical project artifact should be previewable, got %v", err)
	}
}

func TestInvalidStoredWorkspaceDoesNotBecomeActive(t *testing.T) {
	dir := t.TempDir()
	defaultWorkspace := filepath.Join(dir, "default-workspace")
	missingWorkspace := filepath.Join(dir, "missing-workspace")
	if err := os.MkdirAll(defaultWorkspace, 0o755); err != nil {
		t.Fatalf("mkdir default workspace: %v", err)
	}
	if err := os.MkdirAll(missingWorkspace, 0o755); err != nil {
		t.Fatalf("mkdir missing workspace: %v", err)
	}
	reg, err := preview.New(preview.RegistryOptions{TrustedRoots: []string{defaultWorkspace}})
	if err != nil {
		t.Fatalf("preview.New: %v", err)
	}
	store := localstore.New(filepath.Join(dir, "officedex.db"))
	ctx := context.Background()
	if err := store.Open(ctx); err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	defaultRecord, err := store.EnsureWorkspace(ctx, defaultWorkspace)
	if err != nil {
		t.Fatalf("EnsureWorkspace default: %v", err)
	}
	missingRecord, err := store.EnsureWorkspace(ctx, missingWorkspace)
	if err != nil {
		t.Fatalf("EnsureWorkspace missing: %v", err)
	}
	if _, err := store.ActivateWorkspace(ctx, defaultRecord.ID); err != nil {
		t.Fatalf("ActivateWorkspace default: %v", err)
	}
	if err := os.RemoveAll(missingWorkspace); err != nil {
		t.Fatalf("remove missing workspace: %v", err)
	}
	app := &App{
		workspaceDir:   defaultWorkspace,
		settingsStore:  settings.New(filepath.Join(dir, "settings.json"), nil),
		localStore:     store,
		previewReg:     reg,
		cachedSettings: settings.Defaults(),
	}

	if _, err := app.SelectWorkspace(missingRecord.ID); err == nil || !strings.Contains(err.Error(), "workspace dir is unavailable") {
		t.Fatalf("SelectWorkspace should reject missing workspace, got %v", err)
	}
	active, err := store.ActiveWorkspace(ctx)
	if err != nil {
		t.Fatalf("ActiveWorkspace: %v", err)
	}
	if active.ID != defaultRecord.ID {
		t.Fatalf("active workspace = %q, want default %q", active.ID, defaultRecord.ID)
	}

	_, err = app.resolveGenerateInput(
		types.GenerateInput{Topic: "demo", DocumentType: types.DocDOCX, WorkspaceID: missingRecord.ID},
		settings.Defaults(),
	)
	if err == nil || !strings.Contains(err.Error(), "workspace dir is unavailable") {
		t.Fatalf("resolveGenerateInput should reject missing workspace, got %v", err)
	}
	active, err = store.ActiveWorkspace(ctx)
	if err != nil {
		t.Fatalf("ActiveWorkspace after generate: %v", err)
	}
	if active.ID != defaultRecord.ID {
		t.Fatalf("active workspace after generate = %q, want default %q", active.ID, defaultRecord.ID)
	}

	artifactPath := filepath.Join(defaultWorkspace, "generated.docx")
	if err := os.WriteFile(artifactPath, []byte("x"), 0o644); err != nil {
		t.Fatalf("write default artifact: %v", err)
	}
	if err := app.PreviewArtifact(types.Artifact{FilePath: artifactPath}); err != nil {
		t.Fatalf("default workspace should remain trusted, got %v", err)
	}
}

func TestNoProjectGenerateUsesDefaultWorkspaceWithoutActivatingProject(t *testing.T) {
	dir := t.TempDir()
	defaultWorkspace := filepath.Join(dir, "default-workspace")
	projectWorkspace := filepath.Join(dir, "project-workspace")
	if err := os.MkdirAll(defaultWorkspace, 0o755); err != nil {
		t.Fatalf("mkdir default workspace: %v", err)
	}
	if err := os.MkdirAll(projectWorkspace, 0o755); err != nil {
		t.Fatalf("mkdir project workspace: %v", err)
	}
	store := localstore.New(filepath.Join(dir, "officedex.db"))
	ctx := context.Background()
	if err := store.Open(ctx); err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	project, err := store.EnsureWorkspace(ctx, projectWorkspace)
	if err != nil {
		t.Fatalf("EnsureWorkspace project: %v", err)
	}
	if _, err := store.ActivateWorkspace(ctx, project.ID); err != nil {
		t.Fatalf("ActivateWorkspace project: %v", err)
	}
	app := &App{
		workspaceDir:   defaultWorkspace,
		settingsStore:  settings.New(filepath.Join(dir, "settings.json"), nil),
		localStore:     store,
		cachedSettings: settings.Defaults(),
	}

	resolved, err := app.resolveGenerateInput(
		types.GenerateInput{Topic: "standalone", DocumentType: types.DocDOCX, NoProject: true},
		settings.Defaults(),
	)
	if err != nil {
		t.Fatalf("resolveGenerateInput no-project: %v", err)
	}
	if !strings.HasPrefix(resolved.OutputDir, defaultWorkspace+string(os.PathSeparator)) {
		t.Fatalf("OutputDir = %q, want under default workspace %q", resolved.OutputDir, defaultWorkspace)
	}
	if err := app.recordTaskWorkspaceContext("task-no-project", "", "chat-no-project", "", "Standalone", true); err != nil {
		t.Fatalf("recordTaskWorkspaceContext no-project: %v", err)
	}
	active, err := store.ActiveWorkspace(ctx)
	if err != nil {
		t.Fatalf("ActiveWorkspace: %v", err)
	}
	if active.ID != project.ID {
		t.Fatalf("active workspace = %q, want project %q", active.ID, project.ID)
	}
}

func TestListWorkspacesMigratesDefaultWorkspaceProjectToChats(t *testing.T) {
	dir := t.TempDir()
	defaultWorkspace := filepath.Join(dir, "workspace")
	if err := os.MkdirAll(defaultWorkspace, 0o755); err != nil {
		t.Fatalf("mkdir default workspace: %v", err)
	}
	store := localstore.New(filepath.Join(dir, "officedex.db"))
	ctx := context.Background()
	if err := store.Open(ctx); err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	defaultRecord, err := store.EnsureWorkspace(ctx, defaultWorkspace)
	if err != nil {
		t.Fatalf("EnsureWorkspace default: %v", err)
	}
	if err := store.EnsureConversation(ctx, defaultRecord.ID, "legacy-chat", "Legacy chat"); err != nil {
		t.Fatalf("EnsureConversation legacy: %v", err)
	}
	if err := store.RecordTaskContext(ctx, "legacy-task", localstore.TaskContext{
		WorkspaceID:    defaultRecord.ID,
		ConversationID: "legacy-chat",
	}); err != nil {
		t.Fatalf("RecordTaskContext legacy: %v", err)
	}
	app := &App{
		workspaceDir:   defaultWorkspace,
		settingsStore:  settings.New(filepath.Join(dir, "settings.json"), nil),
		localStore:     store,
		cachedSettings: settings.Defaults(),
	}

	workspaces, err := app.ListWorkspaces()
	if err != nil {
		t.Fatalf("ListWorkspaces: %v", err)
	}
	if len(workspaces) != 0 {
		t.Fatalf("workspaces = %#v, want no default workspace project", workspaces)
	}
}

func TestRemoveWorkspaceRefreshesPreviewRootsToDefaultWorkspace(t *testing.T) {
	dir := t.TempDir()
	defaultWorkspace := filepath.Join(dir, "default-workspace")
	projectWorkspace := filepath.Join(dir, "project-workspace")
	if err := os.MkdirAll(defaultWorkspace, 0o755); err != nil {
		t.Fatalf("mkdir default workspace: %v", err)
	}
	if err := os.MkdirAll(projectWorkspace, 0o755); err != nil {
		t.Fatalf("mkdir project workspace: %v", err)
	}
	reg, err := preview.New(preview.RegistryOptions{TrustedRoots: []string{defaultWorkspace}})
	if err != nil {
		t.Fatalf("preview.New: %v", err)
	}
	store := localstore.New(filepath.Join(dir, "officedex.db"))
	ctx := context.Background()
	if err := store.Open(ctx); err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	app := &App{
		workspaceDir:   defaultWorkspace,
		settingsStore:  settings.New(filepath.Join(dir, "settings.json"), nil),
		localStore:     store,
		previewReg:     reg,
		cachedSettings: settings.Defaults(),
	}

	project, err := app.AddWorkspace(projectWorkspace)
	if err != nil {
		t.Fatalf("AddWorkspace: %v", err)
	}
	projectArtifact := filepath.Join(projectWorkspace, "generated.docx")
	if err := os.WriteFile(projectArtifact, []byte("x"), 0o644); err != nil {
		t.Fatalf("write project artifact: %v", err)
	}
	if err := app.PreviewArtifact(types.Artifact{FilePath: projectArtifact}); err != nil {
		t.Fatalf("project workspace should be trusted before removal, got %v", err)
	}

	if err := app.RemoveWorkspace(project.ID); err != nil {
		t.Fatalf("RemoveWorkspace: %v", err)
	}
	defaultArtifact := filepath.Join(defaultWorkspace, "generated.docx")
	if err := os.WriteFile(defaultArtifact, []byte("x"), 0o644); err != nil {
		t.Fatalf("write default artifact: %v", err)
	}
	if err := app.PreviewArtifact(types.Artifact{FilePath: defaultArtifact}); err != nil {
		t.Fatalf("default workspace should be trusted after removal, got %v", err)
	}
	if err := app.PreviewArtifact(types.Artifact{FilePath: projectArtifact}); err == nil || !strings.Contains(err.Error(), "outside trusted") {
		t.Fatalf("project workspace should no longer be trusted after removal, got %v", err)
	}
}
