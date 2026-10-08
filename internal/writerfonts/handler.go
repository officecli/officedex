// Package writerfonts serves the Writer default-font closure that the embedded
// editor loads from /writer-next-default-fonts/.
//
// The closure is hundreds of megabytes, so it is staged into
// Contents/Resources/writer-fonts rather than into dist/, which main.go embeds
// into the binary verbatim. The semantics here mirror createStaticFontMiddleware
// in writer's scripts/vite/writer-next-default-fonts-plugin.ts: the editor
// caches prebuilt metrics by their content hash forever and revalidates the raw
// font files, and it expects the same precompressed sidecars to be negotiated.
package writerfonts

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// RoutePrefix is where the editor's resource loader is pointed
// (createDefaultFontResourceLoader({ baseUrl: '/writer-next-default-fonts/' })).
const RoutePrefix = "/writer-next-default-fonts/"

var (
	// prebuiltNamePattern matches the content-addressed metric bundles. Their
	// name is their hash, which is why they can be served immutable.
	prebuiltNamePattern = regexp.MustCompile(`^[0-9a-f]{64}\.json$`)
	// assetNamePattern is deliberately flat: files/ and draw/ hold one level of
	// font files, so a separator, a NUL, or a re-encoded escape is a probe
	// rather than a legitimate request.
	assetNamePattern = regexp.MustCompile(`^[^/\\\x00?#%]+$`)
)

type route struct {
	kind         string
	root         string
	cacheControl string
	namePattern  *regexp.Regexp
	immutable    bool
}

// Handler serves the staged font closure. It is safe for concurrent use.
type Handler struct {
	routes []route
	logger func(format string, args ...any)
}

// Options configures a Handler.
type Options struct {
	// Root is the staged closure directory, holding prebuilt/, files/ and draw/.
	Root string
	// Logger records why a request was refused.
	Logger func(format string, args ...any)
}

func New(options Options) *Handler {
	root := strings.TrimSpace(options.Root)
	return &Handler{
		routes: []route{
			{
				kind:         "prebuilt",
				root:         filepath.Join(root, "prebuilt"),
				cacheControl: "public, max-age=31536000, immutable",
				namePattern:  prebuiltNamePattern,
				immutable:    true,
			},
			{
				kind:         "files",
				root:         filepath.Join(root, "files"),
				cacheControl: "public, max-age=0, must-revalidate",
				namePattern:  assetNamePattern,
			},
			{
				kind:         "draw",
				root:         filepath.Join(root, "draw"),
				cacheControl: "public, max-age=0, must-revalidate",
				namePattern:  assetNamePattern,
			},
		},
		logger: options.Logger,
	}
}

// Handles reports whether a path belongs to this handler. main.go uses it to
// dispatch between the handlers sharing the asset server's single fallback.
func Handles(requestPath string) bool {
	return strings.HasPrefix(requestPath, RoutePrefix)
}

func (h *Handler) logf(format string, args ...any) {
	if h.logger == nil {
		return
	}
	h.logger(format, args...)
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	matched, name, ok := h.match(r.URL.Path)
	if !ok {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	decoded, err := decodePathSegment(name)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	if !matched.namePattern.MatchString(decoded) {
		h.logf("refused font path %q", r.URL.Path)
		http.NotFound(w, r)
		return
	}

	filePath := filepath.Join(matched.root, decoded)
	// Join already cleans the path, but the check is what makes that a
	// guarantee rather than a side effect of the pattern above.
	if !strings.HasPrefix(filePath, matched.root+string(filepath.Separator)) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	info, err := os.Stat(filePath)
	if err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}

	servePath := filePath
	serveSize := info.Size()
	encoding := "identity"
	if matched.immutable {
		w.Header().Set("Vary", "Accept-Encoding")
		negotiated, sidecarPath, sidecarSize, acceptable := negotiate(filePath, r.Header.Values("Accept-Encoding"))
		if !acceptable {
			// identity was explicitly refused and no sidecar was acceptable.
			w.WriteHeader(http.StatusNotAcceptable)
			return
		}
		if negotiated != "identity" {
			servePath = sidecarPath
			serveSize = sidecarSize
			encoding = negotiated
		}
	}

	etag, err := strongETag(servePath)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	header := w.Header()
	header.Set("ETag", etag)
	header.Set("Cache-Control", matched.cacheControl)
	header.Set("Content-Type", contentType(filePath))
	if encoding != "identity" {
		header.Set("Content-Encoding", encoding)
	}
	if ifNoneMatchMatches(r.Header.Values("If-None-Match"), etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}

	header.Set("Content-Length", strconv.FormatInt(serveSize, 10))
	if r.Method == http.MethodHead {
		w.WriteHeader(http.StatusOK)
		return
	}
	file, err := os.Open(servePath)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, file)
}

// match splits a request path into its delivery root and file name. Only the
// three known roots are recognized, and only one path segment below them.
func (h *Handler) match(requestPath string) (route, string, bool) {
	relative, ok := strings.CutPrefix(requestPath, RoutePrefix)
	if !ok {
		return route{}, "", false
	}
	kind, name, ok := strings.Cut(relative, "/")
	if !ok || name == "" || strings.Contains(name, "/") {
		return route{}, "", false
	}
	for _, candidate := range h.routes {
		if candidate.kind == kind {
			return candidate, name, true
		}
	}
	return route{}, "", false
}

// decodePathSegment undoes percent-encoding without accepting a re-encoded
// separator, which would otherwise slip past the name pattern.
func decodePathSegment(name string) (string, error) {
	decoded, err := decodeURIComponent(name)
	if err != nil {
		return "", err
	}
	return path.Clean(decoded), nil
}

type sidecar struct {
	suffix   string
	encoding string
}

// precompressedSidecars are what writeDefaultFontPrecompressedSidecars emits,
// in the order the middleware prefers them.
var precompressedSidecars = []sidecar{
	{suffix: ".br", encoding: "br"},
	{suffix: ".gz", encoding: "gzip"},
}

// negotiate picks the representation to send. Candidates are considered in the
// dev server's order -- br, gzip, then identity -- with a strict improvement
// required to displace the incumbent, so an `Accept-Encoding: gzip, br` that
// rates both equally still gets the smaller brotli body. It returns false only
// when the client refused identity and no acceptable sidecar exists, which is
// the one case that has to become a 406 rather than a fallback.
func negotiate(filePath string, acceptEncoding []string) (string, string, int64, bool) {
	qualities := parseAcceptEncoding(acceptEncoding)
	candidates := make([]sidecar, 0, len(precompressedSidecars)+1)
	candidates = append(candidates, precompressedSidecars...)
	candidates = append(candidates, sidecar{suffix: "", encoding: "identity"})

	best := ""
	bestPath := ""
	var bestSize int64
	bestQuality := 0.0
	for _, candidate := range candidates {
		quality := encodingQuality(qualities, candidate.encoding)
		if quality <= bestQuality {
			continue
		}
		info, err := os.Stat(filePath + candidate.suffix)
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		best = candidate.encoding
		bestPath = filePath + candidate.suffix
		bestSize = info.Size()
		bestQuality = quality
	}
	if best == "" {
		return "", "", 0, false
	}
	return best, bestPath, bestSize, true
}

var acceptEncodingPattern = regexp.MustCompile(
	`^\s*([!#$%&'*+\-.^_` + "`" + `|~0-9A-Za-z]+)\s*(?:;\s*[qQ]\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?))?\s*$`)

func parseAcceptEncoding(values []string) map[string]float64 {
	qualities := make(map[string]float64)
	for _, header := range values {
		for _, item := range strings.Split(header, ",") {
			match := acceptEncodingPattern.FindStringSubmatch(item)
			if match == nil {
				continue
			}
			encoding := strings.ToLower(match[1])
			quality := 1.0
			if match[2] != "" {
				parsed, err := strconv.ParseFloat(match[2], 64)
				if err != nil {
					continue
				}
				quality = parsed
			}
			if existing, ok := qualities[encoding]; !ok || quality > existing {
				qualities[encoding] = quality
			}
		}
	}
	return qualities
}

// encodingQuality resolves one encoding against the parsed header. identity is
// acceptable by default and only drops out when the client says so, which is
// what RFC 9110 requires and what the dev server implements.
func encodingQuality(qualities map[string]float64, encoding string) float64 {
	if explicit, ok := qualities[encoding]; ok {
		return explicit
	}
	wildcard, hasWildcard := qualities["*"]
	if encoding == "identity" {
		if hasWildcard && wildcard == 0 {
			return 0
		}
		return 1
	}
	if hasWildcard {
		return wildcard
	}
	return 0
}

func strongETag(filePath string) (string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer file.Close()
	digest := sha256.New()
	if _, err := io.Copy(digest, file); err != nil {
		return "", err
	}
	return `"` + hex.EncodeToString(digest.Sum(nil)) + `"`, nil
}

func ifNoneMatchMatches(values []string, etag string) bool {
	for _, header := range values {
		for _, candidate := range strings.Split(header, ",") {
			normalized := strings.TrimSpace(candidate)
			if normalized == "*" || normalized == etag || normalized == "W/"+etag {
				return true
			}
		}
	}
	return false
}

func contentType(filePath string) string {
	switch strings.ToLower(filepath.Ext(filePath)) {
	case ".json":
		return "application/json; charset=utf-8"
	case ".woff":
		return "font/woff"
	case ".woff2":
		return "font/woff2"
	case ".ttf":
		return "font/ttf"
	case ".otf":
		return "font/otf"
	}
	return "application/octet-stream"
}

// decodeURIComponent decodes percent escapes the way the dev server's
// decodeURIComponent does: a malformed escape is an error, and a plus sign is
// a literal plus rather than a space.
func decodeURIComponent(value string) (string, error) {
	if !strings.Contains(value, "%") {
		return value, nil
	}
	var builder strings.Builder
	for index := 0; index < len(value); index++ {
		if value[index] != '%' {
			builder.WriteByte(value[index])
			continue
		}
		if index+2 >= len(value) {
			return "", errBadEscape
		}
		decoded, err := hex.DecodeString(value[index+1 : index+3])
		if err != nil {
			return "", errBadEscape
		}
		builder.Write(decoded)
		index += 2
	}
	return builder.String(), nil
}

type escapeError struct{}

func (escapeError) Error() string { return "malformed percent-encoding" }

var errBadEscape = escapeError{}
