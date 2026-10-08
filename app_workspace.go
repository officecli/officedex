package main

import (
	"context"
	"fmt"
	"officedex/internal/workspace"
	"os"
	"path/filepath"
	"strings"

	"officedex/internal/localstore"
	"officedex/internal/types"
)

// ─── Workspaces and task output ─────────────────────────────────────────────

func (a *App) resolveGenerateInput(input types.GenerateInput, s types.UserSettings) (types.GenerateInput, error) {
	// Caller-provided OutputDir wins. This is the seam the future
	// "continue editing" path uses to reuse a prior task's directory so
	// follow-up edits land alongside the original artifact.
	if strings.TrimSpace(input.OutputDir) != "" {
		outputDir, err := workspace.CleanOutputDir(input.OutputDir)
		if err != nil {
			return types.GenerateInput{}, err
		}
		out := input
		out.OutputDir = outputDir
		return out, nil
	}
	base, err := a.effectiveWorkspaceDirForInput(input.WorkspaceID, input.NoProject, s)
	if err != nil {
		return types.GenerateInput{}, err
	}
	taskDir := filepath.Join(base, workspace.TaskDirName(input.Topic, string(input.DocumentType)))
	if err := os.MkdirAll(taskDir, 0o755); err != nil {
		return types.GenerateInput{}, fmt.Errorf("mkdir task output dir: %w", err)
	}
	out := input
	out.OutputDir = taskDir
	return out, nil
}

func (a *App) effectiveWorkspaceDirForInput(workspaceID string, noProject bool, s types.UserSettings) (string, error) {
	if noProject {
		return a.workspaceDir, nil
	}
	if a.localStore != nil {
		ctx := a.ctx
		if ctx == nil {
			ctx = context.Background()
		}
		if strings.TrimSpace(workspaceID) != "" {
			ws, err := a.localStore.Workspace(ctx, strings.TrimSpace(workspaceID))
			if err != nil {
				return "", err
			}
			cleaned, err := workspace.CleanExistingDir(ws.Path)
			if err != nil {
				return "", err
			}
			if _, err := a.localStore.ActivateWorkspace(ctx, ws.ID); err != nil {
				return "", err
			}
			return cleaned, nil
		}
		if ws, err := a.localStore.ActiveWorkspace(ctx); err == nil {
			return workspace.CleanExistingDir(ws.Path)
		}
	}
	return a.effectiveWorkspaceDir(s)
}

func (a *App) effectiveWorkspaceDir(s types.UserSettings) (string, error) {
	if a.localStore != nil {
		ctx := a.ctx
		if ctx == nil {
			ctx = context.Background()
		}
		if ws, err := a.localStore.ActiveWorkspace(ctx); err == nil {
			return workspace.CleanExistingDir(ws.Path)
		}
	}
	if s.WorkspaceDir != nil && strings.TrimSpace(*s.WorkspaceDir) != "" {
		return workspace.CleanDir(*s.WorkspaceDir)
	}
	if s.OutputDir != nil && strings.TrimSpace(*s.OutputDir) != "" {
		return workspace.CleanDir(*s.OutputDir)
	}
	return a.workspaceDir, nil
}

func (a *App) effectiveWorkspaceDirForRuntime(s types.UserSettings) string {
	workspaceDir, err := a.effectiveWorkspaceDir(s)
	if err != nil {
		return a.workspaceDir
	}
	return workspaceDir
}

func (a *App) initializeWorkspaces(ctx context.Context) error {
	if a.localStore == nil {
		return nil
	}
	if err := a.removeDefaultWorkspaceProject(ctx); err != nil {
		return err
	}
	activePath := a.workspaceDir
	if legacy, ok := workspace.SettingsDir(a.cachedSettings); ok {
		if cleaned, err := workspace.CleanExistingDir(legacy); err == nil {
			if workspace.SamePath(cleaned, a.workspaceDir) {
				activePath = a.workspaceDir
			} else if ws, err := a.localStore.EnsureWorkspace(ctx, cleaned); err == nil {
				if _, activeErr := a.localStore.ActiveWorkspace(ctx); activeErr != nil {
					_, _ = a.localStore.ActivateWorkspace(ctx, ws.ID)
				}
				activePath = ws.Path
			}
		}
	}
	if ws, err := a.localStore.ActiveWorkspace(ctx); err == nil && ws.Path != "" {
		activePath = ws.Path
	}
	return a.applyActiveWorkspace(activePath)
}

func (a *App) removeDefaultWorkspaceProject(ctx context.Context) error {
	if a.localStore == nil {
		return nil
	}
	if _, err := a.localStore.RemoveWorkspaceByPath(ctx, a.workspaceDir); err != nil {
		return err
	}
	return nil
}

func (a *App) applyActiveWorkspace(workspacePath string) error {
	workspacePath, err := workspace.CleanExistingDir(workspacePath)
	if err != nil {
		return err
	}
	if a.previewReg != nil {
		ctx := a.ctx
		if ctx == nil {
			ctx = context.Background()
		}
		if err := a.previewReg.SetTrustedRoots(a.previewTrustedRoots(ctx, workspacePath, a.cachedSettings)); err != nil {
			return err
		}
	}
	a.resetBridgeRuntime()
	return nil
}

func (a *App) recordTaskWorkspaceContext(taskID, workspaceID, conversationID, parentTaskID, title string, noProject bool) error {
	if a.localStore == nil || strings.TrimSpace(taskID) == "" {
		return nil
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	if strings.TrimSpace(workspaceID) != "" && !noProject {
		ws, err := a.localStore.Workspace(ctx, strings.TrimSpace(workspaceID))
		if err != nil {
			return err
		}
		if _, err := workspace.CleanExistingDir(ws.Path); err != nil {
			return err
		}
		if _, err := a.localStore.ActivateWorkspace(ctx, ws.ID); err != nil {
			return err
		}
	}
	resolvedWorkspaceID := ""
	if !noProject {
		ws, err := a.localStore.ActiveWorkspace(ctx)
		if err != nil {
			return err
		}
		resolvedWorkspaceID = ws.ID
	}
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		conversationID = taskID
	}
	if err := a.localStore.EnsureConversation(ctx, resolvedWorkspaceID, conversationID, title); err != nil {
		return err
	}
	return a.localStore.RecordTaskContext(ctx, taskID, localstore.TaskContext{
		WorkspaceID:    resolvedWorkspaceID,
		ConversationID: conversationID,
		ParentTaskID:   parentTaskID,
	})
}

func (a *App) refreshPreviewTrustedRoots(s types.UserSettings) error {
	if a.previewReg == nil {
		return nil
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	activeWorkspace := a.workspaceDir
	if a.localStore != nil {
		if ws, err := a.localStore.ActiveWorkspace(ctx); err == nil && strings.TrimSpace(ws.Path) != "" {
			activeWorkspace = ws.Path
		}
	}
	roots, ok := a.previewTrustedRootsForUpdate(ctx, activeWorkspace, s)
	if !ok {
		return nil
	}
	if err := a.previewReg.SetTrustedRoots(roots); err != nil {
		return fmt.Errorf("refresh preview trusted roots: %w", err)
	}
	return nil
}

func (a *App) previewTrustedRoots(ctx context.Context, activeWorkspace string, s types.UserSettings) []string {
	roots := workspace.TrustedRoots(a.workspaceDir, s)
	if cleaned, err := workspace.CleanExistingDir(activeWorkspace); err == nil {
		roots = append(roots, cleaned)
	}
	if a.localStore == nil {
		return roots
	}
	summaries, err := a.localStore.QueryWorkspaceSummaries(ctx, 0)
	if err != nil {
		return roots
	}
	for _, summary := range summaries {
		if cleaned, err := workspace.CleanExistingDir(summary.Path); err == nil {
			roots = append(roots, cleaned)
		}
	}
	return roots
}

func (a *App) previewTrustedRootsForUpdate(ctx context.Context, activeWorkspace string, s types.UserSettings) ([]string, bool) {
	if workspace.HasInvalidSettingsDir(s) {
		return nil, false
	}
	return a.previewTrustedRoots(ctx, activeWorkspace, s), true
}
