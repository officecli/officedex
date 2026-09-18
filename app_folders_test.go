package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"officedex/internal/localstore"
)

func newFolderTestApp(t *testing.T) (*App, *localstore.Store, string) {
	t.Helper()
	root := t.TempDir()
	workspaceDir := filepath.Join(root, "OfficeDex")
	if err := os.MkdirAll(workspaceDir, 0o755); err != nil {
		t.Fatal(err)
	}
	store := localstore.New(filepath.Join(root, "officedex.db"))
	if err := store.Open(context.Background()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return &App{localStore: store, workspaceDir: workspaceDir}, store, workspaceDir
}

// The default folder is synthesised, not stored. The old IA removes the
// workspace directory from its own list on every call; this view has to show it
// anyway, and the two must not fight over a row.
func TestListFoldersAlwaysLeadsWithASyntheticDefault(t *testing.T) {
	app, store, workspaceDir := newFolderTestApp(t)
	ctx := context.Background()

	folders, err := app.ListFolders()
	if err != nil {
		t.Fatalf("ListFolders: %v", err)
	}
	if len(folders) != 1 {
		t.Fatalf("got %d folders, want just the default", len(folders))
	}
	if !folders[0].IsDefault || folders[0].ID != DefaultFolderID {
		t.Errorf("first folder is not the default: %+v", folders[0])
	}
	if folders[0].Path != workspaceDir {
		t.Errorf("default folder path = %s, want the workspace dir %s", folders[0].Path, workspaceDir)
	}

	// A real folder joins it, and the default stays first.
	other := filepath.Join(t.TempDir(), "client-work")
	if err := os.MkdirAll(other, 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := store.EnsureWorkspace(ctx, other); err != nil {
		t.Fatalf("EnsureWorkspace: %v", err)
	}
	folders, err = app.ListFolders()
	if err != nil {
		t.Fatalf("ListFolders: %v", err)
	}
	if len(folders) != 2 || !folders[0].IsDefault {
		t.Fatalf("got %+v, want the default first then client-work", folders)
	}
	defaults := 0
	for _, folder := range folders {
		if folder.IsDefault {
			defaults++
		}
	}
	if defaults != 1 {
		t.Errorf("got %d default folders, want exactly one", defaults)
	}
}

// If the workspace directory ever does get a stored row, it must not appear
// twice — the synthesised default already stands for that path.
func TestListFoldersDoesNotShowTheWorkspaceDirectoryTwice(t *testing.T) {
	app, store, workspaceDir := newFolderTestApp(t)
	if _, err := store.EnsureWorkspace(context.Background(), workspaceDir); err != nil {
		t.Fatalf("EnsureWorkspace: %v", err)
	}

	folders, err := app.ListFolders()
	if err != nil {
		t.Fatalf("ListFolders: %v", err)
	}
	seen := map[string]int{}
	for _, folder := range folders {
		seen[folder.Path]++
	}
	if seen[workspaceDir] != 1 {
		t.Errorf("workspace dir appears %d times in %+v, want once", seen[workspaceDir], folders)
	}
}

// The UI supplies a name; where the directory goes is this layer's business.
func TestCreateFolderMakesADirectoryAndRefusesDuplicates(t *testing.T) {
	app, _, workspaceDir := newFolderTestApp(t)

	created, err := app.CreateFolder("Client work")
	if err != nil {
		t.Fatalf("CreateFolder: %v", err)
	}
	if created.Name != "Client work" {
		t.Errorf("name = %q, want what the user typed", created.Name)
	}
	if filepath.Dir(created.Path) != workspaceDir {
		t.Errorf("created under %s, want under the default folder %s", filepath.Dir(created.Path), workspaceDir)
	}
	info, err := os.Stat(created.Path)
	if err != nil || !info.IsDir() {
		t.Fatalf("directory was not created at %s: %v", created.Path, err)
	}

	// Silently merging into an existing directory gives two folders one path.
	if _, err := app.CreateFolder("Client work"); err == nil {
		t.Error("expected a refusal for a name already in use")
	}
	if _, err := app.CreateFolder("   "); err == nil {
		t.Error("expected a refusal for a blank name")
	}
	if _, err := app.CreateFolder("///"); err == nil {
		t.Error("expected a refusal for a name with no usable characters")
	}
}

// Renaming changes the label. The directory keeps its name: renaming it would
// move every file inside and break paths the editors already hold.
func TestRenameFolderLeavesTheDirectoryAlone(t *testing.T) {
	app, _, _ := newFolderTestApp(t)
	created, err := app.CreateFolder("Before")
	if err != nil {
		t.Fatalf("CreateFolder: %v", err)
	}

	renamed, err := app.RenameFolder(created.ID, "After")
	if err != nil {
		t.Fatalf("RenameFolder: %v", err)
	}
	if renamed.Name != "After" {
		t.Errorf("name = %q, want After", renamed.Name)
	}
	if renamed.Path != created.Path {
		t.Errorf("path moved from %s to %s", created.Path, renamed.Path)
	}
	if _, err := os.Stat(created.Path); err != nil {
		t.Errorf("directory no longer at its original path: %v", err)
	}
}

// Removing a folder never destroys work: the directory and its contents stay.
func TestRemoveFolderKeepsTheDirectoryOnDisk(t *testing.T) {
	app, _, _ := newFolderTestApp(t)
	created, err := app.CreateFolder("Temporary")
	if err != nil {
		t.Fatalf("CreateFolder: %v", err)
	}
	keeper := filepath.Join(created.Path, "keep.txt")
	if err := os.WriteFile(keeper, []byte("work"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := app.RemoveFolder(created.ID); err != nil {
		t.Fatalf("RemoveFolder: %v", err)
	}
	if _, err := os.Stat(keeper); err != nil {
		t.Errorf("removing a folder deleted its contents: %v", err)
	}
	folders, err := app.ListFolders()
	if err != nil {
		t.Fatalf("ListFolders: %v", err)
	}
	for _, folder := range folders {
		if folder.ID == created.ID {
			t.Errorf("removed folder is still listed: %+v", folder)
		}
	}
}

// The default folder is the one place work can always land, so it is not the
// user's to rename or remove.
func TestDefaultFolderCannotBeRenamedOrRemoved(t *testing.T) {
	app, _, workspaceDir := newFolderTestApp(t)

	if _, err := app.RenameFolder(DefaultFolderID, "Something else"); err == nil {
		t.Error("expected a refusal when renaming the default folder")
	}
	if err := app.RemoveFolder(DefaultFolderID); err == nil {
		t.Error("expected a refusal when removing the default folder")
	}

	// And it resolves to the workspace directory without touching the store.
	path, err := app.FolderPath(DefaultFolderID)
	if err != nil || path != workspaceDir {
		t.Errorf("FolderPath(default) = %q, %v; want %q", path, err, workspaceDir)
	}
	// A blank id means the same thing: documents with no workspace.
	blank, err := app.FolderPath("")
	if err != nil || blank != workspaceDir {
		t.Errorf("FolderPath(blank) = %q, %v; want %q", blank, err, workspaceDir)
	}
	if _, err := app.FolderPath("folder:nope"); err == nil {
		t.Error("expected an error for a folder that does not exist")
	}
}
