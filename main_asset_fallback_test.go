package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"officedex/internal/pptxeditor"
	"officedex/internal/word2mowhttp"
	"officedex/internal/writerfonts"
)

type recordingHandler struct{ hits int }

func (h *recordingHandler) ServeHTTP(w http.ResponseWriter, _ *http.Request) {
	h.hits++
	w.WriteHeader(http.StatusOK)
}

// The asset server has one fallback slot for three APIs, so a path landing on
// the wrong handler shows up as a 404 the caller cannot explain. Pin the
// routing rather than trusting each handler's own prefix check to sort it out.
func TestAssetFallbackRoutesByPrefix(t *testing.T) {
	mop := &recordingHandler{}
	word2mow := &recordingHandler{}
	fonts := &recordingHandler{}
	handler := newAssetFallbackHandler(&App{
		mopHTTPHandler:      mop,
		word2mowHTTPHandler: word2mow,
		writerFontsHandler:  fonts,
	})

	for _, testCase := range []struct {
		path   string
		method string
		want   *recordingHandler
	}{
		{path: word2mowhttp.ImportRoute, method: http.MethodPost, want: word2mow},
		{path: word2mowhttp.ExportRoute, method: http.MethodPost, want: word2mow},
		{path: writerfonts.RoutePrefix + "files/Arial.woff", method: http.MethodGet, want: fonts},
		{path: writerfonts.RoutePrefix + "prebuilt/x.json", method: http.MethodGet, want: fonts},
		{path: "/api/osuite/mop/content", method: http.MethodGet, want: mop},
		// The MOP handler strips the editor's cluster proxy prefix itself, so
		// anything unrecognized has to reach it rather than being 404'd here.
		{path: "/proxy/docs/api/osuite/mop/content", method: http.MethodGet, want: mop},
		{path: "/anything-else", method: http.MethodGet, want: mop},
	} {
		before := testCase.want.hits
		request := httptest.NewRequest(testCase.method, testCase.path, nil)
		handler.ServeHTTP(httptest.NewRecorder(), request)
		if testCase.want.hits != before+1 {
			t.Fatalf("%s %s did not reach its handler", testCase.method, testCase.path)
		}
	}

	if mop.hits != 3 || word2mow.hits != 2 || fonts.hits != 2 {
		t.Fatalf("hits: mop=%d word2mow=%d fonts=%d", mop.hits, word2mow.hits, fonts.hits)
	}
}

// A picture drawn into an open deck is loaded by an image element from the MOP
// asset route. The MOP store does not know editor sessions, so the session has
// to answer first — and everything it cannot answer must still reach the MOP
// handler exactly as before.
func TestAssetFallbackServesAnOpenSessionsAssets(t *testing.T) {
	mop := &recordingHandler{}
	editor := &fakePptxEditorService{readAsset: func(session, relativePath string) ([]byte, string, error) {
		if session != "session-1" || relativePath != "media/abc.png" {
			return nil, "", pptxeditor.ErrSessionMismatch
		}
		return []byte("png-bytes"), "image/png", nil
	}}
	handler := newAssetFallbackHandler(&App{
		mopHTTPHandler:      mop,
		word2mowHTTPHandler: &recordingHandler{},
		writerFontsHandler:  &recordingHandler{},
		pptxEditorService:   editor,
	})

	for _, path := range []string{
		"/api/osuite/mop/assets/media/abc.png?fileId=session-1",
		"/proxy/docs/api/osuite/mop/assets/media/abc.png?fileId=session-1",
	} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusOK || response.Body.String() != "png-bytes" || response.Header().Get("Content-Type") != "image/png" {
			t.Fatalf("GET %s = %d %q (%s)", path, response.Code, response.Body.String(), response.Header().Get("Content-Type"))
		}
	}
	if mop.hits != 0 {
		t.Fatalf("a session asset reached the MOP handler %d times", mop.hits)
	}

	head := httptest.NewRecorder()
	handler.ServeHTTP(head, httptest.NewRequest(http.MethodHead, "/api/osuite/mop/assets/media/abc.png?fileId=session-1", nil))
	if head.Code != http.StatusOK || head.Body.Len() != 0 || head.Header().Get("Content-Length") != "9" {
		t.Fatalf("HEAD = %d, %d body bytes, length %q", head.Code, head.Body.Len(), head.Header().Get("Content-Length"))
	}

	for _, testCase := range []struct{ method, path string }{
		{http.MethodGet, "/api/osuite/mop/assets/media/abc.png?fileId=a-mop-package"},
		{http.MethodGet, "/api/osuite/mop/assets/media/other.png?fileId=session-1"},
		{http.MethodGet, "/api/osuite/mop/assets/media/abc.png"},
		{http.MethodPut, "/api/osuite/mop/assets/media/abc.png?fileId=session-1"},
	} {
		before := mop.hits
		handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(testCase.method, testCase.path, nil))
		if mop.hits != before+1 {
			t.Fatalf("%s %s did not fall through to the MOP handler", testCase.method, testCase.path)
		}
	}
}

// A nil app means the asset server serves only the embedded bundle; handing it
// a handler that dereferences nil fields would crash on the first request.
func TestAssetFallbackIsNilWithoutAnApp(t *testing.T) {
	if handler := newAssetFallbackHandler(nil); handler != nil {
		t.Fatal("newAssetFallbackHandler(nil) returned a handler")
	}
}
