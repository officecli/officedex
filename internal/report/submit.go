// Package report implements minimal issue-report submission for OfficeDex.
//
// The minimal flow uploads a tiny JSON pointer (request_id + user description
// + minimal context) rather than a multipart bundle, so the server can index
// the report by request_id against its own logs without absorbing arbitrary
// payload size.
package report

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// MaxPayloadBytes caps the serialized JSON payload sent to the server. 4 KiB
// fits a 500-character CJK description plus the metadata fields with
// headroom; anything larger is a misuse of the report channel.
const MaxPayloadBytes = 4096

// ErrPayloadTooLarge is returned when the marshaled JSON payload exceeds
// MaxPayloadBytes.
var ErrPayloadTooLarge = errors.New("report: payload exceeds 4 KiB limit")

// ReportPayload is the wire shape uploaded to the support endpoint. Field
// names use camelCase to match the existing server contract. Metadata that
// the User-Agent / X-Client-* headers already carry (app version, os, arch,
// bundle schema) is intentionally not duplicated here.
type ReportPayload struct {
	RequestID    string `json:"requestId,omitempty"`
	TaskID       string `json:"taskId,omitempty"`
	RuntimeMode  string `json:"runtimeMode,omitempty"`
	ErrorCode    string `json:"errorCode,omitempty"`
	ErrorMessage string `json:"errorMessage,omitempty"`
	Description  string `json:"description"`
	ContactEmail string `json:"contactEmail,omitempty"`
	Timestamp    string `json:"timestamp"`
	Via          string `json:"via"`
}

// SubmitResult is what a Submitter returns on success.
type SubmitResult struct {
	TicketID string `json:"ticketId"`
	ViewURL  string `json:"viewUrl,omitempty"`
	Uploaded bool   `json:"uploaded"`
}

// Submitter abstracts the upload transport so callers can mock in tests.
type Submitter interface {
	Submit(ctx context.Context, payload ReportPayload) (SubmitResult, error)
}

// errUnsupportedSchema flags the well-known server rejection so the caller
// can surface it distinctly to the user.
var errUnsupportedSchema = errors.New("report: server rejected payload schema (unsupported_schema)")

// ErrUnsupportedSchema is the sentinel returned when the server rejects the
// payload for schema reasons.
func ErrUnsupportedSchema() error { return errUnsupportedSchema }

// HTTPOptions configures httpSubmitter. Endpoint is required. Token is
// optional. HTTPClient may be overridden for tests; nil falls back to a
// 30s-timeout default. UserAgent and BundleSchema propagate as request
// headers instead of duplicating in the body.
type HTTPOptions struct {
	Endpoint     string
	Token        string
	HTTPClient   *http.Client
	UserAgent    string
	BundleSchema string
}

type httpSubmitter struct {
	opts HTTPOptions
}

// NewHTTPSubmitter returns a Submitter that POSTs ReportPayload as JSON.
func NewHTTPSubmitter(opts HTTPOptions) Submitter {
	if opts.HTTPClient == nil {
		opts.HTTPClient = &http.Client{Timeout: 30 * time.Second}
	}
	if opts.UserAgent == "" {
		opts.UserAgent = "OfficeDex/unknown"
	}
	if opts.BundleSchema == "" {
		opts.BundleSchema = "1"
	}
	return &httpSubmitter{opts: opts}
}

type httpResponse struct {
	TicketID string `json:"ticketId"`
	ViewURL  string `json:"viewUrl,omitempty"`
}

func (h *httpSubmitter) Submit(ctx context.Context, payload ReportPayload) (SubmitResult, error) {
	if strings.TrimSpace(h.opts.Endpoint) == "" {
		return SubmitResult{}, errors.New("report: http endpoint is empty")
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return SubmitResult{}, fmt.Errorf("report: marshal payload: %w", err)
	}
	if len(body) > MaxPayloadBytes {
		return SubmitResult{}, ErrPayloadTooLarge
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, h.opts.Endpoint, bytes.NewReader(body))
	if err != nil {
		return SubmitResult{}, fmt.Errorf("report: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", h.opts.UserAgent)
	req.Header.Set("X-Client-Bundle-Schema", h.opts.BundleSchema)
	if h.opts.Token != "" {
		req.Header.Set("Authorization", "Bearer "+h.opts.Token)
	}

	resp, err := h.opts.HTTPClient.Do(req)
	if err != nil {
		return SubmitResult{}, fmt.Errorf("report: http post: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode == http.StatusUnsupportedMediaType ||
		strings.Contains(strings.ToLower(string(respBody)), "unsupported_schema") {
		return SubmitResult{}, errUnsupportedSchema
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg := strings.TrimSpace(string(respBody))
		if msg == "" {
			msg = fmt.Sprintf("status %d", resp.StatusCode)
		}
		return SubmitResult{}, fmt.Errorf("report: http %d: %s", resp.StatusCode, msg)
	}
	var parsed httpResponse
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return SubmitResult{}, fmt.Errorf("report: parse http response: %w", err)
	}
	if parsed.TicketID == "" {
		return SubmitResult{}, errors.New("report: http response missing ticketId")
	}
	return SubmitResult{TicketID: parsed.TicketID, ViewURL: parsed.ViewURL, Uploaded: true}, nil
}
