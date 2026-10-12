package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"officedex/internal/types"
)

// ArtifactSuggestionFileInput is the renderer-facing, path-only contract for
// the shell's Review/Apply/Undo flow. Bytes never cross the Wails boundary.
type ArtifactSuggestionFileInput struct {
	SuggestionID         string `json:"suggestionId"`
	SourceFile           string `json:"sourceFile"`
	ArtifactFile         string `json:"artifactFile"`
	ExpectedSourceSHA256 string `json:"expectedSourceSHA256,omitempty"`
}

type artifactSuggestionBackup struct {
	Path          string
	Source        string
	AppliedSHA256 string
}

// Apply is a guarded commit of the worker's proposal, not worker completion.
// Capture the baseline at Modify dispatch, so an external edit during the run
// cannot be silently overwritten by either Full access or a later Review.
func (a *App) ApplyArtifactSuggestion(input ArtifactSuggestionFileInput) error {
	key := strings.TrimSpace(input.SuggestionID)
	source := filepath.Clean(strings.TrimSpace(input.SourceFile))
	artifact := filepath.Clean(strings.TrimSpace(input.ArtifactFile))
	if key == "" || source == "." || artifact == "." || input.ExpectedSourceSHA256 == "" {
		return errors.New("suggestion source baseline is unavailable; run the edit again before applying")
	}
	if canonicalPath(source) == canonicalPath(artifact) || filepath.Ext(source) == "" || !strings.EqualFold(filepath.Ext(source), filepath.Ext(artifact)) {
		return errors.New("suggestion source and artifact must be different files of the same type")
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if _, exists := a.artifactSuggestionBackups[key]; exists {
		return errors.New("suggestion has already been applied")
	}
	if err := requireRegularSuggestionFile(source); err != nil {
		return fmt.Errorf("source file: %w", err)
	}
	if err := requireRegularSuggestionFile(artifact); err != nil {
		return fmt.Errorf("artifact file: %w", err)
	}
	before, err := os.ReadFile(source)
	if err != nil {
		return err
	}
	if sha256Hex(before) != input.ExpectedSourceSHA256 {
		return errSourceChangedExternally
	}
	after, err := os.ReadFile(artifact)
	if err != nil {
		return err
	}
	backup, err := os.CreateTemp("", "officedex-suggestion-*.bak")
	if err != nil {
		return err
	}
	backupPath := backup.Name()
	if _, err = backup.Write(before); err != nil {
		backup.Close()
		os.Remove(backupPath)
		return err
	}
	if err = backup.Close(); err != nil {
		os.Remove(backupPath)
		return err
	}
	if err := replaceSuggestionBytes(source, after, input.ExpectedSourceSHA256); err != nil {
		os.Remove(backupPath)
		return fmt.Errorf("apply artifact: %w", err)
	}
	if a.artifactSuggestionBackups == nil {
		a.artifactSuggestionBackups = make(map[string]artifactSuggestionBackup)
	}
	a.artifactSuggestionBackups[key] = artifactSuggestionBackup{Path: backupPath, Source: canonicalPath(source), AppliedSHA256: sha256Hex(after)}
	return nil
}

// Undo can only restore the original target, while it still contains exactly
// the bytes this suggestion applied. It must never discard a later user edit.
func (a *App) UndoArtifactSuggestion(input ArtifactSuggestionFileInput) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	backup, ok := a.artifactSuggestionBackups[strings.TrimSpace(input.SuggestionID)]
	if !ok {
		return errors.New("suggestion is no longer undoable")
	}
	if backup.Source != canonicalPath(input.SourceFile) {
		return errors.New("suggestion target does not match its saved source")
	}
	if err := requireRegularSuggestionFile(backup.Path); err != nil {
		return err
	}
	before, err := os.ReadFile(backup.Path)
	if err != nil {
		return err
	}
	if err := replaceSuggestionBytes(input.SourceFile, before, backup.AppliedSHA256); err != nil {
		return fmt.Errorf("restore source file: %w", err)
	}
	delete(a.artifactSuggestionBackups, strings.TrimSpace(input.SuggestionID))
	_ = os.Remove(backup.Path)
	return nil
}

func requireRegularSuggestionFile(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return errors.New("must be a regular non-symlink file")
	}
	return nil
}

func replaceSuggestionBytes(destination string, data []byte, expectedSHA256 string) error {
	if err := requireRegularSuggestionFile(destination); err != nil {
		return err
	}
	info, err := os.Stat(destination)
	if err != nil {
		return err
	}
	// Rename would otherwise replace a read-only file as long as its directory
	// is writable. Respect both its mode bits and the OS ACL/access decision.
	if info.Mode().Perm()&0o222 == 0 {
		return os.ErrPermission
	}
	writable, err := os.OpenFile(destination, os.O_WRONLY, 0)
	if err != nil {
		return err
	}
	if err := writable.Close(); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(destination), ".officedex-suggestion-*")
	if err != nil {
		return err
	}
	defer os.Remove(temporary.Name())
	if err := temporary.Chmod(info.Mode().Perm()); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(data); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	// Recheck after staging bytes, immediately before the atomic replacement.
	if err := requireRegularSuggestionFile(destination); err != nil {
		return err
	}
	current, err := os.ReadFile(destination)
	if err != nil {
		return err
	}
	if sha256Hex(current) != expectedSHA256 {
		return errSourceChangedExternally
	}
	return os.Rename(temporary.Name(), destination)
}

// ─── Document file operations ───────────────────────────────────────────────
//
// These move real files. A folder is a real directory, so what the user sees in
// the app and what they see in Finder have to be the same thing — renaming a
// document renames the file, moving it moves the file.
//
// Two invariants hold across all of them:
//
//   - The document id never changes. It used to be a pure function of the path,
//     which meant a rename produced a different document and every tab, recent-
//     files row and agent reference the UI was holding pointed at something that
//     no longer existed. The path is an attribute now; see documentIDForPathTx.
//
//   - The filesystem moves first, the database second. If the move fails there
//     is nothing to undo; if the database write fails afterwards the file is in
//     its new place and the next projection pass reconciles. The opposite order
//     would leave rows pointing at a file that was never moved.
//
// Creating a new empty document lives in app_blank_document.go; this file keeps
// the rename, move, duplicate and remove operations together.

// documentExtension keeps a document's type when its name changes. A .pptx that
// the user renames to "Q3 review" is still a .pptx.
func documentExtension(record types.DocumentRecord) string {
	if ext := filepath.Ext(record.FilePath); ext != "" {
		return ext
	}
	if record.DocumentType != "" {
		return "." + strings.ToLower(record.DocumentType)
	}
	return ""
}

// sanitizeFileName rejects the names that would escape the folder rather than
// quietly rewriting them: a name that turns into a different path is not the
// rename the user asked for.
func sanitizeFileName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", errors.New("document name is required")
	}
	if strings.ContainsRune(name, os.PathSeparator) || strings.Contains(name, "/") {
		return "", fmt.Errorf("document name cannot contain a path separator: %q", name)
	}
	if name == "." || name == ".." {
		return "", fmt.Errorf("invalid document name: %q", name)
	}
	return name, nil
}

// moveFile renames a file, falling back to copy-and-delete across volumes.
//
// os.Rename fails with a link error when the two paths are on different
// filesystems, which on a desktop is ordinary: an external disk, a network
// share, a RAM disk in a test.
func moveFile(source, destination string) error {
	if err := os.Rename(source, destination); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrExist) {
		var linkErr *os.LinkError
		if !errors.As(err, &linkErr) {
			return err
		}
	}
	if err := copyFile(source, destination); err != nil {
		return err
	}
	if err := os.Remove(source); err != nil {
		// The copy landed, so the move succeeded as far as the user is
		// concerned; leaving the original behind is the lesser failure and
		// worth reporting rather than rolling back a good copy.
		return fmt.Errorf("copied to %s but could not remove %s: %w", destination, source, err)
	}
	return nil
}

func copyFile(source, destination string) error {
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	// O_EXCL: never silently overwrite something already at the destination.
	out, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		_ = os.Remove(destination)
		return err
	}
	return out.Close()
}

// uniqueDestination appends " 2", " 3" … until the path is free, the way a
// file manager does. Bounded so a pathological directory cannot spin forever.
func uniqueDestination(directory, base, ext string) (string, error) {
	candidate := filepath.Join(directory, base+ext)
	if _, err := os.Stat(candidate); errors.Is(err, os.ErrNotExist) {
		return candidate, nil
	} else if err != nil {
		return "", err
	}
	for i := 2; i < 1000; i++ {
		candidate = filepath.Join(directory, fmt.Sprintf("%s %d%s", base, i, ext))
		if _, err := os.Stat(candidate); errors.Is(err, os.ErrNotExist) {
			return candidate, nil
		} else if err != nil {
			return "", err
		}
	}
	return "", fmt.Errorf("no free name for %s in %s", base+ext, directory)
}

// RenameDocument renames the file on disk and every row that remembers it. The
// extension is preserved: a .pptx renamed to "Q3 review" is still a .pptx.
func (a *App) RenameDocument(documentID, name string) (types.DocumentRecord, error) {
	a.documentRelocationMu.Lock()
	defer a.documentRelocationMu.Unlock()
	name, err := sanitizeFileName(name)
	if err != nil {
		return types.DocumentRecord{}, err
	}
	record, err := a.GetDocument(documentID)
	if err != nil {
		return types.DocumentRecord{}, err
	}
	ext := documentExtension(record)
	if strings.EqualFold(filepath.Ext(name), ext) {
		name = strings.TrimSuffix(name, filepath.Ext(name))
	}
	destination := filepath.Join(filepath.Dir(record.FilePath), name+ext)
	if destination == record.FilePath {
		return record, nil
	}
	if _, err := os.Stat(destination); err == nil {
		return types.DocumentRecord{}, fmt.Errorf("a file named %q already exists here", name+ext)
	} else if !errors.Is(err, os.ErrNotExist) {
		return types.DocumentRecord{}, fmt.Errorf("check destination: %w", err)
	}
	// A file deleted outside the app is reported rather than papered over: the
	// row would otherwise point at a path that never existed.
	if _, err := os.Stat(record.FilePath); err != nil {
		return types.DocumentRecord{}, fmt.Errorf("document file is unavailable: %w", err)
	}
	ctx, err := a.documentStoreContext()
	if err != nil {
		return types.DocumentRecord{}, err
	}
	// Resolve aliases while the source still exists (/var vs /private/var on macOS).
	oldCanonical := canonicalPath(record.FilePath)
	if err := moveFile(record.FilePath, destination); err != nil {
		return types.DocumentRecord{}, fmt.Errorf("rename %s: %w", record.FileName, err)
	}
	if err := a.localStore.RelocateDocument(ctx, record.ID, destination, name+ext); err != nil {
		rollbackErr := moveFile(destination, record.FilePath)
		return types.DocumentRecord{}, errors.Join(err, rollbackErr)
	}
	newCanonical := canonicalPath(destination)
	if a.previewReg != nil {
		a.previewReg.RelocateFile(oldCanonical, newCanonical)
	}
	if a.pptxEditorService != nil {
		a.pptxEditorService.RelocateFile(oldCanonical, newCanonical)
	}
	if a.xlsxEditorService != nil {
		a.xlsxEditorService.RelocateFile(oldCanonical, newCanonical)
	}
	a.sourceDigests.relocate(oldCanonical, newCanonical)

	return a.GetDocument(record.ID)
}

// MoveDocument files the document under another folder, keeping its name, id
// and path. Despite the verb — kept because the UI contract and every caller
// use it — nothing moves on disk.
//
// A project's Assets are references (WORKSPACE-STANDARD: "从项目库移除引用；原文件仍可在
// Local 打开", "不自动搬走或复制两个项目的资产"). Adding a file the user keeps on their
// Desktop to a project must not take it off the Desktop, and removing it from
// the project must not relocate a file the agent wrote into that project's
// directory. Only "Move to Trash" touches files. So this writes the one column
// the file list reads folder membership from — documents.workspace_id — and
// leaves file_path alone, which is also what makes the change survive the
// projection reconcile at the next launch.
//
// The earlier version moved the file and left workspace_id unchanged: the file
// disappeared from where the user kept it and never appeared in the project.
func (a *App) MoveDocument(documentID, folderID string) (types.DocumentRecord, error) {
	record, err := a.GetDocument(documentID)
	if err != nil {
		return types.DocumentRecord{}, err
	}
	folderID = strings.TrimSpace(folderID)
	// Resolving the folder is what checks it exists; the path itself is unused.
	if _, err := a.FolderPath(folderID); err != nil {
		return types.DocumentRecord{}, err
	}
	workspaceID := folderID
	if folderID == DefaultFolderID {
		workspaceID = ""
	}
	if record.WorkspaceID == workspaceID {
		return record, nil
	}
	ctx, err := a.documentStoreContext()
	if err != nil {
		return types.DocumentRecord{}, err
	}
	if err := a.localStore.SetDocumentWorkspace(ctx, record.ID, workspaceID); err != nil {
		return types.DocumentRecord{}, err
	}
	return a.GetDocument(record.ID)
}

// DuplicateDocument copies the file beside the original and records the copy as
// a document of its own. The copy has no run behind it, which is why it is
// written through the artifacts table the projection reads.
func (a *App) DuplicateDocument(documentID string) (types.DocumentRecord, error) {
	record, err := a.GetDocument(documentID)
	if err != nil {
		return types.DocumentRecord{}, err
	}
	if _, err := os.Stat(record.FilePath); err != nil {
		return types.DocumentRecord{}, fmt.Errorf("document file is unavailable: %w", err)
	}
	ext := documentExtension(record)
	base := strings.TrimSuffix(record.FileName, ext)
	destination, err := uniqueDestination(filepath.Dir(record.FilePath), base+" copy", ext)
	if err != nil {
		return types.DocumentRecord{}, err
	}
	if err := copyFile(record.FilePath, destination); err != nil {
		return types.DocumentRecord{}, fmt.Errorf("duplicate %s: %w", record.FileName, err)
	}
	ctx, err := a.documentStoreContext()
	if err != nil {
		return types.DocumentRecord{}, err
	}
	copied, err := a.localStore.InsertCopiedDocument(ctx, record.ID, destination, filepath.Base(destination))
	if err != nil {
		// The file is on disk but unrecorded; removing it keeps the two in step
		// rather than leaving an orphan the user cannot see or reach.
		_ = os.Remove(destination)
		return types.DocumentRecord{}, err
	}
	return copied, nil
}

// PublishArtifactCopy is used only when the user explicitly asks for a copy.
// A private proposal must be materialized outside its reserved directory before
// it becomes an independently editable result. Never overwrite an existing file.
func (a *App) PublishArtifactCopy(input ArtifactSuggestionFileInput) (types.Artifact, error) {
	if !filepath.IsAbs(input.SourceFile) || !filepath.IsAbs(input.ArtifactFile) || strings.TrimSpace(input.SuggestionID) == "" {
		return types.Artifact{}, errors.New("copy requires a task and absolute paths")
	}
	if err := requireRegularSuggestionFile(input.SourceFile); err != nil {
		return types.Artifact{}, err
	}
	if !types.IsInternalProposal(input.ArtifactFile) || types.IsInternalProposal(input.SourceFile) {
		return types.Artifact{}, errors.New("invalid proposal copy paths")
	}
	if err := requireRegularSuggestionFile(input.ArtifactFile); err != nil {
		return types.Artifact{}, err
	}
	ext := filepath.Ext(input.SourceFile)
	if !strings.EqualFold(ext, filepath.Ext(input.ArtifactFile)) {
		return types.Artifact{}, errors.New("proposal type does not match source")
	}
	destination, err := uniqueDestination(filepath.Dir(input.SourceFile), strings.TrimSuffix(filepath.Base(input.SourceFile), ext)+".modified", ext)
	if err != nil {
		return types.Artifact{}, err
	}
	if err := copyFile(input.ArtifactFile, destination); err != nil {
		return types.Artifact{}, err
	}
	artifact := types.Artifact{TaskID: input.SuggestionID, FilePath: destination, FileName: filepath.Base(destination), DocumentType: strings.TrimPrefix(strings.ToLower(ext), ".")}
	if a.previewReg != nil {
		if err := a.previewReg.AllowSelectedArtifact(artifact); err != nil {
			return types.Artifact{}, err
		}
	}
	if err := a.RecordArtifact(artifact); err != nil {
		return types.Artifact{}, err
	}
	return artifact, nil
}
