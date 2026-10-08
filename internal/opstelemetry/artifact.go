package opstelemetry

import (
	"archive/zip"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// ooxmlLocalFileHeader is the "PK\x03\x04" signature every non-empty zip — and
// therefore every OOXML document — starts with.
var ooxmlLocalFileHeader = []byte{'P', 'K', 0x03, 0x04}

// ArtifactUsable reports whether a completed task's output is a real document,
// which is what the contract means by "产物文件存在、非空、可打开格式校验通过".
//
// This check exists because the desktop used to count a run as successful on
// the strength of the bridge saying so. bridge.ResultToArtifact reads a path
// out of the result payload and never stats it, so a run that reported a file
// it failed to write, or wrote as an empty stub, looked exactly like a real
// success. Counting those inflates the only number the funnel is built on.
//
// For OOXML it is a cheap structural check, not a schema validation: the local
// file header plus a readable central directory. That catches a truncated
// download, an empty placeholder and a zero-byte file, and costs one open of
// the directory at the end of the archive rather than a full decompress.
// Anything else (an image, a PDF, a text report) is only required to exist and
// be non-empty, because there is no equally cheap structural check for them.
func ArtifactUsable(path string) error {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return errors.New("opstelemetry: artifact has no file path")
	}
	info, err := os.Stat(trimmed)
	if err != nil {
		return fmt.Errorf("opstelemetry: artifact is not readable: %w", err)
	}
	if info.IsDir() {
		return fmt.Errorf("opstelemetry: artifact %q is a directory", filepath.Base(trimmed))
	}
	if info.Size() == 0 {
		return errors.New("opstelemetry: artifact is empty")
	}
	if !isOOXML(trimmed) {
		return nil
	}
	file, err := os.Open(trimmed)
	if err != nil {
		return fmt.Errorf("opstelemetry: open artifact: %w", err)
	}
	defer file.Close()
	header := make([]byte, len(ooxmlLocalFileHeader))
	if _, err := file.ReadAt(header, 0); err != nil {
		return fmt.Errorf("opstelemetry: read artifact header: %w", err)
	}
	for i, want := range ooxmlLocalFileHeader {
		if header[i] != want {
			return errors.New("opstelemetry: artifact is not a zip container")
		}
	}
	reader, err := zip.NewReader(file, info.Size())
	if err != nil {
		return fmt.Errorf("opstelemetry: artifact zip directory is unreadable: %w", err)
	}
	if len(reader.File) == 0 {
		return errors.New("opstelemetry: artifact zip container is empty")
	}
	return nil
}

// isOOXML reports whether the extension names an Office Open XML package. Only
// the three the app generates plus their macro-enabled and template siblings,
// since an unknown extension falls back to the exists-and-non-empty rule
// anyway.
func isOOXML(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".pptx", ".pptm", ".potx", ".docx", ".docm", ".dotx", ".xlsx", ".xlsm", ".xltx":
		return true
	default:
		return false
	}
}
