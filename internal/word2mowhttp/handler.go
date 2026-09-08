// Package word2mowhttp serves the two conversion endpoints the embedded Writer
// editor calls: POST /api/import turns a .docx into a MOW ZIP, POST /api/export
// turns a MOW ZIP back into a .docx. Both delegate to word2mow's `convert`
// executable, which is bundled under Contents/Resources/word2mow.
//
// Writer's Vite dev server implements the same two routes in
// apps/docx-demo/server/word2mow-converter.ts; this is the packaged-app
// equivalent, mounted on the Wails asset server.
package word2mowhttp

import (
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
)

const (
	// ImportRoute and ExportRoute are the paths createHttpWord2MowAdapter posts
	// to. They are absolute and same-origin, so they land on whatever serves
	// the embed's own document.
	ImportRoute = "/api/import"
	ExportRoute = "/api/export"

	docxContentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	zipContentType  = "application/zip"

	// maxImportBytes and maxExportBytes bound the request bodies. A MOW package
	// carries the document's images uncompressed alongside its content, so the
	// export side needs the larger budget; both match the dev server's
	// 128 MB ceiling.
	maxImportBytes = 128 * 1024 * 1024
	maxExportBytes = 128 * 1024 * 1024
)

// Options configures a Handler.
type Options struct {
	// Converter runs word2mow's convert CLI. A nil converter makes both routes
	// report the converter as unavailable rather than panicking.
	Converter Converter
	// TempDir is where conversions stage their scratch directories. Empty means
	// os.TempDir().
	TempDir string
	// Logger records why a request was refused. A packaged app has no other way
	// to explain a failure, so leaving this nil makes the server silent in
	// exactly the situation where diagnosis is hardest.
	Logger func(format string, args ...any)
}

// Handler serves the local DOCX conversion API. It is safe for concurrent use.
type Handler struct {
	converter Converter
	tempDir   string
	logger    func(format string, args ...any)
}

func New(options Options) *Handler {
	return &Handler{
		converter: options.Converter,
		tempDir:   options.TempDir,
		logger:    options.Logger,
	}
}

// Handles reports whether a path belongs to this handler. main.go uses it to
// dispatch between the handlers sharing the asset server's single fallback.
func Handles(path string) bool {
	return path == ImportRoute || path == ExportRoute
}

func (h *Handler) logf(format string, args ...any) {
	if h.logger == nil {
		return
	}
	h.logger(format, args...)
}

// ServeHTTP routes conversion requests. Anything outside the two routes is a
// 404 rather than a fallthrough: like the MOP handler, this is mounted as the
// Wails asset server's fallback, which receives every non-GET request
// regardless of path.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !Handles(r.URL.Path) {
		http.NotFound(w, r)
		return
	}
	if r.Method == http.MethodOptions {
		applyCORS(w, r)
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Accept")
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodPost {
		sendMethodNotAllowed(w, r)
		return
	}
	if r.URL.Path == ImportRoute {
		h.importDocx(w, r)
		return
	}
	h.exportDocx(w, r)
}

// importDocx converts an uploaded .docx into the MOW ZIP the editor loads.
//
// The body is raw bytes, never multipart: a packaged app runs the editor behind
// a WKWebView custom scheme, and WebKit does not deliver a Blob-backed request
// body (FormData, File, Blob) to a custom scheme handler -- the request arrives
// with its body silently emptied, while an ArrayBuffer body comes through
// intact. createHttpWord2MowAdapter posts an ArrayBuffer for exactly this
// reason, so there is no second shape to support.
func (h *Handler) importDocx(w http.ResponseWriter, r *http.Request) {
	upload, err := readLimitedBody(r, maxImportBytes)
	if err != nil {
		h.rejectBody(w, r, err, "DOCX")
		return
	}
	if len(upload) == 0 {
		h.reject(w, r, newAPIError(http.StatusBadRequest, "INVALID_DOCX_FILE", "The DOCX upload was empty."))
		return
	}

	root, cleanup, err := h.scratchDirectory("writer-docx-import-")
	if err != nil {
		h.reject(w, r, newAPIError(http.StatusInternalServerError, "WORD2MOW_TEMP_FAILED", err.Error()))
		return
	}
	defer cleanup()

	inputPath := filepath.Join(root, "input.docx")
	packageDirectory := filepath.Join(root, "document.mow.dir")
	if err := os.WriteFile(inputPath, upload, 0o644); err != nil {
		h.reject(w, r, newAPIError(http.StatusInternalServerError, "WORD2MOW_TEMP_FAILED", err.Error()))
		return
	}

	if err := h.convertImport(r, inputPath, packageDirectory); err != nil {
		h.rejectConversion(w, r, err)
		return
	}

	archive, err := readMowDirectoryAsArchive(packageDirectory)
	if err != nil {
		h.reject(w, r, newAPIError(http.StatusBadRequest, "DOCX_CONVERSION_FAILED", err.Error()))
		return
	}
	writeBinary(w, r, zipContentType, archive)
}

// exportDocx converts the editor's MOW ZIP back into a .docx.
func (h *Handler) exportDocx(w http.ResponseWriter, r *http.Request) {
	archive, err := readLimitedBody(r, maxExportBytes)
	if err != nil {
		h.rejectBody(w, r, err, "MOW package")
		return
	}

	root, cleanup, err := h.scratchDirectory("writer-docx-export-")
	if err != nil {
		h.reject(w, r, newAPIError(http.StatusInternalServerError, "WORD2MOW_TEMP_FAILED", err.Error()))
		return
	}
	defer cleanup()

	packageDirectory := filepath.Join(root, "document.mow.dir")
	outputPath := filepath.Join(root, "output.docx")
	if err := os.MkdirAll(packageDirectory, 0o755); err != nil {
		h.reject(w, r, newAPIError(http.StatusInternalServerError, "WORD2MOW_TEMP_FAILED", err.Error()))
		return
	}
	if err := writeMowArchiveToDirectory(archive, packageDirectory); err != nil {
		h.reject(w, r, newAPIError(http.StatusBadRequest, "INVALID_MOW_PACKAGE", err.Error()))
		return
	}

	if err := h.convertExport(r, packageDirectory, outputPath); err != nil {
		h.rejectConversion(w, r, err)
		return
	}

	output, err := os.ReadFile(outputPath)
	if err != nil || len(output) == 0 {
		h.reject(w, r, newAPIError(http.StatusBadRequest, "DOCX_GENERATION_FAILED", "word2mow produced an empty DOCX file."))
		return
	}
	writeBinary(w, r, docxContentType, output)
}

func (h *Handler) convertImport(r *http.Request, inputPath, packageDirectory string) error {
	if h.converter == nil {
		return errConverterUnavailable
	}
	return h.converter.Import(r.Context(), inputPath, packageDirectory)
}

func (h *Handler) convertExport(r *http.Request, packageDirectory, outputPath string) error {
	if h.converter == nil {
		return errConverterUnavailable
	}
	return h.converter.Export(r.Context(), packageDirectory, outputPath)
}

var errConverterUnavailable = &apiError{
	status:  http.StatusServiceUnavailable,
	code:    "WORD2MOW_CLI_UNAVAILABLE",
	message: "The DOCX converter command-line tool is unavailable.",
}

// scratchDirectory creates the per-request staging directory. Its cleanup runs
// even when the converter fails, so a failed conversion cannot accumulate
// hundreds of megabytes of half-written packages.
func (h *Handler) scratchDirectory(prefix string) (string, func(), error) {
	root, err := os.MkdirTemp(h.tempDir, prefix)
	if err != nil {
		return "", func() {}, err
	}
	return root, func() { _ = os.RemoveAll(root) }, nil
}

func (h *Handler) reject(w http.ResponseWriter, r *http.Request, err *apiError) {
	h.logf("%s refused: %s (%s)", r.URL.Path, err.code, err.message)
	sendAPIError(w, r, err)
}

func (h *Handler) rejectConversion(w http.ResponseWriter, r *http.Request, err error) {
	var api *apiError
	if errors.As(err, &api) {
		h.reject(w, r, api)
		return
	}
	h.reject(w, r, newAPIError(http.StatusBadRequest, "DOCX_CONVERSION_FAILED", err.Error()))
}

func (h *Handler) rejectBody(w http.ResponseWriter, r *http.Request, err error, label string) {
	if errors.Is(err, errBodyTooLarge) {
		h.reject(w, r, newAPIError(http.StatusRequestEntityTooLarge, "REQUEST_TOO_LARGE",
			"The "+label+" upload exceeds the allowed size."))
		return
	}
	h.reject(w, r, newAPIError(http.StatusBadRequest, "INVALID_REQUEST_BODY", err.Error()))
}

func writeBinary(w http.ResponseWriter, r *http.Request, contentType string, data []byte) {
	applyCORS(w, r)
	header := w.Header()
	header.Set("Content-Type", contentType)
	header.Set("Cache-Control", "no-store")
	header.Set("Content-Length", strconv.Itoa(len(data)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

var errBodyTooLarge = errors.New("request body exceeds the allowed size")

// readLimitedBody reads at most limit bytes and reports anything larger as an
// error rather than silently truncating, which would corrupt the document.
func readLimitedBody(r *http.Request, limit int64) ([]byte, error) {
	if r.Body == nil {
		return nil, nil
	}
	defer drainAndClose(r.Body)
	data, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, errBodyTooLarge
	}
	return data, nil
}

// drainAndClose consumes what is left of a body before closing it, so a client
// that is still writing sees the response instead of a connection reset.
func drainAndClose(body io.ReadCloser) {
	_, _ = io.Copy(io.Discard, io.LimitReader(body, 1<<20))
	_ = body.Close()
}
