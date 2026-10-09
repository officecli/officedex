package main

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestConflictedDocxRetainsLatestEditsAcrossRestart(t *testing.T) {
	original := testDocxPackage(t, "original")
	app, source, token := newDocxSaveTestApp(t, original)
	app.userDataDir = t.TempDir()
	external := testDocxPackage(t, "external")
	if err := os.WriteFile(source, external, 0o644); err != nil {
		t.Fatal(err)
	}
	edited := testDocxPackage(t, "unsaved edits")
	_, err := app.SaveDocx(SaveDocxInput{DataBase64: base64.StdEncoding.EncodeToString(edited), PreviewToken: token, ExpectedSHA256: sha256Hex(original)})
	if err == nil || !strings.Contains(err.Error(), SourceChangedMarker) {
		t.Fatalf("expected conflict: %v", err)
	}
	restarted := &App{userDataDir: app.userDataDir}
	drafts, err := restarted.ListDocumentDrafts()
	if err != nil || len(drafts) != 1 {
		t.Fatalf("drafts: %v %v", drafts, err)
	}
	restored, err := restarted.RestoreDocumentDraft(drafts[0]["id"])
	if err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(restored)
	if string(data) != string(edited) {
		t.Fatal("recovery did not retain the editor bytes")
	}
	data, _ = os.ReadFile(source)
	if string(data) != string(external) {
		t.Fatal("external source overwritten")
	}
	if filepath.Dir(restored) != filepath.Join(app.userDataDir, "workspace") {
		t.Fatal(restored)
	}
	if _, err := restarted.RestoreDocumentDraft("../secret.docx"); err == nil {
		t.Fatal("accepted unlisted ID")
	}
}
