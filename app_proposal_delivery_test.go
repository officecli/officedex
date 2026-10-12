package main

import (
	"archive/zip"
	"bytes"
	"context"
	"io"
	"officedex/internal/types"
	"os"
	"path/filepath"
	"testing"
)

func TestN27ProposalApplyUndoDelivery(t *testing.T) {
	app, store := newRecentFilesTestApp(t)
	approved, err := os.ReadFile("e2e/fixtures/qa27/approved.docx")
	if err != nil {
		t.Fatal(err)
	}
	if sha256Hex(approved) != "baa2001d014e6f7789bee34a1534dbd22f401a1faa2772ac4de7ef51f38e7c18" {
		t.Fatal("report fixture changed")
	}
	zr, err := zip.NewReader(bytes.NewReader(approved), int64(len(approved)))
	if err != nil {
		t.Fatal(err)
	}
	var before bytes.Buffer
	zw := zip.NewWriter(&before)
	for _, entry := range zr.File {
		r, _ := entry.Open()
		data, _ := io.ReadAll(r)
		r.Close()
		if entry.Name == "word/document.xml" {
			data = bytes.ReplaceAll(data, []byte("Gamma approved."), []byte("Gamma pending."))
		}
		w, err := zw.CreateHeader(&entry.FileHeader)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = w.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(t.TempDir(), "OD27-attachment.docx")
	stageDir := filepath.Join(filepath.Dir(source), ".officedex-proposal-123")
	if err := os.Mkdir(stageDir, 0700); err != nil {
		t.Fatal(err)
	}
	proposal := filepath.Join(stageDir, "OD27-attachment.modified.docx")
	if err := os.WriteFile(source, before.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(proposal, approved, 0600); err != nil {
		t.Fatal(err)
	}
	original, err := app.ImportLocalFile(source)
	if err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{types.EventTaskStarted, types.EventTaskOutput, types.EventTaskCompleted} {
		payload := map[string]any{"output_file": proposal, "document_type": "docx"}
		if kind == types.EventTaskStarted {
			payload = map[string]any{"tool": "office.modify", "source_file": source}
		}
		if err := app.recordTaskEvent(types.BridgeEvent{TaskID: "edit", Type: kind, Payload: payload}); err != nil {
			t.Fatal(err)
		}
	}
	assertLibrary := func() {
		t.Helper()
		page, err := store.QueryDocuments(context.Background(), types.DocumentListInput{})
		if err != nil || len(page.Items) != 1 || page.Items[0].ID != original.ID {
			t.Fatalf("library: %v %v", page, err)
		}
		recent, err := app.ListRecentFiles("")
		if err != nil || len(recent) != 1 || recent[0].FilePath != source {
			t.Fatalf("recent: %v %v", recent, err)
		}
	}
	assertLibrary()
	grant, err := app.IssuePreviewToken(types.Artifact{FilePath: proposal, FileName: filepath.Base(proposal), DocumentType: "docx"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := app.ReadArtifactFile(grant.Token); err != nil {
		t.Fatal(err)
	}
	assertLibrary()
	input := ArtifactSuggestionFileInput{SuggestionID: "edit", SourceFile: source, ArtifactFile: proposal, ExpectedSourceSHA256: sha256Hex(before.Bytes())}
	if err := app.ApplyArtifactSuggestion(input); err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(source)
	if err != nil || !bytes.Equal(after, approved) {
		t.Fatal("Apply did not save the source")
	}
	assertLibrary()
	if _, err := app.ImportLocalFile(proposal); err == nil {
		t.Fatal("proposal opened as independent document")
	}
	if err := app.UndoArtifactSuggestion(input); err != nil {
		t.Fatal(err)
	}
	restored, _ := os.ReadFile(source)
	if !bytes.Equal(restored, before.Bytes()) {
		t.Fatal("Undo did not restore original bytes")
	}
	assertLibrary()
	// Explicit copy requests must still work, without exposing the staging path.
	for i := 0; i < 2; i++ {
		copy, err := app.PublishArtifactCopy(input)
		if err != nil {
			t.Fatal(err)
		}
		if types.IsInternalProposal(copy.FilePath) || copy.FilePath == source {
			t.Fatalf("invalid copy: %s", copy.FilePath)
		}
		data, err := os.ReadFile(copy.FilePath)
		if err != nil || !bytes.Equal(data, approved) {
			t.Fatal("copy lost bytes")
		}
	}
	restored, _ = os.ReadFile(source)
	if !bytes.Equal(restored, before.Bytes()) {
		t.Fatal("copy changed original")
	}
}
