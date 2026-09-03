package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"officedex/internal/bridge"
	"officedex/internal/netproxy"
	"officedex/internal/types"
)

const (
	fakeOfficeCLIBehaviorEnv = "OFFICEDEX_TEST_FAKE_OFFICECLI_BEHAVIOR"
	fakeOfficeCLIArgsPathEnv = "OFFICEDEX_TEST_FAKE_OFFICECLI_ARGS_PATH"
	fakeOfficeCLIEnvPathEnv  = "OFFICEDEX_TEST_FAKE_OFFICECLI_ENV_PATH"
)

func init() {
	switch os.Getenv(fakeOfficeCLIBehaviorEnv) {
	case "success":
		if argsPath := os.Getenv(fakeOfficeCLIArgsPathEnv); argsPath != "" {
			_ = os.WriteFile(argsPath, []byte(strings.Join(os.Args[1:], "\n")+"\n"), 0o644)
		}
		if envPath := os.Getenv(fakeOfficeCLIEnvPathEnv); envPath != "" {
			_ = os.WriteFile(envPath, []byte(strings.Join(os.Environ(), "\n")+"\n"), 0o644)
		}
		fmt.Println(`{"ok":true}`)
		os.Exit(0)
	case "failure":
		fmt.Println("stdout says not enough credits with extra details")
		_, _ = fmt.Fprintln(os.Stderr, "stderr says hosted provider unreachable")
		os.Exit(42)
	}
}

type providerTestFakeTransport struct {
	stdin   *providerTestBufferedPipe
	stdoutR *io.PipeReader
	stdoutW *io.PipeWriter
	stderrR *io.PipeReader
	stderrW *io.PipeWriter
}

type providerTestBufferedPipe struct {
	mu   sync.Mutex
	cond *sync.Cond
	data []byte
}

func newProviderTestBufferedPipe() *providerTestBufferedPipe {
	b := &providerTestBufferedPipe{}
	b.cond = sync.NewCond(&b.mu)
	return b
}

func (b *providerTestBufferedPipe) Write(p []byte) (int, error) {
	b.mu.Lock()
	b.data = append(b.data, p...)
	b.cond.Broadcast()
	b.mu.Unlock()
	return len(p), nil
}

func (b *providerTestBufferedPipe) readFrame() []byte {
	b.mu.Lock()
	defer b.mu.Unlock()
	for {
		headerEnd := strings.Index(string(b.data), "\r\n\r\n")
		if headerEnd < 0 {
			b.cond.Wait()
			continue
		}
		header := string(b.data[:headerEnd])
		var length int
		if _, err := fmt.Sscanf(header, "Content-Length: %d", &length); err != nil || length <= 0 {
			b.cond.Wait()
			continue
		}
		start := headerEnd + 4
		if len(b.data) < start+length {
			b.cond.Wait()
			continue
		}
		body := append([]byte(nil), b.data[start:start+length]...)
		b.data = b.data[start+length:]
		return body
	}
}

func newProviderTestFakeTransport() *providerTestFakeTransport {
	stdoutR, stdoutW := io.Pipe()
	stderrR, stderrW := io.Pipe()
	return &providerTestFakeTransport{
		stdin:   newProviderTestBufferedPipe(),
		stdoutR: stdoutR,
		stdoutW: stdoutW,
		stderrR: stderrR,
		stderrW: stderrW,
	}
}

func (f *providerTestFakeTransport) Stdin() io.Writer  { return f.stdin }
func (f *providerTestFakeTransport) Stdout() io.Reader { return f.stdoutR }
func (f *providerTestFakeTransport) Stderr() io.Reader { return f.stderrR }
func (f *providerTestFakeTransport) Kill() error {
	_ = f.stdoutW.Close()
	_ = f.stderrW.Close()
	return nil
}
func (f *providerTestFakeTransport) Wait() (*int, string, error) {
	zero := 0
	return &zero, "", nil
}

func (f *providerTestFakeTransport) answerInitialize(t *testing.T) {
	t.Helper()
	var req struct {
		ID     int    `json:"id"`
		Method string `json:"method"`
	}
	if err := json.Unmarshal(f.stdin.readFrame(), &req); err != nil {
		t.Fatalf("decode bridge request: %v", err)
	}
	if req.Method != "initialize" {
		t.Fatalf("bridge request method = %q, want initialize", req.Method)
	}
	body, err := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      req.ID,
		"result":  map[string]any{"serverName": "fake-officecli-agent-bridge"},
	})
	if err != nil {
		t.Fatalf("marshal bridge response: %v", err)
	}
	if _, err := fmt.Fprintf(f.stdoutW, "Content-Length: %d\r\n\r\n", len(body)); err != nil {
		t.Fatalf("write bridge header: %v", err)
	}
	if _, err := f.stdoutW.Write(body); err != nil {
		t.Fatalf("write bridge body: %v", err)
	}
}

func TestTestProviderOfficialModeReportsUnavailable(t *testing.T) {
	a := &App{
		proxyPool:      netproxy.NewPool(),
		cachedSettings: types.UserSettings{},
	}
	result, err := a.TestProvider()
	if err != nil {
		t.Fatalf("TestProvider: %v", err)
	}
	if result.OK || !result.Unavailable || result.URL != "official" {
		t.Fatalf("official mode result = %+v, want unavailable official result", result)
	}
	if !strings.Contains(result.Error, "official provider connection test is not available") {
		t.Fatalf("official mode error = %q", result.Error)
	}
}

func TestTestProviderOfficialModeDoesNotClaimBridgeInitializeAsProviderOK(t *testing.T) {
	fake := newProviderTestFakeTransport()
	client := bridge.New(bridge.Options{
		RequestTimeout: 500 * time.Millisecond,
		CreateTransport: func(opts bridge.Options) (bridge.Transport, error) {
			return fake, nil
		},
		DisableAutoReconnect: true,
	})
	if err := client.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer client.Stop()

	a := &App{
		proxyPool:      netproxy.NewPool(),
		cachedSettings: types.UserSettings{},
	}
	a.bridges.seed("/ws", map[string]*bridge.Client{"/ws": client})

	type outcome struct {
		result types.ProviderTestResult
		err    error
	}
	done := make(chan outcome, 1)
	go func() {
		result, err := a.TestProvider()
		done <- outcome{result: result, err: err}
	}()

	var out outcome
	select {
	case out = <-done:
	case <-time.After(20 * time.Millisecond):
		fake.answerInitialize(t)
		out = <-done
	}

	if out.err != nil {
		t.Fatalf("TestProvider: %v", out.err)
	}
	if out.result.OK || out.result.URL == "bridge:initialize" || !out.result.Unavailable || !strings.Contains(out.result.Error, "official provider connection test is not available") {
		t.Fatalf("official provider test should not report bridge initialize as provider OK, got %+v", out.result)
	}
}

func TestTestProviderWithInputOfficialPaidProbeRunsOfficeCLICommand(t *testing.T) {
	dir := t.TempDir()
	argsPath := filepath.Join(dir, "args.txt")
	envPath := filepath.Join(dir, "env.txt")
	t.Setenv(fakeOfficeCLIBehaviorEnv, "success")
	t.Setenv(fakeOfficeCLIArgsPathEnv, argsPath)
	t.Setenv(fakeOfficeCLIEnvPathEnv, envPath)
	fakeOfficeCLIPath := os.Args[0]

	appProxy := netproxy.NewPool()
	a := &App{
		proxyPool: appProxy,
		cachedSettings: types.UserSettings{
			BridgeBinaryPath: &fakeOfficeCLIPath,
			LlmProvider: &types.LlmProvider{
				Type:    types.LlmCustom,
				BaseURL: "http://cached.example/v1",
				APIKey:  "cached-key",
				Model:   "cached-model",
			},
		},
	}
	a.binary.seed(writeWhoamiFakeOfficeCLI(t, "logged_in"), nil, time.Now())

	result, err := a.TestProviderWithInput(types.ProviderTestInput{
		UseProviderOverride:    true,
		LlmProvider:            nil,
		UseProxyOverride:       true,
		Proxy:                  &types.ProxySettings{Enabled: true, URL: "http://proxy.test:7890"},
		AllowPaidOfficialProbe: true,
	})
	if err != nil {
		t.Fatalf("TestProviderWithInput: %v", err)
	}
	if !result.OK || result.URL != "official" || result.ProbeType != "officialPaid" {
		t.Fatalf("official paid probe result = %+v, want success", result)
	}

	argsBytes, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatalf("read args: %v", err)
	}
	args := strings.Split(strings.TrimSpace(string(argsBytes)), "\n")
	wantPrefix := []string{"new", "docx", "OfficeDex Provider Connection Test"}
	for i, want := range wantPrefix {
		if len(args) <= i || args[i] != want {
			t.Fatalf("args = %#v, want prefix %#v", args, wantPrefix)
		}
	}
	if !containsString(args, "--prompt") || !containsString(args, "--no-publish") || !containsString(args, "--json") {
		t.Fatalf("args missing required probe flags: %#v", args)
	}

	envBytes, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatalf("read env: %v", err)
	}
	env := string(envBytes)
	if !strings.Contains(env, "OFFICE_CLI_RUNTIME_MODE=hosted") {
		t.Fatalf("env missing hosted runtime mode:\n%s", env)
	}
	if !strings.Contains(env, "HTTP_PROXY=http://proxy.test:7890") && !strings.Contains(env, "http_proxy=http://proxy.test:7890") {
		t.Fatalf("env missing proxy override:\n%s", env)
	}
	if got := appProxy.Get(); got != nil {
		t.Fatalf("app proxy pool was mutated: %v", got)
	}
}

func TestTestProviderWithInputOfficialPaidProbeReturnsFailureSummary(t *testing.T) {
	t.Setenv(fakeOfficeCLIBehaviorEnv, "failure")
	fakeOfficeCLIPath := os.Args[0]

	a := &App{
		proxyPool: netproxy.NewPool(),
		cachedSettings: types.UserSettings{
			BridgeBinaryPath: &fakeOfficeCLIPath,
		},
	}
	result, err := a.TestProviderWithInput(types.ProviderTestInput{
		UseProviderOverride:    true,
		LlmProvider:            nil,
		AllowPaidOfficialProbe: true,
	})
	if err != nil {
		t.Fatalf("TestProviderWithInput: %v", err)
	}
	if result.OK || result.ProbeType != "officialPaid" || result.URL != "official" {
		t.Fatalf("official paid failure result = %+v, want failed paid probe", result)
	}
	if !strings.Contains(result.Error, "exit code 42") ||
		!strings.Contains(result.Error, "hosted provider unreachable") ||
		!strings.Contains(result.Error, "not enough credits") {
		t.Fatalf("failure summary = %q", result.Error)
	}
}

func TestTestProviderWithInputUsesOverridesWithoutMutatingCachedSettings(t *testing.T) {
	var seenProxyRequest bool
	proxyServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenProxyRequest = true
		if r.URL.String() != "http://upstream.example/v1/chat/completions" {
			t.Errorf("proxy request URL = %q", r.URL.String())
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"proxied ok"}}]}`))
	}))
	defer proxyServer.Close()

	appProxy := netproxy.NewPool()
	a := &App{
		proxyPool: appProxy,
		cachedSettings: types.UserSettings{
			LlmProvider: &types.LlmProvider{
				Type:    types.LlmCustom,
				BaseURL: "http://cached.example/v1",
				APIKey:  "cached-key",
				Model:   "cached-model",
			},
		},
	}

	result, err := a.TestProviderWithInput(types.ProviderTestInput{
		UseProviderOverride: true,
		LlmProvider: &types.LlmProvider{
			Type:    types.LlmCustom,
			BaseURL: "http://upstream.example/v1",
			APIKey:  "input-key",
			Model:   "input-model",
		},
		UseProxyOverride: true,
		Proxy: &types.ProxySettings{
			Enabled: true,
			URL:     proxyServer.URL,
		},
	})
	if err != nil {
		t.Fatalf("TestProviderWithInput: %v", err)
	}
	if !result.OK || result.ResponseMessage != "proxied ok" {
		t.Fatalf("result = %+v, want proxied success", result)
	}
	if !seenProxyRequest {
		t.Fatal("proxy server did not receive the provider test request")
	}
	if a.cachedSettings.LlmProvider == nil || a.cachedSettings.LlmProvider.BaseURL != "http://cached.example/v1" {
		t.Fatalf("cached settings were mutated: %+v", a.cachedSettings.LlmProvider)
	}
	if got := appProxy.Get(); got != nil {
		t.Fatalf("app proxy pool was mutated: %v", got)
	}
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
