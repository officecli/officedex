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
// Creating a *new* empty document is deliberately not here — see docs/uiport-scope.md.

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
	if err := moveFile(record.FilePath, destination); err != nil {
		return types.DocumentRecord{}, fmt.Errorf("rename %s: %w", record.FileName, err)
	}
	ctx, err := a.documentStoreContext()
	if err != nil {
		return types.DocumentRecord{}, err
	}
	if err := a.localStore.RelocateDocument(ctx, record.ID, destination, name+ext); err != nil {
		return types.DocumentRecord{}, err
	}
	return a.GetDocument(record.ID)
}

// MoveDocument moves the file into another folder, keeping its name and id.
func (a *App) MoveDocument(documentID, folderID string) (types.DocumentRecord, error) {
	record, err := a.GetDocument(documentID)
	if err != nil {
		return types.DocumentRecord{}, err
	}
	directory, err := a.FolderPath(folderID)
	if err != nil {
		return types.DocumentRecord{}, err
	}
	destination := filepath.Join(directory, record.FileName)
	if destination == record.FilePath {
		return record, nil
	}
	if _, err := os.Stat(destination); err == nil {
		return types.DocumentRecord{}, fmt.Errorf("a file named %q already exists in that folder", record.FileName)
	} else if !errors.Is(err, os.ErrNotExist) {
		return types.DocumentRecord{}, fmt.Errorf("check destination: %w", err)
	}
	if _, err := os.Stat(record.FilePath); err != nil {
		return types.DocumentRecord{}, fmt.Errorf("document file is unavailable: %w", err)
	}
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return types.DocumentRecord{}, fmt.Errorf("prepare folder %s: %w", directory, err)
	}
	if err := moveFile(record.FilePath, destination); err != nil {
		return types.DocumentRecord{}, fmt.Errorf("move %s: %w", record.FileName, err)
	}
	ctx, err := a.documentStoreContext()
	if err != nil {
		return types.DocumentRecord{}, err
	}
	if err := a.localStore.RelocateDocument(ctx, record.ID, destination, record.FileName); err != nil {
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
