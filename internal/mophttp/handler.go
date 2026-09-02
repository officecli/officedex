package mophttp

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	// routePrefix is the mount point the editor's api-base resolver produces
	// for a same-origin deployment, which is what the embedded bundle is.
	routePrefix = "/api/osuite/mop"

	pptxContentType = "application/vnd.openxmlformats-officedocument.presentationml.presentation"

	maxPptxImportBytes   = 100 * 1024 * 1024
	maxSnapshotBytes     = 64 * 1024 * 1024
	maxAssetBytes        = 256 * 1024 * 1024
	preparedExportTTL    = 5 * time.Minute
	multipartMemoryLimit = 8 * 1024 * 1024
)

// Capabilities are the MOP protocol and schema versions the editor's WASM
// runtime reports. assertPackageCapabilities in editor-document.ts rejects any
// package whose headers disagree, so these must track the bundled mop-wasm
// exactly; capabilities_test.go verifies them against the real binary.
type Capabilities struct {
	ProtocolVersion int
	SchemaVersion   int
}

// Options configures a Handler.
type Options struct {
	// Root is the directory that holds MOP packages, one per file ID.
	Root string
	// Converter runs mop-convert. A nil converter makes import and export
	// report the converter as unavailable rather than panicking.
	Converter Converter
	// BlankTemplatePath is the bundled blank presentation used by /create.
	BlankTemplatePath string
	// Capabilities are the versions advertised on content responses.
	Capabilities Capabilities
	// Now is injected by tests; it defaults to time.Now.
	Now func() time.Time
	// Logger records why a request was refused. A packaged app has no other
	// way to explain a failure, so leaving this nil makes the server silent in
	// exactly the situation where diagnosis is hardest.
	Logger func(format string, args ...any)
}

// Handler serves the local MOP API. It is safe for concurrent use.
type Handler struct {
	store             *Store
	converter         Converter
	blankTemplatePath string
	capabilities      Capabilities
	now               func() time.Time
	logger            func(format string, args ...any)

	mu        sync.Mutex
	prepared  map[string]*preparedExport
	nextToken func() string
}

type preparedExport struct {
	fileName string
	output   []byte
	revision int64
	expires  time.Time
}

func New(options Options) *Handler {
	now := options.Now
	if now == nil {
		now = time.Now
	}
	return &Handler{
		store:             NewStore(options.Root),
		converter:         options.Converter,
		blankTemplatePath: options.BlankTemplatePath,
		capabilities:      options.Capabilities,
		now:               now,
		logger:            options.Logger,
		prepared:          make(map[string]*preparedExport),
		nextToken:         randomToken,
	}
}

// Store exposes the package store so the host application can locate packages
// it imported through this API.
func (h *Handler) Store() *Store { return h.store }

func (h *Handler) logf(format string, args ...any) {
	if h.logger == nil {
		return
	}
	h.logger(format, args...)
}

func randomToken() string {
	buffer := make([]byte, 16)
	if _, err := rand.Read(buffer); err != nil {
		// crypto/rand failing is not recoverable in a way that matters here;
		// a time-derived token still avoids collisions within one process.
		return fmt.Sprintf("t%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buffer)
}

// ServeHTTP routes MOP API requests. Anything outside the MOP prefix is a 404
// rather than a fallthrough: this handler is mounted as the Wails asset
// server's fallback, which receives every non-GET request regardless of path.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	routePath := normalizeRoutePath(r.URL.Path)
	if !strings.HasPrefix(routePath, routePrefix) {
		http.NotFound(w, r)
		return
	}
	if r.Method == http.MethodOptions {
		applyCORS(w, r)
		w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Accept, X-MOP-Base-Revision, X-MOP-Revision, X-MOP-Asset-Digest, X-PPTX-File-Name")
		w.WriteHeader(http.StatusNoContent)
		return
	}

	switch routePath {
	case routePrefix + "/create":
		h.methodGate(w, r, map[string]http.HandlerFunc{http.MethodPost: h.createPresentation})
		return
	case routePrefix + "/examples":
		h.methodGate(w, r, map[string]http.HandlerFunc{http.MethodGet: h.listExamples})
		return
	case routePrefix + "/import":
		h.methodGate(w, r, map[string]http.HandlerFunc{http.MethodPost: h.importPptx})
		return
	case routePrefix + "/export":
		h.methodGate(w, r, map[string]http.HandlerFunc{http.MethodPost: h.exportPptx})
		return
	case routePrefix + "/export-download":
		h.methodGate(w, r, map[string]http.HandlerFunc{
			http.MethodGet:  h.downloadPreparedPptx,
			http.MethodHead: h.downloadPreparedPptx,
		})
		return
	case routePrefix + "/office-js/export-slide":
		h.methodGate(w, r, map[string]http.HandlerFunc{http.MethodPost: h.exportOfficeJsSlide})
		return
	case routePrefix + "/content":
		h.methodGate(w, r, map[string]http.HandlerFunc{
			http.MethodGet:    h.sendContent,
			http.MethodHead:   h.sendContent,
			http.MethodPut:    h.saveContent,
			http.MethodDelete: h.deletePackage,
		})
		return
	case routePrefix + "/rendered-pictures":
		h.methodGate(w, r, map[string]http.HandlerFunc{
			http.MethodGet:  h.sendRenderedPictures,
			http.MethodHead: h.sendRenderedPictures,
		})
		return
	}

	if relative, ok := strings.CutPrefix(routePath, routePrefix+"/assets/"); ok {
		decoded, err := url.PathUnescape(relative)
		if err != nil {
			decoded = relative
		}
		switch r.Method {
		case http.MethodPut:
			h.saveAsset(w, r, decoded)
		case http.MethodGet, http.MethodHead:
			if !h.sendPackageFile(w, r, decoded) {
				sendJSON(w, r, http.StatusNotFound, map[string]any{"error": "MOP_CONTENT_NOT_FOUND"})
			}
		default:
			sendMethodNotAllowed(w, r)
		}
		return
	}

	sendJSON(w, r, http.StatusNotFound, map[string]any{"error": "MOP_CONTENT_NOT_FOUND"})
}

// clusterProxyPrefixPattern matches the `/proxy/<cluster>` prefix the editor
// puts in front of every API call. The bundle carries five cluster names
// (docs, us04docs, bff, slides, us04file) and picks one at runtime, so this
// strips any of them rather than the two the dev server happens to hardcode --
// a prefix this server does not recognize would 404 silently, which is exactly
// how the packaged app failed with "404 page not found". Stripping is safe
// because the result still has to match the MOP route prefix to be served.
var clusterProxyPrefixPattern = regexp.MustCompile(`^/proxy/[A-Za-z0-9_-]+`)

// normalizeRoutePath reduces a request path to the bare MOP route the handlers
// are written against, so `/proxy/docs/api/osuite/mop/content` and
// `/api/osuite/mop/content` reach the same place.
func normalizeRoutePath(path string) string {
	return clusterProxyPrefixPattern.ReplaceAllString(path, "")
}

func (h *Handler) methodGate(w http.ResponseWriter, r *http.Request, routes map[string]http.HandlerFunc) {
	if handler, ok := routes[r.Method]; ok {
		handler(w, r)
		return
	}
	sendMethodNotAllowed(w, r)
}

// requestFileID reads the file ID every route keys off. The dev server falls
// back to a bundled demo package when the parameter is absent; a packaged app
// ships no demo packages, so an absent or malformed ID is simply unknown.
func requestFileID(r *http.Request) string {
	return r.URL.Query().Get("fileId")
}

// ---------------------------------------------------------------- capabilities

// encodeURIComponent escapes exactly the characters JavaScript's
// encodeURIComponent escapes. net/url's helpers differ in ways that matter
// here: QueryEscape turns a space into "+", which decodeURIComponent would
// hand back to the editor as a literal plus inside a presentation title.
func encodeURIComponent(value string) string {
	const unreserved = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"
	var builder strings.Builder
	for _, octet := range []byte(value) {
		if strings.IndexByte(unreserved, octet) >= 0 {
			builder.WriteByte(octet)
			continue
		}
		builder.WriteString(fmt.Sprintf("%%%02X", octet))
	}
	return builder.String()
}

func (h *Handler) applyCapabilityHeaders(header http.Header, revision int64) {
	header.Set("X-MOP-Magic", "mop0")
	header.Set("X-MOP-Protocol-Version", strconv.Itoa(h.capabilities.ProtocolVersion))
	header.Set("X-MOP-Schema-Version", strconv.Itoa(h.capabilities.SchemaVersion))
	header.Set("X-MOP-Revision", strconv.FormatInt(revision, 10))
}

func writeBody(w http.ResponseWriter, r *http.Request, status int, data []byte) {
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.WriteHeader(status)
	if r.Method != http.MethodHead {
		_, _ = w.Write(data)
	}
}

// ---------------------------------------------------------------------- content

func (h *Handler) sendContent(w http.ResponseWriter, r *http.Request) {
	fileID := requestFileID(r)
	content, _, err := h.store.readPackageFile(fileID, contentFileName)
	if err != nil || content == nil {
		sendJSON(w, r, http.StatusNotFound, map[string]any{"error": "MOP_CONTENT_NOT_FOUND"})
		return
	}
	revision := h.store.readRevision(fileID, content)
	metadata := h.store.readMetadata(fileID)

	title := fileID
	if metadata != nil && strings.TrimSpace(metadata.Title) != "" {
		title = strings.TrimSpace(metadata.Title)
	}
	renderedPictures, _, err := h.store.readPackageFile(fileID, renderedFileName)
	hasRenderedPictures := err == nil && renderedPictures != nil

	applyCORS(w, r)
	header := w.Header()
	header.Set("Content-Type", "application/json; charset=utf-8")
	header.Set("Cache-Control", "no-store")
	h.applyCapabilityHeaders(header, revision)
	header.Set("X-MOP-Title", encodeURIComponent(title))
	if metadata != nil && metadata.SourceFileName != "" {
		header.Set("X-MOP-Source-File-Name", encodeURIComponent(metadata.SourceFileName))
	}
	if hasRenderedPictures {
		header.Set("X-MOP-Rendered-Pictures", "1")
	}
	writeBody(w, r, http.StatusOK, content)
}

func (h *Handler) sendRenderedPictures(w http.ResponseWriter, r *http.Request) {
	data, _, err := h.store.readPackageFile(requestFileID(r), renderedFileName)
	if err != nil || data == nil {
		// An import performed by this server does not pre-render slide
		// pictures (the dev server's renderer sidecars are not bundled), so an
		// absent file is the normal case rather than an error.
		sendJSON(w, r, http.StatusOK, map[string]any{})
		return
	}
	applyCORS(w, r)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	writeBody(w, r, http.StatusOK, data)
}

func (h *Handler) saveContent(w http.ResponseWriter, r *http.Request) {
	fileID := requestFileID(r)
	baseRevision, baseOK := parseRevisionHeader(r.Header.Get("X-MOP-Base-Revision"))
	nextRevision, nextOK := parseRevisionHeader(r.Header.Get("X-MOP-Revision"))
	if !baseOK || !nextOK || nextRevision <= baseRevision {
		sendJSON(w, r, http.StatusBadRequest, map[string]any{"error": "INVALID_MOP_REVISION"})
		return
	}

	content, err := readLimitedBody(r, maxSnapshotBytes)
	if err != nil || len(content) == 0 {
		sendJSON(w, r, http.StatusRequestEntityTooLarge, map[string]any{"error": "INVALID_MOP_CONTENT_SIZE"})
		return
	}
	if _, err := parseValidSnapshot(content); err != nil {
		sendJSON(w, r, http.StatusBadRequest, map[string]any{"error": "INVALID_MOP_CONTENT"})
		return
	}
	if !validFileID(fileID) || !h.store.exists(fileID) {
		sendJSON(w, r, http.StatusNotFound, map[string]any{"error": "MOP_CONTENT_NOT_FOUND"})
		return
	}

	var conflict bool
	var currentRevision int64
	writeErr := h.store.withWriteLock(fileID, func() error {
		contentPath := filepath.Join(h.store.packageRoot(fileID), contentFileName)
		storedContent, err := readFileIfExists(contentPath)
		if err != nil {
			return err
		}
		persistedRevision := h.store.readRevision(fileID, storedContent)
		if baseRevision != persistedRevision {
			conflict = true
			currentRevision = persistedRevision
			return nil
		}
		if err := writeFileAtomically(contentPath, content); err != nil {
			return err
		}
		if err := writeRevisionAt(h.store.packageRoot(fileID), nextRevision, content, h.now()); err != nil {
			return err
		}
		currentRevision = nextRevision
		return nil
	})
	if writeErr != nil {
		sendJSON(w, r, http.StatusInternalServerError, map[string]any{"error": "MOP_CONTENT_WRITE_FAILED"})
		return
	}

	applyCORS(w, r)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-MOP-Revision", strconv.FormatInt(currentRevision, 10))
	if conflict {
		sendJSONPreservingHeaders(w, http.StatusConflict, map[string]any{
			"error":    "MOP_REVISION_CONFLICT",
			"revision": currentRevision,
		})
		return
	}
	sendJSONPreservingHeaders(w, http.StatusOK, map[string]any{"revision": currentRevision})
}

// sendJSONPreservingHeaders writes a JSON body without touching headers the
// caller already set, which the revision responses depend on.
func sendJSONPreservingHeaders(w http.ResponseWriter, status int, payload any) {
	encoded, err := json.Marshal(payload)
	if err != nil {
		encoded = []byte(`{"error":"MOP_INTERNAL_ERROR"}`)
		status = http.StatusInternalServerError
	}
	w.Header().Set("Content-Length", strconv.Itoa(len(encoded)))
	w.WriteHeader(status)
	_, _ = w.Write(encoded)
}

// parseRevisionHeader accepts only what JavaScript's Number.isSafeInteger
// would accept, because the editor computes the next revision client-side and
// a silently truncated value would desynchronize the two.
func parseRevisionHeader(value string) (int64, bool) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return 0, false
	}
	parsed, err := strconv.ParseInt(trimmed, 10, 64)
	if err != nil || parsed < 0 || parsed > 1<<53-1 {
		return 0, false
	}
	return parsed, true
}

// parseQueryRevision differs from the header form in one way that matters: an
// absent query parameter means revision 0, because the editor builds this URL
// with URLSearchParams and omits the value rather than sending "0". A present
// but unparseable value stays an error.
func parseQueryRevision(value string) (int64, bool) {
	if strings.TrimSpace(value) == "" {
		return 0, true
	}
	return parseRevisionHeader(value)
}

func (h *Handler) deletePackage(w http.ResponseWriter, r *http.Request) {
	fileID := requestFileID(r)
	if !validFileID(fileID) {
		sendJSON(w, r, http.StatusNotFound, map[string]any{"error": "MOP_CONTENT_NOT_FOUND"})
		return
	}
	err := h.store.withWriteLock(fileID, func() error {
		return h.store.deletePackage(fileID)
	})
	if err != nil {
		sendJSON(w, r, http.StatusInternalServerError, map[string]any{"error": "MOP_PACKAGE_DELETE_FAILED"})
		return
	}
	applyCORS(w, r)
	w.WriteHeader(http.StatusNoContent)
}

// ----------------------------------------------------------------- package files

var assetPathPattern = regexp.MustCompile(`^(?:media|embeddings)/[A-Za-z0-9._-]+$`)

func (h *Handler) sendPackageFile(w http.ResponseWriter, r *http.Request, relativePath string) bool {
	normalized := strings.TrimLeft(relativePath, "/")
	if normalized != contentFileName && !assetPathPattern.MatchString(normalized) {
		return false
	}
	data, resolvedPath, err := h.store.readPackageFile(requestFileID(r), normalized)
	if err != nil || data == nil {
		return false
	}

	applyCORS(w, r)
	header := w.Header()
	header.Set("Content-Type", contentTypeForFile(resolvedPath))
	if normalized == contentFileName {
		header.Set("Cache-Control", "no-store")
	} else {
		// Asset names are content digests, so a stored asset is immutable and
		// can be cached indefinitely.
		header.Set("Cache-Control", "public, max-age=31536000, immutable")
	}
	// Assets are addressed by digest rather than by revision, so the dev
	// server reports revision 0 here and the editor ignores it.
	h.applyCapabilityHeaders(header, 0)
	writeBody(w, r, http.StatusOK, data)
	return true
}

var contentTypesByExtension = map[string]string{
	".aac":  "audio/aac",
	".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".emf":  "image/emf",
	".flac": "audio/flac",
	".gif":  "image/gif",
	".jpeg": "image/jpeg",
	".jpg":  "image/jpeg",
	".json": "application/json; charset=utf-8",
	".m4a":  "audio/mp4",
	".mov":  "video/quicktime",
	".mp3":  "audio/mpeg",
	".mp4":  "video/mp4",
	".ogg":  "audio/ogg",
	".png":  "image/png",
	".svg":  "image/svg+xml",
	".tif":  "image/tiff",
	".tiff": "image/tiff",
	".wav":  "audio/wav",
	".webp": "image/webp",
	".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}

func contentTypeForFile(filePath string) string {
	if contentType, ok := contentTypesByExtension[strings.ToLower(filepath.Ext(filePath))]; ok {
		return contentType
	}
	return "application/octet-stream"
}

var digestAssetPattern = regexp.MustCompile(`^(media|embeddings)/([a-f0-9]{64})\.([A-Za-z0-9]{1,10})$`)

func (h *Handler) saveAsset(w http.ResponseWriter, r *http.Request, relativePath string) {
	normalized := strings.TrimLeft(relativePath, "/")
	match := digestAssetPattern.FindStringSubmatch(normalized)
	if match == nil {
		sendJSON(w, r, http.StatusBadRequest, map[string]any{"error": "INVALID_MOP_ASSET_PATH"})
		return
	}
	body, err := readLimitedBody(r, maxAssetBytes)
	if err != nil || len(body) == 0 {
		sendJSON(w, r, http.StatusRequestEntityTooLarge, map[string]any{"error": "INVALID_MOP_ASSET_SIZE"})
		return
	}

	sum := sha256.Sum256(body)
	digestHex := hex.EncodeToString(sum[:])
	digest := "sha256:" + digestHex
	// The path names the digest, so a mismatch means the upload was corrupted
	// in transit; storing it would leave an asset no snapshot can reference.
	if digestHex != match[2] {
		sendJSON(w, r, http.StatusBadRequest, map[string]any{"error": "MOP_ASSET_DIGEST_MISMATCH"})
		return
	}
	if declared := r.Header.Get("X-MOP-Asset-Digest"); declared != "" && declared != digest {
		sendJSON(w, r, http.StatusBadRequest, map[string]any{"error": "MOP_ASSET_DIGEST_MISMATCH"})
		return
	}

	contentType := strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0])
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	fileID := requestFileID(r)
	if !validFileID(fileID) {
		sendJSON(w, r, http.StatusNotFound, map[string]any{"error": "MOP_CONTENT_NOT_FOUND"})
		return
	}
	writeErr := h.store.withWriteLock(fileID, func() error {
		return writeFileAtomically(filepath.Join(h.store.packageRoot(fileID), filepath.FromSlash(normalized)), body)
	})
	if writeErr != nil {
		sendJSON(w, r, http.StatusInternalServerError, map[string]any{"error": "MOP_ASSET_WRITE_FAILED"})
		return
	}
	sendJSON(w, r, http.StatusCreated, map[string]any{
		"resourceUri":  "mop-asset:/" + normalized,
		"contentType":  contentType,
		"extension":    strings.ToLower(match[3]),
		"digest":       digest,
		"resourceSize": len(body),
	})
}

// ---------------------------------------------------------------------- examples

func (h *Handler) listExamples(w http.ResponseWriter, r *http.Request) {
	items, err := h.store.listExamples()
	if err != nil {
		sendJSON(w, r, http.StatusInternalServerError, map[string]any{"error": "MOP_EXAMPLES_LIST_FAILED"})
		return
	}
	sendJSON(w, r, http.StatusOK, map[string]any{"items": items})
}

// ------------------------------------------------------------------------ create

func (h *Handler) createPresentation(w http.ResponseWriter, r *http.Request) {
	content, err := os.ReadFile(h.blankTemplatePath)
	if err != nil {
		sendJSON(w, r, http.StatusInternalServerError, map[string]any{
			"error":   "MOP_PRESENTATION_CREATE_FAILED",
			"message": "Unable to create a blank presentation.",
		})
		return
	}
	snapshot, err := parseValidSnapshot(content)
	if err != nil || len(blockData(findBlock(snapshot, "slides"))) != 1 {
		sendJSON(w, r, http.StatusInternalServerError, map[string]any{
			"error":   "MOP_PRESENTATION_CREATE_FAILED",
			"message": "Unable to create a blank presentation.",
		})
		return
	}

	fileID, err := h.allocateFileID()
	if err != nil {
		sendJSON(w, r, http.StatusInternalServerError, map[string]any{
			"error":   "MOP_PRESENTATION_CREATE_FAILED",
			"message": "Unable to create a blank presentation.",
		})
		return
	}
	stagingRoot := filepath.Join(h.store.root, "."+fileID+".creating")
	metadata := metadata{Title: "无标题演示文稿", CreatedAt: h.now().UTC().Format(time.RFC3339Nano)}
	if err := h.stagePackage(stagingRoot, fileID, content, metadata); err != nil {
		_ = os.RemoveAll(stagingRoot)
		sendJSON(w, r, http.StatusInternalServerError, map[string]any{
			"error":   "MOP_PRESENTATION_CREATE_FAILED",
			"message": "Unable to create a blank presentation.",
		})
		return
	}
	sendJSON(w, r, http.StatusCreated, map[string]any{
		"fileId": fileID,
		"title":  metadata.Title,
		"route":  "/p/" + encodeURIComponent(fileID),
	})
}

// stagePackage writes a complete package into a staging directory and moves it
// into place with a single rename, so a reader never sees a package that is
// missing its metadata or revision file.
func (h *Handler) stagePackage(stagingRoot, fileID string, content []byte, meta metadata) error {
	if err := os.MkdirAll(h.store.root, 0o755); err != nil {
		return err
	}
	if err := os.RemoveAll(stagingRoot); err != nil {
		return err
	}
	if err := os.MkdirAll(stagingRoot, 0o755); err != nil {
		return err
	}
	if err := writeFileAtomically(filepath.Join(stagingRoot, contentFileName), content); err != nil {
		return err
	}
	if err := writeMetadataAt(stagingRoot, meta); err != nil {
		return err
	}
	if err := writeRevisionAt(stagingRoot, 0, content, h.now()); err != nil {
		return err
	}
	return os.Rename(stagingRoot, h.store.packageRoot(fileID))
}

func writeMetadataAt(packageRoot string, meta metadata) error {
	payload, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomically(filepath.Join(packageRoot, metaFileName), append(payload, '\n'))
}

// allocateFileID mints an unused package ID. The `local-` prefix and base36
// timestamp match the dev server, so IDs stay recognizable in logs and routes.
func (h *Handler) allocateFileID() (string, error) {
	for attempt := 0; attempt < 8; attempt++ {
		suffix := make([]byte, 6)
		if _, err := rand.Read(suffix); err != nil {
			return "", err
		}
		fileID := fmt.Sprintf("local-%s-%s", strconv.FormatInt(h.now().UnixMilli(), 36), hex.EncodeToString(suffix))
		if !h.store.exists(fileID) {
			return fileID, nil
		}
	}
	return "", errors.New("unable to allocate a unique MOP package id")
}

// ------------------------------------------------------------------------ import

func (h *Handler) importPptx(w http.ResponseWriter, r *http.Request) {
	mediaType, parameters, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))

	requestedFileName := decodeHeaderFileName(r.Header.Get("X-PPTX-File-Name"))
	if requestedFileName == "" {
		requestedFileName = contentDispositionFileName(r.Header.Get("Content-Disposition"))
	}
	if requestedFileName != "" && !strings.HasSuffix(strings.ToLower(requestedFileName), ".pptx") {
		h.rejectImport(w, r, http.StatusBadRequest, "the upload is not named like a .pptx file")
		return
	}

	upload, uploadName, err := h.readUpload(r, mediaType, parameters["boundary"])
	if err != nil {
		if errors.Is(err, errBodyTooLarge) {
			sendJSON(w, r, http.StatusRequestEntityTooLarge, map[string]any{
				"error":   "PPTX_TOO_LARGE",
				"message": "The PowerPoint file is too large to import.",
			})
			return
		}
		h.rejectImport(w, r, http.StatusBadRequest, "the upload could not be read: "+err.Error())
		return
	}

	effectiveFileName := requestedFileName
	if effectiveFileName == "" {
		effectiveFileName = decodeHeaderFileName(uploadName)
	}
	if effectiveFileName == "" {
		// A raw-body upload need not name itself; the dev server falls back to
		// the same placeholder when no name reaches it either.
		effectiveFileName = "presentation.pptx"
	}
	if !strings.HasSuffix(strings.ToLower(effectiveFileName), ".pptx") {
		h.rejectImport(w, r, http.StatusBadRequest, "the upload is not named like a .pptx file")
		return
	}
	if len(upload) == 0 {
		h.rejectImport(w, r, http.StatusBadRequest, "the upload carried no data")
		return
	}
	if len(upload) > maxPptxImportBytes {
		sendJSON(w, r, http.StatusRequestEntityTooLarge, map[string]any{
			"error":   "PPTX_TOO_LARGE",
			"message": "The PowerPoint file is too large to import.",
		})
		return
	}
	// A PPTX is a ZIP container; rejecting anything without the local file
	// header here keeps a mislabeled upload from reaching the converter.
	if len(upload) < 2 || !strings.HasPrefix(string(upload[:2]), "PK") {
		h.rejectImport(w, r, http.StatusBadRequest, "the upload is not a PowerPoint (ZIP) container")
		return
	}
	sourceFileName := safePptxSourceName(effectiveFileName)

	fileID, err := h.allocateFileID()
	if err != nil {
		sendAPIError(w, r, newAPIError(http.StatusInternalServerError, "MOP_PACKAGE_WRITE_FAILED", err.Error()))
		return
	}
	stagingRoot := filepath.Join(h.store.root, "."+fileID+".importing")
	inputPath := stagingRoot + ".pptx"
	defer func() {
		_ = os.RemoveAll(stagingRoot)
		_ = os.Remove(inputPath)
	}()

	if err := os.MkdirAll(h.store.root, 0o755); err != nil {
		sendAPIError(w, r, newAPIError(http.StatusInternalServerError, "MOP_PACKAGE_WRITE_FAILED", err.Error()))
		return
	}
	_ = os.RemoveAll(stagingRoot)
	if err := os.WriteFile(inputPath, upload, 0o600); err != nil {
		sendAPIError(w, r, newAPIError(http.StatusInternalServerError, "MOP_PACKAGE_WRITE_FAILED", err.Error()))
		return
	}

	if err := h.runImport(r.Context(), inputPath, stagingRoot); err != nil {
		h.sendConversionError(w, r, err, "MOP_PACKAGE_WRITE_FAILED")
		return
	}
	content, err := validateImportedPackage(stagingRoot)
	if err != nil {
		h.sendConversionError(w, r, err, "MOP_PACKAGE_WRITE_FAILED")
		return
	}

	sourceSum := sha256.Sum256(upload)
	meta := metadata{
		SourceFileName: sourceFileName,
		Title:          presentationTitle(sourceFileName),
		SourceDigest:   "sha256:" + hex.EncodeToString(sourceSum[:]),
		ImportedAt:     h.now().UTC().Format(time.RFC3339Nano),
	}
	if err := writeMetadataAt(stagingRoot, meta); err != nil {
		sendAPIError(w, r, newAPIError(http.StatusInternalServerError, "MOP_PACKAGE_WRITE_FAILED", err.Error()))
		return
	}
	if err := writeRevisionAt(stagingRoot, 0, content, h.now()); err != nil {
		sendAPIError(w, r, newAPIError(http.StatusInternalServerError, "MOP_PACKAGE_WRITE_FAILED", err.Error()))
		return
	}
	if err := os.Rename(stagingRoot, h.store.packageRoot(fileID)); err != nil {
		sendAPIError(w, r, newAPIError(http.StatusInternalServerError, "MOP_PACKAGE_WRITE_FAILED", err.Error()))
		return
	}

	sendJSON(w, r, http.StatusCreated, map[string]any{
		"fileId": fileID,
		"title":  meta.Title,
		"route":  "/p/" + encodeURIComponent(fileID),
	})
}

// readUpload accepts both shapes of import request.
//
// The editor historically posted multipart/form-data, but a packaged app runs
// the editor behind a WKWebView custom scheme, and WebKit does not deliver a
// Blob-backed request body (FormData, File, Blob) to a custom scheme handler --
// the request arrives with its body silently emptied, while an ArrayBuffer body
// comes through intact. So the editor now posts raw bytes, and multipart stays
// supported for the Vite dev server, tests, and anything driving this API with
// a normal HTTP client.
func (h *Handler) readUpload(r *http.Request, mediaType, boundary string) ([]byte, string, error) {
	if mediaType == "multipart/form-data" && boundary != "" {
		return readMultipartFile(r, boundary)
	}
	upload, err := readLimitedBody(r, maxPptxImportBytes)
	return upload, "", err
}

// rejectImport answers with the contract's error code plus a reason. The dev
// server sends the bare code; the reason is added here because a packaged app
// has no other channel to explain itself -- an empty-bodied upload previously
// surfaced to the user only as the client's generic fallback text.
func (h *Handler) rejectImport(w http.ResponseWriter, r *http.Request, status int, reason string) {
	h.logf("import rejected: %s (content-type=%q)", reason, r.Header.Get("Content-Type"))
	sendJSON(w, r, status, map[string]any{
		"error":   "INVALID_PPTX_FILE",
		"message": "The PowerPoint file could not be imported: " + reason + ".",
	})
}

func (h *Handler) runImport(ctx context.Context, inputPath, packageDirectory string) error {
	if h.converter == nil {
		return &apiError{
			status:  http.StatusServiceUnavailable,
			code:    "MOP_CONVERTER_CLI_UNAVAILABLE",
			message: "The PPTX converter command-line tool is unavailable.",
		}
	}
	return h.converter.Import(ctx, inputPath, packageDirectory)
}

func (h *Handler) runExport(ctx context.Context, packageDirectory, outputPath string) error {
	if h.converter == nil {
		return &apiError{
			status:  http.StatusServiceUnavailable,
			code:    "MOP_CONVERTER_CLI_UNAVAILABLE",
			message: "The PPTX converter command-line tool is unavailable.",
		}
	}
	return h.converter.Export(ctx, packageDirectory, outputPath)
}

// validateImportedPackage confirms the converter produced something the editor
// can open, so a broken conversion fails at import time rather than leaving a
// package that errors every time it is opened.
func validateImportedPackage(packageRoot string) ([]byte, error) {
	content, err := readFileIfExists(filepath.Join(packageRoot, contentFileName))
	if err != nil {
		return nil, err
	}
	if content == nil {
		return nil, &apiError{
			status:  422,
			code:    "INVALID_MOP_PACKAGE",
			message: "The converter did not create an editable MOP package.",
			detail:  "The converted package is missing content.json.",
		}
	}
	if _, err := parseValidSnapshot(content); err != nil {
		return nil, &apiError{
			status:  422,
			code:    "INVALID_MOP_PACKAGE",
			message: "The converter created an invalid MOP package.",
			detail:  err.Error(),
		}
	}
	return content, nil
}

func (h *Handler) sendConversionError(w http.ResponseWriter, r *http.Request, err error, fallbackCode string) {
	h.logf("%s %s failed: %v", r.Method, r.URL.Path, err)
	sendConversionError(w, r, err, fallbackCode)
}

func sendConversionError(w http.ResponseWriter, r *http.Request, err error, fallbackCode string) {
	var typed *apiError
	if errors.As(err, &typed) {
		sendAPIError(w, r, typed)
		return
	}
	sendJSON(w, r, http.StatusInternalServerError, map[string]any{
		"error":   fallbackCode,
		"message": err.Error(),
	})
}

// ------------------------------------------------------------------------ export

func (h *Handler) exportPptx(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	fileID := query.Get("fileId")
	if !validFileID(fileID) || !h.store.exists(fileID) {
		sendJSON(w, r, http.StatusNotFound, map[string]any{"error": "MOP_CONTENT_NOT_FOUND"})
		return
	}
	requestedRevision, revisionOK := parseQueryRevision(query.Get("revision"))
	useNativeDownload := query.Get("delivery") == "native"

	requestedContent, err := readLimitedBody(r, maxSnapshotBytes)
	if err != nil {
		sendJSON(w, r, http.StatusRequestEntityTooLarge, map[string]any{"error": "PPTX_TOO_LARGE"})
		return
	}
	var includedResources map[string]bool
	if len(requestedContent) > 0 {
		if _, err := parseValidSnapshot(requestedContent); err != nil {
			sendAPIError(w, r, newAPIError(http.StatusBadRequest, "INVALID_MOP_CONTENT", "The PowerPoint export snapshot is not a MOP package."))
			return
		}
		includedResources, err = collectResourcePaths(requestedContent)
		if err != nil {
			sendAPIError(w, r, newAPIError(http.StatusBadRequest, "INVALID_MOP_CONTENT", "The PowerPoint export snapshot is not a MOP package."))
			return
		}
	} else {
		requestedContent = nil
	}

	exportID := fileID + "." + h.nextToken()
	exportRoot := filepath.Join(h.store.root, "."+exportID+".exporting")
	outputPath := filepath.Join(h.store.root, "."+exportID+".pptx")
	defer func() {
		_ = os.RemoveAll(exportRoot)
		_ = os.Remove(outputPath)
	}()

	var persistedRevision int64
	stageErr := h.store.withWriteLock(fileID, func() error {
		if err := os.RemoveAll(exportRoot); err != nil {
			return err
		}
		content, err := h.store.copyInto(fileID, exportRoot, includedResources, requestedContent)
		if err != nil {
			return err
		}
		persistedRevision = h.store.readRevision(fileID, content)
		// The editor sends the revision it believes is current. A mismatch
		// means the package changed underneath it, and exporting anyway would
		// hand the user a file that does not match what they see.
		if !revisionOK || requestedRevision != persistedRevision {
			return &apiError{
				status:   http.StatusConflict,
				code:     "MOP_REVISION_CONFLICT",
				revision: revisionOf(persistedRevision),
			}
		}
		return nil
	})
	if stageErr != nil {
		h.sendConversionError(w, r, stageErr, "MOP_PACKAGE_EXPORT_FAILED")
		return
	}

	sourceFileName := h.exportFileName(fileID)
	if err := h.runExport(r.Context(), exportRoot, outputPath); err != nil {
		h.sendConversionError(w, r, err, "MOP_PACKAGE_EXPORT_FAILED")
		return
	}
	output, err := os.ReadFile(outputPath)
	if err != nil || len(output) == 0 || !strings.HasPrefix(string(output[:min(2, len(output))]), "PK") {
		sendAPIError(w, r, newAPIError(http.StatusInternalServerError, "PPTX_GENERATION_FAILED", "The converter did not create a valid PowerPoint file."))
		return
	}

	if useNativeDownload {
		token := h.storePreparedExport(sourceFileName, output, persistedRevision)
		downloadPath := strings.TrimSuffix(r.URL.Path, "/export") + "/export-download"
		sendJSON(w, r, http.StatusOK, map[string]any{
			"downloadUrl": downloadPath + "?token=" + url.QueryEscape(token),
			"fileName":    sourceFileName,
			"revision":    persistedRevision,
		})
		return
	}

	applyCORS(w, r)
	header := w.Header()
	header.Set("Content-Type", pptxContentType)
	header.Set("Content-Disposition", "attachment; filename*=UTF-8''"+encodeURIComponent(sourceFileName))
	header.Set("Cache-Control", "no-store")
	header.Set("X-MOP-Revision", strconv.FormatInt(persistedRevision, 10))
	writeBody(w, r, http.StatusOK, output)
}

// exportFileName prefers the name the deck was imported from so a round trip
// gives the user back a file they recognize.
func (h *Handler) exportFileName(fileID string) string {
	if meta := h.store.readMetadata(fileID); meta != nil {
		if strings.TrimSpace(meta.SourceFileName) != "" {
			return safePptxSourceName(meta.SourceFileName)
		}
		if strings.TrimSpace(meta.Title) != "" {
			return safePptxSourceName(meta.Title + ".pptx")
		}
	}
	return safePptxSourceName(fileID + ".pptx")
}

func (h *Handler) storePreparedExport(fileName string, output []byte, revision int64) string {
	token := h.nextToken()
	h.mu.Lock()
	defer h.mu.Unlock()
	h.evictExpiredLocked()
	h.prepared[token] = &preparedExport{
		fileName: fileName,
		output:   output,
		revision: revision,
		expires:  h.now().Add(preparedExportTTL),
	}
	return token
}

// evictExpiredLocked drops exports the browser never fetched. Without it a
// long session that exports repeatedly would hold every generated deck in
// memory until the app exits.
func (h *Handler) evictExpiredLocked() {
	now := h.now()
	for token, prepared := range h.prepared {
		if now.After(prepared.expires) {
			delete(h.prepared, token)
		}
	}
}

func (h *Handler) downloadPreparedPptx(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	h.mu.Lock()
	h.evictExpiredLocked()
	prepared, ok := h.prepared[token]
	if ok {
		// A prepared export is single-use: the browser fetches it once through
		// a synthetic anchor click, and keeping it would pin the bytes.
		delete(h.prepared, token)
	}
	h.mu.Unlock()

	if token == "" || !ok {
		sendJSON(w, r, http.StatusNotFound, map[string]any{"error": "MOP_EXPORT_DOWNLOAD_NOT_FOUND"})
		return
	}

	applyCORS(w, r)
	header := w.Header()
	header.Set("Content-Type", pptxContentType)
	header.Set("Content-Disposition", "attachment; filename*=UTF-8''"+encodeURIComponent(prepared.fileName))
	header.Set("Cache-Control", "no-store")
	header.Set("X-MOP-Revision", strconv.FormatInt(prepared.revision, 10))
	writeBody(w, r, http.StatusOK, prepared.output)
}

// -------------------------------------------------------------- office-js export

func (h *Handler) exportOfficeJsSlide(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	fileID := query.Get("fileId")
	slideID := query.Get("slideId")
	if fileID == "" || slideID == "" || !validFileID(fileID) || !h.store.exists(fileID) {
		sendJSON(w, r, http.StatusNotFound, map[string]any{"error": "MOP_CONTENT_NOT_FOUND"})
		return
	}

	content, err := readLimitedBody(r, maxSnapshotBytes)
	if err != nil {
		sendJSON(w, r, http.StatusRequestEntityTooLarge, map[string]any{"error": "PPTX_TOO_LARGE"})
		return
	}
	if len(content) == 0 {
		sendJSON(w, r, http.StatusBadRequest, map[string]any{"error": "INVALID_MOP_CONTENT"})
		return
	}

	exportID := "office-js." + fileID + "." + h.nextToken()
	exportRoot := filepath.Join(h.store.root, "."+exportID+".exporting")
	outputPath := filepath.Join(h.store.root, "."+exportID+".pptx")
	defer func() {
		_ = os.RemoveAll(exportRoot)
		_ = os.Remove(outputPath)
	}()

	singleSlideContent, err := createSingleSlideSnapshot(content, slideID)
	if err != nil {
		h.sendConversionError(w, r, err, "MOP_SLIDE_EXPORT_FAILED")
		return
	}
	includedResources, err := collectResourcePaths(singleSlideContent)
	if err != nil {
		sendAPIError(w, r, newAPIError(http.StatusBadRequest, "INVALID_MOP_CONTENT", "The editor snapshot is not valid MOP JSON."))
		return
	}
	if err := os.RemoveAll(exportRoot); err != nil {
		h.sendConversionError(w, r, err, "MOP_SLIDE_EXPORT_FAILED")
		return
	}
	if _, err := h.store.copyInto(fileID, exportRoot, includedResources, singleSlideContent); err != nil {
		h.sendConversionError(w, r, err, "MOP_SLIDE_EXPORT_FAILED")
		return
	}
	if err := h.runExport(r.Context(), exportRoot, outputPath); err != nil {
		h.sendConversionError(w, r, err, "MOP_SLIDE_EXPORT_FAILED")
		return
	}
	output, err := os.ReadFile(outputPath)
	if err != nil || len(output) == 0 || !strings.HasPrefix(string(output[:min(2, len(output))]), "PK") {
		sendAPIError(w, r, newAPIError(http.StatusInternalServerError, "PPTX_GENERATION_FAILED", "The converter did not create a valid PowerPoint file."))
		return
	}

	applyCORS(w, r)
	header := w.Header()
	header.Set("Content-Type", pptxContentType)
	header.Set("Cache-Control", "no-store")
	writeBody(w, r, http.StatusOK, output)
}

// ------------------------------------------------------------------------ bodies

var errBodyTooLarge = errors.New("request body exceeds the allowed size")

// readLimitedBody reads at most limit bytes and reports anything larger as an
// error rather than silently truncating, which would corrupt a saved snapshot.
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

// readMultipartFile extracts the `file` part of the upload. The overall read is
// capped a megabyte above the PPTX limit so that an oversized upload is
// reported as too large instead of as a malformed request.
func readMultipartFile(r *http.Request, boundary string) ([]byte, string, error) {
	defer drainAndClose(r.Body)
	limited := io.LimitReader(r.Body, maxPptxImportBytes+1024*1024+1)
	reader := multipart.NewReader(limited, boundary)
	for {
		part, err := reader.NextPart()
		if errors.Is(err, io.EOF) {
			return nil, "", errors.New("multipart file field is missing")
		}
		if err != nil {
			return nil, "", err
		}
		if part.FormName() != "file" {
			_ = part.Close()
			continue
		}
		data, err := io.ReadAll(part)
		fileName := part.FileName()
		_ = part.Close()
		if err != nil {
			return nil, "", err
		}
		if len(data) > maxPptxImportBytes {
			return nil, "", errBodyTooLarge
		}
		return data, fileName, nil
	}
}

// --------------------------------------------------------------------- file names

var (
	utf8FileNamePattern   = regexp.MustCompile(`(?i)filename\*=UTF-8''([^;]+)`)
	quotedFileNamePattern = regexp.MustCompile(`(?i)filename="([^"]+)"`)
	bareFileNamePattern   = regexp.MustCompile(`(?i)filename=([^;]+)`)
	unsafeFileNamePattern = regexp.MustCompile(`[\x00-\x1f<>:"/\\|?*]+`)
)

func contentDispositionFileName(header string) string {
	if match := utf8FileNamePattern.FindStringSubmatch(header); match != nil {
		if decoded, err := url.QueryUnescape(match[1]); err == nil {
			return decoded
		}
	}
	if match := quotedFileNamePattern.FindStringSubmatch(header); match != nil {
		return match[1]
	}
	if match := bareFileNamePattern.FindStringSubmatch(header); match != nil {
		return strings.TrimSpace(match[1])
	}
	return ""
}

// decodeHeaderFileName undoes the encodeURIComponent the editor applies to the
// upload name. A value that is not valid percent-encoding is used verbatim,
// matching the dev server, so an unusual name still imports.
func decodeHeaderFileName(value string) string {
	if value == "" {
		return ""
	}
	decoded, err := url.QueryUnescape(value)
	if err != nil {
		return value
	}
	return decoded
}

// safePptxSourceName reduces an arbitrary name to something safe to write to
// disk and to put in a Content-Disposition header.
func safePptxSourceName(value string) string {
	if strings.TrimSpace(value) == "" {
		value = "presentation.pptx"
	}
	base := path.Base(filepath.ToSlash(value))
	normalized := unsafeFileNamePattern.ReplaceAllString(base, "_")
	if strings.HasSuffix(strings.ToLower(normalized), ".pptx") {
		return normalized
	}
	if normalized == "" || normalized == "." || normalized == ".." {
		normalized = "presentation"
	}
	return normalized + ".pptx"
}

func presentationTitle(fileName string) string {
	safe := safePptxSourceName(fileName)
	title := strings.TrimSpace(strings.TrimSuffix(safe, filepath.Ext(safe)))
	if title == "" {
		return "Presentation"
	}
	return title
}
