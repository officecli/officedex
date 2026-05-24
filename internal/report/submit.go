// Package report implements issue-report submission for OfficeDex.
//
// Two submitter implementations live behind the same Submitter interface so
// the caller (app.go SubmitReport) can pick whichever is available without
// reshaping the flow:
//
//   - cliSubmitter shells out to `officecli report submit` (subprocess pattern
//     mirroring internal/login).
//   - httpSubmitter POSTs the bundle multipart to a configured endpoint
//     (HTTP pattern mirroring internal/appupdate).
//
// Capability detection (DetectCapability) decides which one is viable at
// runtime; the renderer can also call GetReportCapability to gate UI affordances.
package report

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

// SubmitInput describes the renderer-facing report payload.
type SubmitInput struct {
	BundlePath   string
	TaskID       string
	Description  string
	ContactEmail string
	BundleID     string
}

// SubmitResult is what a Submitter returns on success.
type SubmitResult struct {
	TicketID string `json:"ticketId"`
	ViewURL  string `json:"viewUrl,omitempty"`
	Uploaded bool   `json:"uploaded"`
}

// Submitter abstracts CLI vs HTTP submission so SubmitReport can branch
// based on detected capability without owning protocol details.
type Submitter interface {
	Submit(ctx context.Context, opts SubmitInput) (SubmitResult, error)
}

// Transport mirrors internal/login.Transport for test injection.
type Transport interface {
	Stdout() io.Reader
	Stderr() io.Reader
	Stdin() io.Writer
	Kill(sig os.Signal) error
	Wait() (exitCode int, signal os.Signal, err error)
}

// CLIOptions configures cliSubmitter. SpawnTransport overrides binary lookup
// for tests.
type CLIOptions struct {
	BinaryPath     string
	Env            []string
	SpawnTransport func(args []string) (Transport, error)
}

type cliSubmitter struct {
	opts CLIOptions
}

// NewCLISubmitter returns a Submitter that shells out to `officecli report submit`.
func NewCLISubmitter(opts CLIOptions) Submitter {
	return &cliSubmitter{opts: opts}
}

// cliResponse mirrors the JSON the CLI is expected to print on stdout.
type cliResponse struct {
	TicketID string `json:"ticketId"`
	ViewURL  string `json:"viewUrl,omitempty"`
}

// errUnsupportedSchema flags the well-known server rejection so the caller
// can surface it distinctly to the user.
var errUnsupportedSchema = errors.New("report: server rejected bundle schema (unsupported_schema)")

// ErrUnsupportedSchema is the sentinel returned when the server rejects the
// bundle for schema reasons.
func ErrUnsupportedSchema() error { return errUnsupportedSchema }

func (c *cliSubmitter) Submit(ctx context.Context, in SubmitInput) (SubmitResult, error) {
	if strings.TrimSpace(in.BundlePath) == "" {
		return SubmitResult{}, errors.New("report: bundle path is required")
	}
	args := []string{
		"report", "submit",
		"--bundle", in.BundlePath,
		"--json",
		"--source", "desktop",
	}
	if in.TaskID != "" {
		args = append(args, "--task-id", in.TaskID)
	}
	if in.Description != "" {
		args = append(args, "--description", in.Description)
	}
	if in.ContactEmail != "" {
		args = append(args, "--contact-email", in.ContactEmail)
	}
	if in.BundleID != "" {
		args = append(args, "--bundle-id", in.BundleID)
	}

	stdout, stderr, code, err := runOnce(ctx, c.opts, args)
	if err != nil {
		return SubmitResult{}, err
	}
	if code != 0 {
		msg := strings.TrimSpace(stderr)
		if msg == "" {
			msg = strings.TrimSpace(stdout)
		}
		if msg == "" {
			msg = fmt.Sprintf("officecli report submit exited with code %d", code)
		}
		if strings.Contains(strings.ToLower(msg), "unsupported_schema") {
			return SubmitResult{}, errUnsupportedSchema
		}
		return SubmitResult{}, errors.New(msg)
	}
	var parsed cliResponse
	if err := json.Unmarshal([]byte(strings.TrimSpace(stdout)), &parsed); err != nil {
		return SubmitResult{}, fmt.Errorf("report: parse cli response: %w", err)
	}
	if parsed.TicketID == "" {
		return SubmitResult{}, errors.New("report: cli response missing ticketId")
	}
	return SubmitResult{TicketID: parsed.TicketID, ViewURL: parsed.ViewURL, Uploaded: true}, nil
}

// HTTPOptions configures httpSubmitter. Endpoint is required. Token is
// optional (when empty, the endpoint is expected to accept anonymous
// submissions or fetch identity another way). HTTPClient may be overridden
// for tests; nil falls back to a 60s-timeout default client.
type HTTPOptions struct {
	Endpoint   string
	Token      string
	HTTPClient *http.Client
	UserAgent  string
}

type httpSubmitter struct {
	opts HTTPOptions
}

// NewHTTPSubmitter returns a Submitter that POSTs the bundle to a configured URL.
func NewHTTPSubmitter(opts HTTPOptions) Submitter {
	if opts.HTTPClient == nil {
		opts.HTTPClient = &http.Client{Timeout: 60 * time.Second}
	}
	if opts.UserAgent == "" {
		opts.UserAgent = "officedex-report"
	}
	return &httpSubmitter{opts: opts}
}

func (h *httpSubmitter) Submit(ctx context.Context, in SubmitInput) (SubmitResult, error) {
	if strings.TrimSpace(h.opts.Endpoint) == "" {
		return SubmitResult{}, errors.New("report: http endpoint is empty")
	}
	if strings.TrimSpace(in.BundlePath) == "" {
		return SubmitResult{}, errors.New("report: bundle path is required")
	}
	body, contentType, err := buildMultipartBody(in)
	if err != nil {
		return SubmitResult{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, h.opts.Endpoint, body)
	if err != nil {
		return SubmitResult{}, fmt.Errorf("report: build request: %w", err)
	}
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("User-Agent", h.opts.UserAgent)
	req.Header.Set("Accept", "application/json")
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
	var parsed cliResponse
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return SubmitResult{}, fmt.Errorf("report: parse http response: %w", err)
	}
	if parsed.TicketID == "" {
		return SubmitResult{}, errors.New("report: http response missing ticketId")
	}
	return SubmitResult{TicketID: parsed.TicketID, ViewURL: parsed.ViewURL, Uploaded: true}, nil
}

func buildMultipartBody(in SubmitInput) (io.Reader, string, error) {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)

	fields := map[string]string{
		"source":      "desktop",
		"description": in.Description,
	}
	if in.TaskID != "" {
		fields["taskId"] = in.TaskID
	}
	if in.ContactEmail != "" {
		fields["contactEmail"] = in.ContactEmail
	}
	if in.BundleID != "" {
		fields["bundleId"] = in.BundleID
	}
	for k, v := range fields {
		if err := mw.WriteField(k, v); err != nil {
			return nil, "", fmt.Errorf("report: write field %s: %w", k, err)
		}
	}

	f, err := os.Open(in.BundlePath)
	if err != nil {
		return nil, "", fmt.Errorf("report: open bundle: %w", err)
	}
	defer f.Close()
	part, err := mw.CreateFormFile("bundle", filepath.Base(in.BundlePath))
	if err != nil {
		return nil, "", fmt.Errorf("report: create form file: %w", err)
	}
	if _, err := io.Copy(part, f); err != nil {
		return nil, "", fmt.Errorf("report: copy bundle: %w", err)
	}
	if err := mw.Close(); err != nil {
		return nil, "", fmt.Errorf("report: close multipart: %w", err)
	}
	return &buf, mw.FormDataContentType(), nil
}

// runOnce drives a short-lived officecli subprocess to completion. Mirrors
// internal/login.runOnce so behaviour stays consistent across CLI callers.
func runOnce(ctx context.Context, opts CLIOptions, args []string) (string, string, int, error) {
	transport, err := spawn(opts, args)
	if err != nil {
		return "", "", 0, fmt.Errorf("report: spawn: %w", err)
	}
	var stdoutBuf, stderrBuf strings.Builder
	stdoutDone := make(chan struct{})
	stderrDone := make(chan struct{})
	go drain(transport.Stdout(), &stdoutBuf, stdoutDone)
	go drain(transport.Stderr(), &stderrBuf, stderrDone)

	type waitResult struct {
		code   int
		signal os.Signal
		err    error
	}
	waitDone := make(chan waitResult, 1)
	go func() {
		code, sig, werr := transport.Wait()
		<-stdoutDone
		<-stderrDone
		waitDone <- waitResult{code: code, signal: sig, err: werr}
	}()

	select {
	case result := <-waitDone:
		if result.err != nil {
			return stdoutBuf.String(), stderrBuf.String(), result.code, result.err
		}
		return stdoutBuf.String(), stderrBuf.String(), result.code, nil
	case <-ctx.Done():
		_ = transport.Kill(syscall.SIGTERM)
		<-waitDone
		return stdoutBuf.String(), stderrBuf.String(), 0, ctx.Err()
	}
}

func drain(r io.Reader, sink *strings.Builder, done chan<- struct{}) {
	defer close(done)
	buf := make([]byte, 4096)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			sink.Write(buf[:n])
		}
		if err != nil {
			return
		}
	}
}

func spawn(opts CLIOptions, args []string) (Transport, error) {
	if opts.SpawnTransport != nil {
		return opts.SpawnTransport(args)
	}
	binary := opts.BinaryPath
	if binary == "" {
		binary = "officecli"
	}
	cmd := exec.Command(binary, args...)
	if len(opts.Env) > 0 {
		cmd.Env = append(os.Environ(), opts.Env...)
	}
	return newProcessTransport(cmd)
}

type processTransport struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout io.ReadCloser
	stderr io.ReadCloser
}

func newProcessTransport(cmd *exec.Cmd) (*processTransport, error) {
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("stderr pipe: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start: %w", err)
	}
	return &processTransport{cmd: cmd, stdin: stdin, stdout: stdout, stderr: stderr}, nil
}

func (p *processTransport) Stdout() io.Reader { return p.stdout }
func (p *processTransport) Stderr() io.Reader { return p.stderr }
func (p *processTransport) Stdin() io.Writer  { return p.stdin }

func (p *processTransport) Kill(sig os.Signal) error {
	if p.cmd.Process == nil {
		return nil
	}
	return p.cmd.Process.Signal(sig)
}

func (p *processTransport) Wait() (int, os.Signal, error) {
	err := p.cmd.Wait()
	code := 0
	var sig os.Signal
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			code = exitErr.ExitCode()
			if status, ok := exitErr.Sys().(syscall.WaitStatus); ok && status.Signaled() {
				sig = status.Signal()
			}
			return code, sig, nil
		}
		return -1, nil, err
	}
	if state := p.cmd.ProcessState; state != nil {
		code = state.ExitCode()
	}
	return code, nil, nil
}
