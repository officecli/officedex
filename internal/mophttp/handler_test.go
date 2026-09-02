package mophttp

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// validSnapshot builds the smallest snapshot that satisfies the envelope check
// the editor and this server both apply.
func validSnapshot(slideIDs ...string) []byte {
	slides := make([]any, 0, len(slideIDs))
	order := make([]any, 0, len(slideIDs))
	for _, id := range slideIDs {
		slides = append(slides, map[string]any{
			"type":  "slide",
			"attrs": map[string]any{"logicalId": id},
			"data":  []any{},
		})
		order = append(order, map[string]any{
			"type":  "slideRef",
			"attrs": map[string]any{"targetRef": id},
			"data":  nil,
		})
	}
	snapshot := map[string]any{
		"magic":   "mop0",
		"version": 1,
		"blocks": []any{
			map[string]any{"type": "slides", "data": slides},
			map[string]any{"type": "presentation", "data": []any{
				map[string]any{"type": "slideOrder", "data": order},
			}},
		},
	}
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		panic(err)
	}
	return encoded
}

// fakeConverter stands in for mop-convert. Import produces a package the
// editor would accept; Export produces a minimal ZIP so the PK check passes.
type fakeConverter struct {
	importContent []byte
	importErr     error
	exportErr     error
	exportOutput  []byte
	// exportedContent records what the converter was handed, which is how the
	// tests assert on snapshot normalization and slide pruning.
	exportedContent []byte
	importCalls     int
	exportCalls     int
}

func (f *fakeConverter) Import(_ context.Context, _, packageDirectory string) error {
	f.importCalls++
	if f.importErr != nil {
		return f.importErr
	}
	content := f.importContent
	if content == nil {
		content = validSnapshot("slide-1")
	}
	if err := os.MkdirAll(packageDirectory, 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(packageDirectory, contentFileName), content, 0o644)
}

func (f *fakeConverter) Export(_ context.Context, packageDirectory, outputPath string) error {
	f.exportCalls++
	if f.exportErr != nil {
		return f.exportErr
	}
	if data, err := os.ReadFile(filepath.Join(packageDirectory, contentFileName)); err == nil {
		f.exportedContent = data
	}
	output := f.exportOutput
	if output == nil {
		output = []byte("PK\x03\x04fake-pptx")
	}
	return os.WriteFile(outputPath, output, 0o644)
}

type testHarness struct {
	handler   *Handler
	converter *fakeConverter
	root      string
	clock     time.Time
}

func newHarness(t *testing.T) *testHarness {
	t.Helper()
	root := filepath.Join(t.TempDir(), "mop-packages")
	converter := &fakeConverter{}
	harness := &testHarness{
		converter: converter,
		root:      root,
		clock:     time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC),
	}
	blankPath := filepath.Join(t.TempDir(), "blank.json")
	if err := os.WriteFile(blankPath, validSnapshot("blank-slide"), 0o644); err != nil {
		t.Fatalf("write blank template: %v", err)
	}
	harness.handler = New(Options{
		Root:              root,
		Converter:         converter,
		BlankTemplatePath: blankPath,
		Capabilities:      Capabilities{ProtocolVersion: 1, SchemaVersion: 975},
		Now:               func() time.Time { return harness.clock },
	})
	return harness
}

func (h *testHarness) do(t *testing.T, method, target string, body []byte, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	request := httptest.NewRequest(method, target, reader)
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	recorder := httptest.NewRecorder()
	h.handler.ServeHTTP(recorder, request)
	return recorder
}

// importDeck drives a real multipart import and returns the new file ID.
func (h *testHarness) importDeck(t *testing.T, fileName string) string {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", fileName)
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := part.Write([]byte("PK\x03\x04pptx-bytes")); err != nil {
		t.Fatalf("write upload: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}
	response := h.do(t, http.MethodPost, routePrefix+"/import", body.Bytes(), map[string]string{
		"Content-Type": writer.FormDataContentType(),
	})
	if response.Code != http.StatusCreated {
		t.Fatalf("import status = %d, body %s", response.Code, response.Body.String())
	}
	var payload struct {
		FileID string `json:"fileId"`
		Title  string `json:"title"`
		Route  string `json:"route"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode import response: %v", err)
	}
	if payload.FileID == "" || payload.Route != "/p/"+payload.FileID {
		t.Fatalf("unexpected import payload %+v", payload)
	}
	return payload.FileID
}

func TestImportCreatesOpenablePackage(t *testing.T) {
	harness := newHarness(t)
	fileID := harness.importDeck(t, "Quarterly Review.pptx")

	response := harness.do(t, http.MethodGet, routePrefix+"/content?fileId="+fileID, nil, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("content status = %d, body %s", response.Code, response.Body.String())
	}
	header := response.Header()
	if got := header.Get("X-MOP-Magic"); got != "mop0" {
		t.Errorf("X-MOP-Magic = %q", got)
	}
	// The editor hard-rejects a package whose advertised versions differ from
	// its runtime, so these two headers are the whole reason import worked.
	if got := header.Get("X-MOP-Protocol-Version"); got != "1" {
		t.Errorf("X-MOP-Protocol-Version = %q, want 1", got)
	}
	if got := header.Get("X-MOP-Schema-Version"); got != "975" {
		t.Errorf("X-MOP-Schema-Version = %q, want 975", got)
	}
	if got := header.Get("X-MOP-Revision"); got != "0" {
		t.Errorf("X-MOP-Revision = %q, want 0", got)
	}
	// A space must survive as %20: the editor runs decodeURIComponent on this
	// header, and QueryEscape's "+" would surface as a literal plus.
	if got := header.Get("X-MOP-Title"); got != "Quarterly%20Review" {
		t.Errorf("X-MOP-Title = %q", got)
	}
	if got := header.Get("X-MOP-Source-File-Name"); got != "Quarterly%20Review.pptx" {
		t.Errorf("X-MOP-Source-File-Name = %q", got)
	}
	if header.Get("X-MOP-Rendered-Pictures") != "" {
		t.Error("rendered-pictures header set for a package without rendered pictures")
	}
	if !bytes.Equal(response.Body.Bytes(), validSnapshot("slide-1")) {
		t.Error("content body does not match the imported snapshot")
	}
}

func TestImportRejectsNonPptxUploads(t *testing.T) {
	harness := newHarness(t)
	for _, testCase := range []struct {
		name        string
		fileName    string
		body        []byte
		contentType string
		wantStatus  int
		wantCode    string
	}{
		{name: "wrong extension", fileName: "notes.txt", body: []byte("PK\x03\x04"), wantStatus: 400, wantCode: "INVALID_PPTX_FILE"},
		{name: "not a zip", fileName: "deck.pptx", body: []byte("plain text"), wantStatus: 400, wantCode: "INVALID_PPTX_FILE"},
		{name: "empty file", fileName: "deck.pptx", body: []byte{}, wantStatus: 400, wantCode: "INVALID_PPTX_FILE"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			var body bytes.Buffer
			writer := multipart.NewWriter(&body)
			part, err := writer.CreateFormFile("file", testCase.fileName)
			if err != nil {
				t.Fatalf("create form file: %v", err)
			}
			if _, err := part.Write(testCase.body); err != nil {
				t.Fatalf("write upload: %v", err)
			}
			if err := writer.Close(); err != nil {
				t.Fatalf("close writer: %v", err)
			}
			response := harness.do(t, http.MethodPost, routePrefix+"/import", body.Bytes(), map[string]string{
				"Content-Type": writer.FormDataContentType(),
			})
			assertErrorCode(t, response, testCase.wantStatus, testCase.wantCode)
		})
	}
}

// A request that declares multipart but does not carry it is malformed, and
// must not fall through to being read as a raw upload -- that would turn the
// boundary preamble into the first bytes of the "PowerPoint file".
func TestImportRejectsMalformedMultipart(t *testing.T) {
	harness := newHarness(t)
	response := harness.do(t, http.MethodPost, routePrefix+"/import", []byte("PK not really multipart"),
		map[string]string{"Content-Type": "multipart/form-data; boundary=----abc"})
	assertErrorCode(t, response, http.StatusBadRequest, "INVALID_PPTX_FILE")
}

func TestImportRejectsAConverterPackageWithoutContent(t *testing.T) {
	harness := newHarness(t)
	// A converter that "succeeds" without writing content.json must not leave
	// a package behind that fails every time it is opened.
	harness.converter.importContent = []byte("")
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, _ := writer.CreateFormFile("file", "deck.pptx")
	_, _ = part.Write([]byte("PK\x03\x04"))
	_ = writer.Close()
	response := harness.do(t, http.MethodPost, routePrefix+"/import", body.Bytes(), map[string]string{
		"Content-Type": writer.FormDataContentType(),
	})
	assertErrorCode(t, response, 422, "INVALID_MOP_PACKAGE")

	entries, err := os.ReadDir(harness.root)
	if err != nil {
		t.Fatalf("read store root: %v", err)
	}
	for _, entry := range entries {
		if !strings.HasPrefix(entry.Name(), ".") {
			t.Errorf("failed import left package %q behind", entry.Name())
		}
	}
}

func TestUnavailableConverterReportsServiceUnavailable(t *testing.T) {
	harness := newHarness(t)
	harness.handler.converter = nil
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, _ := writer.CreateFormFile("file", "deck.pptx")
	_, _ = part.Write([]byte("PK\x03\x04"))
	_ = writer.Close()
	response := harness.do(t, http.MethodPost, routePrefix+"/import", body.Bytes(), map[string]string{
		"Content-Type": writer.FormDataContentType(),
	})
	assertErrorCode(t, response, http.StatusServiceUnavailable, "MOP_CONVERTER_CLI_UNAVAILABLE")
}

func TestSaveContentAdvancesRevisionAndDetectsConflicts(t *testing.T) {
	harness := newHarness(t)
	fileID := harness.importDeck(t, "deck.pptx")
	updated := validSnapshot("slide-1", "slide-2")

	response := harness.do(t, http.MethodPut, routePrefix+"/content?fileId="+fileID, updated, map[string]string{
		"X-MOP-Base-Revision": "0",
		"X-MOP-Revision":      "1",
	})
	if response.Code != http.StatusOK {
		t.Fatalf("save status = %d, body %s", response.Code, response.Body.String())
	}
	if got := response.Header().Get("X-MOP-Revision"); got != "1" {
		t.Errorf("X-MOP-Revision = %q, want 1", got)
	}

	// Replaying the same base revision is exactly the stale-client case the
	// editor resynchronizes from, so it must conflict rather than overwrite.
	conflict := harness.do(t, http.MethodPut, routePrefix+"/content?fileId="+fileID, updated, map[string]string{
		"X-MOP-Base-Revision": "0",
		"X-MOP-Revision":      "1",
	})
	if conflict.Code != http.StatusConflict {
		t.Fatalf("conflict status = %d, body %s", conflict.Code, conflict.Body.String())
	}
	if got := conflict.Header().Get("X-MOP-Revision"); got != "1" {
		t.Errorf("conflict X-MOP-Revision = %q, want 1", got)
	}
	var payload struct {
		Error    string `json:"error"`
		Revision int64  `json:"revision"`
	}
	if err := json.Unmarshal(conflict.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode conflict: %v", err)
	}
	if payload.Error != "MOP_REVISION_CONFLICT" || payload.Revision != 1 {
		t.Errorf("conflict payload = %+v", payload)
	}

	reread := harness.do(t, http.MethodGet, routePrefix+"/content?fileId="+fileID, nil, nil)
	if got := reread.Header().Get("X-MOP-Revision"); got != "1" {
		t.Errorf("reread revision = %q, want 1", got)
	}
	if !bytes.Equal(reread.Body.Bytes(), updated) {
		t.Error("saved content was not persisted")
	}
}

func TestSaveContentRejectsInvalidInput(t *testing.T) {
	harness := newHarness(t)
	fileID := harness.importDeck(t, "deck.pptx")
	target := routePrefix + "/content?fileId=" + fileID

	for _, testCase := range []struct {
		name     string
		body     []byte
		headers  map[string]string
		status   int
		wantCode string
	}{
		{
			name:     "non-increasing revision",
			body:     validSnapshot("slide-1"),
			headers:  map[string]string{"X-MOP-Base-Revision": "3", "X-MOP-Revision": "3"},
			status:   http.StatusBadRequest,
			wantCode: "INVALID_MOP_REVISION",
		},
		{
			name:     "missing revision headers",
			body:     validSnapshot("slide-1"),
			headers:  map[string]string{},
			status:   http.StatusBadRequest,
			wantCode: "INVALID_MOP_REVISION",
		},
		{
			name:     "not a MOP envelope",
			body:     []byte(`{"magic":"other","version":1,"blocks":[]}`),
			headers:  map[string]string{"X-MOP-Base-Revision": "0", "X-MOP-Revision": "1"},
			status:   http.StatusBadRequest,
			wantCode: "INVALID_MOP_CONTENT",
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			response := harness.do(t, http.MethodPut, target, testCase.body, testCase.headers)
			assertErrorCode(t, response, testCase.status, testCase.wantCode)
		})
	}
}

func TestExportRequiresTheCurrentRevision(t *testing.T) {
	harness := newHarness(t)
	fileID := harness.importDeck(t, "deck.pptx")

	stale := harness.do(t, http.MethodPost, routePrefix+"/export?delivery=native&fileId="+fileID+"&revision=7", nil, nil)
	if stale.Code != http.StatusConflict {
		t.Fatalf("stale export status = %d, body %s", stale.Code, stale.Body.String())
	}
	var conflict struct {
		Error    string `json:"error"`
		Revision int64  `json:"revision"`
	}
	if err := json.Unmarshal(stale.Body.Bytes(), &conflict); err != nil {
		t.Fatalf("decode conflict: %v", err)
	}
	if conflict.Error != "MOP_REVISION_CONFLICT" || conflict.Revision != 0 {
		t.Errorf("conflict payload = %+v", conflict)
	}
	if harness.converter.exportCalls != 0 {
		t.Error("converter ran despite a revision conflict")
	}
}

func TestNativeExportRoundTripsThroughDownloadToken(t *testing.T) {
	harness := newHarness(t)
	fileID := harness.importDeck(t, "Annual Report.pptx")

	response := harness.do(t, http.MethodPost, routePrefix+"/export?delivery=native&fileId="+fileID+"&revision=0", nil, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("export status = %d, body %s", response.Code, response.Body.String())
	}
	var prepared struct {
		DownloadURL string `json:"downloadUrl"`
		FileName    string `json:"fileName"`
		Revision    int64  `json:"revision"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &prepared); err != nil {
		t.Fatalf("decode export: %v", err)
	}
	if prepared.FileName != "Annual Report.pptx" || prepared.Revision != 0 {
		t.Fatalf("prepared export = %+v", prepared)
	}
	if !strings.HasPrefix(prepared.DownloadURL, routePrefix+"/export-download?token=") {
		t.Fatalf("downloadUrl = %q", prepared.DownloadURL)
	}

	download := harness.do(t, http.MethodGet, prepared.DownloadURL, nil, nil)
	if download.Code != http.StatusOK {
		t.Fatalf("download status = %d", download.Code)
	}
	if got := download.Header().Get("Content-Type"); got != pptxContentType {
		t.Errorf("download content type = %q", got)
	}
	if !bytes.HasPrefix(download.Body.Bytes(), []byte("PK")) {
		t.Error("download body is not a ZIP container")
	}
	// filename* must be RFC 5987 percent-encoding, not form encoding.
	if got := download.Header().Get("Content-Disposition"); got != "attachment; filename*=UTF-8''Annual%20Report.pptx" {
		t.Errorf("Content-Disposition = %q", got)
	}

	// The token is single-use; a second fetch of the same URL must not serve
	// bytes the app is no longer holding.
	repeat := harness.do(t, http.MethodGet, prepared.DownloadURL, nil, nil)
	assertErrorCode(t, repeat, http.StatusNotFound, "MOP_EXPORT_DOWNLOAD_NOT_FOUND")
}

func TestPreparedExportsExpire(t *testing.T) {
	harness := newHarness(t)
	fileID := harness.importDeck(t, "deck.pptx")
	response := harness.do(t, http.MethodPost, routePrefix+"/export?delivery=native&fileId="+fileID+"&revision=0", nil, nil)
	var prepared struct {
		DownloadURL string `json:"downloadUrl"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &prepared); err != nil {
		t.Fatalf("decode export: %v", err)
	}

	harness.clock = harness.clock.Add(preparedExportTTL + time.Minute)
	expired := harness.do(t, http.MethodGet, prepared.DownloadURL, nil, nil)
	assertErrorCode(t, expired, http.StatusNotFound, "MOP_EXPORT_DOWNLOAD_NOT_FOUND")
	if len(harness.handler.prepared) != 0 {
		t.Errorf("expired export still retained: %d", len(harness.handler.prepared))
	}
}

func TestExportStripsEmptyChartStyles(t *testing.T) {
	harness := newHarness(t)
	fileID := harness.importDeck(t, "deck.pptx")

	snapshot := map[string]any{
		"magic":   "mop0",
		"version": 1,
		"blocks": []any{
			map[string]any{"type": "slides", "data": []any{
				map[string]any{"type": "chartStyle", "data": []any{}},
				map[string]any{"type": "slide", "attrs": map[string]any{"logicalId": "slide-1"}, "data": []any{}},
			}},
		},
	}
	body, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatalf("marshal snapshot: %v", err)
	}
	response := harness.do(t, http.MethodPost, routePrefix+"/export?fileId="+fileID+"&revision=0", body, map[string]string{
		"Content-Type": "application/octet-stream",
	})
	if response.Code != http.StatusOK {
		t.Fatalf("export status = %d, body %s", response.Code, response.Body.String())
	}
	if bytes.Contains(harness.converter.exportedContent, []byte("chartStyle")) {
		t.Errorf("empty chartStyle reached the converter: %s", harness.converter.exportedContent)
	}
}

func TestExportCopiesOnlyReferencedAssets(t *testing.T) {
	harness := newHarness(t)
	fileID := harness.importDeck(t, "deck.pptx")
	packageRoot := harness.handler.store.packageRoot(fileID)
	for _, name := range []string{"used.png", "unused.png"} {
		if err := writeFileAtomically(filepath.Join(packageRoot, "media", name), []byte("bytes")); err != nil {
			t.Fatalf("seed asset: %v", err)
		}
	}

	snapshot := map[string]any{
		"magic":   "mop0",
		"version": 1,
		"blocks": []any{
			map[string]any{"type": "slides", "data": []any{
				map[string]any{
					"type":  "picture",
					"attrs": map[string]any{"logicalId": "slide-1", "resourceUri": "mop-asset:/media/used.png"},
					"data":  []any{},
				},
			}},
		},
	}
	body, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatalf("marshal snapshot: %v", err)
	}

	var stagedMedia []string
	harness.converter.exportErr = nil
	original := harness.converter
	harness.handler.converter = converterFunc{
		export: func(_ context.Context, packageDirectory, outputPath string) error {
			entries, err := os.ReadDir(filepath.Join(packageDirectory, "media"))
			if err != nil {
				return err
			}
			for _, entry := range entries {
				stagedMedia = append(stagedMedia, entry.Name())
			}
			return os.WriteFile(outputPath, []byte("PK\x03\x04"), 0o644)
		},
		importFn: original.Import,
	}

	response := harness.do(t, http.MethodPost, routePrefix+"/export?fileId="+fileID+"&revision=0", body, map[string]string{
		"Content-Type": "application/octet-stream",
	})
	if response.Code != http.StatusOK {
		t.Fatalf("export status = %d, body %s", response.Code, response.Body.String())
	}
	if len(stagedMedia) != 1 || stagedMedia[0] != "used.png" {
		t.Errorf("staged media = %v, want only used.png", stagedMedia)
	}
}

type converterFunc struct {
	importFn func(context.Context, string, string) error
	export   func(context.Context, string, string) error
}

func (c converterFunc) Import(ctx context.Context, input, dir string) error {
	return c.importFn(ctx, input, dir)
}

func (c converterFunc) Export(ctx context.Context, dir, output string) error {
	return c.export(ctx, dir, output)
}

func TestOfficeJsExportProducesASingleSlidePackage(t *testing.T) {
	harness := newHarness(t)
	fileID := harness.importDeck(t, "deck.pptx")
	snapshot := validSnapshot("slide-1", "slide-2")

	response := harness.do(t, http.MethodPost,
		routePrefix+"/office-js/export-slide?fileId="+fileID+"&slideId=slide-2", snapshot,
		map[string]string{"Content-Type": "application/octet-stream"})
	if response.Code != http.StatusOK {
		t.Fatalf("export-slide status = %d, body %s", response.Code, response.Body.String())
	}
	if got := response.Header().Get("Content-Type"); got != pptxContentType {
		t.Errorf("content type = %q", got)
	}

	var exported map[string]any
	if err := json.Unmarshal(harness.converter.exportedContent, &exported); err != nil {
		t.Fatalf("decode exported content: %v", err)
	}
	blocks, _ := exported["blocks"].([]any)
	slides, _ := blocks[0].(map[string]any)
	data, _ := slides["data"].([]any)
	if len(data) != 1 {
		t.Fatalf("exported slide count = %d, want 1", len(data))
	}
	only, _ := data[0].(map[string]any)
	attrs, _ := only["attrs"].(map[string]any)
	if attrs["logicalId"] != "slide-2" {
		t.Errorf("exported slide = %v, want slide-2", attrs["logicalId"])
	}
}

func TestOfficeJsExportRejectsAnUnknownSlide(t *testing.T) {
	harness := newHarness(t)
	fileID := harness.importDeck(t, "deck.pptx")
	response := harness.do(t, http.MethodPost,
		routePrefix+"/office-js/export-slide?fileId="+fileID+"&slideId=missing", validSnapshot("slide-1"),
		map[string]string{"Content-Type": "application/octet-stream"})
	assertErrorCode(t, response, http.StatusNotFound, "SLIDE_NOT_FOUND")
}

func TestExamplesListsImportedPackagesNewestFirst(t *testing.T) {
	harness := newHarness(t)

	empty := harness.do(t, http.MethodGet, routePrefix+"/examples", nil, nil)
	if empty.Code != http.StatusOK {
		t.Fatalf("examples status = %d", empty.Code)
	}
	// The editor's file list reads `items`; a bare 404 here is what produced
	// the "example list failed" banner before this server existed.
	if strings.TrimSpace(empty.Body.String()) != `{"items":[]}` {
		t.Errorf("empty listing = %s", empty.Body.String())
	}

	first := harness.importDeck(t, "older.pptx")
	harness.clock = harness.clock.Add(time.Hour)
	second := harness.importDeck(t, "newer.pptx")

	response := harness.do(t, http.MethodGet, routePrefix+"/examples", nil, nil)
	var payload struct {
		Items []ExampleItem `json:"items"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode examples: %v", err)
	}
	if len(payload.Items) != 2 {
		t.Fatalf("items = %d, want 2", len(payload.Items))
	}
	if payload.Items[0].FileID != second || payload.Items[1].FileID != first {
		t.Errorf("ordering = %q, %q; want newest first", payload.Items[0].FileID, payload.Items[1].FileID)
	}
	if payload.Items[0].Title != "newer" || payload.Items[0].SlideCount != 1 {
		t.Errorf("first item = %+v", payload.Items[0])
	}
	if payload.Items[0].Route != "/p/"+second {
		t.Errorf("route = %q", payload.Items[0].Route)
	}
}

func TestExamplesSkipsUnreadablePackages(t *testing.T) {
	harness := newHarness(t)
	good := harness.importDeck(t, "good.pptx")
	// One corrupt package must not take the whole file list down with it.
	broken := filepath.Join(harness.root, "local-broken-000000000000")
	if err := writeFileAtomically(filepath.Join(broken, contentFileName), []byte("not json")); err != nil {
		t.Fatalf("seed broken package: %v", err)
	}

	response := harness.do(t, http.MethodGet, routePrefix+"/examples", nil, nil)
	var payload struct {
		Items []ExampleItem `json:"items"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode examples: %v", err)
	}
	if len(payload.Items) != 1 || payload.Items[0].FileID != good {
		t.Errorf("items = %+v, want only %q", payload.Items, good)
	}
}

func TestCreateProducesABlankPresentation(t *testing.T) {
	harness := newHarness(t)
	response := harness.do(t, http.MethodPost, routePrefix+"/create", nil, nil)
	if response.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body %s", response.Code, response.Body.String())
	}
	var payload struct {
		FileID string `json:"fileId"`
		Title  string `json:"title"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode create: %v", err)
	}
	if payload.Title != "无标题演示文稿" {
		t.Errorf("title = %q", payload.Title)
	}
	content := harness.do(t, http.MethodGet, routePrefix+"/content?fileId="+payload.FileID, nil, nil)
	if content.Code != http.StatusOK {
		t.Fatalf("content status = %d", content.Code)
	}
	if got := content.Header().Get("X-MOP-Title"); got != encodeURIComponent("无标题演示文稿") {
		t.Errorf("title header = %q", got)
	}
}

func TestDeleteRemovesThePackage(t *testing.T) {
	harness := newHarness(t)
	fileID := harness.importDeck(t, "deck.pptx")

	response := harness.do(t, http.MethodDelete, routePrefix+"/content?fileId="+fileID, nil, nil)
	if response.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d, body %s", response.Code, response.Body.String())
	}
	after := harness.do(t, http.MethodGet, routePrefix+"/content?fileId="+fileID, nil, nil)
	assertErrorCode(t, after, http.StatusNotFound, "MOP_CONTENT_NOT_FOUND")
}

func TestAssetUploadAndFetchRoundTrip(t *testing.T) {
	harness := newHarness(t)
	fileID := harness.importDeck(t, "deck.pptx")

	payload := []byte("image-bytes")
	sum := sha256.Sum256(payload)
	digestHex := hex.EncodeToString(sum[:])
	assetPath := fmt.Sprintf("media/%s.png", digestHex)

	upload := harness.do(t, http.MethodPut, routePrefix+"/assets/"+assetPath+"?fileId="+fileID, payload, map[string]string{
		"Content-Type":       "image/png",
		"X-MOP-Asset-Digest": "sha256:" + digestHex,
	})
	if upload.Code != http.StatusCreated {
		t.Fatalf("asset upload status = %d, body %s", upload.Code, upload.Body.String())
	}
	var descriptor struct {
		ResourceURI  string `json:"resourceUri"`
		ContentType  string `json:"contentType"`
		Extension    string `json:"extension"`
		Digest       string `json:"digest"`
		ResourceSize int    `json:"resourceSize"`
	}
	if err := json.Unmarshal(upload.Body.Bytes(), &descriptor); err != nil {
		t.Fatalf("decode descriptor: %v", err)
	}
	// The editor validates all three of these and throws if any disagrees.
	if descriptor.ResourceURI != "mop-asset:/"+assetPath ||
		descriptor.Digest != "sha256:"+digestHex ||
		descriptor.ResourceSize != len(payload) {
		t.Fatalf("descriptor = %+v", descriptor)
	}
	if descriptor.ContentType != "image/png" || descriptor.Extension != "png" {
		t.Errorf("descriptor content type/extension = %+v", descriptor)
	}

	fetch := harness.do(t, http.MethodGet, routePrefix+"/assets/"+assetPath+"?fileId="+fileID, nil, nil)
	if fetch.Code != http.StatusOK {
		t.Fatalf("asset fetch status = %d", fetch.Code)
	}
	if !bytes.Equal(fetch.Body.Bytes(), payload) {
		t.Error("asset bytes changed in transit")
	}
	if got := fetch.Header().Get("Content-Type"); got != "image/png" {
		t.Errorf("asset content type = %q", got)
	}
	if got := fetch.Header().Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Errorf("asset cache control = %q", got)
	}
}

func TestAssetUploadRejectsADigestMismatch(t *testing.T) {
	harness := newHarness(t)
	fileID := harness.importDeck(t, "deck.pptx")
	wrongDigest := strings.Repeat("a", 64)

	response := harness.do(t, http.MethodPut,
		routePrefix+"/assets/media/"+wrongDigest+".png?fileId="+fileID, []byte("image-bytes"),
		map[string]string{"Content-Type": "image/png"})
	assertErrorCode(t, response, http.StatusBadRequest, "MOP_ASSET_DIGEST_MISMATCH")
}

func TestAssetUploadRejectsAPathOutsideThePackage(t *testing.T) {
	harness := newHarness(t)
	fileID := harness.importDeck(t, "deck.pptx")
	response := harness.do(t, http.MethodPut,
		routePrefix+"/assets/media/../../escape.png?fileId="+fileID, []byte("x"), nil)
	assertErrorCode(t, response, http.StatusBadRequest, "INVALID_MOP_ASSET_PATH")
}

func TestPackageFileFetchRefusesTraversal(t *testing.T) {
	harness := newHarness(t)
	fileID := harness.importDeck(t, "deck.pptx")
	secret := filepath.Join(harness.root, "secret.txt")
	if err := os.WriteFile(secret, []byte("classified"), 0o644); err != nil {
		t.Fatalf("seed secret: %v", err)
	}
	response := harness.do(t, http.MethodGet,
		routePrefix+"/assets/media/..%2f..%2fsecret.txt?fileId="+fileID, nil, nil)
	if response.Code != http.StatusNotFound {
		t.Fatalf("traversal status = %d, body %s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), "classified") {
		t.Error("traversal served a file outside the package")
	}
}

func TestUnknownFileIdIsNotFound(t *testing.T) {
	harness := newHarness(t)
	for _, target := range []string{
		routePrefix + "/content?fileId=local-missing",
		routePrefix + "/export?fileId=local-missing&revision=0",
		routePrefix + "/office-js/export-slide?fileId=local-missing&slideId=slide-1",
	} {
		method := http.MethodGet
		if strings.Contains(target, "export") {
			method = http.MethodPost
		}
		response := harness.do(t, method, target, nil, nil)
		if response.Code != http.StatusNotFound {
			t.Errorf("%s %s status = %d, want 404", method, target, response.Code)
		}
	}
}

func TestRenderedPicturesDefaultsToAnEmptyObject(t *testing.T) {
	harness := newHarness(t)
	fileID := harness.importDeck(t, "deck.pptx")

	// Imports performed by this server do not pre-render slide pictures, so
	// the editor must receive an empty object rather than a 404.
	response := harness.do(t, http.MethodGet, routePrefix+"/rendered-pictures?fileId="+fileID, nil, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("rendered-pictures status = %d", response.Code)
	}
	if strings.TrimSpace(response.Body.String()) != "{}" {
		t.Errorf("body = %s", response.Body.String())
	}

	stored := []byte(`{"slide-1":"data:image/png;base64,AAA"}`)
	if err := writeFileAtomically(filepath.Join(harness.handler.store.packageRoot(fileID), renderedFileName), stored); err != nil {
		t.Fatalf("seed rendered pictures: %v", err)
	}
	content := harness.do(t, http.MethodGet, routePrefix+"/content?fileId="+fileID, nil, nil)
	if got := content.Header().Get("X-MOP-Rendered-Pictures"); got != "1" {
		t.Errorf("rendered pictures header = %q, want 1", got)
	}
	withPictures := harness.do(t, http.MethodGet, routePrefix+"/rendered-pictures?fileId="+fileID, nil, nil)
	if !bytes.Equal(withPictures.Body.Bytes(), stored) {
		t.Error("rendered pictures body does not match what was stored")
	}
}

func TestUnsupportedMethodsAreRejected(t *testing.T) {
	harness := newHarness(t)
	response := harness.do(t, http.MethodDelete, routePrefix+"/examples", nil, nil)
	assertErrorCode(t, response, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED")
}

func TestNonMopPathsFallThroughAsNotFound(t *testing.T) {
	harness := newHarness(t)
	// Wails routes every non-GET request to this handler regardless of path,
	// so an unrelated route must not be swallowed as a MOP error.
	response := harness.do(t, http.MethodPost, "/api/something-else", nil, nil)
	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", response.Code)
	}
	if strings.Contains(response.Body.String(), "MOP") {
		t.Errorf("unrelated path answered with a MOP error: %s", response.Body.String())
	}
}

func TestHeadRequestsOmitTheBody(t *testing.T) {
	harness := newHarness(t)
	fileID := harness.importDeck(t, "deck.pptx")
	response := harness.do(t, http.MethodHead, routePrefix+"/content?fileId="+fileID, nil, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d", response.Code)
	}
	if response.Body.Len() != 0 {
		t.Errorf("HEAD returned %d body bytes", response.Body.Len())
	}
	if got := response.Header().Get("Content-Length"); got == "" || got == "0" {
		t.Errorf("Content-Length = %q, want the real body length", got)
	}
}

func assertErrorCode(t *testing.T, response *httptest.ResponseRecorder, wantStatus int, wantCode string) {
	t.Helper()
	if response.Code != wantStatus {
		t.Fatalf("status = %d, want %d (body %s)", response.Code, wantStatus, response.Body.String())
	}
	var payload struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode error body %q: %v", response.Body.String(), err)
	}
	if payload.Error != wantCode {
		t.Errorf("error code = %q, want %q", payload.Error, wantCode)
	}
}

// TestClusterProxyPrefixIsAccepted covers the failure that made the packaged
// app report "404 page not found": the editor does not call the bare route, it
// prefixes every request with the API cluster it resolved (`/proxy/docs/...`).
// A handler that only matches the bare path answers nothing it actually sends.
func TestClusterProxyPrefixIsAccepted(t *testing.T) {
	harness := newHarness(t)
	fileID := harness.importDeck(t, "deck.pptx")

	for _, cluster := range []string{"docs", "us04docs", "us04file", "bff", "slides"} {
		t.Run(cluster, func(t *testing.T) {
			prefix := "/proxy/" + cluster

			examples := harness.do(t, http.MethodGet, prefix+routePrefix+"/examples", nil, nil)
			if examples.Code != http.StatusOK {
				t.Fatalf("examples via %s = %d, body %s", prefix, examples.Code, examples.Body.String())
			}

			content := harness.do(t, http.MethodGet, prefix+routePrefix+"/content?fileId="+fileID, nil, nil)
			if content.Code != http.StatusOK {
				t.Fatalf("content via %s = %d", prefix, content.Code)
			}
			if got := content.Header().Get("X-MOP-Schema-Version"); got != "975" {
				t.Errorf("schema header via %s = %q", prefix, got)
			}

			asset := harness.do(t, http.MethodGet, prefix+routePrefix+"/assets/content.json?fileId="+fileID, nil, nil)
			if asset.Code != http.StatusOK {
				t.Errorf("asset fetch via %s = %d", prefix, asset.Code)
			}
		})
	}
}

// The prepared-download URL is handed straight to an anchor, so it has to keep
// the prefix the export was requested through.
func TestPreparedDownloadURLKeepsTheRequestPrefix(t *testing.T) {
	harness := newHarness(t)
	fileID := harness.importDeck(t, "deck.pptx")

	response := harness.do(t, http.MethodPost,
		"/proxy/docs"+routePrefix+"/export?delivery=native&fileId="+fileID+"&revision=0", nil, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("export status = %d, body %s", response.Code, response.Body.String())
	}
	var prepared struct {
		DownloadURL string `json:"downloadUrl"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &prepared); err != nil {
		t.Fatalf("decode export: %v", err)
	}
	if !strings.HasPrefix(prepared.DownloadURL, "/proxy/docs"+routePrefix+"/export-download?token=") {
		t.Fatalf("downloadUrl = %q, want the /proxy/docs prefix preserved", prepared.DownloadURL)
	}
	download := harness.do(t, http.MethodGet, prepared.DownloadURL, nil, nil)
	if download.Code != http.StatusOK {
		t.Fatalf("download via prefixed URL = %d", download.Code)
	}
}

func TestProxyPrefixDoesNotOpenNonMopRoutes(t *testing.T) {
	harness := newHarness(t)
	// Stripping the cluster prefix must not turn an unrelated docs API into
	// something this handler claims; it still has to be a MOP route.
	response := harness.do(t, http.MethodGet, "/proxy/docs/api/user/me", nil, nil)
	if response.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", response.Code)
	}
}

// importRaw posts the upload the way the editor does in a packaged app: raw
// bytes with the name in a header, because a WKWebView custom scheme drops
// Blob-backed bodies (FormData/File/Blob) and delivers only ArrayBuffers.
func (h *testHarness) importRaw(t *testing.T, fileName string, payload []byte) *httptest.ResponseRecorder {
	t.Helper()
	return h.do(t, http.MethodPost, routePrefix+"/import", payload, map[string]string{
		"Content-Type":     "application/octet-stream",
		"X-PPTX-File-Name": url.QueryEscape(fileName),
	})
}

func TestImportAcceptsARawBodyUpload(t *testing.T) {
	harness := newHarness(t)

	response := harness.importRaw(t, "Quarterly Review.pptx", []byte("PK\x03\x04pptx-bytes"))
	if response.Code != http.StatusCreated {
		t.Fatalf("raw import status = %d, body %s", response.Code, response.Body.String())
	}
	var payload struct {
		FileID string `json:"fileId"`
		Title  string `json:"title"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode import: %v", err)
	}
	if payload.Title != "Quarterly Review" {
		t.Errorf("title = %q, want the name from the header", payload.Title)
	}

	content := harness.do(t, http.MethodGet, routePrefix+"/content?fileId="+payload.FileID, nil, nil)
	if content.Code != http.StatusOK {
		t.Fatalf("content status = %d", content.Code)
	}
	if got := content.Header().Get("X-MOP-Source-File-Name"); got != "Quarterly%20Review.pptx" {
		t.Errorf("source file name = %q", got)
	}
}

func TestImportRawBodyStillValidatesTheUpload(t *testing.T) {
	harness := newHarness(t)

	// An empty body is precisely what a dropped Blob upload looks like, so the
	// reason has to reach the user rather than the client's generic fallback.
	empty := harness.importRaw(t, "deck.pptx", nil)
	assertErrorCode(t, empty, http.StatusBadRequest, "INVALID_PPTX_FILE")
	var payload struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal(empty.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !strings.Contains(payload.Message, "no data") {
		t.Errorf("message = %q, want it to name the empty body", payload.Message)
	}

	notZip := harness.importRaw(t, "deck.pptx", []byte("plain text"))
	assertErrorCode(t, notZip, http.StatusBadRequest, "INVALID_PPTX_FILE")

	wrongName := harness.importRaw(t, "notes.txt", []byte("PK\x03\x04"))
	assertErrorCode(t, wrongName, http.StatusBadRequest, "INVALID_PPTX_FILE")
}

func TestImportRawBodyWithoutAFileNameFallsBack(t *testing.T) {
	harness := newHarness(t)
	response := harness.do(t, http.MethodPost, routePrefix+"/import", []byte("PK\x03\x04pptx"),
		map[string]string{"Content-Type": "application/octet-stream"})
	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, body %s", response.Code, response.Body.String())
	}
	var payload struct {
		Title string `json:"title"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if payload.Title != "presentation" {
		t.Errorf("title = %q, want the placeholder name", payload.Title)
	}
}

// Multipart must keep working: the Vite dev server, the quality runners and
// any plain HTTP client still post that shape.
func TestImportStillAcceptsMultipart(t *testing.T) {
	harness := newHarness(t)
	fileID := harness.importDeck(t, "deck.pptx")
	if fileID == "" {
		t.Fatal("multipart import stopped working")
	}
}

func TestImportRejectionIsLogged(t *testing.T) {
	harness := newHarness(t)
	var logged []string
	harness.handler.logger = func(format string, args ...any) {
		logged = append(logged, fmt.Sprintf(format, args...))
	}

	harness.importRaw(t, "deck.pptx", nil)
	if len(logged) == 0 {
		t.Fatal("a refused import produced no log line")
	}
	if !strings.Contains(logged[0], "no data") {
		t.Errorf("log = %q, want the reason", logged[0])
	}
}
