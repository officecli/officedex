package word2mowhttp

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

type stubConverter struct {
	importFn func(ctx context.Context, inputPath, packageDirectory string) error
	exportFn func(ctx context.Context, packageDirectory, outputPath string) error
}

func (s stubConverter) Import(ctx context.Context, inputPath, packageDirectory string) error {
	return s.importFn(ctx, inputPath, packageDirectory)
}

func (s stubConverter) Export(ctx context.Context, packageDirectory, outputPath string) error {
	return s.exportFn(ctx, packageDirectory, outputPath)
}

// writePackage fakes what `convert import` leaves behind.
func writePackage(t *testing.T, root string, entries map[string]string) {
	t.Helper()
	for name, content := range entries {
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func zipBytes(t *testing.T, entries map[string]string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for name, content := range entries {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func post(t *testing.T, handler http.Handler, path string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body))
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}

func errorCode(t *testing.T, recorder *httptest.ResponseRecorder) string {
	t.Helper()
	var payload struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode error body %q: %v", recorder.Body.String(), err)
	}
	return payload.Error
}

func TestImportReturnsMowArchive(t *testing.T) {
	handler := New(Options{Converter: stubConverter{
		importFn: func(_ context.Context, inputPath, packageDirectory string) error {
			upload, err := os.ReadFile(inputPath)
			if err != nil {
				return err
			}
			if string(upload) != "PK-docx" {
				t.Fatalf("converter received %q, want the posted bytes", upload)
			}
			writePackage(t, packageDirectory, map[string]string{
				"content.json":    `{"type":"doc"}`,
				"image/cover.png": "png",
			})
			return nil
		},
	}})

	recorder := post(t, handler, ImportRoute, []byte("PK-docx"))

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", recorder.Code, recorder.Body)
	}
	if got := recorder.Header().Get("Content-Type"); got != zipContentType {
		t.Fatalf("content-type = %q", got)
	}
	archive := recorder.Body.Bytes()
	reader, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		t.Fatalf("response is not a ZIP: %v", err)
	}
	names := make([]string, 0, len(reader.File))
	for _, entry := range reader.File {
		names = append(names, entry.Name)
	}
	if len(names) != 2 || names[0] != "content.json" || names[1] != "image/cover.png" {
		t.Fatalf("archive entries = %v, want sorted content.json + image/cover.png", names)
	}
}

func TestImportRejectsAnEmptyBody(t *testing.T) {
	handler := New(Options{Converter: stubConverter{
		importFn: func(context.Context, string, string) error {
			t.Fatal("converter ran for an empty upload")
			return nil
		},
	}})

	recorder := post(t, handler, ImportRoute, nil)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d", recorder.Code)
	}
	if code := errorCode(t, recorder); code != "INVALID_DOCX_FILE" {
		t.Fatalf("error = %q", code)
	}
}

// A converter that exits 0 without writing content.json has produced nothing
// loadable; reporting success would hand the editor an empty document.
func TestImportRejectsAPackageWithoutContent(t *testing.T) {
	handler := New(Options{Converter: stubConverter{
		importFn: func(_ context.Context, _, packageDirectory string) error {
			return os.MkdirAll(packageDirectory, 0o755)
		},
	}})

	recorder := post(t, handler, ImportRoute, []byte("PK-docx"))

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d", recorder.Code)
	}
	if code := errorCode(t, recorder); code != "DOCX_CONVERSION_FAILED" {
		t.Fatalf("error = %q", code)
	}
}

func TestExportUnpacksTheArchiveAndReturnsDocx(t *testing.T) {
	handler := New(Options{Converter: stubConverter{
		exportFn: func(_ context.Context, packageDirectory, outputPath string) error {
			content, err := os.ReadFile(filepath.Join(packageDirectory, "content.json"))
			if err != nil {
				return err
			}
			if string(content) != `{"type":"doc"}` {
				t.Fatalf("content.json = %q", content)
			}
			if _, err := os.Stat(filepath.Join(packageDirectory, "image", "cover.png")); err != nil {
				t.Fatalf("image entry was not unpacked: %v", err)
			}
			return os.WriteFile(outputPath, []byte("PK-docx"), 0o644)
		},
	}})

	recorder := post(t, handler, ExportRoute, zipBytes(t, map[string]string{
		"content.json":    `{"type":"doc"}`,
		"image/cover.png": "png",
	}))

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", recorder.Code, recorder.Body)
	}
	if got := recorder.Header().Get("Content-Type"); got != docxContentType {
		t.Fatalf("content-type = %q", got)
	}
	if recorder.Body.String() != "PK-docx" {
		t.Fatalf("body = %q", recorder.Body)
	}
}

// The path whitelist is the only thing standing between a crafted ZIP and a
// write outside the scratch directory.
func TestExportRejectsAnEscapingArchivePath(t *testing.T) {
	handler := New(Options{Converter: stubConverter{
		exportFn: func(context.Context, string, string) error {
			t.Fatal("converter ran for an unsafe archive")
			return nil
		},
	}})

	for _, name := range []string{"../escape.json", "/absolute.json", "secrets/key.pem"} {
		recorder := post(t, handler, ExportRoute, zipBytes(t, map[string]string{
			"content.json": `{"type":"doc"}`,
			name:           "x",
		}))
		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("%s: status = %d", name, recorder.Code)
		}
		if code := errorCode(t, recorder); code != "INVALID_MOW_PACKAGE" {
			t.Fatalf("%s: error = %q", name, code)
		}
	}
}

func TestExportRejectsAnArchiveWithoutContent(t *testing.T) {
	handler := New(Options{Converter: stubConverter{
		exportFn: func(context.Context, string, string) error {
			t.Fatal("converter ran for a package with no content.json")
			return nil
		},
	}})

	recorder := post(t, handler, ExportRoute, zipBytes(t, map[string]string{"image/cover.png": "png"}))

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d", recorder.Code)
	}
	if code := errorCode(t, recorder); code != "INVALID_MOW_PACKAGE" {
		t.Fatalf("error = %q", code)
	}
}

func TestConverterErrorsKeepTheirStatus(t *testing.T) {
	handler := New(Options{Converter: stubConverter{
		importFn: func(context.Context, string, string) error {
			return &apiError{status: http.StatusGatewayTimeout, code: "WORD2MOW_TIMEOUT", message: "DOCX import timed out."}
		},
	}})

	recorder := post(t, handler, ImportRoute, []byte("PK-docx"))

	if recorder.Code != http.StatusGatewayTimeout {
		t.Fatalf("status = %d", recorder.Code)
	}
	if code := errorCode(t, recorder); code != "WORD2MOW_TIMEOUT" {
		t.Fatalf("error = %q", code)
	}
}

// A build with no bundled converter must say so rather than panic on a nil
// interface, because that is what a partially staged app looks like.
func TestMissingConverterReportsUnavailable(t *testing.T) {
	handler := New(Options{})

	recorder := post(t, handler, ImportRoute, []byte("PK-docx"))

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d", recorder.Code)
	}
	if code := errorCode(t, recorder); code != "WORD2MOW_CLI_UNAVAILABLE" {
		t.Fatalf("error = %q", code)
	}
}

// This handler is the asset server's fallback, so it sees every non-GET request
// regardless of path and must not answer for paths it does not own.
func TestUnknownPathsAre404(t *testing.T) {
	handler := New(Options{})

	recorder := post(t, handler, "/api/osuite/mop/content", nil)

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status = %d", recorder.Code)
	}
}

func TestNonPostIsRejected(t *testing.T) {
	handler := New(Options{})

	request := httptest.NewRequest(http.MethodGet, ImportRoute, nil)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d", recorder.Code)
	}
	if allow := recorder.Header().Get("Allow"); allow != "POST, OPTIONS" {
		t.Fatalf("allow = %q", allow)
	}
}

// An oversized body must be reported, not truncated: a truncated MOW package
// would export as a silently corrupted document.
func TestOversizedBodyIsReportedRatherThanTruncated(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, ExportRoute, bytes.NewReader(make([]byte, 64)))
	if _, err := readLimitedBody(request, 16); err == nil {
		t.Fatal("readLimitedBody accepted a body over the limit")
	}
}

func TestScratchDirectoriesAreRemoved(t *testing.T) {
	tempDir := t.TempDir()
	var packageDirectory string
	handler := New(Options{TempDir: tempDir, Converter: stubConverter{
		importFn: func(_ context.Context, _, directory string) error {
			packageDirectory = directory
			writePackage(t, directory, map[string]string{"content.json": `{"type":"doc"}`})
			return nil
		},
	}})

	if recorder := post(t, handler, ImportRoute, []byte("PK-docx")); recorder.Code != http.StatusOK {
		t.Fatalf("status = %d", recorder.Code)
	}
	if _, err := os.Stat(packageDirectory); !os.IsNotExist(err) {
		t.Fatalf("scratch directory survived the request: %v", err)
	}
	entries, err := os.ReadDir(tempDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("temp dir still holds %d entries", len(entries))
	}
}
