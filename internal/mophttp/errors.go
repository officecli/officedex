package mophttp

import (
	"encoding/json"
	"fmt"
	"net/http"
)

// apiError is a failure that maps onto a specific HTTP status and error code.
// The editor branches on the `error` field of the JSON body (see
// template-content-api.ts's LocalMopApiError), so the codes here are part of
// the contract rather than diagnostics.
type apiError struct {
	status  int
	code    string
	message string
	detail  string
	// revision carries the persisted revision on a conflict, which the editor
	// uses to resynchronize instead of retrying blindly.
	revision *int64
}

func (e *apiError) Error() string {
	if e.message != "" {
		return fmt.Sprintf("%s: %s", e.code, e.message)
	}
	return e.code
}

func newAPIError(status int, code, message string) *apiError {
	return &apiError{status: status, code: code, message: message}
}

// body renders the error the way the dev server does: `error` is always
// present, and `message`/`detail`/`revision` only appear when set, because the
// editor treats an empty string as a real (empty) message.
func (e *apiError) body() map[string]any {
	payload := map[string]any{"error": e.code}
	if e.message != "" {
		payload["message"] = e.message
	}
	if e.detail != "" {
		payload["detail"] = e.detail
	}
	if e.revision != nil {
		payload["revision"] = *e.revision
	}
	return payload
}

func revisionOf(value int64) *int64 { return &value }

// corsHeaders mirrors the dev server's headers. The embedded editor is
// same-origin so these are not strictly required, but a mismatch would show up
// as an opaque network failure rather than a clear error, and reflecting the
// request origin costs nothing.
func applyCORS(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")
	if origin == "" {
		host := r.Host
		if host == "" {
			host = "127.0.0.1:4176"
		}
		origin = "http://" + host
	}
	header := w.Header()
	header.Set("Access-Control-Allow-Origin", origin)
	header.Set("Access-Control-Allow-Credentials", "true")
	header.Set("Vary", "Origin")
}

func sendJSON(w http.ResponseWriter, r *http.Request, status int, payload any) {
	applyCORS(w, r)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	encoded, err := json.Marshal(payload)
	if err != nil {
		// A payload built entirely from strings and numbers cannot fail to
		// marshal; fall back rather than leaving the request hanging.
		encoded = []byte(`{"error":"MOP_INTERNAL_ERROR"}`)
		status = http.StatusInternalServerError
	}
	w.Header().Set("Content-Length", fmt.Sprint(len(encoded)))
	w.WriteHeader(status)
	_, _ = w.Write(encoded)
}

func sendAPIError(w http.ResponseWriter, r *http.Request, err *apiError) {
	sendJSON(w, r, err.status, err.body())
}

func sendMethodNotAllowed(w http.ResponseWriter, r *http.Request) {
	sendJSON(w, r, http.StatusMethodNotAllowed, map[string]any{"error": "METHOD_NOT_ALLOWED"})
}
