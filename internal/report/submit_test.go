package report

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func basePayload() ReportPayload {
	return ReportPayload{
		RequestID:    "req-001",
		TaskID:       "task-9",
		RuntimeMode:  "hosted",
		ErrorCode:    "rate_limit",
		ErrorMessage: "too many requests",
		Description:  "things broke when I tried to generate the PPTX",
		ContactEmail: "u@example.com",
		Timestamp:    "2026-05-24T00:00:00Z",
		Via:          "http",
	}
}

func TestHTTPSubmitterSuccessPostsJSON(t *testing.T) {
	var (
		gotBody    []byte
		gotHeaders http.Header
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotBody, _ = io.ReadAll(r.Body)
		gotHeaders = r.Header.Clone()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ticketId":"H-1","viewUrl":"https://srv/H-1"}`))
	}))
	defer srv.Close()

	sub := NewHTTPSubmitter(HTTPOptions{
		Endpoint:     srv.URL,
		Token:        "tok-1",
		UserAgent:    "OfficeDex/1.2.3 (darwin; arm64)",
		BundleSchema: "1",
	})
	res, err := sub.Submit(context.Background(), basePayload())
	if err != nil {
		t.Fatalf("Submit: %v", err)
	}
	if !res.Uploaded || res.TicketID != "H-1" || res.ViewURL != "https://srv/H-1" {
		t.Errorf("unexpected result: %+v", res)
	}
	if got := gotHeaders.Get("Content-Type"); got != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", got)
	}
	if got := gotHeaders.Get("Authorization"); got != "Bearer tok-1" {
		t.Errorf("Authorization = %q, want Bearer tok-1", got)
	}
	if got := gotHeaders.Get("User-Agent"); got != "OfficeDex/1.2.3 (darwin; arm64)" {
		t.Errorf("User-Agent = %q", got)
	}
	if got := gotHeaders.Get("X-Client-Bundle-Schema"); got != "1" {
		t.Errorf("X-Client-Bundle-Schema = %q", got)
	}
	if len(gotBody) > MaxPayloadBytes {
		t.Errorf("body size = %d, want <= %d", len(gotBody), MaxPayloadBytes)
	}
	var parsed map[string]any
	if err := json.Unmarshal(gotBody, &parsed); err != nil {
		t.Fatalf("body is not JSON: %v", err)
	}
	for _, want := range []string{"requestId", "taskId", "runtimeMode", "errorCode", "errorMessage", "description", "contactEmail", "timestamp", "via"} {
		if _, ok := parsed[want]; !ok {
			t.Errorf("payload missing %q field", want)
		}
	}
	if parsed["via"] != "http" {
		t.Errorf("via = %v, want http", parsed["via"])
	}
	for _, banned := range []string{"source", "bundleId", "os", "arch", "appVersion", "bundleSchemaVersion"} {
		if _, ok := parsed[banned]; ok {
			t.Errorf("payload must not contain %q (header-only or removed)", banned)
		}
	}
}

func TestHTTPSubmitterEmptyEndpoint(t *testing.T) {
	sub := NewHTTPSubmitter(HTTPOptions{})
	_, err := sub.Submit(context.Background(), basePayload())
	if err == nil {
		t.Fatal("expected error on empty endpoint")
	}
}

func TestHTTPSubmitter4xx(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(400)
		_, _ = w.Write([]byte(`{"error":"bad"}`))
	}))
	defer srv.Close()

	sub := NewHTTPSubmitter(HTTPOptions{Endpoint: srv.URL})
	_, err := sub.Submit(context.Background(), basePayload())
	if err == nil {
		t.Fatal("expected error on 4xx")
	}
	if !strings.Contains(err.Error(), "400") {
		t.Errorf("expected status in error: %v", err)
	}
}

func TestHTTPSubmitter5xx(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(503)
		_, _ = w.Write([]byte(`upstream offline`))
	}))
	defer srv.Close()

	sub := NewHTTPSubmitter(HTTPOptions{Endpoint: srv.URL})
	_, err := sub.Submit(context.Background(), basePayload())
	if err == nil {
		t.Fatal("expected error on 5xx")
	}
	if !strings.Contains(err.Error(), "503") {
		t.Errorf("expected status in error: %v", err)
	}
}

func TestHTTPSubmitterUnsupportedSchema(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnsupportedMediaType)
		_, _ = w.Write([]byte(`{"error":"unsupported_schema"}`))
	}))
	defer srv.Close()

	sub := NewHTTPSubmitter(HTTPOptions{Endpoint: srv.URL})
	_, err := sub.Submit(context.Background(), basePayload())
	if !errors.Is(err, ErrUnsupportedSchema()) {
		t.Errorf("expected unsupported_schema sentinel, got %v", err)
	}
}

func TestHTTPSubmitterNetworkError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	srv.Close()
	sub := NewHTTPSubmitter(HTTPOptions{Endpoint: srv.URL})
	_, err := sub.Submit(context.Background(), basePayload())
	if err == nil {
		t.Fatal("expected network error")
	}
}

func TestHTTPSubmitterMissingTicketID(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"viewUrl":"https://srv"}`))
	}))
	defer srv.Close()

	sub := NewHTTPSubmitter(HTTPOptions{Endpoint: srv.URL})
	_, err := sub.Submit(context.Background(), basePayload())
	if err == nil {
		t.Fatal("expected missing-ticketId error")
	}
}

func TestHTTPSubmitterCJKDescriptionUnderLimit(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if len(body) > MaxPayloadBytes {
			t.Errorf("body size = %d, want <= %d", len(body), MaxPayloadBytes)
		}
		_, _ = w.Write([]byte(`{"ticketId":"H-2"}`))
	}))
	defer srv.Close()

	payload := basePayload()
	payload.Description = strings.Repeat("中", 500)

	sub := NewHTTPSubmitter(HTTPOptions{Endpoint: srv.URL})
	if _, err := sub.Submit(context.Background(), payload); err != nil {
		t.Fatalf("Submit: %v", err)
	}
}

func TestHTTPSubmitterRejectsOversizedPayload(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("server should not be reached for oversized payload")
	}))
	defer srv.Close()

	payload := basePayload()
	payload.Description = strings.Repeat("x", MaxPayloadBytes+1)

	sub := NewHTTPSubmitter(HTTPOptions{Endpoint: srv.URL})
	_, err := sub.Submit(context.Background(), payload)
	if !errors.Is(err, ErrPayloadTooLarge) {
		t.Errorf("expected ErrPayloadTooLarge, got %v", err)
	}
}

func TestReportPayloadJSONShape(t *testing.T) {
	b, err := json.Marshal(ReportPayload{
		Description: "x",
		Timestamp:   "t",
		Via:         "http",
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, banned := range []string{"requestId", "taskId", "runtimeMode", "errorCode", "errorMessage", "contactEmail"} {
		if strings.Contains(string(b), banned) {
			t.Errorf("expected %q to omit when empty, got %s", banned, b)
		}
	}
	for _, want := range []string{`"description":"x"`, `"timestamp":"t"`, `"via":"http"`} {
		if !strings.Contains(string(b), want) {
			t.Errorf("payload JSON missing %q in %s", want, b)
		}
	}
}
