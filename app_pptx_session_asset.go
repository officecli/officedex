package main

import (
	"net/http"
	"strconv"
	"strings"
)

// pptxSessionAssetRoute is where the embedded presentation editor loads
// package assets from: its asset base URL plus the path inside the package,
// with the editor session's file ID in the query.
const pptxSessionAssetRoute = "/api/osuite/mop/assets/"

// servePptxSessionAsset answers an asset load for a deck that is open in a
// PPTX editor session, and reports whether it did.
//
// These loads come from image elements, which the frame's host bridge cannot
// intercept. Assets present when the deck was opened never get this far: they
// are inlined into the document. A picture added while the deck is open — the
// ones a generation draws live — has only its package path, so without this
// it is requested here, misses, and is painted as nothing.
func (a *App) servePptxSessionAsset(w http.ResponseWriter, r *http.Request) bool {
	if a.pptxEditorService == nil || (r.Method != http.MethodGet && r.Method != http.MethodHead) {
		return false
	}
	// The route may sit behind the editor's cluster proxy prefix.
	at := strings.Index(r.URL.Path, pptxSessionAssetRoute)
	if at < 0 {
		return false
	}
	sessionID := r.URL.Query().Get("fileId")
	relativePath := r.URL.Path[at+len(pptxSessionAssetRoute):]
	if sessionID == "" || relativePath == "" {
		return false
	}
	data, contentType, err := a.pptxEditorService.ReadAsset(sessionID, relativePath)
	if err != nil {
		return false
	}
	header := w.Header()
	header.Set("Content-Type", contentType)
	header.Set("Content-Length", strconv.Itoa(len(data)))
	header.Set("X-Content-Type-Options", "nosniff")
	// Session assets are written once under a content-derived name, and the
	// session ID in the URL retires with the session.
	header.Set("Cache-Control", "private, max-age=31536000, immutable")
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodGet {
		_, _ = w.Write(data)
	}
	return true
}
