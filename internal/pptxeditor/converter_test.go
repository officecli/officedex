package pptxeditor

import (
	"archive/zip"
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// A build without a converter must report that per call rather than refuse to
// start, so the editor can say the converter is unavailable and everything else
// keeps working.
func TestCLIConverterWithoutBinaryReportsUnavailable(t *testing.T) {
	converter := NewCLIConverter("")
	if err := converter.ImportPptx(context.Background(), "deck.pptx", t.TempDir()); err == nil ||
		!strings.Contains(err.Error(), "mop-convert is unavailable") {
		t.Fatalf("ImportPptx error = %v, want unavailable converter", err)
	}
	if err := converter.ExportPptx(context.Background(), t.TempDir(), "deck.pptx"); err == nil ||
		!strings.Contains(err.Error(), "mop-convert is unavailable") {
		t.Fatalf("ExportPptx error = %v, want unavailable converter", err)
	}
}

// Importing a template must not fail outright because the deck carries fields
// the converter has not reviewed: the import is retried on a copy without them.
func TestCLIConverterImportRetriesWithoutUnreviewedFields(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell script stubs are not portable to Windows")
	}
	deck := filepath.Join(t.TempDir(), "template.pptx")
	file, err := os.Create(deck)
	if err != nil {
		t.Fatalf("create deck: %v", err)
	}
	archive := zip.NewWriter(file)
	entry, err := archive.Create("ppt/presProps.xml")
	if err != nil {
		t.Fatalf("create part: %v", err)
	}
	if _, err := entry.Write([]byte(`<p:presentationPr><p:showPr><p:extLst><p:ext uri="{x}"/></p:extLst></p:showPr></p:presentationPr>`)); err != nil {
		t.Fatalf("write part: %v", err)
	}
	if err := archive.Close(); err != nil {
		t.Fatalf("close archive: %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("close deck: %v", err)
	}

	// Arguments: import --input <pptx> --mop <dir> --format json.
	binary := filepath.Join(t.TempDir(), "mop-convert")
	script := `#!/bin/sh
mkdir -p "$5"
if unzip -p "$3" ppt/presProps.xml | grep -q extLst; then
  echo partial > "$5/stale.json"
  echo "Error: conversion stopped with 1 unsupported typed field(s)"
  echo "import /ppt/presProps.xml CTPresentationProperties.showPr.extLst presentationProperties editing: unreviewed extension list"
  exit 1
fi
echo '{}' > "$5/content.json"
`
	if err := os.WriteFile(binary, []byte(script), 0o755); err != nil {
		t.Fatalf("write stub: %v", err)
	}
	mopDirectory := filepath.Join(t.TempDir(), "mop")

	if err := NewCLIConverter(binary).ImportPptx(context.Background(), deck, mopDirectory); err != nil {
		t.Fatalf("ImportPptx: %v", err)
	}
	if _, err := os.Stat(filepath.Join(mopDirectory, "content.json")); err != nil {
		t.Errorf("the retried import produced no package: %v", err)
	}
	if _, err := os.Stat(filepath.Join(mopDirectory, "stale.json")); !os.IsNotExist(err) {
		t.Error("the refused attempt's partial package was not cleared before the retry")
	}
}
