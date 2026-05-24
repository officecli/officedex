package login

import (
	"context"
	"errors"
	"io"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"officedex/internal/types"
)

// fakeTransport is a Transport backed by pipes and a controllable Wait.
type fakeTransport struct {
	stdoutR   *io.PipeReader
	stdoutW   *io.PipeWriter
	stderrR   *io.PipeReader
	stderrW   *io.PipeWriter
	stdinR    *io.PipeReader
	stdinW    *io.PipeWriter
	waitCh    chan waitResult
	killed    chan os.Signal
	killCalls atomic.Int32
}

func newFakeTransport() *fakeTransport {
	stdoutR, stdoutW := io.Pipe()
	stderrR, stderrW := io.Pipe()
	stdinR, stdinW := io.Pipe()
	return &fakeTransport{
		stdoutR: stdoutR, stdoutW: stdoutW,
		stderrR: stderrR, stderrW: stderrW,
		stdinR: stdinR, stdinW: stdinW,
		waitCh: make(chan waitResult, 1),
		killed: make(chan os.Signal, 4),
	}
}

func (f *fakeTransport) Stdout() io.Reader { return f.stdoutR }
func (f *fakeTransport) Stderr() io.Reader { return f.stderrR }
func (f *fakeTransport) Stdin() io.Writer  { return f.stdinW }

func (f *fakeTransport) Kill(sig os.Signal) error {
	f.killCalls.Add(1)
	select {
	case f.killed <- sig:
	default:
	}
	return nil
}

func (f *fakeTransport) Wait() (int, os.Signal, error) {
	result := <-f.waitCh
	_ = f.stdoutW.Close()
	_ = f.stderrW.Close()
	_ = f.stdinR.Close()
	return result.code, result.signal, result.err
}

func (f *fakeTransport) finish(code int, sig os.Signal) {
	f.waitCh <- waitResult{code: code, signal: sig}
}

func TestStartReturnsURLWhenEmittedOnStdout(t *testing.T) {
	ft := newFakeTransport()
	mgr := New(ManagerOptions{
		URLTimeout: 2 * time.Second,
		SpawnTransport: func(args []string) (Transport, error) {
			if len(args) == 0 || args[0] != "login" {
				t.Errorf("unexpected args: %v", args)
			}
			return ft, nil
		},
	})
	events := captureEvents(mgr)

	done := make(chan struct {
		url string
		err error
	}, 1)
	go func() {
		u, e := mgr.Start(context.Background())
		done <- struct {
			url string
			err error
		}{u, e}
	}()

	if _, err := ft.stdoutW.Write([]byte("Please visit https://example.com/auth?code=abc to continue.\n")); err != nil {
		t.Fatalf("write stdout: %v", err)
	}

	select {
	case res := <-done:
		if res.err != nil {
			t.Fatalf("Start returned error: %v", res.err)
		}
		if res.url != "https://example.com/auth?code=abc" {
			t.Fatalf("unexpected url: %q", res.url)
		}
	case <-time.After(time.Second):
		t.Fatal("Start did not return after URL was emitted")
	}

	ft.finish(0, nil)
	waitForEvent(t, events, EventSuccess)
}

func TestStartTimesOutWhenNoURL(t *testing.T) {
	ft := newFakeTransport()
	mgr := New(ManagerOptions{
		URLTimeout: 30 * time.Millisecond,
		SpawnTransport: func(args []string) (Transport, error) { return ft, nil },
	})
	// Drain any kill signal then complete Wait after kill.
	go func() {
		<-ft.killed
		ft.finish(0, syscall.SIGTERM)
	}()

	_, err := mgr.Start(context.Background())
	if err == nil {
		t.Fatal("expected timeout error, got nil")
	}
	if !strings.Contains(err.Error(), "did not print a verification URL") {
		t.Fatalf("unexpected error: %v", err)
	}
	if ft.killCalls.Load() == 0 {
		t.Fatal("expected Kill to be called on timeout")
	}
}

func TestStartUsesFallbackRegexAfterExit(t *testing.T) {
	ft := newFakeTransport()
	mgr := New(ManagerOptions{
		URLTimeout:     time.Second,
		SpawnTransport: func(args []string) (Transport, error) { return ft, nil },
	})
	events := captureEvents(mgr)

	// Write a URL without trailing whitespace so the primary regex misses,
	// then exit; the fallback should pick it up.
	go func() {
		_, _ = ft.stdoutW.Write([]byte("Visit https://example.com/auth?code=xyz"))
		ft.finish(0, nil)
	}()

	url, err := mgr.Start(context.Background())
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if url != "https://example.com/auth?code=xyz" {
		t.Fatalf("unexpected url from fallback: %q", url)
	}
	waitForEvent(t, events, EventSuccess)
}

func TestStartEmitsFailureOnNonZeroExit(t *testing.T) {
	ft := newFakeTransport()
	mgr := New(ManagerOptions{
		URLTimeout:     time.Second,
		SpawnTransport: func(args []string) (Transport, error) { return ft, nil },
	})
	events := captureEvents(mgr)

	go func() {
		_, _ = ft.stdoutW.Write([]byte("https://example.com/auth?code=k\n"))
		_, _ = ft.stderrW.Write([]byte("backend unreachable\n"))
		// Give the URL match goroutine a chance to fire before exit.
		time.Sleep(20 * time.Millisecond)
		ft.finish(2, nil)
	}()

	if _, err := mgr.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}

	ev := waitForEvent(t, events, EventFailure)
	if !strings.Contains(ev.Message, "code=2") {
		t.Fatalf("failure message missing exit code: %q", ev.Message)
	}
	if !strings.Contains(ev.Message, "backend unreachable") {
		t.Fatalf("failure message missing stderr: %q", ev.Message)
	}
}

func TestCancelSendsSIGTERM(t *testing.T) {
	ft := newFakeTransport()
	mgr := New(ManagerOptions{
		URLTimeout:     time.Second,
		SpawnTransport: func(args []string) (Transport, error) { return ft, nil },
	})

	startDone := make(chan error, 1)
	go func() {
		_, err := mgr.Start(context.Background())
		startDone <- err
	}()

	_, _ = ft.stdoutW.Write([]byte("https://example.com/auth?code=q\n"))
	if err := <-startDone; err != nil {
		t.Fatalf("Start: %v", err)
	}

	if err := mgr.Cancel(); err != nil {
		t.Fatalf("Cancel: %v", err)
	}
	select {
	case sig := <-ft.killed:
		if sig != syscall.SIGTERM {
			t.Fatalf("expected SIGTERM, got %v", sig)
		}
	case <-time.After(time.Second):
		t.Fatal("Kill was not called")
	}
	ft.finish(0, syscall.SIGTERM)
}

func TestCancelIsNoopWhenNotRunning(t *testing.T) {
	mgr := New(ManagerOptions{})
	if err := mgr.Cancel(); err != nil {
		t.Fatalf("Cancel on idle manager returned: %v", err)
	}
}

func TestParseWhoAmIAnonymousOnNonZeroExit(t *testing.T) {
	result := ParseWhoAmI("anything here", 1)
	if result.Mode != types.WhoAmIAnonymous {
		t.Fatalf("expected anonymous, got %q", result.Mode)
	}
}

func TestParseWhoAmIDetectsAPIKey(t *testing.T) {
	result := ParseWhoAmI("Authenticated via API key for service\n", 0)
	if result.Mode != types.WhoAmIAPIKey {
		t.Fatalf("expected api_key, got %q", result.Mode)
	}
}

func TestParseWhoAmILoggedInWithFields(t *testing.T) {
	stdout := "Logged in as the following user.\nUser ID: usr-123\nEmail: user@example.com\nSession: sess-abc\nExpires at: 2030-01-01T00:00:00Z\n"
	result := ParseWhoAmI(stdout, 0)
	if result.Mode != types.WhoAmILoggedIn {
		t.Fatalf("expected logged_in, got %q", result.Mode)
	}
	if result.UserID != "usr-123" {
		t.Fatalf("UserID: %q", result.UserID)
	}
	if result.Email != "user@example.com" {
		t.Fatalf("Email: %q", result.Email)
	}
	if result.Session != "sess-abc" {
		t.Fatalf("Session: %q", result.Session)
	}
	if result.ExpiresAt != "2030-01-01T00:00:00Z" {
		t.Fatalf("ExpiresAt: %q", result.ExpiresAt)
	}
}

func TestParseWhoAmIAnonymousWhenNothingMatches(t *testing.T) {
	result := ParseWhoAmI("nothing relevant here\n", 0)
	if result.Mode != types.WhoAmIAnonymous {
		t.Fatalf("expected anonymous, got %q", result.Mode)
	}
	if result.UserID != "" || result.Session != "" || result.ExpiresAt != "" {
		t.Fatalf("expected empty fields, got %+v", result)
	}
}

func TestParseWhoAmIDetectsLoggedInViaSessionLine(t *testing.T) {
	result := ParseWhoAmI("Session: only-session\n", 0)
	if result.Mode != types.WhoAmILoggedIn {
		t.Fatalf("expected logged_in via session marker, got %q", result.Mode)
	}
	if result.Session != "only-session" {
		t.Fatalf("Session: %q", result.Session)
	}
}

func TestBuildBridgeEnvIncludesSkipDefaults(t *testing.T) {
	env := BuildBridgeEnv(nil)
	wants := []string{
		"OFFICECLI_SKIP_SKILL_PREFLIGHT=1",
		"OFFICECLI_SKIP_PUBLISH_SETUP=1",
		"OFFICECLI_SKIP_UPDATE_CHECK=1",
	}
	for _, w := range wants {
		if !containsEntry(env, w) {
			t.Fatalf("BuildBridgeEnv missing default %q in %v", w, env)
		}
	}
}

func TestBuildBridgeEnvExtraOverridesDefaults(t *testing.T) {
	env := BuildBridgeEnv([]string{
		"OFFICECLI_SKIP_SKILL_PREFLIGHT=0",
		"CUSTOM_FLAG=on",
	})
	if !containsEntry(env, "OFFICECLI_SKIP_SKILL_PREFLIGHT=0") {
		t.Fatalf("extra entry did not override default; env=%v", env)
	}
	if containsEntry(env, "OFFICECLI_SKIP_SKILL_PREFLIGHT=1") {
		t.Fatalf("original default still present after override; env=%v", env)
	}
	if !containsEntry(env, "OFFICECLI_SKIP_PUBLISH_SETUP=1") {
		t.Fatal("untouched default missing")
	}
	if !containsEntry(env, "CUSTOM_FLAG=on") {
		t.Fatal("custom entry not present")
	}
}

func TestBuildBridgeEnvOverridesProcessEnv(t *testing.T) {
	key := "OFFICEDEX_LOGIN_TEST_VAR"
	t.Setenv(key, "from-process")
	env := BuildBridgeEnv([]string{key + "=from-extra"})
	if !containsEntry(env, key+"=from-extra") {
		t.Fatalf("extra value missing: %v", env)
	}
	if containsEntry(env, key+"=from-process") {
		t.Fatalf("process-level value should have been dedup'd: %v", env)
	}
}

func captureEvents(mgr *Manager) *eventLog {
	log := &eventLog{ch: make(chan LoginEvent, 16)}
	log.unsub = mgr.OnEvent(func(ev LoginEvent) {
		log.mu.Lock()
		log.list = append(log.list, ev)
		log.mu.Unlock()
		select {
		case log.ch <- ev:
		default:
		}
	})
	return log
}

type eventLog struct {
	mu    sync.Mutex
	list  []LoginEvent
	ch    chan LoginEvent
	unsub func()
}

func waitForEvent(t *testing.T, log *eventLog, want LoginEventType) LoginEvent {
	t.Helper()
	deadline := time.After(time.Second)
	for {
		select {
		case ev := <-log.ch:
			if ev.Type == want {
				return ev
			}
		case <-deadline:
			log.mu.Lock()
			seen := append([]LoginEvent{}, log.list...)
			log.mu.Unlock()
			t.Fatalf("timed out waiting for %s; saw %+v", want, seen)
		}
	}
}

func containsEntry(env []string, want string) bool {
	for _, kv := range env {
		if kv == want {
			return true
		}
	}
	return false
}

// Sanity: a fake spawn error from SpawnTransport surfaces from Start.
func TestStartReportsSpawnError(t *testing.T) {
	mgr := New(ManagerOptions{
		SpawnTransport: func(args []string) (Transport, error) {
			return nil, errors.New("boom")
		},
	})
	if _, err := mgr.Start(context.Background()); err == nil || !strings.Contains(err.Error(), "boom") {
		t.Fatalf("expected spawn error, got %v", err)
	}
}
