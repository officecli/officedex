package xlsxeditor

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

const (
	testMaxXlsxCompressedBytes        = 100 * 1024 * 1024
	testMaxXlsxEntryUncompressedBytes = 512 * 1024 * 1024
	testMaxXlsxTotalUncompressedBytes = 2 * 1024 * 1024 * 1024
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

func TestValidateXlsxReadsEntryPayloads(t *testing.T) {
	path := filepath.Join(t.TempDir(), "crc-corrupt.xlsx")
	writeStoredXlsxFixture(t, path, "[Content_Types].xml", "xl/workbook.xml")
	corruptStoredEntryPayload(t, path, "[Content_Types].xml")

	err := validateXlsx(path)
	if err == nil || !strings.Contains(err.Error(), "[Content_Types].xml") {
		t.Fatalf("validateXlsx() error = %v, want entry-specific payload validation error", err)
	}
}

func TestValidateXlsxEnforcesUncompressedEntryAndTotalLimits(t *testing.T) {
	dir := t.TempDir()

	largeWorksheetPath := filepath.Join(dir, "large-worksheet.xlsx")
	writeLargeXlsxFixture(t, largeWorksheetPath, map[string]int64{
		"[Content_Types].xml":      1,
		"xl/workbook.xml":          1,
		"xl/worksheets/sheet1.xml": 33 * 1024 * 1024,
	})
	if err := validateXlsx(largeWorksheetPath); err != nil {
		t.Fatalf("validateXlsx(33 MiB worksheet) error = %v", err)
	}

	overEntryPath := filepath.Join(dir, "over-entry-limit.xlsx")
	writeStoredXlsxFixture(t, overEntryPath, "[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml")
	declareZipEntryUncompressedSize(t, overEntryPath, "xl/worksheets/sheet1.xml", testMaxXlsxEntryUncompressedBytes+1)
	if err := validateXlsx(overEntryPath); err == nil || !strings.Contains(err.Error(), "entry size limit") {
		t.Fatalf("validateXlsx(entry over limit) error = %v, want entry size limit error", err)
	}

	overTotalPath := filepath.Join(dir, "over-total-limit.xlsx")
	entries := []string{
		"[Content_Types].xml",
		"xl/workbook.xml",
	}
	for i := 0; i < 5; i++ {
		entries = append(entries, "xl/worksheets/sheet"+string(rune('a'+i))+".xml")
	}
	writeStoredXlsxFixture(t, overTotalPath, entries...)
	for _, entry := range entries[2:] {
		declareZipEntryUncompressedSize(t, overTotalPath, entry, testMaxXlsxEntryUncompressedBytes)
	}
	if err := validateXlsx(overTotalPath); err == nil || !strings.Contains(err.Error(), "total size limit") {
		t.Fatalf("validateXlsx(total over limit) error = %v, want total size limit error", err)
	}

	overCompressedPath := filepath.Join(dir, "over-compressed-limit.xlsx")
	writeXlsxFixture(t, overCompressedPath, "[Content_Types].xml", "xl/workbook.xml")
	if err := os.Truncate(overCompressedPath, testMaxXlsxCompressedBytes+1); err != nil {
		t.Fatal(err)
	}
	if err := validateXlsx(overCompressedPath); err == nil || !strings.Contains(err.Error(), "compressed size limit") {
		t.Fatalf("validateXlsx(compressed file over limit) error = %v, want compressed size limit error", err)
	}
}

func TestValidateXlsxEnforcesEntryCountLimit(t *testing.T) {
	path := filepath.Join(t.TempDir(), "too-many-entries.xlsx")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(file)
	for i := 0; i <= maxXlsxEntryCount; i++ {
		name := "entry-" + strconv.Itoa(i)
		if i == 0 {
			name = "[Content_Types].xml"
		} else if i == 1 {
			name = "xl/workbook.xml"
		}
		if _, err := zw.Create(name); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}

	err = validateXlsx(path)
	if err == nil || !strings.Contains(err.Error(), "entry count limit") {
		t.Fatalf("validateXlsx() error = %v, want entry count limit error", err)
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

	ops := defaultReplaceOps()
	ops.rename = func(_, _ string) error { return errors.New("forced rename failure") }
	err := replaceAtomicallyWithOps(originalPath, exportedPath, ops)
	if err == nil || !strings.Contains(err.Error(), "rename exported XLSX") {
		t.Fatalf("replaceAtomically() error = %v, want rename error", err)
	}
	assertFileUnchanged(t, originalPath, []byte("original content"), 0o640)
	if _, err := os.Stat(exportedPath); err != nil {
		t.Fatalf("exported path should remain after failed rename: %v", err)
	}
}

func TestReplaceAtomicallyReportsPostCommitDurabilityErrors(t *testing.T) {
	tests := []struct {
		name       string
		configure  func(replaceOps, error) replaceOps
		underlying error
	}{
		{
			name:       "open parent directory",
			underlying: errors.New("forced directory open failure"),
			configure: func(ops replaceOps, underlying error) replaceOps {
				ops.openDir = func(string) (fileHandle, error) { return nil, underlying }
				return ops
			},
		},
		{
			name:       "sync parent directory",
			underlying: errors.New("forced directory sync failure"),
			configure: func(ops replaceOps, underlying error) replaceOps {
				ops.openDir = func(string) (fileHandle, error) {
					return &stubFile{syncErr: underlying}, nil
				}
				return ops
			},
		},
		{
			name:       "close parent directory",
			underlying: errors.New("forced directory close failure"),
			configure: func(ops replaceOps, underlying error) replaceOps {
				ops.openDir = func(string) (fileHandle, error) {
					return &stubFile{closeErr: underlying}, nil
				}
				return ops
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			originalPath := filepath.Join(dir, "workbook.xlsx")
			exportedPath := filepath.Join(dir, "exported.xlsx")
			writeFile(t, originalPath, []byte("original content"), 0o640)
			writeXlsxFixture(t, exportedPath, "[Content_Types].xml", "xl/workbook.xml")
			wantContent := readFile(t, exportedPath)

			err := replaceAtomicallyWithOps(originalPath, exportedPath, tt.configure(defaultReplaceOps(), tt.underlying))
			var postCommitErr *PostCommitError
			if !errors.As(err, &postCommitErr) {
				t.Fatalf("replaceAtomicallyWithOps() error = %v, want PostCommitError", err)
			}
			if !postCommitErr.Replaced {
				t.Fatalf("PostCommitError.Replaced = false, want true")
			}
			if !errors.Is(err, tt.underlying) {
				t.Fatalf("replaceAtomicallyWithOps() error = %v, want wrapped %v", err, tt.underlying)
			}
			if got := readFile(t, originalPath); string(got) != string(wantContent) {
				t.Fatalf("original content = %q, want exported content %q", got, wantContent)
			}
		})
	}
}

func TestReplaceAtomicallyRejectsDifferentParentDirectories(t *testing.T) {
	dir := t.TempDir()
	originalPath := filepath.Join(dir, "original", "workbook.xlsx")
	exportedPath := filepath.Join(dir, "exported", "workbook.xlsx")
	if err := os.MkdirAll(filepath.Dir(originalPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(exportedPath), 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, originalPath, []byte("original content"), 0o640)
	writeXlsxFixture(t, exportedPath, "[Content_Types].xml", "xl/workbook.xml")

	err := replaceAtomically(originalPath, exportedPath)
	if err == nil || !strings.Contains(err.Error(), "same parent directory") {
		t.Fatalf("replaceAtomically() error = %v, want same parent directory error", err)
	}
	assertFileUnchanged(t, originalPath, []byte("original content"), 0o640)
}

func TestReplaceAtomicallyRejectsExportedSymlinkWithoutChangingTarget(t *testing.T) {
	dir := t.TempDir()
	originalPath := filepath.Join(dir, "original.xlsx")
	targetPath := filepath.Join(dir, "export-target.xlsx")
	exportedPath := filepath.Join(dir, "exported.xlsx")
	writeFile(t, originalPath, []byte("original content"), 0o640)
	writeXlsxFixture(t, targetPath, "[Content_Types].xml", "xl/workbook.xml")
	if err := os.Chmod(targetPath, 0o600); err != nil {
		t.Fatal(err)
	}
	targetContent := readFile(t, targetPath)
	if err := os.Symlink(targetPath, exportedPath); err != nil {
		t.Fatal(err)
	}

	err := replaceAtomically(originalPath, exportedPath)
	if err == nil || !strings.Contains(err.Error(), "symbolic link") {
		t.Fatalf("replaceAtomically() error = %v, want symbolic link error", err)
	}
	assertFileUnchanged(t, originalPath, []byte("original content"), 0o640)
	assertFileUnchanged(t, targetPath, targetContent, 0o600)
}

func TestReplaceAtomicallyRejectsOriginalSymlinkAndDirectory(t *testing.T) {
	dir := t.TempDir()
	exportedPath := filepath.Join(dir, "exported.xlsx")
	writeXlsxFixture(t, exportedPath, "[Content_Types].xml", "xl/workbook.xml")

	targetPath := filepath.Join(dir, "original-target.xlsx")
	originalSymlink := filepath.Join(dir, "original-link.xlsx")
	writeFile(t, targetPath, []byte("original content"), 0o640)
	if err := os.Symlink(targetPath, originalSymlink); err != nil {
		t.Fatal(err)
	}
	if err := replaceAtomically(originalSymlink, exportedPath); err == nil || !strings.Contains(err.Error(), "symbolic link") {
		t.Fatalf("replaceAtomically(original symlink) error = %v, want symbolic link error", err)
	}
	assertFileUnchanged(t, targetPath, []byte("original content"), 0o640)
	info, err := os.Lstat(originalSymlink)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("original path mode = %v, want symbolic link", info.Mode())
	}

	originalDirectory := filepath.Join(dir, "original-directory.xlsx")
	if err := os.Mkdir(originalDirectory, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := replaceAtomically(originalDirectory, exportedPath); err == nil || !strings.Contains(err.Error(), "regular file") {
		t.Fatalf("replaceAtomically(original directory) error = %v, want regular file error", err)
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

func writeStoredXlsxFixture(t *testing.T, path string, entries ...string) {
	t.Helper()
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(file)
	for _, entry := range entries {
		writer, err := zw.CreateHeader(&zip.FileHeader{Name: entry, Method: zip.Store})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := io.WriteString(writer, "stored payload for "+entry); err != nil {
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

func corruptStoredEntryPayload(t *testing.T, path, entry string) {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	payload := []byte("stored payload for " + entry)
	offset := bytes.Index(content, payload)
	if offset < 0 {
		t.Fatalf("stored payload for %q not found", entry)
	}
	content[offset] ^= 0xff
	if err := os.WriteFile(path, content, 0o600); err != nil {
		t.Fatal(err)
	}
}

func declareZipEntryUncompressedSize(t *testing.T, path, entry string, size int64) {
	t.Helper()
	if size < 0 || size > int64(^uint32(0)) {
		t.Fatalf("unsupported declared ZIP size %d", size)
	}
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for offset := 0; offset+46 <= len(content); {
		next := bytes.Index(content[offset:], []byte("PK\x01\x02"))
		if next < 0 {
			break
		}
		offset += next
		nameLength := int(binary.LittleEndian.Uint16(content[offset+28 : offset+30]))
		extraLength := int(binary.LittleEndian.Uint16(content[offset+30 : offset+32]))
		commentLength := int(binary.LittleEndian.Uint16(content[offset+32 : offset+34]))
		entryEnd := offset + 46 + nameLength + extraLength + commentLength
		if entryEnd > len(content) {
			t.Fatalf("invalid central directory entry for %q", entry)
		}
		if string(content[offset+46:offset+46+nameLength]) == entry {
			binary.LittleEndian.PutUint32(content[offset+24:offset+28], uint32(size))
			if err := os.WriteFile(path, content, 0o600); err != nil {
				t.Fatal(err)
			}
			return
		}
		offset = entryEnd
	}
	t.Fatalf("central directory entry %q not found", entry)
}

func writeLargeXlsxFixture(t *testing.T, path string, entries map[string]int64) {
	t.Helper()
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(file)
	for name, size := range entries {
		writer, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := io.CopyN(writer, zeroReader{}, size); err != nil {
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

type zeroReader struct{}

func (zeroReader) Read(p []byte) (int, error) {
	clear(p)
	return len(p), nil
}

type stubFile struct {
	syncErr  error
	closeErr error
}

func (f *stubFile) Stat() (os.FileInfo, error) { return nil, nil }
func (f *stubFile) Chmod(os.FileMode) error    { return nil }
func (f *stubFile) Sync() error                { return f.syncErr }
func (f *stubFile) Close() error               { return f.closeErr }

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
