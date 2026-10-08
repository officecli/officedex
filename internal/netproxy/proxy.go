// Package netproxy centralises HTTP proxy configuration for OfficeDex. A
// single Pool instance is shared by every outbound HTTP client (app update
// manifest+downloads, officecli runtime downloads, support report submits)
// and by the bridge subprocess (officecli) via injected env vars. The pool
// holds the active proxy URL atomically so a renderer-side toggle from
// Settings can swap proxies without restarting the app.
package netproxy

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync/atomic"
	"time"
)

// AllowedSchemes are the URL schemes the renderer is allowed to configure.
var AllowedSchemes = []string{"http", "https", "socks5", "socks5h"}

// Pool is a thread-safe holder of the currently-configured proxy URL.
// The zero value is ready to use (and means "no proxy").
type Pool struct {
	current atomic.Pointer[url.URL]
}

// NewPool returns an empty Pool.
func NewPool() *Pool { return &Pool{} }

// Set parses rawURL and stores it as the active proxy. Empty/whitespace
// rawURL is equivalent to Clear(). Invalid scheme/host returns an error and
// leaves the previous value in place.
func (p *Pool) Set(rawURL string) error {
	parsed, err := ValidateURL(rawURL)
	if err != nil {
		return err
	}
	p.current.Store(parsed)
	return nil
}

func (p *Pool) Clear() { p.current.Store(nil) }

func (p *Pool) Get() *url.URL { return p.current.Load() }

// ProxyFunc matches the http.Transport.Proxy signature.
func (p *Pool) ProxyFunc(_ *http.Request) (*url.URL, error) {
	return p.current.Load(), nil
}

// NewClient returns an *http.Client whose transport honours the pool's
// proxy on every request. A zero timeout disables the client-level
// timeout (callers can still use per-request contexts).
func (p *Pool) NewClient(timeout time.Duration) *http.Client {
	transport := defaultTransport()
	transport.Proxy = p.ProxyFunc
	return &http.Client{Transport: transport, Timeout: timeout}
}

// SubprocessEnv returns the KEY=VAL entries to append to a subprocess
// environment so it inherits the active proxy. Both upper- and lower-case
// forms are emitted because Go and many other clients pick different
// conventions. Returns nil when no proxy is configured.
func (p *Pool) SubprocessEnv() []string {
	u := p.current.Load()
	if u == nil {
		return nil
	}
	s := u.String()
	return []string{
		"HTTP_PROXY=" + s,
		"HTTPS_PROXY=" + s,
		"ALL_PROXY=" + s,
		"http_proxy=" + s,
		"https_proxy=" + s,
		"all_proxy=" + s,
	}
}

// ValidateURL parses rawURL and returns a normalised *url.URL when the
// input is acceptable as a proxy target. Empty/whitespace input is treated
// as "no proxy" and returns (nil, nil).
func ValidateURL(rawURL string) (*url.URL, error) {
	trimmed := strings.TrimSpace(rawURL)
	if trimmed == "" {
		return nil, nil
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return nil, fmt.Errorf("invalid proxy URL: %w", err)
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("proxy URL must include scheme and host (e.g. http://127.0.0.1:7890)")
	}
	if !schemeAllowed(parsed.Scheme) {
		return nil, fmt.Errorf("unsupported proxy scheme %q (use one of %s)", parsed.Scheme, strings.Join(AllowedSchemes, ", "))
	}
	return parsed, nil
}

func schemeAllowed(scheme string) bool {
	scheme = strings.ToLower(scheme)
	for _, allowed := range AllowedSchemes {
		if scheme == allowed {
			return true
		}
	}
	return false
}

// defaultTransport clones the std-lib default transport so per-call tweaks
// don't mutate the global. We rely on Clone() to preserve the upstream
// timeouts (dial, TLS handshake, idle connection limits).
func defaultTransport() *http.Transport {
	base, ok := http.DefaultTransport.(*http.Transport)
	if !ok {
		return &http.Transport{}
	}
	return base.Clone()
}
