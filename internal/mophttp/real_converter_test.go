package mophttp

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestRealConverterRoundTrip exercises the exact path that failed in the
// packaged app: a real .pptx uploaded through the HTTP API, converted by the
// real mop-convert binary, read back with the capability headers the editor
// validates, and exported to a real PowerPoint file. The fakes elsewhere in
// this package cannot catch a converter contract change; this can.
//
// It is skipped unless both a converter and a sample deck are available, so a
// clean checkout without the bundled runtime still runs the rest of the suite.
func TestRealConverterRoundTrip(t *testing.T) {
	converterBinary := locateRealConverter(t)
	if converterBinary == "" {
		t.Skip("no mop-convert binary is available")
	}
	samplePath := strings.TrimSpace(os.Getenv("OFFICEDEX_TEST_PPTX"))
	if samplePath == "" {
		t.Skip("set OFFICEDEX_TEST_PPTX to a sample .pptx to run the real round trip")
	}
	sample, err := os.ReadFile(samplePath)
	if err != nil {
		t.Skipf("cannot read %s: %v", samplePath, err)
	}

	root := filepath.Join(t.TempDir(), "mop-packages")
	handler := New(Options{
		Root:         root,
		Converter:    NewCLIConverter(converterBinary),
		Capabilities: Capabilities{ProtocolVersion: DefaultProtocolVersion, SchemaVersion: DefaultSchemaVersion},
		Now:          time.Now,
	})

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", filepath.Base(samplePath))
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := part.Write(sample); err != nil {
		t.Fatalf("write upload: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}

	importRequest := httptest.NewRequest(http.MethodPost, routePrefix+"/import", bytes.NewReader(body.Bytes()))
	importRequest.Header.Set("Content-Type", writer.FormDataContentType())
	importResponse := httptest.NewRecorder()
	handler.ServeHTTP(importResponse, importRequest)
	if importResponse.Code != http.StatusCreated {
		t.Fatalf("import status = %d, body %s", importResponse.Code, importResponse.Body.String())
	}
	var imported struct {
		FileID string `json:"fileId"`
		Title  string `json:"title"`
	}
	if err := json.Unmarshal(importResponse.Body.Bytes(), &imported); err != nil {
		t.Fatalf("decode import: %v", err)
	}

	contentRequest := httptest.NewRequest(http.MethodGet, routePrefix+"/content?fileId="+imported.FileID, nil)
	contentResponse := httptest.NewRecorder()
	handler.ServeHTTP(contentResponse, contentRequest)
	if contentResponse.Code != http.StatusOK {
		t.Fatalf("content status = %d, body %s", contentResponse.Code, contentResponse.Body.String())
	}
	// These are the headers editor-document.ts refuses to open a package
	// without; a mismatch here is the "Failed to import" the user saw.
	if got := contentResponse.Header().Get("X-MOP-Protocol-Version"); got != "1" {
		t.Errorf("protocol version header = %q", got)
	}
	slideCount, err := snapshotSlideCount(contentResponse.Body.Bytes())
	if err != nil {
		t.Fatalf("converted package is not a readable snapshot: %v", err)
	}
	if slideCount == 0 {
		t.Error("converted package has no slides")
	}
	t.Logf("imported %q as %s with %d slides", imported.Title, imported.FileID, slideCount)

	exportRequest := httptest.NewRequest(http.MethodPost,
		routePrefix+"/export?fileId="+imported.FileID+"&revision=0", nil)
	exportResponse := httptest.NewRecorder()
	handler.ServeHTTP(exportResponse, exportRequest)
	if exportResponse.Code != http.StatusOK {
		t.Fatalf("export status = %d, body %s", exportResponse.Code, exportResponse.Body.String())
	}
	if !bytes.HasPrefix(exportResponse.Body.Bytes(), []byte("PK")) {
		t.Error("export did not produce a ZIP container")
	}
	t.Logf("exported %d bytes of PPTX", exportResponse.Body.Len())
}

func locateRealConverter(t *testing.T) string {
	t.Helper()
	candidates := []string{strings.TrimSpace(os.Getenv("OFFICEDEX_MOP_CONVERT_BIN"))}
	if workingDirectory, err := os.Getwd(); err == nil {
		workspace := filepath.Join(workingDirectory, "..", "..", "..")
		candidates = append(candidates,
			filepath.Join(workspace, "pptx", "tools", "bin", "mop-convert"),
			filepath.Join(workingDirectory, "..", "..", "build", "bin", "OfficeDex.app",
				"Contents", "Resources", "presentation", "tools", "bin", "mop-convert"),
		)
	}
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		info, err := os.Stat(candidate)
		if err != nil || info.IsDir() || info.Mode().Perm()&0o111 == 0 {
			continue
		}
		absolute, err := filepath.Abs(candidate)
		if err != nil {
			continue
		}
		return absolute
	}
	return ""
}
