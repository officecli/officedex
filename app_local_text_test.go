package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeTestFile(t *testing.T, dir, name, body string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestReadLocalTextDocumentsReadsWhitelistedFiles(t *testing.T) {
	dir := t.TempDir()
	notes := writeTestFile(t, dir, "notes.txt", "Q3 revenue was 120")
	readme := writeTestFile(t, dir, "readme.md", "# Heading")

	app := &App{}
	docs, err := app.ReadLocalTextDocuments([]string{notes, readme})
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if len(docs) != 2 {
		t.Fatalf("expected 2 documents, got %d", len(docs))
	}
	if docs[0].Text != "Q3 revenue was 120" || docs[0].FileName != "notes.txt" {
		t.Errorf("unexpected first document: %+v", docs[0])
	}
	if docs[0].Truncated {
		t.Error("a small file must not be marked truncated")
	}
}

func TestReadLocalTextDocumentsRejectsUnknownExtensions(t *testing.T) {
	dir := t.TempDir()
	// The allow-list is a boundary: an attachment must not be able to read an
	// arbitrary local file just because it was passed in.
	secret := writeTestFile(t, dir, "id_rsa.pem", "PRIVATE KEY")

	app := &App{}
	if _, err := app.ReadLocalTextDocuments([]string{secret}); err == nil {
		t.Fatal("expected an unsupported-extension error")
	} else if !strings.Contains(err.Error(), "unsupported extension") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestReadLocalTextDocumentsTruncatesOversizedFiles(t *testing.T) {
	dir := t.TempDir()
	big := writeTestFile(t, dir, "big.txt", strings.Repeat("x", maxLocalTextBytesPerFile+5_000))

	app := &App{}
	docs, err := app.ReadLocalTextDocuments([]string{big})
	if err != nil {
		t.Fatalf("an oversized file should truncate, not fail: %v", err)
	}
	if !docs[0].Truncated {
		t.Error("expected the document to be marked truncated")
	}
	if len(docs[0].Text) > maxLocalTextBytesPerFile {
		t.Errorf("text length %d exceeds the per-file cap", len(docs[0].Text))
	}
}

func TestReadLocalTextDocumentsNormalizesEncoding(t *testing.T) {
	dir := t.TempDir()
	path := writeTestFile(t, dir, "windows.txt", "\ufeffline one\r\nline two\r\n")

	app := &App{}
	docs, err := app.ReadLocalTextDocuments([]string{path})
	if err != nil {
		t.Fatal(err)
	}
	if docs[0].Text != "line one\nline two\n" {
		t.Errorf("BOM and CRLF should be normalized, got %q", docs[0].Text)
	}
}

func TestReadLocalTextDocumentsRejectsDirectoriesAndOverlongLists(t *testing.T) {
	dir := t.TempDir()
	app := &App{}

	nested := filepath.Join(dir, "folder.txt")
	if err := os.Mkdir(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := app.ReadLocalTextDocuments([]string{nested}); err == nil {
		t.Error("expected a directory to be rejected")
	}

	many := make([]string, maxLocalTextDocuments+1)
	for i := range many {
		many[i] = writeTestFile(t, dir, filepath.Base(filepath.Join(dir, "f"+string(rune('a'+i))+".txt")), "x")
	}
	if _, err := app.ReadLocalTextDocuments(many); err == nil {
		t.Error("expected an over-long attachment list to be rejected")
	}
}
