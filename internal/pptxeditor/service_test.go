package pptxeditor

import (
	"archive/zip"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"officedex/internal/preview"
)

type fakeResolver struct {
	entries map[string]preview.ArtifactEntry
}

func (r *fakeResolver) ResolveToken(token string) (preview.ArtifactEntry, error) {
	entry, ok := r.entries[token]
	if !ok {
		return preview.ArtifactEntry{}, os.ErrNotExist
	}
	return entry, nil
}

type fakeConverter struct{}

func (fakeConverter) ImportPptx(_ context.Context, _ string, mopDirectory string) error {
	if err := os.MkdirAll(filepath.Join(mopDirectory, "media"), 0o700); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(mopDirectory, "content.json"), []byte(`{"magic":"mop0","version":1,"blocks":[]}`), 0o600); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(mopDirectory, "media", "asset.png"), []byte("png"), 0o600)
}

func (fakeConverter) ExportPptx(_ context.Context, _ string, outputPath string) error {
	file, err := os.Create(outputPath)
	if err != nil {
		return err
	}
	writer := zip.NewWriter(file)
	for _, name := range []string{"[Content_Types].xml", "ppt/presentation.xml"} {
		entry, err := writer.Create(name)
		if err != nil {
			return err
		}
		if _, err := entry.Write([]byte("ok")); err != nil {
			return err
		}
	}
	if err := writer.Close(); err != nil {
		return err
	}
	return file.Close()
}

func (fakeConverter) Close() error { return nil }

func writeTestPptx(t *testing.T, path string) {
	t.Helper()
	if err := (fakeConverter{}).ExportPptx(context.Background(), "", path); err != nil {
		t.Fatal(err)
	}
}

func TestPrepareSaveAndExportPptxSession(t *testing.T) {
	root := t.TempDir()
	sourcePath := filepath.Join(root, "deck.pptx")
	writeTestPptx(t, sourcePath)
	service := NewService(&fakeResolver{entries: map[string]preview.ArtifactEntry{
		"token": {FilePath: sourcePath, DocumentType: "pptx"},
	}}, fakeConverter{}, filepath.Join(root, "sessions"))

	prepared, err := service.Prepare(context.Background(), "token")
	if err != nil {
		t.Fatalf("Prepare: %v", err)
	}
	if prepared.SessionID == "" || prepared.FileID != prepared.SessionID || len(prepared.Content) == 0 {
		t.Fatalf("unexpected prepare result: %+v", prepared)
	}
	if len(prepared.Assets) != 1 || prepared.Assets[0].Path != "media/asset.png" {
		t.Fatalf("assets = %+v", prepared.Assets)
	}

	content := []byte(`{"magic":"mop0","version":1,"blocks":[{"type":"presentation","data":[]}]}`)
	saved, err := service.SaveSnapshot("token", prepared.SessionID, content, 0, 1)
	if err != nil {
		t.Fatalf("SaveSnapshot: %v", err)
	}
	if saved.Revision != 1 {
		t.Fatalf("revision = %d", saved.Revision)
	}
	if _, err := service.Export(context.Background(), "token", prepared.SessionID, 1); err != nil {
		t.Fatalf("Export: %v", err)
	}
	if err := validatePptx(sourcePath); err != nil {
		t.Fatalf("validate exported source: %v", err)
	}
}

func TestPptxSessionRejectsExternallyChangedSource(t *testing.T) {
	root := t.TempDir()
	sourcePath := filepath.Join(root, "deck.pptx")
	writeTestPptx(t, sourcePath)
	service := NewService(&fakeResolver{entries: map[string]preview.ArtifactEntry{
		"token": {FilePath: sourcePath, DocumentType: "pptx"},
	}}, fakeConverter{}, filepath.Join(root, "sessions"))
	prepared, err := service.Prepare(context.Background(), "token")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(sourcePath, []byte("changed"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SaveSnapshot("token", prepared.SessionID, prepared.Content, 0, 1); err != ErrSourceChanged {
		t.Fatalf("SaveSnapshot error = %v, want %v", err, ErrSourceChanged)
	}
}

func TestSaveAssetRequiresDigestAddressedPath(t *testing.T) {
	root := t.TempDir()
	sourcePath := filepath.Join(root, "deck.pptx")
	writeTestPptx(t, sourcePath)
	service := NewService(&fakeResolver{entries: map[string]preview.ArtifactEntry{
		"token": {FilePath: sourcePath, DocumentType: "pptx"},
	}}, fakeConverter{}, filepath.Join(root, "sessions"))
	prepared, err := service.Prepare(context.Background(), "token")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SaveAsset("token", prepared.SessionID, "media/not-a-digest.png", "image/png", []byte("image")); err == nil {
		t.Fatal("SaveAsset accepted a non digest-addressed path")
	}
}

func TestPrepareRetiresOnlyTheSessionsThatCanNoLongerSave(t *testing.T) {
	root := t.TempDir()
	sourcePath := filepath.Join(root, "deck.pptx")
	otherPath := filepath.Join(root, "other.pptx")
	writeTestPptx(t, sourcePath)
	writeTestPptx(t, otherPath)
	service := NewService(&fakeResolver{entries: map[string]preview.ArtifactEntry{
		"token":       {FilePath: sourcePath, DocumentType: "pptx"},
		"other-token": {FilePath: otherPath, DocumentType: "pptx"},
	}}, fakeConverter{}, filepath.Join(root, "sessions"))

	healthy, err := service.Prepare(context.Background(), "token")
	if err != nil {
		t.Fatal(err)
	}
	elsewhere, err := service.Prepare(context.Background(), "other-token")
	if err != nil {
		t.Fatal(err)
	}
	// Opening the same file again — a second panel, or a strict-mode double
	// mount — must not pull the document out from under the first session.
	if _, err := service.Prepare(context.Background(), "token"); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SaveSnapshot("token", healthy.SessionID, []byte(`{"v":1}`), 0, 1); err != nil {
		t.Fatalf("a healthy session was retired: %v", err)
	}
	if _, err := service.SaveSnapshot("other-token", elsewhere.SessionID, []byte(`{"v":1}`), 0, 1); err != nil {
		t.Fatalf("an unrelated session was retired: %v", err)
	}

	// Now the file is replaced, as a fresh drawing replaces a live draft. The
	// session that fingerprinted the old bytes can never save again, so the
	// next open retires it rather than leaving it failing forever.
	doomed, err := service.Prepare(context.Background(), "token")
	if err != nil {
		t.Fatal(err)
	}
	writeTestPptx(t, sourcePath)
	if _, err := service.Prepare(context.Background(), "token"); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SaveSnapshot("token", doomed.SessionID, []byte(`{"v":2}`), 1, 2); !errors.Is(err, ErrSessionMismatch) {
		t.Fatalf("the unusable session was kept: %v", err)
	}
}
