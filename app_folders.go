package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"officedex/internal/types"
	"officedex/internal/workspace"
)

// ─── Folders ────────────────────────────────────────────────────────────────
//
// A folder is a real directory. The new UI's model says every file belongs to
// exactly one, and that exactly one folder is the default — where work lands
// when the user has not chosen anywhere else.
//
// The old IA disagreed, and the disagreement is load-bearing: it treats the
// per-user workspace directory as "no project" rather than as a folder, and
// ListWorkspaces actively removes it from the list on every call
// (removeDefaultWorkspaceProject). The old UI is frozen, so that behaviour
// stays exactly as it is. This is a second view over the same data rather than
// a change to the first one.
//
// The default folder is therefore synthesised rather than stored: a stable id,
// the real workspace directory as its path, and no row in the workspaces table
// for anything to fight over.

// DefaultFolderID names the synthesised default folder. Stable across
// restarts, and deliberately not a workspace row id — nothing stores it.
const DefaultFolderID = "folder:default"

// defaultFolderName is what the default folder is called when its directory
// name is not usable as a label.
const defaultFolderName = "OfficeDex"

// ListFolders returns every folder, the default one first.
//
// Documents with no workspace are reported under DefaultFolderID by the
// service layer; their files already live in this directory, because that is
// where a no-project run writes its output (see effectiveWorkspaceDirForInput).
func (a *App) ListFolders() ([]types.FolderRecord, error) {
	ctx, err := a.documentStoreContext()
	if err != nil {
		return nil, err
	}
	summaries, err := a.localStore.QueryWorkspaceSummaries(ctx, 200)
	if err != nil {
		return nil, err
	}
	folders := make([]types.FolderRecord, 0, len(summaries)+1)
	folders = append(folders, a.defaultFolder())
	for _, summary := range summaries {
		// The synthesised default already covers this path; a stored row for it
		// would show the same directory twice.
		if workspace.SamePath(summary.Path, a.workspaceDir) {
			continue
		}
		folders = append(folders, types.FolderRecord{
			ID:   summary.ID,
			Name: summary.Name,
			Path: summary.Path,
		})
	}
	return folders, nil
}

func (a *App) defaultFolder() types.FolderRecord {
	name := strings.TrimSpace(filepath.Base(a.workspaceDir))
	if name == "" || name == "." || name == string(filepath.Separator) {
		name = defaultFolderName
	}
	return types.FolderRecord{
		ID:        DefaultFolderID,
		Name:      name,
		Path:      a.workspaceDir,
		IsDefault: true,
	}
}

// FolderPath resolves a folder id to the directory it stands for. The default
// folder resolves without touching the store; anything else has to exist.
func (a *App) FolderPath(folderID string) (string, error) {
	folderID = strings.TrimSpace(folderID)
	if folderID == "" || folderID == DefaultFolderID {
		return a.workspaceDir, nil
	}
	ctx, err := a.documentStoreContext()
	if err != nil {
		return "", err
	}
	found, err := a.localStore.Workspace(ctx, folderID)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(found.Path) == "" {
		return "", fmt.Errorf("folder not found: %s", folderID)
	}
	return found.Path, nil
}

// CreateFolder makes a new directory under the default folder and registers it.
//
// The UI supplies a name, not a path: a folder is somewhere the app puts
// things, and where that is is this layer's business. Names are slugified the
// same way task output directories are, so what appears in Finder matches what
// the user typed as closely as the filesystem allows.
func (a *App) CreateFolder(name string) (types.FolderRecord, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return types.FolderRecord{}, errors.New("folder name is required")
	}
	ctx, err := a.documentStoreContext()
	if err != nil {
		return types.FolderRecord{}, err
	}
	slug := workspace.Slugify(name)
	if slug == "" {
		return types.FolderRecord{}, fmt.Errorf("folder name has no usable characters: %q", name)
	}
	target := filepath.Join(a.workspaceDir, slug)
	// A name the user has already used should not silently merge into the
	// existing directory: two folders with one path is the confusing outcome.
	if _, statErr := os.Stat(target); statErr == nil {
		return types.FolderRecord{}, fmt.Errorf("a folder named %q already exists", name)
	} else if !errors.Is(statErr, os.ErrNotExist) {
		return types.FolderRecord{}, fmt.Errorf("check folder %s: %w", target, statErr)
	}
	if err := os.MkdirAll(target, 0o755); err != nil {
		return types.FolderRecord{}, fmt.Errorf("create folder %s: %w", target, err)
	}
	created, err := a.localStore.EnsureWorkspace(ctx, target)
	if err != nil {
		return types.FolderRecord{}, err
	}
	// EnsureWorkspace names a workspace after its directory; keep what the user
	// typed instead, since the directory name went through the slug.
	if created.Name != name {
		renamed, renameErr := a.localStore.RenameWorkspace(ctx, created.ID, name)
		if renameErr != nil {
			return types.FolderRecord{}, renameErr
		}
		created = renamed
	}
	return types.FolderRecord{ID: created.ID, Name: created.Name, Path: created.Path}, nil
}

// RenameFolder renames the folder's label. The directory on disk keeps its
// name: renaming it would move every file inside and break paths the editors
// and recent-file rows already hold.
func (a *App) RenameFolder(folderID, name string) (types.FolderRecord, error) {
	folderID = strings.TrimSpace(folderID)
	name = strings.TrimSpace(name)
	if name == "" {
		return types.FolderRecord{}, errors.New("folder name is required")
	}
	if folderID == DefaultFolderID {
		return types.FolderRecord{}, errors.New("the default folder cannot be renamed")
	}
	ctx, err := a.documentStoreContext()
	if err != nil {
		return types.FolderRecord{}, err
	}
	renamed, err := a.localStore.RenameWorkspace(ctx, folderID, name)
	if err != nil {
		return types.FolderRecord{}, err
	}
	return types.FolderRecord{ID: renamed.ID, Name: renamed.Name, Path: renamed.Path}, nil
}

// RemoveFolder unregisters a folder. Files are not deleted and not moved: the
// directory and its contents stay on disk, and the documents in it report the
// default folder from then on. The UI's rule is that removing a folder never
// destroys work.
func (a *App) RemoveFolder(folderID string) error {
	folderID = strings.TrimSpace(folderID)
	if folderID == DefaultFolderID {
		return errors.New("the default folder cannot be removed")
	}
	ctx, err := a.documentStoreContext()
	if err != nil {
		return err
	}
	return a.localStore.RemoveWorkspace(ctx, folderID)
}
