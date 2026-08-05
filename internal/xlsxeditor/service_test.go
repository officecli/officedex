package xlsxeditor

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"officedex/internal/preview"
)

type fakePreviewResolver struct {
	entries map[string]preview.ArtifactEntry
	err     error
}

func (r *fakePreviewResolver) ResolveToken(token string) (preview.ArtifactEntry, error) {
	if r.err != nil {
		return preview.ArtifactEntry{}, r.err
	}
	entry, ok := r.entries[token]
	if !ok {
		return preview.ArtifactEntry{}, errors.New("preview: invalid preview token")
	}
	return entry, nil
}

type fakeConverter struct {
	mu         sync.Mutex
	imports    [][3]string
	exports    [][3]string
	importFn   func(string, string, string) error
	exportFn   func(string, string, string) error
	closeCalls int
	closeErr   error
}

func (c *fakeConverter) ImportXlsx(_ context.Context, input, shimo, temp string) error {
	c.mu.Lock()
	c.imports = append(c.imports, [3]string{input, shimo, temp})
	c.mu.Unlock()
	if c.importFn != nil {
		return c.importFn(input, shimo, temp)
	}
	return os.WriteFile(shimo, []byte("prepared-modoc"), 0o600)
}

func (c *fakeConverter) ExportXlsx(_ context.Context, output, shimo, temp string) error {
	c.mu.Lock()
	c.exports = append(c.exports, [3]string{output, shimo, temp})
	c.mu.Unlock()
	if c.exportFn != nil {
		return c.exportFn(output, shimo, temp)
	}
	return nil
}

func (c *fakeConverter) Close() error {
	c.mu.Lock()
	c.closeCalls++
	c.mu.Unlock()
	return c.closeErr
}

func TestPrepareRequiresXlsxPreviewToken(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "document.docx")
	writeFile(t, path, []byte("docx"), 0o600)
	service := NewService(&fakePreviewResolver{entries: map[string]preview.ArtifactEntry{
		"token": {FilePath: path, DocumentType: "docx"},
	}}, &fakeConverter{}, dir)

	_, err := service.Prepare(context.Background(), "token")
	if err == nil || !strings.Contains(strings.ToLower(err.Error()), "xlsx") {
		t.Fatalf("Prepare() error = %v, want XLSX validation error", err)
	}
}

func TestPrepareImportsModocAndBindsCanonicalPath(t *testing.T) {
	dir := t.TempDir()
	realPath := filepath.Join(dir, "workbook.xlsx")
	writeXlsxFixture(t, realPath, "[Content_Types].xml", "xl/workbook.xml")
	linkPath := filepath.Join(dir, "linked.xlsx")
	if err := os.Symlink(realPath, linkPath); err != nil {
		t.Fatal(err)
	}
	converter := &fakeConverter{}
	service := NewService(&fakePreviewResolver{entries: map[string]preview.ArtifactEntry{
		"token": {FilePath: linkPath, DocumentType: "xlsx"},
	}}, converter, dir)

	result, err := service.Prepare(context.Background(), "token")
	if err != nil {
		t.Fatalf("Prepare() error = %v", err)
	}
	if result.SessionID == "" || result.ModocContent != "prepared-modoc" {
		t.Fatalf("Prepare() = %+v", result)
	}
	if len(converter.imports) != 1 {
		t.Fatalf("Import calls = %d, want 1", len(converter.imports))
	}
	canonicalRealPath, err := filepath.EvalSymlinks(realPath)
	if err != nil {
		t.Fatal(err)
	}
	if converter.imports[0][0] != canonicalRealPath {
		t.Fatalf("Import input = %q, want canonical %q", converter.imports[0][0], canonicalRealPath)
	}
	if filepath.Dir(converter.imports[0][1]) != converter.imports[0][2] {
		t.Fatalf("MODoc path/temp = %q/%q, want same private directory", converter.imports[0][1], converter.imports[0][2])
	}
}

func TestPrepareReadsContentFromDirectoryModocPackage(t *testing.T) {
	dir := t.TempDir()
	originalPath := filepath.Join(dir, "workbook.xlsx")
	writeXlsxFixture(t, originalPath, "[Content_Types].xml", "xl/workbook.xml")
	converter := &fakeConverter{importFn: func(_, shimo, _ string) error {
		if err := os.Mkdir(shimo, 0o700); err != nil {
			return err
		}
		return os.WriteFile(filepath.Join(shimo, "content"), []byte("directory-modoc"), 0o600)
	}}
	service := NewService(&fakePreviewResolver{entries: map[string]preview.ArtifactEntry{
		"token": {FilePath: originalPath, DocumentType: "xlsx"},
	}}, converter, dir)

	result, err := service.Prepare(context.Background(), "token")
	if err != nil {
		t.Fatalf("Prepare() error = %v", err)
	}
	if result.ModocContent != "directory-modoc" {
		t.Fatalf("Prepare().ModocContent = %q, want directory package content", result.ModocContent)
	}
}

func TestSaveUpdatesDirectoryModocContentBeforeExport(t *testing.T) {
	dir := t.TempDir()
	originalPath := filepath.Join(dir, "workbook.xlsx")
	writeXlsxFixture(t, originalPath, "[Content_Types].xml", "xl/workbook.xml")
	converter := &fakeConverter{importFn: func(_, shimo, _ string) error {
		if err := os.Mkdir(shimo, 0o700); err != nil {
			return err
		}
		return os.WriteFile(filepath.Join(shimo, "content"), []byte("directory-modoc"), 0o600)
	}}
	converter.exportFn = func(output, shimo, _ string) error {
		info, err := os.Stat(shimo)
		if err != nil {
			return err
		}
		if !info.IsDir() {
			return fmt.Errorf("export MODoc path is not a directory")
		}
		content, err := os.ReadFile(filepath.Join(shimo, "content"))
		if err != nil {
			return err
		}
		if string(content) != "changed-modoc" {
			return fmt.Errorf("export MODoc content = %q", content)
		}
		writeXlsxFixture(t, output, "[Content_Types].xml", "xl/workbook.xml")
		return nil
	}
	service := NewService(&fakePreviewResolver{entries: map[string]preview.ArtifactEntry{
		"token": {FilePath: originalPath, DocumentType: "xlsx"},
	}}, converter, dir)
	prepared, err := service.Prepare(context.Background(), "token")
	if err != nil {
		t.Fatalf("Prepare() error = %v", err)
	}

	if _, err := service.Save(context.Background(), "token", prepared.SessionID, "changed-modoc"); err != nil {
		t.Fatalf("Save() error = %v", err)
	}
}

func TestSaveRejectsTokenOrSessionMismatch(t *testing.T) {
	service, converter, token, sessionID, _ := preparedService(t)

	for _, tc := range []struct{ token, session string }{
		{"wrong-token", sessionID},
		{token, "wrong-session"},
	} {
		_, err := service.Save(context.Background(), tc.token, tc.session, "modoc")
		if !errors.Is(err, ErrSessionMismatch) {
			t.Fatalf("Save(%q, %q) error = %v, want ErrSessionMismatch", tc.token, tc.session, err)
		}
	}
	if len(converter.exports) != 0 {
		t.Fatalf("Export calls = %d, want 0", len(converter.exports))
	}
}

func TestSaveRejectsOversizedModoc(t *testing.T) {
	service, converter, token, sessionID, _ := preparedService(t)
	service.maxModocBytes = 4

	_, err := service.Save(context.Background(), token, sessionID, "12345")
	if !errors.Is(err, ErrModocTooLarge) {
		t.Fatalf("Save() error = %v, want ErrModocTooLarge", err)
	}
	if len(converter.exports) != 0 {
		t.Fatalf("Export calls = %d, want 0", len(converter.exports))
	}
}

func TestSaveRejectsExternalFileModification(t *testing.T) {
	service, converter, token, sessionID, originalPath := preparedService(t)
	if err := os.WriteFile(originalPath, []byte("externally modified"), 0o600); err != nil {
		t.Fatal(err)
	}

	_, err := service.Save(context.Background(), token, sessionID, "modoc")
	if !errors.Is(err, ErrSourceChanged) {
		t.Fatalf("Save() error = %v, want ErrSourceChanged", err)
	}
	if len(converter.exports) != 0 {
		t.Fatalf("Export calls = %d, want 0", len(converter.exports))
	}
}

func TestSaveRejectsExternalFileReplacementWithSameFingerprintData(t *testing.T) {
	service, converter, token, sessionID, originalPath := preparedService(t)
	content := readFile(t, originalPath)
	info, err := os.Stat(originalPath)
	if err != nil {
		t.Fatal(err)
	}
	replacementPath := filepath.Join(filepath.Dir(originalPath), "replacement.xlsx")
	writeFile(t, replacementPath, content, info.Mode().Perm())
	if err := os.Chtimes(replacementPath, info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(replacementPath, originalPath); err != nil {
		t.Fatal(err)
	}

	_, err = service.Save(context.Background(), token, sessionID, "modoc")
	if !errors.Is(err, ErrSourceChanged) {
		t.Fatalf("Save() error = %v, want ErrSourceChanged", err)
	}
	if len(converter.exports) != 0 {
		t.Fatalf("Export calls = %d, want 0", len(converter.exports))
	}
}

func TestSaveKeepsOriginalWhenExportFails(t *testing.T) {
	service, converter, token, sessionID, originalPath := preparedService(t)
	want := readFile(t, originalPath)
	converter.exportFn = func(_, _, _ string) error { return errors.New("forced export failure") }

	_, err := service.Save(context.Background(), token, sessionID, "changed-modoc")
	if err == nil || !strings.Contains(err.Error(), "forced export failure") {
		t.Fatalf("Save() error = %v, want export failure", err)
	}
	if got := readFile(t, originalPath); string(got) != string(want) {
		t.Fatalf("original changed after export failure")
	}
}

func TestSaveReplacesOriginalAndRefreshesFingerprint(t *testing.T) {
	service, converter, token, sessionID, originalPath := preparedService(t)
	converter.exportFn = func(output, _, _ string) error {
		writeXlsxFixture(t, output, "[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/saved.xml")
		return nil
	}

	result, err := service.Save(context.Background(), token, sessionID, "changed-modoc")
	if err != nil {
		t.Fatalf("first Save() error = %v", err)
	}
	canonicalOriginalPath, err := filepath.EvalSymlinks(originalPath)
	if err != nil {
		t.Fatal(err)
	}
	if result.FilePath != canonicalOriginalPath {
		t.Fatalf("Save().FilePath = %q, want %q", result.FilePath, canonicalOriginalPath)
	}
	if _, err := service.Save(context.Background(), token, sessionID, "changed-again"); err != nil {
		t.Fatalf("second Save() after fingerprint refresh error = %v", err)
	}
	if len(converter.exports) != 2 {
		t.Fatalf("Export calls = %d, want 2", len(converter.exports))
	}
}

func TestCloseRemovesSessionDirectory(t *testing.T) {
	service, converter, token, sessionID, _ := preparedService(t)
	sessionDir := converter.imports[0][2]

	if err := service.Close(token, sessionID); err != nil {
		t.Fatalf("Close() error = %v", err)
	}
	if _, err := os.Stat(sessionDir); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("session directory stat error = %v, want not exist", err)
	}
}

func TestCloseByTokenRemovesAllBoundSessions(t *testing.T) {
	dir := t.TempDir()
	first := filepath.Join(dir, "first.xlsx")
	second := filepath.Join(dir, "second.xlsx")
	other := filepath.Join(dir, "other.xlsx")
	for _, path := range []string{first, second, other} {
		writeXlsxFixture(t, path, "[Content_Types].xml", "xl/workbook.xml")
	}
	resolver := &fakePreviewResolver{entries: map[string]preview.ArtifactEntry{
		"token": {FilePath: first, DocumentType: "xlsx"},
		"other": {FilePath: other, DocumentType: "xlsx"},
	}}
	converter := &fakeConverter{}
	service := NewService(resolver, converter, dir)
	if _, err := service.Prepare(context.Background(), "token"); err != nil {
		t.Fatal(err)
	}
	resolver.entries["token"] = preview.ArtifactEntry{FilePath: second, DocumentType: "xlsx"}
	if _, err := service.Prepare(context.Background(), "token"); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Prepare(context.Background(), "other"); err != nil {
		t.Fatal(err)
	}
	dirs := []string{converter.imports[0][2], converter.imports[1][2], converter.imports[2][2]}

	if err := service.CloseByToken("token"); err != nil {
		t.Fatalf("CloseByToken() error = %v", err)
	}
	for _, sessionDir := range dirs[:2] {
		if _, err := os.Stat(sessionDir); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("bound session directory %q remains: %v", sessionDir, err)
		}
	}
	if _, err := os.Stat(dirs[2]); err != nil {
		t.Fatalf("other token session removed: %v", err)
	}
}

func TestCloseAllClosesConverter(t *testing.T) {
	service, converter, _, _, _ := preparedService(t)
	sessionDir := converter.imports[0][2]

	if err := service.CloseAll(); err != nil {
		t.Fatalf("CloseAll() error = %v", err)
	}
	if converter.closeCalls != 1 {
		t.Fatalf("converter Close calls = %d, want 1", converter.closeCalls)
	}
	if _, err := os.Stat(sessionDir); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("session directory stat error = %v, want not exist", err)
	}
}

func TestCleanupStaleOnlyRemovesOwnedOldDirectories(t *testing.T) {
	root := t.TempDir()
	service := NewService(&fakePreviewResolver{}, &fakeConverter{}, root)
	now := time.Now()
	service.now = func() time.Time { return now }
	oldOwned := filepath.Join(root, sessionDirectoryPrefix+"old")
	freshOwned := filepath.Join(root, sessionDirectoryPrefix+"fresh")
	oldUnrelated := filepath.Join(root, "unrelated-old")
	for _, path := range []string{oldOwned, freshOwned, oldUnrelated} {
		if err := os.Mkdir(path, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	old := now.Add(-25 * time.Hour)
	if err := os.Chtimes(oldOwned, old, old); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(oldUnrelated, old, old); err != nil {
		t.Fatal(err)
	}

	if err := service.CleanupStale(); err != nil {
		t.Fatalf("CleanupStale() error = %v", err)
	}
	if _, err := os.Stat(oldOwned); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("old owned directory remains: %v", err)
	}
	for _, path := range []string{freshOwned, oldUnrelated} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("directory %q should remain: %v", path, err)
		}
	}
}

func preparedService(t *testing.T) (*Service, *fakeConverter, string, string, string) {
	t.Helper()
	dir := t.TempDir()
	originalPath := filepath.Join(dir, "workbook.xlsx")
	writeXlsxFixture(t, originalPath, "[Content_Types].xml", "xl/workbook.xml")
	token := "preview-token"
	converter := &fakeConverter{}
	service := NewService(&fakePreviewResolver{entries: map[string]preview.ArtifactEntry{
		token: {FilePath: originalPath, DocumentType: "xlsx"},
	}}, converter, dir)
	result, err := service.Prepare(context.Background(), token)
	if err != nil {
		t.Fatalf("Prepare() error = %v", err)
	}
	return service, converter, token, result.SessionID, originalPath
}
