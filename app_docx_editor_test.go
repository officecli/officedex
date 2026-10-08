package main

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"officedex/internal/preview"
	"officedex/internal/types"
)

func testDocxPackage(t *testing.T, body string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for name, content := range map[string]string{
		"[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
		"word/document.xml":   `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>` + body + `</w:t></w:r></w:p></w:body></w:document>`,
	} {
		file, err := writer.Create(name)
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		if _, err := file.Write([]byte(content)); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close docx: %v", err)
	}
	return buffer.Bytes()
}

func newDocxSaveTestApp(t *testing.T, source []byte) (*App, string, string) {
	t.Helper()
	workspace := t.TempDir()
	path := filepath.Join(workspace, "document.docx")
	if err := os.WriteFile(path, source, 0o644); err != nil {
		t.Fatalf("write source: %v", err)
	}
	reg, err := preview.New(preview.RegistryOptions{
		TrustedRoots: []string{workspace},
		CreateToken:  func() string { return "docx-token" },
	})
	if err != nil {
		t.Fatalf("preview.New: %v", err)
	}
	artifact := types.Artifact{FilePath: path, FileName: "document.docx", DocumentType: "docx"}
	if err := reg.AllowArtifact(artifact); err != nil {
		t.Fatalf("AllowArtifact: %v", err)
	}
	grant, err := reg.IssueToken(artifact)
	if err != nil {
		t.Fatalf("IssueToken: %v", err)
	}
	return &App{workspaceDir: workspace, previewReg: reg}, path, grant.Token
}

func TestSaveDocxOverwritesPreviewGrantedSourceAtomically(t *testing.T) {
	oldData := testDocxPackage(t, "old-docx")
	newData := testDocxPackage(t, "new-docx")
	app, path, token := newDocxSaveTestApp(t, oldData)

	result, err := app.SaveDocx(SaveDocxInput{
		DataBase64:     base64.StdEncoding.EncodeToString(newData),
		FileName:       "ignored.docx",
		PreviewToken:   token,
		ExpectedSHA256: sha256Hex(oldData),
	})
	if err != nil {
		t.Fatalf("SaveDocx: %v", err)
	}
	canonicalPath, err := filepath.EvalSymlinks(path)
	if err != nil {
		t.Fatalf("canonical path: %v", err)
	}
	if result.FilePath != canonicalPath || result.SHA256 != sha256Hex(newData) {
		t.Fatalf("SaveDocx result = %#v", result)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read saved source: %v", err)
	}
	if string(got) != string(newData) {
		t.Fatalf("saved bytes = %q, want %q", got, newData)
	}
}

func TestSaveDocxRejectsExternalSourceChange(t *testing.T) {
	original := testDocxPackage(t, "original")
	app, path, token := newDocxSaveTestApp(t, original)
	if err := os.WriteFile(path, testDocxPackage(t, "external-change"), 0o644); err != nil {
		t.Fatalf("change source: %v", err)
	}

	_, err := app.SaveDocx(SaveDocxInput{
		DataBase64:     base64.StdEncoding.EncodeToString(testDocxPackage(t, "editor-change")),
		PreviewToken:   token,
		ExpectedSHA256: sha256Hex(original),
	})
	if err == nil || !strings.Contains(err.Error(), "changed outside OfficeDex") {
		t.Fatalf("SaveDocx should reject stale source, got %v", err)
	}
}

func TestSaveDocxRejectsInvalidPackageAndToken(t *testing.T) {
	app, _, token := newDocxSaveTestApp(t, testDocxPackage(t, "original"))
	_, err := app.SaveDocx(SaveDocxInput{
		DataBase64:   base64.StdEncoding.EncodeToString([]byte("not-a-docx")),
		PreviewToken: token,
	})
	if err == nil || !strings.Contains(err.Error(), "invalid DOCX package") {
		t.Fatalf("invalid package error = %v", err)
	}

	_, err = app.SaveDocx(SaveDocxInput{
		DataBase64:   base64.StdEncoding.EncodeToString(testDocxPackage(t, "valid-shape")),
		PreviewToken: "unknown",
	})
	if err == nil || !strings.Contains(err.Error(), "invalid preview token") {
		t.Fatalf("invalid token error = %v", err)
	}
}
