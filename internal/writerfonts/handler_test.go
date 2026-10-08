package writerfonts

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

const prebuiltName = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.json"

func stageClosure(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	for _, kind := range []string{"prebuilt", "files", "draw"} {
		if err := os.MkdirAll(filepath.Join(root, kind), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	write(t, filepath.Join(root, "prebuilt", prebuiltName), []byte(`{"metrics":1}`))
	write(t, filepath.Join(root, "prebuilt", prebuiltName+".br"), []byte("brotli-bytes"))
	write(t, filepath.Join(root, "prebuilt", prebuiltName+".gz"), gzipped(t, []byte(`{"metrics":1}`)))
	write(t, filepath.Join(root, "files", "Arial.woff"), []byte("woff"))
	write(t, filepath.Join(root, "draw", "CambriaMath.woff"), []byte("draw-woff"))
	return root
}

func write(t *testing.T, path string, content []byte) {
	t.Helper()
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatal(err)
	}
}

func gzipped(t *testing.T, content []byte) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := gzip.NewWriter(&buffer)
	if _, err := writer.Write(content); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func get(handler http.Handler, path string, headers map[string]string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodGet, path, nil)
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}

func TestPrebuiltIsImmutableAndIdentityByDefault(t *testing.T) {
	handler := New(Options{Root: stageClosure(t)})

	recorder := get(handler, RoutePrefix+"prebuilt/"+prebuiltName, nil)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d", recorder.Code)
	}
	if got := recorder.Header().Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Fatalf("cache-control = %q", got)
	}
	if got := recorder.Header().Get("Vary"); got != "Accept-Encoding" {
		t.Fatalf("vary = %q", got)
	}
	if got := recorder.Header().Get("Content-Encoding"); got != "" {
		t.Fatalf("content-encoding = %q, want identity (absent)", got)
	}
	if recorder.Body.String() != `{"metrics":1}` {
		t.Fatalf("body = %q", recorder.Body)
	}
	digest := sha256.Sum256([]byte(`{"metrics":1}`))
	if want := `"` + hex.EncodeToString(digest[:]) + `"`; recorder.Header().Get("ETag") != want {
		t.Fatalf("etag = %q, want %q", recorder.Header().Get("ETag"), want)
	}
}

// The sidecars are the whole point of precompressing 38 MB of metrics; serving
// identity to a browser that asked for br would undo that.
func TestPrebuiltNegotiatesBrotliThenGzip(t *testing.T) {
	handler := New(Options{Root: stageClosure(t)})

	brotli := get(handler, RoutePrefix+"prebuilt/"+prebuiltName, map[string]string{"Accept-Encoding": "gzip, deflate, br"})
	if brotli.Header().Get("Content-Encoding") != "br" {
		t.Fatalf("content-encoding = %q, want br", brotli.Header().Get("Content-Encoding"))
	}
	if brotli.Body.String() != "brotli-bytes" {
		t.Fatalf("body = %q, want the .br sidecar", brotli.Body)
	}

	gzipOnly := get(handler, RoutePrefix+"prebuilt/"+prebuiltName, map[string]string{"Accept-Encoding": "gzip"})
	if gzipOnly.Header().Get("Content-Encoding") != "gzip" {
		t.Fatalf("content-encoding = %q, want gzip", gzipOnly.Header().Get("Content-Encoding"))
	}
}

// The ETag must describe what was actually sent, or a cached brotli body would
// be revalidated against the identity hash and served as garbage.
func TestSidecarETagDescribesTheEncodedBytes(t *testing.T) {
	handler := New(Options{Root: stageClosure(t)})

	recorder := get(handler, RoutePrefix+"prebuilt/"+prebuiltName, map[string]string{"Accept-Encoding": "br"})

	digest := sha256.Sum256([]byte("brotli-bytes"))
	if want := `"` + hex.EncodeToString(digest[:]) + `"`; recorder.Header().Get("ETag") != want {
		t.Fatalf("etag = %q, want the sidecar's digest %q", recorder.Header().Get("ETag"), want)
	}
}

func TestIfNoneMatchIs304(t *testing.T) {
	handler := New(Options{Root: stageClosure(t)})

	first := get(handler, RoutePrefix+"files/Arial.woff", nil)
	second := get(handler, RoutePrefix+"files/Arial.woff", map[string]string{"If-None-Match": first.Header().Get("ETag")})

	if second.Code != http.StatusNotModified {
		t.Fatalf("status = %d", second.Code)
	}
	if second.Body.Len() != 0 {
		t.Fatalf("304 carried a body of %d bytes", second.Body.Len())
	}
}

func TestFontFilesRevalidate(t *testing.T) {
	handler := New(Options{Root: stageClosure(t)})

	for _, path := range []string{RoutePrefix + "files/Arial.woff", RoutePrefix + "draw/CambriaMath.woff"} {
		recorder := get(handler, path, nil)
		if recorder.Code != http.StatusOK {
			t.Fatalf("%s: status = %d", path, recorder.Code)
		}
		if got := recorder.Header().Get("Cache-Control"); got != "public, max-age=0, must-revalidate" {
			t.Fatalf("%s: cache-control = %q", path, got)
		}
		if got := recorder.Header().Get("Content-Type"); got != "font/woff" {
			t.Fatalf("%s: content-type = %q", path, got)
		}
	}
}

// files/ and draw/ have no sidecars staged, so a request for them must not
// claim an encoding it cannot deliver.
func TestFontFilesAreNeverContentEncoded(t *testing.T) {
	handler := New(Options{Root: stageClosure(t)})

	recorder := get(handler, RoutePrefix+"files/Arial.woff", map[string]string{"Accept-Encoding": "br, gzip"})

	if got := recorder.Header().Get("Content-Encoding"); got != "" {
		t.Fatalf("content-encoding = %q", got)
	}
}

func TestRefusingIdentityIs406(t *testing.T) {
	handler := New(Options{Root: stageClosure(t)})

	recorder := get(handler, RoutePrefix+"prebuilt/"+prebuiltName, map[string]string{"Accept-Encoding": "identity;q=0, *;q=0"})

	if recorder.Code != http.StatusNotAcceptable {
		t.Fatalf("status = %d", recorder.Code)
	}
}

// The name pattern is what keeps a probe from walking out of the closure, so it
// has to reject the encoded forms too.
func TestUnsafePathsAreRefused(t *testing.T) {
	handler := New(Options{Root: stageClosure(t)})

	for _, path := range []string{
		RoutePrefix + "files/../../etc/passwd",
		RoutePrefix + "files/%2e%2e%2fpasswd",
		RoutePrefix + "files/nested/Arial.woff",
		RoutePrefix + "prebuilt/not-a-hash.json",
		RoutePrefix + "secrets/key.pem",
		RoutePrefix + "files/",
	} {
		if recorder := get(handler, path, nil); recorder.Code != http.StatusNotFound {
			t.Fatalf("%s: status = %d, want 404", path, recorder.Code)
		}
	}
}

func TestMalformedEscapeIs400(t *testing.T) {
	handler := New(Options{Root: stageClosure(t)})

	// httptest.NewRequest parses the target, so build the URL path directly to
	// keep the broken escape intact.
	request := httptest.NewRequest(http.MethodGet, "http://localhost/", nil)
	request.URL.Path = RoutePrefix + "files/Arial%zz.woff"
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d", recorder.Code)
	}
}

func TestHeadOmitsTheBodyButKeepsTheLength(t *testing.T) {
	handler := New(Options{Root: stageClosure(t)})

	request := httptest.NewRequest(http.MethodHead, RoutePrefix+"files/Arial.woff", nil)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d", recorder.Code)
	}
	if got := recorder.Header().Get("Content-Length"); got != "4" {
		t.Fatalf("content-length = %q", got)
	}
	if recorder.Body.Len() != 0 {
		t.Fatalf("HEAD carried a body of %d bytes", recorder.Body.Len())
	}
}

func TestWriteMethodsAreRejected(t *testing.T) {
	handler := New(Options{Root: stageClosure(t)})

	request := httptest.NewRequest(http.MethodPost, RoutePrefix+"files/Arial.woff", nil)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d", recorder.Code)
	}
	if allow := recorder.Header().Get("Allow"); allow != "GET, HEAD" {
		t.Fatalf("allow = %q", allow)
	}
}

// Like the other asset-server fallbacks, this must not answer for paths outside
// its own prefix.
func TestForeignPathsAre404(t *testing.T) {
	handler := New(Options{Root: stageClosure(t)})

	if recorder := get(handler, "/api/import", nil); recorder.Code != http.StatusNotFound {
		t.Fatalf("status = %d", recorder.Code)
	}
	if Handles("/api/import") {
		t.Fatal("Handles claimed a path outside the font prefix")
	}
	if !Handles(RoutePrefix + "files/Arial.woff") {
		t.Fatal("Handles rejected a font path")
	}
}

// A build that forgot to stage the closure must 404 rather than panic; the
// editor falls back to its own error surface from there.
func TestMissingClosureIs404(t *testing.T) {
	handler := New(Options{Root: filepath.Join(t.TempDir(), "absent")})

	if recorder := get(handler, RoutePrefix+"files/Arial.woff", nil); recorder.Code != http.StatusNotFound {
		t.Fatalf("status = %d", recorder.Code)
	}
}
