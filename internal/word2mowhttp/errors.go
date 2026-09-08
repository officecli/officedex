package word2mowhttp

import (
	"encoding/json"
	"fmt"
	"net/http"
)

// apiError is a failure that maps onto a specific HTTP status and error code.
// The Writer embed reads the response body as text and appends it to the
// message it shows, so the code and detail are what a user ends up seeing when
// a conversion fails.
type apiError struct {
	status  int
	code    string
	message string
	detail  string
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

func (e *apiError) body() map[string]any {
	payload := map[string]any{"error": e.code}
	if e.message != "" {
		payload["message"] = e.message
	}
	if e.detail != "" {
		payload["detail"] = e.detail
	}
	return payload
}

// applyCORS mirrors mophttp's handling. The embed is same-origin so these are
// not strictly required, but a mismatch would surface as an opaque network
// failure rather than the converter's actual error.
func applyCORS(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")
	if origin == "" {
		host := r.Host
		if host == "" {
			host = "127.0.0.1:3100"
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
		encoded = []byte(`{"error":"WORD2MOW_INTERNAL_ERROR"}`)
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
	w.Header().Set("Allow", "POST, OPTIONS")
	sendJSON(w, r, http.StatusMethodNotAllowed, map[string]any{"error": "METHOD_NOT_ALLOWED"})
}
