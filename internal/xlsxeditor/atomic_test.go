package xlsxeditor

import (
	"archive/zip"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestValidateXlsxRequiresContentTypesAndWorkbook(t *testing.T) {
	dir := t.TempDir()

	tests := []struct {
		name    string
		entries []string
		wantErr string
	}{
		{name: "valid", entries: []string{"[Content_Types].xml", "xl/workbook.xml"}},
		{name: "missing content types", entries: []string{"xl/workbook.xml"}, wantErr: "[Content_Types].xml"},
		{name: "missing workbook", entries: []string{"[Content_Types].xml"}, wantErr: "xl/workbook.xml"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path := filepath.Join(dir, strings.ReplaceAll(tt.name, " ", "-")+".xlsx")
			writeXlsxFixture(t, path, tt.entries...)

			err := validateXlsx(path)
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("validateXlsx() error = %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("validateXlsx() error = %v, want message containing %q", err, tt.wantErr)
			}
		})
	}

	invalidPath := filepath.Join(dir, "invalid.xlsx")
	if err := os.WriteFile(invalidPath, []byte("not a zip"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := validateXlsx(invalidPath); err == nil || !strings.Contains(err.Error(), "open ZIP") {
		t.Fatalf("validateXlsx(invalid) error = %v, want ZIP open error", err)
	}

	if err := validateXlsx(dir); err == nil || !strings.Contains(err.Error(), "directory") {
		t.Fatalf("validateXlsx(directory) error = %v, want directory error", err)
	}
}

func TestCreateTempXlsxUsesOriginalDirectory(t *testing.T) {
	dir := t.TempDir()
	temp, err := createTempXlsx(filepath.Join(dir, "workbook.xlsx"))
	if err != nil {
		t.Fatalf("createTempXlsx() error = %v", err)
	}
	t.Cleanup(func() { _ = os.Remove(temp.Name()) })
	if err := temp.Close(); err != nil {
		t.Fatal(err)
	}

	if filepath.Dir(temp.Name()) != dir {
		t.Fatalf("temporary export directory = %q, want %q", filepath.Dir(temp.Name()), dir)
	}
	if !strings.HasPrefix(filepath.Base(temp.Name()), ".officedex-xlsx-") || !strings.HasSuffix(temp.Name(), ".xlsx") {
		t.Fatalf("temporary export path = %q, want .officedex-xlsx-*.xlsx", temp.Name())
	}
}

func TestReplaceAtomicallyPreservesMode(t *testing.T) {
	dir := t.TempDir()
	originalPath := filepath.Join(dir, "workbook.xlsx")
	exportedPath := filepath.Join(dir, "exported.xlsx")
	writeFile(t, originalPath, []byte("old workbook"), 0o600)
	if err := os.Chmod(originalPath, 0o640); err != nil {
		t.Fatal(err)
	}
	writeXlsxFixture(t, exportedPath, "[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml")
	wantContent, err := os.ReadFile(exportedPath)
	if err != nil {
		t.Fatal(err)
	}

	if err := replaceAtomically(originalPath, exportedPath); err != nil {
		t.Fatalf("replaceAtomically() error = %v", err)
	}

	if got := readFile(t, originalPath); string(got) != string(wantContent) {
		t.Fatalf("original content = %q, want exported content %q", got, wantContent)
	}
	info, err := os.Stat(originalPath)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := info.Mode().Perm(), os.FileMode(0o640); got != want {
		t.Fatalf("original mode = %04o, want %04o", got, want)
	}
	if _, err := os.Stat(exportedPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("exported path should be consumed, stat error = %v", err)
	}
}

func TestReplaceAtomicallyLeavesOriginalOnInvalidExport(t *testing.T) {
	dir := t.TempDir()
	originalPath := filepath.Join(dir, "workbook.xlsx")
	exportedPath := filepath.Join(dir, "exported.xlsx")
	writeFile(t, originalPath, []byte("original content"), 0o600)
	if err := os.Chmod(originalPath, 0o640); err != nil {
		t.Fatal(err)
	}
	writeFile(t, exportedPath, []byte("not a workbook"), 0o600)

	err := replaceAtomically(originalPath, exportedPath)
	if err == nil || !strings.Contains(err.Error(), "validate exported XLSX") {
		t.Fatalf("replaceAtomically() error = %v, want validation error", err)
	}
	assertFileUnchanged(t, originalPath, []byte("original content"), 0o640)
}

func TestReplaceAtomicallyLeavesOriginalWhenRenameFails(t *testing.T) {
	dir := t.TempDir()
	originalPath := filepath.Join(dir, "workbook.xlsx")
	exportedPath := filepath.Join(dir, "exported.xlsx")
	writeFile(t, originalPath, []byte("original content"), 0o600)
	if err := os.Chmod(originalPath, 0o640); err != nil {
		t.Fatal(err)
	}
	writeXlsxFixture(t, exportedPath, "[Content_Types].xml", "xl/workbook.xml")

	previousRename := renameFile.Load().(renameFunc)
	renameFile.Store(renameFunc(func(_, _ string) error { return errors.New("forced rename failure") }))
	t.Cleanup(func() { renameFile.Store(previousRename) })

	err := replaceAtomically(originalPath, exportedPath)
	if err == nil || !strings.Contains(err.Error(), "rename exported XLSX") {
		t.Fatalf("replaceAtomically() error = %v, want rename error", err)
	}
	assertFileUnchanged(t, originalPath, []byte("original content"), 0o640)
	if _, err := os.Stat(exportedPath); err != nil {
		t.Fatalf("exported path should remain after failed rename: %v", err)
	}
}

func writeXlsxFixture(t *testing.T, path string, entries ...string) {
	t.Helper()
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(file)
	for _, entry := range entries {
		writer, err := zw.Create(entry)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := writer.Write([]byte("fixture")); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
}

func writeFile(t *testing.T, path string, content []byte, mode os.FileMode) {
	t.Helper()
	if err := os.WriteFile(path, content, mode); err != nil {
		t.Fatal(err)
	}
}

func readFile(t *testing.T, path string) []byte {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return content
}

func assertFileUnchanged(t *testing.T, path string, wantContent []byte, wantMode os.FileMode) {
	t.Helper()
	if got := readFile(t, path); string(got) != string(wantContent) {
		t.Fatalf("original content = %q, want %q", got, wantContent)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != wantMode {
		t.Fatalf("original mode = %04o, want %04o", got, wantMode)
	}
}
