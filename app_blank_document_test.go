package main

import (
	"archive/zip"
	"bytes"
	"context"
	"os"
	"testing"

	"officedex/internal/types"
)

func TestCreateBlankDocumentWritesAndRegistersOfficePackages(t *testing.T) {
	app, store, workspace := newFolderTestApp(t)
	for _, documentType := range []string{"docx", "xlsx", "pptx"} {
		record, err := app.CreateBlankDocument(documentType, DefaultFolderID)
		if err != nil {
			t.Fatalf("CreateBlankDocument(%s): %v", documentType, err)
		}
		if record.DocumentType != documentType || record.FilePath == "" {
			t.Fatalf("record = %+v", record)
		}
		if _, err := os.Stat(record.FilePath); err != nil {
			t.Fatalf("created %s: %v", documentType, err)
		}
		if record.WorkspaceID != DefaultFolderID {
			t.Errorf("blank %s has workspace id %q, want %q", documentType, record.WorkspaceID, DefaultFolderID)
		}
	}
	page, err := store.QueryDocuments(context.Background(), types.DocumentListInput{})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 3 {
		t.Fatalf("registered %d documents, want 3 in %s", len(page.Items), workspace)
	}
}

func TestBlankDocxPackageHasWordDocumentPart(t *testing.T) {
	data := blankDocxPackage()
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, entry := range reader.File {
		seen[entry.Name] = true
	}
	for _, name := range []string{"[Content_Types].xml", "_rels/.rels", "word/document.xml"} {
		if !seen[name] {
			t.Errorf("blank docx is missing %s", name)
		}
	}
}
