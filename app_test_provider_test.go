package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
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

func TestProviderProbeFor(t *testing.T) {
	cases := []struct {
		name    string
		input   types.LlmProvider
		wantU   string
		wantH   map[string]string
		wantM   string
		hasBody bool
	}{
		{
			name:    "openai",
			input:   types.LlmProvider{Type: types.LlmOpenAI, BaseURL: "https://api.openai.com/v1", APIKey: "sk-abc", Model: "gpt-4"},
			wantU:   "https://api.openai.com/v1/chat/completions",
			wantH:   map[string]string{"Authorization": "Bearer sk-abc", "Content-Type": "application/json"},
			wantM:   http.MethodPost,
			hasBody: true,
		},
		{
			name:    "azure",
			input:   types.LlmProvider{Type: types.LlmAzure, BaseURL: "https://x.openai.azure.com", APIKey: "az-key", Model: "gpt-4"},
			wantU:   "https://x.openai.azure.com/openai/deployments/gpt-4/chat/completions?api-version=2024-02-15-preview",
			wantH:   map[string]string{"api-key": "az-key", "Content-Type": "application/json"},
			wantM:   http.MethodPost,
			hasBody: true,
		},
		{
			name:    "anthropic",
			input:   types.LlmProvider{Type: types.LlmAnthropic, BaseURL: "https://api.anthropic.com", APIKey: "ant-key", Model: "claude-3-opus"},
			wantU:   "https://api.anthropic.com/v1/messages",
			wantH:   map[string]string{"x-api-key": "ant-key", "anthropic-version": "2023-06-01", "Content-Type": "application/json"},
			wantM:   http.MethodPost,
			hasBody: true,
		},
		{
			name:    "custom-chat-completions",
			input:   types.LlmProvider{Type: types.LlmCustom, BaseURL: "https://4zapi.com/v1", APIKey: "sk-x", Model: "gpt-4"},
			wantU:   "https://4zapi.com/v1/chat/completions",
			wantH:   map[string]string{"Authorization": "Bearer sk-x", "Content-Type": "application/json"},
			wantM:   http.MethodPost,
			hasBody: true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p, err := providerProbeFor(tc.input)
			if err != nil {
				t.Fatalf("providerProbeFor: %v", err)
			}
			if p.method != tc.wantM {
				t.Errorf("method = %q, want %q", p.method, tc.wantM)
			}
			if p.url != tc.wantU {
				t.Errorf("url = %q, want %q", p.url, tc.wantU)
			}
			for k, v := range tc.wantH {
				if p.headers[k] != v {
					t.Errorf("header %q = %q, want %q", k, p.headers[k], v)
				}
			}
			if tc.hasBody && len(p.body) == 0 {
				t.Error("expected body but got none")
			}
		})
	}
}

func TestProviderProbeForCustomEmbedsModel(t *testing.T) {
	p, err := providerProbeFor(types.LlmProvider{
		Type: types.LlmCustom, BaseURL: "https://x.example.com", APIKey: "k", Model: "Deepseek-v4-flash4",
	})
	if err != nil {
		t.Fatalf("providerProbeFor: %v", err)
	}
	var body map[string]any
	if err := json.Unmarshal(p.body, &body); err != nil {
		t.Fatalf("body not JSON: %v", err)
	}
	if body["model"] != "Deepseek-v4-flash4" {
		t.Errorf("body.model = %v, want Deepseek-v4-flash4", body["model"])
	}
	if body["max_tokens"].(float64) != 50 {
		t.Errorf("body.max_tokens = %v, want 50", body["max_tokens"])
	}
	if body["stream"] != false {
		t.Errorf("body.stream = %v, want false", body["stream"])
	}
	msgs, ok := body["messages"].([]any)
	if !ok || len(msgs) == 0 {
		t.Fatal("messages missing or empty")
	}
	msg0 := msgs[0].(map[string]any)
	if msg0["role"] != "user" || msg0["content"] != "hi" {
		t.Errorf("messages[0] = %+v, want {role:user, content:hi}", msg0)
	}
}

func TestProviderProbeForRejectsEmpty(t *testing.T) {
	_, err := providerProbeFor(types.LlmProvider{Type: types.LlmOpenAI, BaseURL: ""})
	if err == nil {
		t.Fatal("expected error for empty BaseURL")
	}
}

func TestRunHTTPProbe(t *testing.T) {
	t.Run("openai-200-with-hi-response", func(t *testing.T) {
		var seenAuth, seenPath, seenMethod string
		var receivedBody map[string]any
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			seenAuth = r.Header.Get("Authorization")
			seenPath = r.URL.Path
			seenMethod = r.Method
			data, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(data, &receivedBody)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"Hello! How can I help?"}}]}`))
		}))
		defer srv.Close()
		p, _ := providerProbeFor(types.LlmProvider{Type: types.LlmOpenAI, BaseURL: srv.URL, APIKey: "sk-test", Model: "gpt-4"})
		res := runHTTPProbe(context.Background(), netproxy.NewPool(), p)
		if !res.OK || res.HTTPStatus != 200 {
			t.Errorf("res = %+v", res)
		}
		if seenAuth != "Bearer sk-test" {
			t.Errorf("Authorization header = %q", seenAuth)
		}
		if seenPath != "/chat/completions" {
			t.Errorf("path = %q, want /chat/completions", seenPath)
		}
		if seenMethod != http.MethodPost {
			t.Errorf("method = %q, want POST", seenMethod)
		}
		if receivedBody["model"] != "gpt-4" {
			t.Errorf("body.model = %v", receivedBody["model"])
		}
		msgs, ok := receivedBody["messages"].([]any)
		if !ok || len(msgs) == 0 {
			t.Fatal("messages missing")
		}
		msg0 := msgs[0].(map[string]any)
		if msg0["role"] != "user" || msg0["content"] != "hi" {
			t.Errorf("messages = %+v, want {role:user, content:hi}", msg0)
		}
		if res.ResponseMessage == "" {
			t.Error("expected ResponseMessage but got empty")
		}
	})

	t.Run("anthropic-200-with-hi-response", func(t *testing.T) {
		var seenKey, seenVer string
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			seenKey = r.Header.Get("x-api-key")
			seenVer = r.Header.Get("anthropic-version")
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"content":[{"type":"text","text":"Hello! How can I help?"}]}`))
		}))
		defer srv.Close()
		p, _ := providerProbeFor(types.LlmProvider{Type: types.LlmAnthropic, BaseURL: srv.URL, APIKey: "ant-key", Model: "claude-3"})
		res := runHTTPProbe(context.Background(), netproxy.NewPool(), p)
		if !res.OK || res.HTTPStatus != 200 {
			t.Errorf("res = %+v", res)
		}
		if seenKey != "ant-key" || seenVer != "2023-06-01" {
			t.Errorf("headers = %q / %q", seenKey, seenVer)
		}
		if res.ResponseMessage == "" {
			t.Error("expected ResponseMessage but got empty")
		}
	})

	t.Run("anthropic-401-key-rejected", func(t *testing.T) {
		var seenKey, seenVer string
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			seenKey = r.Header.Get("x-api-key")
			seenVer = r.Header.Get("anthropic-version")
			w.WriteHeader(http.StatusUnauthorized)
		}))
		defer srv.Close()
		p, _ := providerProbeFor(types.LlmProvider{Type: types.LlmAnthropic, BaseURL: srv.URL, APIKey: "bad", Model: "claude-3"})
		res := runHTTPProbe(context.Background(), netproxy.NewPool(), p)
		if res.OK {
			t.Errorf("expected OK=false on 401")
		}
		if res.HTTPStatus != 401 {
			t.Errorf("HTTPStatus = %d", res.HTTPStatus)
		}
		if seenKey != "bad" || seenVer != "2023-06-01" {
			t.Errorf("headers = %q / %q", seenKey, seenVer)
		}
	})

	t.Run("custom-posts-chat-completions-body", func(t *testing.T) {
		var receivedBody map[string]any
		var seenMethod, seenPath, seenAuth, seenContentType string
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			seenMethod = r.Method
			seenPath = r.URL.Path
			seenAuth = r.Header.Get("Authorization")
			seenContentType = r.Header.Get("Content-Type")
			data, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(data, &receivedBody)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"pong"}}]}`))
		}))
		defer srv.Close()
		p, _ := providerProbeFor(types.LlmProvider{
			Type: types.LlmCustom, BaseURL: srv.URL, APIKey: "sk-x", Model: "gpt-4o-mini",
		})
		res := runHTTPProbe(context.Background(), netproxy.NewPool(), p)
		if !res.OK || res.HTTPStatus != 200 {
			t.Errorf("res = %+v", res)
		}
		if seenMethod != http.MethodPost {
			t.Errorf("method = %q, want POST", seenMethod)
		}
		if seenPath != "/chat/completions" {
			t.Errorf("path = %q", seenPath)
		}
		if seenAuth != "Bearer sk-x" {
			t.Errorf("Authorization = %q", seenAuth)
		}
		if seenContentType != "application/json" {
			t.Errorf("Content-Type = %q", seenContentType)
		}
		if receivedBody["model"] != "gpt-4o-mini" {
			t.Errorf("model in body = %v", receivedBody["model"])
		}
		if receivedBody["max_tokens"].(float64) != 50 {
			t.Errorf("max_tokens = %v, want 50", receivedBody["max_tokens"])
		}
		msgs, ok := receivedBody["messages"].([]any)
		if !ok || len(msgs) == 0 {
			t.Fatal("messages missing")
		}
		msg0 := msgs[0].(map[string]any)
		if msg0["role"] != "user" || msg0["content"] != "hi" {
			t.Errorf("messages = %+v, want {role:user, content:hi}", msg0)
		}
	})

	t.Run("custom-404-wrong-path", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusNotFound)
		}))
		defer srv.Close()
		p, _ := providerProbeFor(types.LlmProvider{
			Type: types.LlmCustom, BaseURL: srv.URL + "/v12", APIKey: "k", Model: "x",
		})
		res := runHTTPProbe(context.Background(), netproxy.NewPool(), p)
		if res.OK {
			t.Errorf("expected OK=false on 404, got %+v", res)
		}
		if res.HTTPStatus != 404 {
			t.Errorf("HTTPStatus = %d, want 404", res.HTTPStatus)
		}
	})

	t.Run("custom-400-model-not-found", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":{"message":"model_not_found"}}`))
		}))
		defer srv.Close()
		p, _ := providerProbeFor(types.LlmProvider{
			Type: types.LlmCustom, BaseURL: srv.URL, APIKey: "k", Model: "ghost-model",
		})
		res := runHTTPProbe(context.Background(), netproxy.NewPool(), p)
		if res.OK {
			t.Errorf("expected OK=false on 400")
		}
		if res.HTTPStatus != 400 {
			t.Errorf("HTTPStatus = %d, want 400", res.HTTPStatus)
		}
	})

	t.Run("network-error-connection-refused", func(t *testing.T) {
		ln, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatalf("net.Listen: %v", err)
		}
		addr := ln.Addr().String()
		ln.Close()
		p, _ := providerProbeFor(types.LlmProvider{Type: types.LlmOpenAI, BaseURL: "http://" + addr, APIKey: "k", Model: "gpt-4"})
		res := runHTTPProbe(context.Background(), netproxy.NewPool(), p)
		if res.OK {
			t.Errorf("expected OK=false on closed port")
		}
		if res.HTTPStatus != 0 {
			t.Errorf("HTTPStatus = %d, want 0", res.HTTPStatus)
		}
		if res.Error == "" {
			t.Errorf("expected Error to be populated")
		}
	})
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
		bridgeClient:   client,
	}

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
	scriptPath := filepath.Join(dir, "officecli-probe.sh")
	script := fmt.Sprintf(`#!/bin/sh
printf '%%s\n' "$@" > %q
env > %q
printf '{"ok":true}\n'
exit 0
`, argsPath, envPath)
	if err := os.WriteFile(scriptPath, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake officecli: %v", err)
	}

	appProxy := netproxy.NewPool()
	a := &App{
		proxyPool: appProxy,
		cachedSettings: types.UserSettings{
			BridgeBinaryPath: &scriptPath,
			LlmProvider: &types.LlmProvider{
				Type:    types.LlmCustom,
				BaseURL: "http://cached.example/v1",
				APIKey:  "cached-key",
				Model:   "cached-model",
			},
		},
	}

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
	if !strings.Contains(env, "HTTP_PROXY=http://proxy.test:7890") {
		t.Fatalf("env missing proxy override:\n%s", env)
	}
	if got := appProxy.Get(); got != nil {
		t.Fatalf("app proxy pool was mutated: %v", got)
	}
}

func TestTestProviderWithInputOfficialPaidProbeReturnsFailureSummary(t *testing.T) {
	dir := t.TempDir()
	scriptPath := filepath.Join(dir, "officecli-probe.sh")
	script := `#!/bin/sh
printf 'stdout says not enough credits with extra details\n'
printf 'stderr says hosted provider unreachable\n' >&2
exit 42
`
	if err := os.WriteFile(scriptPath, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake officecli: %v", err)
	}

	a := &App{
		proxyPool: netproxy.NewPool(),
		cachedSettings: types.UserSettings{
			BridgeBinaryPath: &scriptPath,
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
