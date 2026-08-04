package office2modoc

import (
	"archive/zip"
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestIntegrationXlsxRoundTrip(t *testing.T) {
	dylibPath := os.Getenv("OFFICE2MODOC_FFI_PATH")
	inputPath := os.Getenv("OFFICE2MODOC_TEST_XLSX")
	if dylibPath == "" || inputPath == "" {
		t.Skip("OFFICE2MODOC_FFI_PATH and OFFICE2MODOC_TEST_XLSX are required")
	}
	if _, err := os.Stat(dylibPath); err != nil {
		t.Skipf("configured dylib is unavailable: %v", err)
	}
	if _, err := os.Stat(inputPath); err != nil {
		t.Skipf("configured XLSX fixture is unavailable: %v", err)
	}

	dir := t.TempDir()
	modocPath := filepath.Join(dir, "workbook.modoc")
	outputPath := filepath.Join(dir, "round-trip.xlsx")
	converter := New(dir)
	t.Cleanup(func() {
		if err := converter.Close(); err != nil {
			t.Errorf("close converter: %v", err)
		}
	})

	if err := converter.ImportXlsx(context.Background(), inputPath, modocPath, dir); err != nil {
		t.Fatalf("import XLSX: %v", err)
	}
	info, err := os.Stat(modocPath)
	if err != nil {
		t.Fatalf("stat imported MODoc: %v", err)
	}
	if info.Size() <= 0 || info.Size() > MaxModocBytes {
		t.Fatalf("imported MODoc size = %d, want 1..%d", info.Size(), MaxModocBytes)
	}

	if err := converter.ExportXlsx(context.Background(), outputPath, modocPath, dir); err != nil {
		t.Fatalf("export XLSX: %v", err)
	}
	assertXlsxEntries(t, outputPath, "[Content_Types].xml", "xl/workbook.xml")
}

func assertXlsxEntries(t *testing.T, path string, required ...string) {
	t.Helper()
	reader, err := zip.OpenReader(path)
	if err != nil {
		info, statErr := os.Stat(path)
		prefix, readErr := readPrefix(path, 64)
		t.Fatalf("open exported XLSX: %v (stat=%v size=%d read=%v prefix=%q)", err, statErr, fileSize(info), readErr, prefix)
	}
	defer reader.Close()

	found := make(map[string]bool, len(required))
	for _, entry := range reader.File {
		found[entry.Name] = true
	}
	for _, name := range required {
		if !found[name] {
			t.Errorf("exported XLSX is missing %q", name)
		}
	}
}

func readPrefix(path string, limit int) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	prefix := make([]byte, limit)
	count, err := file.Read(prefix)
	return prefix[:count], err
}

func fileSize(info os.FileInfo) int64 {
	if info == nil {
		return -1
	}
	return info.Size()
}
