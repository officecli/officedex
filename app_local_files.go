package main

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"officedex/internal/types"
)

// ─── Opening a file from elsewhere on disk ──────────────────────────────────
//
// Everything else in the library got there because the agent made it. This is
// the one way a file the user already had becomes a document.
//
// The file is not copied and not moved: the document points at wherever the
// user keeps it. That follows the same rule as the rest of the new IA — what
// the app shows and what Finder shows are the same file — and it is why the
// registered document has no workspace. It is not inside any of the app's
// folders, and saying it was would be a lie the first `move` would expose.
// It surfaces in the default folder, which is where "filed nowhere" lands.

// OpenableDocumentTypes is what this app can actually open and edit.
//
// Narrower than types.IsPreviewable on purpose: that list includes images and
// PDFs, which the new IA's file list filters out. Accepting one here would
// register a document that then never appears — worse than refusing, because
// the user watched it succeed.
var OpenableDocumentTypes = []string{"docx", "xlsx", "pptx"}

func isOpenableDocumentType(documentType string) bool {
	documentType = strings.ToLower(strings.TrimPrefix(strings.TrimSpace(documentType), "."))
	for _, candidate := range OpenableDocumentTypes {
		if candidate == documentType {
			return true
		}
	}
	return false
}

// OpenLocalFile shows the native picker and registers what comes back.
//
// A zero record with an empty ID means the user cancelled — the same way
// OpenFileDialog reports it, and not an error, because cancelling a dialog is
// an ordinary thing to do and not something to show a user an error for.
func (a *App) OpenLocalFile() (types.DocumentRecord, error) {
	selected, err := a.OpenFileDialog(&FileDialogOptions{
		Filters: []FileDialogFilter{{Name: "Office files", Extensions: OpenableDocumentTypes}},
	})
	if err != nil {
		return types.DocumentRecord{}, err
	}
	if strings.TrimSpace(selected) == "" {
		return types.DocumentRecord{}, nil
	}
	return a.ImportLocalFile(selected)
}

// ImportLocalFile registers a path that is already known — a drop, a command
// line argument, or the picker above. Split out from OpenLocalFile so the rule
// about which types are allowed has one home, and so the registration half can
// be tested without a native dialog.
func (a *App) ImportLocalFile(filePath string) (types.DocumentRecord, error) {
	filePath = filepath.Clean(strings.TrimSpace(filePath))
	if filePath == "." || filePath == "" || !filepath.IsAbs(filePath) {
		return types.DocumentRecord{}, errors.New("file path must be absolute")
	}
	documentType := strings.TrimPrefix(strings.ToLower(filepath.Ext(filePath)), ".")
	// The dialog's filters already narrow the list, but a typed path slips past
	// them on every platform, so the rule is enforced here rather than there.
	if !isOpenableDocumentType(documentType) {
		return types.DocumentRecord{}, fmt.Errorf("OfficeDex opens Word, Excel and PowerPoint files; %q is not one", filepath.Base(filePath))
	}
	fileName := filepath.Base(filePath)

	// OpenRecentFile is what checks the file is really there, clears it with the
	// preview registry (without which the editor cannot load it) and records the
	// open. Reused rather than repeated.
	if _, err := a.OpenRecentFile(types.RecentFile{
		FilePath:     filePath,
		FileName:     fileName,
		DocumentType: documentType,
		Source:       "local",
	}); err != nil {
		return types.DocumentRecord{}, err
	}

	if a.localStore == nil {
		return types.DocumentRecord{}, errors.New("document store is unavailable")
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	return a.localStore.RegisterLocalDocument(ctx, filePath, fileName, documentType, "")
}
