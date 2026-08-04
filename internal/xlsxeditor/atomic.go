package xlsxeditor

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

const (
	maxXlsxEntryUncompressedBytes int64 = 16 * 1024 * 1024
	maxXlsxTotalUncompressedBytes int64 = 64 * 1024 * 1024
)

type fileHandle interface {
	Stat() (os.FileInfo, error)
	Chmod(os.FileMode) error
	Sync() error
	Close() error
}

type replaceOps struct {
	lstat    func(string) (os.FileInfo, error)
	openFile func(string) (fileHandle, error)
	rename   func(string, string) error
	openDir  func(string) (fileHandle, error)
	sameFile func(os.FileInfo, os.FileInfo) bool
}

func defaultReplaceOps() replaceOps {
	return replaceOps{
		lstat: os.Lstat,
		openFile: func(path string) (fileHandle, error) {
			file, err := os.Open(path)
			return file, err
		},
		rename: os.Rename,
		openDir: func(path string) (fileHandle, error) {
			file, err := os.Open(path)
			return file, err
		},
		sameFile: os.SameFile,
	}
}

// PostCommitError reports a directory durability failure after the replacement
// was already committed. Replaced is always true for this error type.
type PostCommitError struct {
	Replaced bool
	Err      error
}

func (err *PostCommitError) Error() string {
	return fmt.Sprintf("XLSX was replaced but durability is uncertain: %v", err.Err)
}

func (err *PostCommitError) Unwrap() error {
	return err.Err
}

// createTempXlsx creates an export file beside originalPath so a successful
// rename can replace the original atomically on the same filesystem.
func createTempXlsx(originalPath string) (*os.File, error) {
	return os.CreateTemp(filepath.Dir(originalPath), ".officedex-xlsx-*.xlsx")
}

// validateXlsx verifies that path is a readable XLSX ZIP with the minimum
// package entries needed by an Office spreadsheet. It consumes every regular
// entry to validate decompression and CRC data within bounded resource limits.
func validateXlsx(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("stat XLSX %q: %w", path, err)
	}
	if info.IsDir() {
		return fmt.Errorf("XLSX %q is a directory", path)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("XLSX %q is not a regular file", path)
	}

	reader, err := zip.OpenReader(path)
	if err != nil {
		return fmt.Errorf("open ZIP XLSX %q: %w", path, err)
	}
	defer reader.Close()

	var totalUncompressed int64
	hasContentTypes := false
	hasWorkbook := false
	for _, file := range reader.File {
		if file.FileInfo().IsDir() {
			continue
		}
		if file.UncompressedSize64 > uint64(maxXlsxEntryUncompressedBytes) {
			return fmt.Errorf("XLSX entry %q exceeds entry size limit of %d bytes", file.Name, maxXlsxEntryUncompressedBytes)
		}

		entry, err := file.Open()
		if err != nil {
			return fmt.Errorf("open XLSX entry %q: %w", file.Name, err)
		}
		remainingTotal := maxXlsxTotalUncompressedBytes - totalUncompressed
		readLimit := maxXlsxEntryUncompressedBytes
		if remainingTotal < readLimit {
			readLimit = remainingTotal
		}
		readBytes, readErr := io.Copy(io.Discard, io.LimitReader(entry, readLimit+1))
		closeErr := entry.Close()
		if readBytes > readLimit {
			if readLimit == remainingTotal {
				return fmt.Errorf("XLSX entry %q exceeds total size limit of %d bytes", file.Name, maxXlsxTotalUncompressedBytes)
			}
			return fmt.Errorf("XLSX entry %q exceeds entry size limit of %d bytes", file.Name, maxXlsxEntryUncompressedBytes)
		}
		if readErr != nil {
			return fmt.Errorf("read XLSX entry %q: %w", file.Name, readErr)
		}
		if closeErr != nil {
			return fmt.Errorf("close XLSX entry %q: %w", file.Name, closeErr)
		}
		totalUncompressed += readBytes

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
	return replaceAtomicallyWithOps(originalPath, exportedPath, defaultReplaceOps())
}

func replaceAtomicallyWithOps(originalPath, exportedPath string, ops replaceOps) error {
	if err := requireSameParentDirectory(originalPath, exportedPath); err != nil {
		return err
	}

	exportedPathInfo, err := ops.lstat(exportedPath)
	if err != nil {
		return fmt.Errorf("lstat exported XLSX: %w", err)
	}
	if err := requireRegularFile("exported XLSX", exportedPathInfo); err != nil {
		return err
	}
	if err := validateXlsx(exportedPath); err != nil {
		return fmt.Errorf("validate exported XLSX: %w", err)
	}

	originalInfo, err := ops.lstat(originalPath)
	if err != nil {
		return fmt.Errorf("lstat original XLSX: %w", err)
	}
	if err := requireRegularFile("original XLSX", originalInfo); err != nil {
		return err
	}

	exportedFile, err := ops.openFile(exportedPath)
	if err != nil {
		return fmt.Errorf("open exported XLSX for sync: %w", err)
	}
	exportedFileInfo, err := exportedFile.Stat()
	if err != nil {
		_ = exportedFile.Close()
		return fmt.Errorf("fstat exported XLSX: %w", err)
	}
	if err := requireRegularFile("opened exported XLSX", exportedFileInfo); err != nil {
		_ = exportedFile.Close()
		return err
	}
	if !ops.sameFile(exportedPathInfo, exportedFileInfo) {
		_ = exportedFile.Close()
		return fmt.Errorf("exported XLSX changed before sync")
	}
	if err := exportedFile.Chmod(originalInfo.Mode().Perm()); err != nil {
		_ = exportedFile.Close()
		return fmt.Errorf("inherit original XLSX permissions: %w", err)
	}
	if err := exportedFile.Sync(); err != nil {
		_ = exportedFile.Close()
		return fmt.Errorf("sync exported XLSX: %w", err)
	}
	if err := exportedFile.Close(); err != nil {
		return fmt.Errorf("close exported XLSX after sync: %w", err)
	}

	currentExportedInfo, err := ops.lstat(exportedPath)
	if err != nil {
		return fmt.Errorf("lstat exported XLSX before rename: %w", err)
	}
	if err := requireRegularFile("exported XLSX before rename", currentExportedInfo); err != nil {
		return err
	}
	if !ops.sameFile(exportedPathInfo, currentExportedInfo) {
		return fmt.Errorf("exported XLSX changed before rename")
	}
	if err := ops.rename(exportedPath, originalPath); err != nil {
		return fmt.Errorf("rename exported XLSX: %w", err)
	}

	directory, err := ops.openDir(filepath.Dir(originalPath))
	if err != nil {
		return postCommitError("open XLSX parent directory for sync", err)
	}
	if err := directory.Sync(); err != nil {
		_ = directory.Close()
		return postCommitError("sync XLSX parent directory", err)
	}
	if err := directory.Close(); err != nil {
		return postCommitError("close XLSX parent directory after sync", err)
	}
	return nil
}

func requireSameParentDirectory(originalPath, exportedPath string) error {
	originalAbs, err := filepath.Abs(originalPath)
	if err != nil {
		return fmt.Errorf("resolve original XLSX path: %w", err)
	}
	exportedAbs, err := filepath.Abs(exportedPath)
	if err != nil {
		return fmt.Errorf("resolve exported XLSX path: %w", err)
	}
	if filepath.Clean(filepath.Dir(originalAbs)) != filepath.Clean(filepath.Dir(exportedAbs)) {
		return fmt.Errorf("original and exported XLSX must use the same parent directory")
	}
	return nil
}

func requireRegularFile(label string, info os.FileInfo) error {
	if info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("%s must not be a symbolic link", label)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("%s must be a regular file", label)
	}
	return nil
}

func postCommitError(operation string, err error) error {
	return &PostCommitError{
		Replaced: true,
		Err:      fmt.Errorf("%s: %w", operation, err),
	}
}
