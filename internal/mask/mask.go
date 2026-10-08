// Package mask renders sensitive values into a form safe for the UI / logs /
// support bundles. The renderer surfaces produced here are read by the
// "currently effective" runtime snapshot — they must never contain the raw
// credential and must remain stable so screenshots from users are useful for
// debugging without leaking the underlying secret.
package mask

import (
	"net/url"
	"strings"
)

const bullet = "••••••"

// APIKey returns a redacted form like "sk-a••••••wxyz". The prefix/suffix
// length is tiered so very short inputs don't reveal a meaningful slice of the
// real key. Empty (after trim) returns "".
//
//   - len ≤ 8:    only bullets, no prefix/suffix
//   - len 9..16:  2-char prefix + bullets + 2-char suffix
//   - len > 16:   4-char prefix + bullets + 4-char suffix
//
// The function operates on runes so multi-byte characters do not split.
func APIKey(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	runes := []rune(trimmed)
	n := len(runes)
	if n <= 8 {
		return bullet
	}
	keep := 2
	if n > 16 {
		keep = 4
	}
	return string(runes[:keep]) + bullet + string(runes[n-keep:])
}

// Host returns scheme://host (no path, query, fragment, or userinfo) for a URL
// safe to render. Returns "" when the input cannot be parsed or is missing
// scheme/host. Default ports are preserved if the caller included them so the
// user can still verify the actual port their requests target.
func Host(rawURL string) string {
	trimmed := strings.TrimSpace(rawURL)
	if trimmed == "" {
		return ""
	}
	u, err := url.Parse(trimmed)
	if err != nil {
		return ""
	}
	if u.Scheme == "" || u.Host == "" {
		return ""
	}
	return u.Scheme + "://" + u.Host
}
