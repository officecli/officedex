package netproxy

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func TestValidateURLAcceptsAllowedSchemes(t *testing.T) {
	cases := []string{
		"http://127.0.0.1:7890",
		"https://proxy.example.com:8080",
		"socks5://localhost:1080",
		"socks5h://user:pass@proxy.lan:1080",
	}
	for _, raw := range cases {
		got, err := ValidateURL(raw)
		if err != nil {
			t.Fatalf("ValidateURL(%q) returned err: %v", raw, err)
		}
		if got == nil {
			t.Fatalf("ValidateURL(%q) returned nil, want parsed", raw)
		}
	}
}

func TestValidateURLEmptyIsNoProxy(t *testing.T) {
	for _, raw := range []string{"", "   ", "\t"} {
		got, err := ValidateURL(raw)
		if err != nil {
			t.Fatalf("ValidateURL(%q) err: %v", raw, err)
		}
		if got != nil {
			t.Fatalf("ValidateURL(%q) = %v, want nil", raw, got)
		}
	}
}

func TestValidateURLRejectsBadInput(t *testing.T) {
	cases := []string{
		"not-a-url",
		"127.0.0.1:7890",          // missing scheme
		"http://",                  // missing host
		"ftp://example.com",        // wrong scheme
		"socks4://localhost:1080",  // unsupported variant
	}
	for _, raw := range cases {
		if _, err := ValidateURL(raw); err == nil {
			t.Errorf("ValidateURL(%q) returned nil err, expected rejection", raw)
		}
	}
}

func TestPoolSetClearGet(t *testing.T) {
	p := NewPool()
	if got := p.Get(); got != nil {
		t.Fatalf("fresh pool Get() = %v, want nil", got)
	}

	if err := p.Set("http://10.0.0.1:8080"); err != nil {
		t.Fatalf("Set err: %v", err)
	}
	if got := p.Get(); got == nil || got.Host != "10.0.0.1:8080" {
		t.Fatalf("Get after Set = %v", got)
	}

	if err := p.Set(""); err != nil {
		t.Fatalf("Set empty err: %v", err)
	}
	if got := p.Get(); got != nil {
		t.Fatalf("Get after Set(empty) = %v, want nil", got)
	}

	if err := p.Set("https://proxy:9"); err != nil {
		t.Fatalf("Set https err: %v", err)
	}
	p.Clear()
	if got := p.Get(); got != nil {
		t.Fatalf("Get after Clear = %v", got)
	}
}

func TestPoolSetInvalidLeavesPrevious(t *testing.T) {
	p := NewPool()
	if err := p.Set("http://good:1"); err != nil {
		t.Fatalf("seed Set err: %v", err)
	}
	before := p.Get()
	if err := p.Set("ftp://nope"); err == nil {
		t.Fatal("Set(ftp) returned nil err, expected rejection")
	}
	if after := p.Get(); after != before {
		t.Fatalf("Set(invalid) mutated pool: before=%v after=%v", before, after)
	}
}

func TestSubprocessEnvShape(t *testing.T) {
	p := NewPool()
	if env := p.SubprocessEnv(); env != nil {
		t.Fatalf("empty pool SubprocessEnv = %v, want nil", env)
	}

	if err := p.Set("http://127.0.0.1:7890"); err != nil {
		t.Fatalf("Set err: %v", err)
	}
	env := p.SubprocessEnv()
	if len(env) != 6 {
		t.Fatalf("SubprocessEnv len = %d, want 6 (got %v)", len(env), env)
	}
	wantKeys := map[string]bool{
		"HTTP_PROXY": false, "HTTPS_PROXY": false, "ALL_PROXY": false,
		"http_proxy": false, "https_proxy": false, "all_proxy": false,
	}
	for _, kv := range env {
		key, val, ok := strings.Cut(kv, "=")
		if !ok {
			t.Fatalf("bad env entry %q", kv)
		}
		if _, expected := wantKeys[key]; !expected {
			t.Fatalf("unexpected env key %q", key)
		}
		if val != "http://127.0.0.1:7890" {
			t.Fatalf("env %q value = %q, want http://127.0.0.1:7890", key, val)
		}
		wantKeys[key] = true
	}
	for k, seen := range wantKeys {
		if !seen {
			t.Fatalf("missing env key %q", k)
		}
	}
}

func TestProxyFuncReturnsCurrent(t *testing.T) {
	p := NewPool()
	req := httptest.NewRequest(http.MethodGet, "https://example.com/x", nil)
	got, err := p.ProxyFunc(req)
	if err != nil || got != nil {
		t.Fatalf("empty pool ProxyFunc = (%v, %v)", got, err)
	}
	if err := p.Set("http://proxy:1"); err != nil {
		t.Fatalf("Set err: %v", err)
	}
	got, err = p.ProxyFunc(req)
	if err != nil {
		t.Fatalf("ProxyFunc err: %v", err)
	}
	if got == nil || got.Host != "proxy:1" {
		t.Fatalf("ProxyFunc = %v", got)
	}
}

func TestPoolConcurrentSetGet(t *testing.T) {
	p := NewPool()
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 200; j++ {
				_ = p.Set("http://h:1")
				_ = p.Get()
				p.Clear()
				_ = p.SubprocessEnv()
			}
		}()
	}
	wg.Wait()
}

func TestNewClientWiresProxy(t *testing.T) {
	p := NewPool()
	if err := p.Set("http://127.0.0.1:65535"); err != nil {
		t.Fatalf("Set err: %v", err)
	}
	c := p.NewClient(0)
	transport, ok := c.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("client transport type = %T, want *http.Transport", c.Transport)
	}
	if transport.Proxy == nil {
		t.Fatal("transport.Proxy is nil")
	}
	req := httptest.NewRequest(http.MethodGet, "https://example.com/", nil)
	got, err := transport.Proxy(req)
	if err != nil {
		t.Fatalf("transport.Proxy err: %v", err)
	}
	if got == nil || got.Host != "127.0.0.1:65535" {
		t.Fatalf("transport.Proxy = %v", got)
	}
}
