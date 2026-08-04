package xlsxeditor

import (
	"archive/zip"
	"fmt"
	"os"
	"path/filepath"
	"sync/atomic"
)

type renameFunc func(oldpath, newpath string) error

// renameFile is an atomic seam so filesystem-level rename failures can be
// tested deterministically without relying on directory permissions.
var renameFile atomic.Value

func init() {
	renameFile.Store(renameFunc(os.Rename))
}

// createTempXlsx creates an export file beside originalPath so a successful
// rename can replace the original atomically on the same filesystem.
func createTempXlsx(originalPath string) (*os.File, error) {
	return os.CreateTemp(filepath.Dir(originalPath), ".officedex-xlsx-*.xlsx")
}

// validateXlsx verifies that path is a readable XLSX ZIP with the minimum
// package entries needed by an Office spreadsheet.
func validateXlsx(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("stat XLSX %q: %w", path, err)
	}
	if info.IsDir() {
		return fmt.Errorf("XLSX %q is a directory", path)
	}

	reader, err := zip.OpenReader(path)
	if err != nil {
		return fmt.Errorf("open ZIP XLSX %q: %w", path, err)
	}
	defer reader.Close()

	hasContentTypes := false
	hasWorkbook := false
	for _, file := range reader.File {
		switch file.Name {
		case "[Content_Types].xml":
			hasContentTypes = true
		case "xl/workbook.xml":
			hasWorkbook = true
		}
	}
	if !hasContentTypes {
		return fmt.Errorf("XLSX %q is missing [Content_Types].xml", path)
	}
	if !hasWorkbook {
		return fmt.Errorf("XLSX %q is missing xl/workbook.xml", path)
	}
	return nil
}

// replaceAtomically validates and durably flushes exportedPath before replacing
// originalPath. Before the rename, every failure leaves the original intact.
func replaceAtomically(originalPath, exportedPath string) error {
	if err := validateXlsx(exportedPath); err != nil {
		return fmt.Errorf("validate exported XLSX: %w", err)
	}

	originalInfo, err := os.Stat(originalPath)
	if err != nil {
		return fmt.Errorf("stat original XLSX: %w", err)
	}
	if err := os.Chmod(exportedPath, originalInfo.Mode().Perm()); err != nil {
		return fmt.Errorf("inherit original XLSX permissions: %w", err)
	}

	exportedFile, err := os.Open(exportedPath)
	if err != nil {
		return fmt.Errorf("open exported XLSX for sync: %w", err)
	}
	if err := exportedFile.Sync(); err != nil {
		_ = exportedFile.Close()
		return fmt.Errorf("sync exported XLSX: %w", err)
	}
	if err := exportedFile.Close(); err != nil {
		return fmt.Errorf("close exported XLSX after sync: %w", err)
	}

	if err := renameFile.Load().(renameFunc)(exportedPath, originalPath); err != nil {
		return fmt.Errorf("rename exported XLSX: %w", err)
	}

	directory, err := os.Open(filepath.Dir(originalPath))
	if err != nil {
		return fmt.Errorf("open XLSX parent directory for sync: %w", err)
	}
	defer directory.Close()
	if err := directory.Sync(); err != nil {
		return fmt.Errorf("sync XLSX parent directory: %w", err)
	}
	return nil
}
