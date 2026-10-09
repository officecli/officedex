package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"officedex/internal/atomicfile"
)

// Recovery exports are separate from the source. A conflict must never discard
// the editor's bytes or overwrite the external version to make a save succeed.
func (a *App) retainDocumentDraft(source string, data []byte) (string, error) {
	if a.userDataDir == "" {
		return "", nil
	}
	dir := filepath.Join(a.userDataDir, "document-recovery")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	name := sha256Hex([]byte(canonicalPath(source)))[:16] + "-" + filepath.Base(source)
	dest := filepath.Join(dir, name)
	if err := atomicfile.WriteFile(dest, data, 0o600); err != nil {
		return "", err
	}
	return dest, nil
}

// ListDocumentDrafts returns only regular recovery exports created by this app.
func (a *App) ListDocumentDrafts() ([]map[string]string, error) {
	drafts := []map[string]string{}
	if a.userDataDir == "" {
		return drafts, nil
	}
	entries, err := os.ReadDir(filepath.Join(a.userDataDir, "document-recovery"))
	if errors.Is(err, os.ErrNotExist) {
		return drafts, nil
	}
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		id := entry.Name()
		if len(id) < 18 {
			continue
		}
		drafts = append(drafts, map[string]string{"id": id, "name": id[17:], "updatedAt": info.ModTime().UTC().Format(time.RFC3339)})
	}
	sort.Slice(drafts, func(i, j int) bool { return drafts[i]["updatedAt"] > drafts[j]["updatedAt"] })
	return drafts, nil
}

// RestoreDocumentDraft creates a fresh file in the workspace, leaving both the
// external source and the recovery export intact. Only listed IDs are accepted.
func (a *App) RestoreDocumentDraft(id string) (string, error) {
	drafts, err := a.ListDocumentDrafts()
	if err != nil {
		return "", err
	}
	for _, draft := range drafts {
		if draft["id"] != id {
			continue
		}
		data, err := os.ReadFile(filepath.Join(a.userDataDir, "document-recovery", id))
		if err != nil {
			return "", err
		}
		name := draft["name"]
		ext := filepath.Ext(name)
		dest := filepath.Join(a.userDataDir, "workspace", fmt.Sprintf("%s-recovered-%d%s", strings.TrimSuffix(name, ext), time.Now().UnixNano(), ext))
		if err := os.MkdirAll(filepath.Dir(dest), 0o700); err != nil {
			return "", err
		}
		if err := atomicfile.WriteFile(dest, data, 0o600); err != nil {
			return "", err
		}
		return dest, nil
	}
	return "", errors.New("recovery draft not found")
}
