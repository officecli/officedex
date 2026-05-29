package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"officedex/internal/bridge"
	"officedex/internal/netproxy"
	"officedex/internal/types"
)

type authResetBridgeTransport struct {
	stdoutR *io.PipeReader
	stdoutW *io.PipeWriter
	stderrR *io.PipeReader
	stderrW *io.PipeWriter
	stdinW  *discardWriteCloser
	waitCh  chan struct{}
	kills   atomic.Int32
	once    sync.Once
}

func newAuthResetBridgeTransport() *authResetBridgeTransport {
	stdoutR, stdoutW := io.Pipe()
	stderrR, stderrW := io.Pipe()
	return &authResetBridgeTransport{
		stdoutR: stdoutR,
		stdoutW: stdoutW,
		stderrR: stderrR,
		stderrW: stderrW,
		stdinW:  &discardWriteCloser{},
		waitCh:  make(chan struct{}),
	}
}

func (f *authResetBridgeTransport) Stdin() io.Writer  { return f.stdinW }
func (f *authResetBridgeTransport) Stdout() io.Reader { return f.stdoutR }
func (f *authResetBridgeTransport) Stderr() io.Reader { return f.stderrR }

func (f *authResetBridgeTransport) Kill() error {
	f.kills.Add(1)
	f.once.Do(func() {
		_ = f.stdoutW.Close()
		_ = f.stderrW.Close()
		close(f.waitCh)
	})
	return nil
}

func (f *authResetBridgeTransport) Wait() (*int, string, error) {
	<-f.waitCh
	return nil, "killed", nil
}

type discardWriteCloser struct{}

func (d *discardWriteCloser) Write(p []byte) (int, error) { return len(p), nil }
func (d *discardWriteCloser) Close() error                { return nil }

func TestLoginSuccessResetsBridgeRuntime(t *testing.T) {
	app, transport := newAuthResetAppWithBridge(t, writeAuthResetOfficeCLI(t, authResetScript{
		loginURL:  "https://platform.officecli.io/verify/test",
		loginCode: 0,
	}))

	manager := appAuthResetLoginManager(app)
	url, err := manager.Start(context.Background())
	if err != nil {
		t.Fatalf("login start: %v", err)
	}
	if url == "" {
		t.Fatal("Login URL should be populated")
	}

	waitForAuthReset(t, app)
	if transport.kills.Load() == 0 {
		t.Fatal("old bridge client was not closed after login success")
	}
}

func TestLoginFailureKeepsBridgeRuntime(t *testing.T) {
	app, transport := newAuthResetAppWithBridge(t, writeAuthResetOfficeCLI(t, authResetScript{
		loginURL:  "https://platform.officecli.io/verify/test",
		loginCode: 7,
		loginErr:  "login rejected",
	}))

	manager := appAuthResetLoginManager(app)
	if _, err := manager.Start(context.Background()); err != nil {
		t.Fatalf("login start: %v", err)
	}

	waitForLoginExit(t, app)
	assertAuthResetRuntimePresent(t, app)
	if transport.kills.Load() != 0 {
		t.Fatal("bridge client should not be closed after login failure")
	}
}

func TestLogoutSuccessResetsBridgeRuntime(t *testing.T) {
	app, transport := newAuthResetAppWithBridge(t, writeAuthResetOfficeCLI(t, authResetScript{
		logoutCode: 0,
	}))
	app.ctx = context.Background()

	if err := app.Logout(); err != nil {
		t.Fatalf("Logout: %v", err)
	}

	assertAuthResetRuntimeCleared(t, app)
	if transport.kills.Load() == 0 {
		t.Fatal("old bridge client was not closed after logout success")
	}
}

func TestLogoutFailureKeepsBridgeRuntime(t *testing.T) {
	app, transport := newAuthResetAppWithBridge(t, writeAuthResetOfficeCLI(t, authResetScript{
		logoutCode: 9,
		logoutErr:  "logout rejected",
	}))
	app.ctx = context.Background()

	if err := app.Logout(); err == nil {
		t.Fatal("Logout should fail")
	}

	assertAuthResetRuntimePresent(t, app)
	if transport.kills.Load() != 0 {
		t.Fatal("bridge client should not be closed after logout failure")
	}
}

func TestRedeemSuccessResetsBridgeRuntime(t *testing.T) {
	app, transport := newAuthResetAppWithBridge(t, writeAuthResetOfficeCLI(t, authResetScript{
		redeemCode: 0,
		redeemJSON: map[string]any{
			"code":                 "PROMO2026",
			"credit_amount":        100,
			"credit_balance_after": 250,
			"redeemed_at":          "2026-05-29T00:00:00Z",
		},
	}))
	app.ctx = context.Background()

	if _, err := app.Redeem("PROMO2026"); err != nil {
		t.Fatalf("Redeem: %v", err)
	}

	assertAuthResetRuntimeCleared(t, app)
	if transport.kills.Load() == 0 {
		t.Fatal("old bridge client was not closed after redeem success")
	}
}

func TestRedeemFailureKeepsBridgeRuntime(t *testing.T) {
	app, transport := newAuthResetAppWithBridge(t, writeAuthResetOfficeCLI(t, authResetScript{
		redeemCode: 8,
		redeemErr:  "Redeem failed: expired",
	}))
	app.ctx = context.Background()

	if _, err := app.Redeem("PROMO2026"); err == nil {
		t.Fatal("Redeem should fail")
	}

	assertAuthResetRuntimePresent(t, app)
	if transport.kills.Load() != 0 {
		t.Fatal("bridge client should not be closed after redeem failure")
	}
}

func newAuthResetAppWithBridge(t *testing.T, binary string) (*App, *authResetBridgeTransport) {
	t.Helper()
	transport := newAuthResetBridgeTransport()
	client := bridge.New(bridge.Options{
		RequestTimeout: 500 * time.Millisecond,
		CreateTransport: func(opts bridge.Options) (bridge.Transport, error) {
			return transport, nil
		},
		DisableAutoReconnect: true,
	})
	if err := client.Start(context.Background()); err != nil {
		t.Fatalf("start bridge client: %v", err)
	}
	app := &App{
		userDataDir:        t.TempDir(),
		workspaceDir:       t.TempDir(),
		proxyPool:          netproxy.NewPool(),
		cachedSettings:     types.UserSettings{},
		bridgeClient:       client,
		resolvedBinaryPath: binary,
		resolvedBinaryEnv:  []string{"OFFICE_CLI_RUNTIME_MODE=hosted"},
		binaryResolvedAt:   time.Now(),
	}
	t.Cleanup(func() {
		client.Close()
	})
	return app, transport
}

func appAuthResetLoginManager(app *App) interface {
	Start(context.Context) (string, error)
} {
	app.mu.Lock()
	defer app.mu.Unlock()
	return app.ensureLoginManagerLocked()
}

func waitForAuthReset(t *testing.T, app *App) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		app.mu.Lock()
		cleared := app.bridgeClient == nil &&
			app.resolvedBinaryPath == "" &&
			app.resolvedBinaryEnv == nil &&
			app.binaryResolvedAt.IsZero()
		app.mu.Unlock()
		if cleared {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	assertAuthResetRuntimeCleared(t, app)
}

func waitForLoginExit(t *testing.T, app *App) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		app.mu.Lock()
		manager := app.loginManager
		exited := manager != nil && !manager.Running()
		app.mu.Unlock()
		if exited {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("login manager did not exit")
}

func assertAuthResetRuntimeCleared(t *testing.T, app *App) {
	t.Helper()
	app.mu.Lock()
	defer app.mu.Unlock()
	if app.bridgeClient != nil {
		t.Fatal("bridgeClient should be nil")
	}
	if app.resolvedBinaryPath != "" {
		t.Fatalf("resolvedBinaryPath = %q, want empty", app.resolvedBinaryPath)
	}
	if app.resolvedBinaryEnv != nil {
		t.Fatalf("resolvedBinaryEnv = %#v, want nil", app.resolvedBinaryEnv)
	}
	if !app.binaryResolvedAt.IsZero() {
		t.Fatalf("binaryResolvedAt = %v, want zero", app.binaryResolvedAt)
	}
}

func assertAuthResetRuntimePresent(t *testing.T, app *App) {
	t.Helper()
	app.mu.Lock()
	defer app.mu.Unlock()
	if app.bridgeClient == nil {
		t.Fatal("bridgeClient should still be present")
	}
	if app.resolvedBinaryPath == "" {
		t.Fatal("resolvedBinaryPath should still be populated")
	}
	if len(app.resolvedBinaryEnv) == 0 {
		t.Fatal("resolvedBinaryEnv should still be populated")
	}
	if app.binaryResolvedAt.IsZero() {
		t.Fatal("binaryResolvedAt should still be populated")
	}
}

type authResetScript struct {
	loginURL   string
	loginCode  int
	loginErr   string
	logoutCode int
	logoutErr  string
	redeemCode int
	redeemErr  string
	redeemJSON map[string]any
}

func writeAuthResetOfficeCLI(t *testing.T, script authResetScript) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("auth reset fake officecli uses a POSIX shell script")
	}
	redeemPayload := script.redeemJSON
	if redeemPayload == nil {
		redeemPayload = map[string]any{
			"code":                 "PROMO2026",
			"credit_amount":        100,
			"credit_balance_after": 250,
			"redeemed_at":          "2026-05-29T00:00:00Z",
		}
	}
	rawRedeem, err := json.Marshal(redeemPayload)
	if err != nil {
		t.Fatalf("marshal redeem payload: %v", err)
	}
	body := fmt.Sprintf(`#!/bin/sh
case "$1" in
  login)
    printf 'Open this URL: %s\n'
    if [ %d -ne 0 ]; then
      printf '%s\n' >&2
      exit %d
    fi
    exit 0
    ;;
  logout)
    if [ %d -ne 0 ]; then
      printf '%s\n' >&2
      exit %d
    fi
    exit 0
    ;;
  redeem)
    if [ %d -ne 0 ]; then
      printf '%s\n' >&2
      exit %d
    fi
    cat <<'OFFICEDEX_REDEEM_JSON'
%s
OFFICEDEX_REDEEM_JSON
    exit 0
    ;;
esac
printf 'unexpected command: %s\n' "$1" >&2
exit 64
`, shellSingleQuote(script.loginURL), script.loginCode, shellSingleQuote(script.loginErr), script.loginCode, script.logoutCode, shellSingleQuote(script.logoutErr), script.logoutCode, script.redeemCode, shellSingleQuote(script.redeemErr), script.redeemCode, string(rawRedeem), "%s")
	path := filepath.Join(t.TempDir(), "officecli-auth-reset")
	if err := os.WriteFile(path, []byte(body), 0o755); err != nil {
		t.Fatalf("write fake officecli: %v", err)
	}
	return path
}

func shellSingleQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'"
}
