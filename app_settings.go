package main

import (
	"context"
	"errors"
	"fmt"
	"officedex/internal/workspace"
	"os"
	"path/filepath"
	"strings"
	"time"

	"officedex/internal/applog"
	"officedex/internal/bridge"
	"officedex/internal/login"
	"officedex/internal/settings"
	"officedex/internal/types"
)

// ─── Settings bindings ──────────────────────────────────────────────────────

// GetSettings returns the current sanitized settings.
func (a *App) GetSettings() (types.UserSettings, error) {
	return a.settingsStore.Load()
}

// UpdateSettings applies a patch and restarts the bridge if the change might
// affect it (binary path, LLM provider, runtime mode, proxy).
func (a *App) UpdateSettings(patch settings.Patch) (types.UserSettings, error) {
	if patch.LlmProvider != nil {
		if err := a.requireLoggedInForProvider(patch.LlmProvider); err != nil {
			return types.UserSettings{}, err
		}
	}
	merged, err := a.settingsStore.Update(patch)
	if err != nil {
		return types.UserSettings{}, err
	}
	proxyChanged := patch.Proxy != nil || patch.ClearProxy
	if proxyChanged {
		if merged.Proxy != nil && merged.Proxy.Enabled && merged.Proxy.URL != "" {
			if err := a.proxyPool.Set(merged.Proxy.URL); err != nil {
				return types.UserSettings{}, fmt.Errorf("apply proxy: %w", err)
			}
		} else {
			a.proxyPool.Clear()
		}
	}
	a.mu.Lock()
	a.cachedSettings = merged
	a.storeRuntimeModeSnapshot(merged)
	workspaceChanged := patch.WorkspaceDir != nil || patch.OutputDir != nil
	if workspaceChanged {
		if _, err := a.effectiveWorkspaceDir(merged); err != nil {
			workspaceChanged = false
		}
	}
	touchesBridge := patch.BridgeBinaryPath != nil ||
		workspaceChanged ||
		patch.LlmProvider != nil ||
		patch.ClearLlmProvider ||
		proxyChanged
	var retiredClients []*bridge.Client
	if touchesBridge {
		retiredClients = a.takeBridgeClientsLocked()
		a.binary.invalidate()
	}
	if patch.BridgeBinaryPath != nil || proxyChanged {
		a.loginManager = nil
		if a.loginUnsub != nil {
			a.loginUnsub()
			a.loginUnsub = nil
		}
	}
	a.mu.Unlock()

	if patch.WorkspaceDir != nil || patch.OutputDir != nil {
		if err := a.refreshPreviewTrustedRoots(merged); err != nil {
			return types.UserSettings{}, err
		}
	}
	for _, client := range retiredClients {
		if patch.BridgeBinaryPath != nil || patch.LlmProvider != nil || patch.ClearLlmProvider || proxyChanged {
			// The binary / provider / proxy the child was started with is no
			// longer valid, so it has to go even with work in flight; Close
			// reports those tasks as failed instead of leaving them running.
			client.Close()
		} else {
			// Workspace-only change: let the old process finish what it started.
			a.retireBridge(client)
		}
	}
	return merged, nil
}

// GetDefaultWorkspaceDir returns the per-user workspace folder.
func (a *App) GetDefaultWorkspaceDir() string {
	return a.workspaceDir
}

func (a *App) ListWorkspaces() ([]types.WorkspaceSummary, error) {
	if a.localStore == nil {
		return nil, nil
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	if err := a.ensureLocalStoreOpen(ctx); err != nil {
		return nil, err
	}
	if err := a.removeDefaultWorkspaceProject(ctx); err != nil {
		return nil, err
	}
	return a.localStore.QueryWorkspaceSummaries(ctx, 20)
}

func (a *App) ListRecentFiles(workspaceID string) ([]types.RecentFile, error) {
	if a.localStore == nil {
		return []types.RecentFile{}, nil
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	if err := a.ensureLocalStoreOpen(ctx); err != nil {
		return nil, err
	}
	return a.localStore.QueryRecentFiles(ctx, strings.TrimSpace(workspaceID), 50)
}

func (a *App) RemoveRecentFile(filePath string) error {
	if a.localStore == nil {
		return errors.New("workspace store is unavailable")
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	return a.localStore.RemoveRecentFile(ctx, filePath)
}

// DeleteDocument removes a generated document's local task/history metadata
// while deliberately leaving every file on disk untouched.
func (a *App) DeleteDocument(taskID string) error {
	if a.localStore == nil {
		return errors.New("workspace store is unavailable")
	}
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return errors.New("task id is empty")
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	return a.localStore.RemoveDocumentByTaskID(ctx, taskID)
}

func (a *App) RenameWorkspace(workspaceID, name string) (types.WorkspaceSummary, error) {
	if a.localStore == nil {
		return types.WorkspaceSummary{}, errors.New("workspace store is unavailable")
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	workspaceID = strings.TrimSpace(workspaceID)
	name = strings.TrimSpace(name)
	if workspaceID == "" {
		return types.WorkspaceSummary{}, errors.New("workspace id is empty")
	}
	if name == "" {
		return types.WorkspaceSummary{}, errors.New("workspace name is empty")
	}
	if _, err := a.localStore.RenameWorkspace(ctx, workspaceID, name); err != nil {
		return types.WorkspaceSummary{}, err
	}
	summaries, err := a.localStore.QueryWorkspaceSummaries(ctx, 20)
	if err != nil {
		return types.WorkspaceSummary{}, err
	}
	for _, summary := range summaries {
		if summary.ID == workspaceID {
			return summary, nil
		}
	}
	return types.WorkspaceSummary{}, errors.New("workspace not found")
}

func (a *App) OpenRecentFile(file types.RecentFile) (types.Artifact, error) {
	filePath := filepath.Clean(strings.TrimSpace(file.FilePath))
	if filePath == "." || filePath == "" || !filepath.IsAbs(filePath) {
		return types.Artifact{}, errors.New("recent file path must be absolute")
	}
	info, err := os.Stat(filePath)
	if err != nil {
		return types.Artifact{}, fmt.Errorf("recent file is unavailable: %w", err)
	}
	if !info.Mode().IsRegular() {
		return types.Artifact{}, errors.New("recent file is unavailable")
	}
	documentType := strings.ToLower(strings.TrimSpace(file.DocumentType))
	extensionType := strings.TrimPrefix(strings.ToLower(filepath.Ext(filePath)), ".")
	if !isSupportedRecentPreviewType(documentType) && isSupportedRecentPreviewType(extensionType) {
		documentType = extensionType
	}
	if !isSupportedRecentPreviewType(documentType) {
		return types.Artifact{}, errors.New("unsupported preview file type")
	}
	fileName := strings.TrimSpace(file.FileName)
	if fileName == "" {
		fileName = filepath.Base(filePath)
	}
	artifact := types.Artifact{
		TaskID:       strings.TrimSpace(file.TaskID),
		FilePath:     filePath,
		FileName:     fileName,
		DocumentType: documentType,
	}
	if a.previewReg == nil {
		return types.Artifact{}, errors.New("preview registry is unavailable")
	}
	if err := a.previewReg.AllowSelectedArtifact(artifact); err != nil {
		return types.Artifact{}, err
	}
	if a.localStore != nil {
		ctx := a.ctx
		if ctx == nil {
			ctx = context.Background()
		}
		source := strings.TrimSpace(file.Source)
		if source == "" {
			source = "local"
		}
		if err := a.localStore.UpsertRecentFile(ctx, types.RecentFile{
			FilePath:       filePath,
			FileName:       fileName,
			DocumentType:   documentType,
			Source:         source,
			WorkspaceID:    strings.TrimSpace(file.WorkspaceID),
			TaskID:         strings.TrimSpace(file.TaskID),
			ConversationID: strings.TrimSpace(file.ConversationID),
			LastOpenedAt:   time.Now().UTC().Format(time.RFC3339Nano),
		}); err != nil {
			return types.Artifact{}, err
		}
	}
	return artifact, nil
}

// isSupportedRecentPreviewType reads the capability table's preview
// extensions; it used to be a second hand-written copy of the registry's list.
func isSupportedRecentPreviewType(documentType string) bool {
	return types.IsPreviewable(documentType)
}

func (a *App) AddWorkspace(workspacePath string) (types.WorkspaceSummary, error) {
	cleaned, err := workspace.CleanExistingDir(workspacePath)
	if err != nil {
		return types.WorkspaceSummary{}, err
	}
	if a.localStore == nil {
		return types.WorkspaceSummary{}, errors.New("workspace store is unavailable")
	}
	if workspace.SamePath(cleaned, a.workspaceDir) {
		return types.WorkspaceSummary{}, errors.New("default app workspace is reserved for app-managed documents")
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	ws, err := a.localStore.EnsureWorkspace(ctx, cleaned)
	if err != nil {
		return types.WorkspaceSummary{}, err
	}
	if _, err := a.localStore.ActivateWorkspace(ctx, ws.ID); err != nil {
		return types.WorkspaceSummary{}, err
	}
	if err := a.applyActiveWorkspace(cleaned); err != nil {
		return types.WorkspaceSummary{}, err
	}
	summaries, err := a.localStore.QueryWorkspaceSummaries(ctx, 20)
	if err != nil {
		return types.WorkspaceSummary{}, err
	}
	for _, summary := range summaries {
		if summary.ID == ws.ID {
			return summary, nil
		}
	}
	return types.WorkspaceSummary{ID: ws.ID, Path: ws.Path, Name: ws.Name, Active: true}, nil
}

func (a *App) RemoveWorkspace(workspaceID string) error {
	if a.localStore == nil {
		return errors.New("workspace store is unavailable")
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" {
		return errors.New("workspace id is empty")
	}
	active := false
	if ws, err := a.localStore.ActiveWorkspace(ctx); err == nil && ws.ID == workspaceID {
		active = true
	}
	if err := a.localStore.RemoveWorkspace(ctx, workspaceID); err != nil {
		return err
	}
	activePath := a.workspaceDir
	if active {
		if err := a.localStore.ClearActiveWorkspace(ctx); err != nil {
			return err
		}
	} else if ws, err := a.localStore.ActiveWorkspace(ctx); err == nil && ws.Path != "" {
		activePath = ws.Path
	}
	if err := a.applyActiveWorkspace(activePath); err != nil {
		return err
	}
	return nil
}

func (a *App) SelectWorkspace(workspaceID string) (types.WorkspaceSummary, error) {
	if a.localStore == nil {
		return types.WorkspaceSummary{}, errors.New("workspace store is unavailable")
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	ws, err := a.localStore.Workspace(ctx, workspaceID)
	if err != nil {
		return types.WorkspaceSummary{}, err
	}
	cleaned, err := workspace.CleanExistingDir(ws.Path)
	if err != nil {
		return types.WorkspaceSummary{}, err
	}
	if _, err := a.localStore.ActivateWorkspace(ctx, workspaceID); err != nil {
		return types.WorkspaceSummary{}, err
	}
	if err := a.applyActiveWorkspace(cleaned); err != nil {
		return types.WorkspaceSummary{}, err
	}
	summaries, err := a.localStore.QueryWorkspaceSummaries(ctx, 20)
	if err != nil {
		return types.WorkspaceSummary{}, err
	}
	for _, summary := range summaries {
		if summary.ID == workspaceID {
			return summary, nil
		}
	}
	return types.WorkspaceSummary{ID: ws.ID, Path: ws.Path, Name: ws.Name, Active: true}, nil
}

// GetCreditFeatureSince returns the timestamp at which per-task credit
// tracking became available for this install (the schema_migrations v1 row).
// The renderer uses this to label tasks predating the feature with "—"
// instead of "0".
func (a *App) GetCreditFeatureSince() (string, error) {
	if a.localStore == nil {
		return "", nil
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	return a.localStore.GetCreditFeatureSince(ctx)
}

// GetTaskHistory returns the persisted bridge events for the most recently
// active tasks so the renderer can replay them into TaskState on startup.
// Entries are ordered oldest-first; events within each entry are sorted
// ascending by created_at. A non-positive limit is clamped to a default cap.
func (a *App) GetTaskHistory(limit int) ([]types.TaskHistoryEntry, error) {
	if a.localStore == nil {
		return nil, nil
	}
	if limit <= 0 {
		limit = 50
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	if err := a.ensureLocalStoreOpen(ctx); err != nil {
		return nil, err
	}
	if err := a.refreshPreviewTrustedRoots(a.cachedSettings); err != nil {
		return nil, err
	}
	entries, err := a.localStore.QueryRecentTaskHistory(ctx, limit)
	if err != nil {
		return nil, fmt.Errorf("get task history: list tasks: %w", err)
	}
	out := make([]types.TaskHistoryEntry, 0, len(entries))
	for _, entry := range entries {
		if len(entry.Events) == 0 {
			continue
		}
		// Re-register completed artifacts with the preview registry so the
		// renderer can issue preview tokens after an app restart. Without this,
		// `IssuePreviewToken` rejects historical artifacts with "artifact is not
		// registered" and the preview button appears to do nothing.
		for _, ev := range entry.Events {
			if ev.Type != types.EventTaskCompleted {
				continue
			}
			if artifact := artifactFromCompletedEvent(ev); artifact != nil {
				if err := a.previewReg.AllowArtifact(*artifact); err != nil {
					applog.Logger().Warn("preview register (history)",
						applog.Task(ev.TaskID), applog.Request(ev.RequestID), applog.Err(err))
				}
			}
		}
		out = append(out, entry)
	}
	return out, nil
}

// validateCustomProvider rejects Generate calls that would silently fall
// through to officecli's built-in default endpoint. When the user selects
// custom mode without supplying BaseURL/APIKey/Model, the subprocess
// receives OFFICE_CLI_RUNTIME_MODE=custom but no provider env, and
// officecli routes the request to its hosted fallback — which is misleading.
// Block here with a sentinel error the renderer can translate.
func validateCustomProvider(s types.UserSettings) error {
	if s.LlmProvider == nil {
		return nil
	}
	if strings.TrimSpace(s.LlmProvider.BaseURL) == "" ||
		strings.TrimSpace(s.LlmProvider.APIKey) == "" ||
		strings.TrimSpace(s.LlmProvider.Model) == "" {
		return errors.New(types.TagFailure(types.FailureSetup, "generate.custom_provider_incomplete"))
	}
	return nil
}

func (a *App) requireLoggedInForCustomProvider(s types.UserSettings) error {
	if s.LlmProvider == nil {
		return nil
	}
	return a.requireLoggedInForProvider(s.LlmProvider)
}

func (a *App) requireLoggedInForProvider(provider *types.LlmProvider) error {
	if provider == nil {
		return nil
	}
	opts := a.runCommandOptions()
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	whoami, err := login.GetWhoAmI(ctx, opts)
	if err != nil {
		return fmt.Errorf("custom_provider.login_required: %w", err)
	}
	if whoami.Mode != types.WhoAmILoggedIn {
		return errors.New(types.TagFailure(types.FailureAuth, "custom_provider.login_required"))
	}
	return nil
}
