package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// stubSaveFileDialog swaps the dialog seam for the duration of a test and
// records the options the app asked for.
func stubSaveFileDialog(t *testing.T, result string, err error) *wailsruntime.SaveDialogOptions {
	t.Helper()
	original := saveFileDialog
	var seen wailsruntime.SaveDialogOptions
	saveFileDialog = func(_ context.Context, options wailsruntime.SaveDialogOptions) (string, error) {
		seen = options
		return result, err
	}
	t.Cleanup(func() { saveFileDialog = original })
	return &seen
}

func TestSaveFileCopyWritesChosenDestination(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "generated.png")
	if err := os.WriteFile(source, []byte("image-bytes"), 0o644); err != nil {
		t.Fatalf("write source: %v", err)
	}
	dest := filepath.Join(t.TempDir(), "saved.png")
	options := stubSaveFileDialog(t, dest, nil)

	app := &App{ctx: context.Background()}
	got, err := app.SaveFileCopy(source, "poster.png")
	if err != nil {
		t.Fatalf("SaveFileCopy: %v", err)
	}
	if got != dest {
		t.Fatalf("destination = %q, want %q", got, dest)
	}
	data, err := os.ReadFile(dest)
	if err != nil {
		t.Fatalf("read destination: %v", err)
	}
	if string(data) != "image-bytes" {
		t.Fatalf("copied bytes = %q, want image-bytes", data)
	}
	if options.DefaultFilename != "poster.png" {
		t.Fatalf("DefaultFilename = %q, want poster.png", options.DefaultFilename)
	}
	if len(options.Filters) == 0 || options.Filters[0].Pattern != "*.png" {
		t.Fatalf("filters = %#v, want a *.png filter first", options.Filters)
	}
	// The source must survive: this is a copy, not a move.
	if _, err := os.Stat(source); err != nil {
		t.Fatalf("source removed: %v", err)
	}
}

func TestSaveFileCopyFallsBackToSourceName(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "generated.png")
	if err := os.WriteFile(source, []byte("x"), 0o644); err != nil {
		t.Fatalf("write source: %v", err)
	}
	options := stubSaveFileDialog(t, filepath.Join(t.TempDir(), "out.png"), nil)

	app := &App{ctx: context.Background()}
	if _, err := app.SaveFileCopy(source, "   "); err != nil {
		t.Fatalf("SaveFileCopy: %v", err)
	}
	if options.DefaultFilename != "generated.png" {
		t.Fatalf("DefaultFilename = %q, want generated.png", options.DefaultFilename)
	}
}

func TestSaveFileCopyReturnsEmptyOnCancel(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "generated.png")
	if err := os.WriteFile(source, []byte("x"), 0o644); err != nil {
		t.Fatalf("write source: %v", err)
	}
	stubSaveFileDialog(t, "", nil)

	app := &App{ctx: context.Background()}
	got, err := app.SaveFileCopy(source, "poster.png")
	if err != nil {
		t.Fatalf("SaveFileCopy: %v", err)
	}
	if got != "" {
		t.Fatalf("destination = %q, want \"\" for a cancelled dialog", got)
	}
}

func TestSaveFileCopyRejectsMissingSource(t *testing.T) {
	stubSaveFileDialog(t, filepath.Join(t.TempDir(), "out.png"), nil)

	app := &App{ctx: context.Background()}
	_, err := app.SaveFileCopy(filepath.Join(t.TempDir(), "nope.png"), "poster.png")
	if err == nil || !strings.Contains(err.Error(), "save file copy: source") {
		t.Fatalf("err = %v, want a missing-source error", err)
	}
}

func TestSaveFileCopyRejectsDirectorySource(t *testing.T) {
	dir := t.TempDir()
	stubSaveFileDialog(t, filepath.Join(t.TempDir(), "out"), nil)

	app := &App{ctx: context.Background()}
	_, err := app.SaveFileCopy(dir, "folder")
	if err == nil || !strings.Contains(err.Error(), "is not a file") {
		t.Fatalf("err = %v, want a not-a-file error", err)
	}
}

func TestSaveFileCopyRefusesDestinationEqualToSource(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "generated.png")
	if err := os.WriteFile(source, []byte("x"), 0o644); err != nil {
		t.Fatalf("write source: %v", err)
	}
	stubSaveFileDialog(t, source, nil)

	app := &App{ctx: context.Background()}
	_, err := app.SaveFileCopy(source, "generated.png")
	if err == nil || !strings.Contains(err.Error(), "destination is the source file") {
		t.Fatalf("err = %v, want a same-path refusal", err)
	}
}
