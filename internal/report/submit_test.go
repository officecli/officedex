package report

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

// fakeTransport implements Transport with caller-controlled stdout/stderr/exit.
type fakeTransport struct {
	stdout io.Reader
	stderr io.Reader
	stdin  io.Writer
	exit   int
	signal os.Signal
	waitMu sync.Mutex
	waited bool
}

func newFakeTransport(stdout, stderr string, exit int) *fakeTransport {
	return &fakeTransport{
		stdout: strings.NewReader(stdout),
		stderr: strings.NewReader(stderr),
		stdin:  io.Discard,
		exit:   exit,
	}
}

func (f *fakeTransport) Stdout() io.Reader        { return f.stdout }
func (f *fakeTransport) Stderr() io.Reader        { return f.stderr }
func (f *fakeTransport) Stdin() io.Writer         { return f.stdin }
func (f *fakeTransport) Kill(sig os.Signal) error { return nil }
func (f *fakeTransport) Wait() (int, os.Signal, error) {
	f.waitMu.Lock()
	defer f.waitMu.Unlock()
	if f.waited {
		// Already waited; return cached state.
		return f.exit, f.signal, nil
	}
	f.waited = true
	return f.exit, f.signal, nil
}

func writeTempBundle(t *testing.T, contents string) string {
	t.Helper()
	dir := t.TempDir()
	p := filepath.Join(dir, "bundle.zip")
	if err := os.WriteFile(p, []byte(contents), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestCLISubmitterSuccess(t *testing.T) {
	bundle := writeTempBundle(t, "fake zip")
	var capturedArgs []string
	submitter := NewCLISubmitter(CLIOptions{
		SpawnTransport: func(args []string) (Transport, error) {
			capturedArgs = args
			return newFakeTransport(`{"ticketId":"T-123","viewUrl":"https://ex/T-123"}`, "", 0), nil
		},
	})
	res, err := submitter.Submit(context.Background(), SubmitInput{
		BundlePath:   bundle,
		TaskID:       "task-1",
		Description:  "things broke",
		ContactEmail: "u@example.com",
		BundleID:     "bid-abc",
	})
	if err != nil {
		t.Fatalf("Submit: %v", err)
	}
	if !res.Uploaded || res.TicketID != "T-123" || res.ViewURL != "https://ex/T-123" {
		t.Errorf("unexpected result: %+v", res)
	}
	wantContains := []string{"report", "submit", "--bundle", bundle, "--json", "--source", "desktop", "--task-id", "task-1", "--description", "things broke", "--contact-email", "u@example.com", "--bundle-id", "bid-abc"}
	for _, w := range wantContains {
		found := false
		for _, a := range capturedArgs {
			if a == w {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("expected arg %q in %v", w, capturedArgs)
		}
	}
}

func TestCLISubmitterEmptyBundlePath(t *testing.T) {
	submitter := NewCLISubmitter(CLIOptions{
		SpawnTransport: func(args []string) (Transport, error) {
			t.Fatal("should not spawn when bundle path empty")
			return nil, nil
		},
	})
	_, err := submitter.Submit(context.Background(), SubmitInput{Description: "x"})
	if err == nil {
		t.Fatal("expected error for empty bundle path")
	}
}

func TestCLISubmitterNonZeroExitReturnsStderr(t *testing.T) {
	bundle := writeTempBundle(t, "z")
	submitter := NewCLISubmitter(CLIOptions{
		SpawnTransport: func(args []string) (Transport, error) {
			return newFakeTransport("", "report submit failed: something blew up", 1), nil
		},
	})
	_, err := submitter.Submit(context.Background(), SubmitInput{BundlePath: bundle, Description: "x"})
	if err == nil {
		t.Fatal("expected error on non-zero exit")
	}
	if !strings.Contains(err.Error(), "something blew up") {
		t.Errorf("expected stderr in error, got: %v", err)
	}
}

func TestCLISubmitterUnsupportedSchema(t *testing.T) {
	bundle := writeTempBundle(t, "z")
	submitter := NewCLISubmitter(CLIOptions{
		SpawnTransport: func(args []string) (Transport, error) {
			return newFakeTransport("", "Error: unsupported_schema (server requires v2)", 2), nil
		},
	})
	_, err := submitter.Submit(context.Background(), SubmitInput{BundlePath: bundle, Description: "x"})
	if !errors.Is(err, ErrUnsupportedSchema()) {
		t.Errorf("expected unsupported_schema sentinel, got: %v", err)
	}
}

func TestCLISubmitterMalformedJSON(t *testing.T) {
	bundle := writeTempBundle(t, "z")
	submitter := NewCLISubmitter(CLIOptions{
		SpawnTransport: func(args []string) (Transport, error) {
			return newFakeTransport("not json", "", 0), nil
		},
	})
	_, err := submitter.Submit(context.Background(), SubmitInput{BundlePath: bundle, Description: "x"})
	if err == nil {
		t.Fatal("expected parse error")
	}
}

func TestCLISubmitterMissingTicketID(t *testing.T) {
	bundle := writeTempBundle(t, "z")
	submitter := NewCLISubmitter(CLIOptions{
		SpawnTransport: func(args []string) (Transport, error) {
			return newFakeTransport(`{"viewUrl":"https://ex"}`, "", 0), nil
		},
	})
	_, err := submitter.Submit(context.Background(), SubmitInput{BundlePath: bundle, Description: "x"})
	if err == nil {
		t.Fatal("expected missing-ticketId error")
	}
}

func TestCLISubmitterCtxCancel(t *testing.T) {
	bundle := writeTempBundle(t, "z")
	// Use a transport whose Wait blocks until Kill is called and whose
	// stdout/stderr return EOF immediately (so drain goroutines exit).
	ft := newBlockingTransport()
	submitter := NewCLISubmitter(CLIOptions{
		SpawnTransport: func(args []string) (Transport, error) {
			return ft, nil
		},
	})
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(20 * time.Millisecond)
		cancel()
	}()
	_, err := submitter.Submit(ctx, SubmitInput{BundlePath: bundle, Description: "x"})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context.Canceled, got %v", err)
	}
}

// blockingTransport returns from Wait only after Kill is called. The killed
// channel is created up front so Wait and Kill never race on its slot.
// Stdout/Stderr return EOF immediately so drain goroutines exit, letting
// runOnce's waitDone goroutine complete once Kill is invoked.
type blockingTransport struct {
	killed   chan struct{}
	killOnce sync.Once
}

func newBlockingTransport() *blockingTransport {
	return &blockingTransport{
		killed: make(chan struct{}),
	}
}

func (b *blockingTransport) Stdout() io.Reader { return strings.NewReader("") }
func (b *blockingTransport) Stderr() io.Reader { return strings.NewReader("") }
func (b *blockingTransport) Stdin() io.Writer  { return io.Discard }
func (b *blockingTransport) Kill(sig os.Signal) error {
	b.killOnce.Do(func() {
		close(b.killed)
	})
	return nil
}
func (b *blockingTransport) Wait() (int, os.Signal, error) {
	<-b.killed
	return 0, syscall.SIGTERM, nil
}

func TestHTTPSubmitterSuccess(t *testing.T) {
	bundle := writeTempBundle(t, "fake-zip-bytes")
	var gotForm map[string]string
	var gotFile []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer tok-1" {
			t.Errorf("missing auth header, got %q", got)
		}
		mt, params, err := parseContentType(r.Header.Get("Content-Type"))
		if err != nil || mt != "multipart/form-data" {
			t.Fatalf("bad content-type: %v", r.Header.Get("Content-Type"))
		}
		mr := multipart.NewReader(r.Body, params["boundary"])
		gotForm = map[string]string{}
		for {
			part, err := mr.NextPart()
			if err == io.EOF {
				break
			}
			if err != nil {
				t.Fatal(err)
			}
			if part.FileName() != "" {
				gotFile, _ = io.ReadAll(part)
			} else {
				b, _ := io.ReadAll(part)
				gotForm[part.FormName()] = string(b)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ticketId":"H-1","viewUrl":"https://srv/H-1"}`))
	}))
	defer srv.Close()

	submitter := NewHTTPSubmitter(HTTPOptions{Endpoint: srv.URL, Token: "tok-1"})
	res, err := submitter.Submit(context.Background(), SubmitInput{
		BundlePath:   bundle,
		TaskID:       "task-2",
		Description:  "hello",
		ContactEmail: "x@y",
		BundleID:     "bid-2",
	})
	if err != nil {
		t.Fatalf("Submit: %v", err)
	}
	if !res.Uploaded || res.TicketID != "H-1" {
		t.Errorf("unexpected result: %+v", res)
	}
	if string(gotFile) != "fake-zip-bytes" {
		t.Errorf("uploaded body wrong: %q", gotFile)
	}
	for k, want := range map[string]string{
		"source":       "desktop",
		"taskId":       "task-2",
		"description":  "hello",
		"contactEmail": "x@y",
		"bundleId":     "bid-2",
	} {
		if got := gotForm[k]; got != want {
			t.Errorf("form[%s] = %q, want %q", k, got, want)
		}
	}
}

func TestHTTPSubmitter4xx(t *testing.T) {
	bundle := writeTempBundle(t, "z")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(400)
		_, _ = w.Write([]byte(`{"error":"bad"}`))
	}))
	defer srv.Close()

	submitter := NewHTTPSubmitter(HTTPOptions{Endpoint: srv.URL})
	_, err := submitter.Submit(context.Background(), SubmitInput{BundlePath: bundle, Description: "x"})
	if err == nil {
		t.Fatal("expected error on 4xx")
	}
	if !strings.Contains(err.Error(), "400") {
		t.Errorf("expected status in error: %v", err)
	}
}

func TestHTTPSubmitterUnsupportedSchema(t *testing.T) {
	bundle := writeTempBundle(t, "z")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnsupportedMediaType)
		_, _ = w.Write([]byte(`{"error":"unsupported_schema"}`))
	}))
	defer srv.Close()

	submitter := NewHTTPSubmitter(HTTPOptions{Endpoint: srv.URL})
	_, err := submitter.Submit(context.Background(), SubmitInput{BundlePath: bundle, Description: "x"})
	if !errors.Is(err, ErrUnsupportedSchema()) {
		t.Errorf("expected unsupported_schema, got %v", err)
	}
}

func TestHTTPSubmitterNetworkError(t *testing.T) {
	bundle := writeTempBundle(t, "z")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	srv.Close() // close immediately so connection fails
	submitter := NewHTTPSubmitter(HTTPOptions{Endpoint: srv.URL})
	_, err := submitter.Submit(context.Background(), SubmitInput{BundlePath: bundle, Description: "x"})
	if err == nil {
		t.Fatal("expected network error")
	}
}

func TestHTTPSubmitterEmptyEndpoint(t *testing.T) {
	bundle := writeTempBundle(t, "z")
	submitter := NewHTTPSubmitter(HTTPOptions{})
	_, err := submitter.Submit(context.Background(), SubmitInput{BundlePath: bundle, Description: "x"})
	if err == nil {
		t.Fatal("expected error on empty endpoint")
	}
}

func TestHTTPSubmitterMissingBundleFile(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer srv.Close()
	submitter := NewHTTPSubmitter(HTTPOptions{Endpoint: srv.URL})
	_, err := submitter.Submit(context.Background(), SubmitInput{BundlePath: "/no/such/file.zip", Description: "x"})
	if err == nil {
		t.Fatal("expected error on missing bundle file")
	}
}

// parseContentType is a tiny helper to avoid importing mime in tests.
func parseContentType(ct string) (string, map[string]string, error) {
	idx := strings.Index(ct, ";")
	if idx < 0 {
		return strings.TrimSpace(ct), nil, nil
	}
	mt := strings.TrimSpace(ct[:idx])
	params := map[string]string{}
	for _, kv := range strings.Split(ct[idx+1:], ";") {
		kv = strings.TrimSpace(kv)
		eq := strings.Index(kv, "=")
		if eq < 0 {
			continue
		}
		k := strings.TrimSpace(kv[:eq])
		v := strings.Trim(strings.TrimSpace(kv[eq+1:]), `"`)
		params[k] = v
	}
	return mt, params, nil
}

// Smoke: buildMultipartBody yields a parseable body even with empty optional fields.
func TestBuildMultipartBodyMinimal(t *testing.T) {
	bundle := writeTempBundle(t, "abc")
	body, ct, err := buildMultipartBody(SubmitInput{BundlePath: bundle, Description: "d"})
	if err != nil {
		t.Fatal(err)
	}
	buf := new(bytes.Buffer)
	if _, err := io.Copy(buf, body); err != nil {
		t.Fatal(err)
	}
	_, params, _ := parseContentType(ct)
	if params["boundary"] == "" {
		t.Fatal("missing boundary")
	}
	mr := multipart.NewReader(buf, params["boundary"])
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		_ = part
	}
}

// Ensure cliResponse marshals/unmarshals as expected so any future renaming
// breaks loudly.
func TestCLIResponseShape(t *testing.T) {
	b, _ := json.Marshal(cliResponse{TicketID: "T", ViewURL: "U"})
	if !strings.Contains(string(b), `"ticketId":"T"`) {
		t.Errorf("unexpected JSON: %s", b)
	}
}
