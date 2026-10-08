package mask

import "testing"

func TestAPIKey(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"empty", "", ""},
		{"whitespace only", "   ", ""},
		{"five chars", "abcde", "••••••"},
		{"eight chars", "abcdefgh", "••••••"},
		{"nine chars", "abcdefghi", "ab••••••hi"},
		{"sixteen chars", "abcdefghijklmnop", "ab••••••op"},
		{"seventeen chars", "abcdefghijklmnopq", "abcd••••••nopq"},
		{"openai 51-char key", "sk-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK", "sk-a••••••HIJK"},
		{"multi-byte unicode", "🔑🔑🔑🔑🔑🔑🔑🔑🔑🔑🔑🔑🔑🔑🔑🔑🔑🔑", "🔑🔑🔑🔑••••••🔑🔑🔑🔑"},
		{"trimmed whitespace", "  sk-shortkey  ", "sk••••••ey"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := APIKey(tc.in)
			if got != tc.want {
				t.Errorf("APIKey(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestAPIKeyDoesNotLeakOriginal(t *testing.T) {
	raw := "sk-livekey1234567890abcdefghijABCDEFGHIJ"
	got := APIKey(raw)
	if got == raw {
		t.Fatalf("APIKey returned raw input")
	}
	// Long-key middle ("livekey1234567890abcdefghij") must not appear verbatim.
	middle := raw[6 : len(raw)-4]
	if got != "" && containsSubstring(got, middle) {
		t.Errorf("APIKey leaked middle %q in %q", middle, got)
	}
}

func TestHost(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"empty", "", ""},
		{"whitespace", "   ", ""},
		{"plain https", "https://api.openai.com", "https://api.openai.com"},
		{"https with path", "https://api.openai.com/v1/chat", "https://api.openai.com"},
		{"https with query", "https://api.openai.com/v1?key=secret", "https://api.openai.com"},
		{"http custom port", "http://127.0.0.1:7890", "http://127.0.0.1:7890"},
		{"userinfo stripped", "https://user:pass@api.example.com/path", "https://api.example.com"},
		{"socks proxy", "socks5://10.0.0.1:1080", "socks5://10.0.0.1:1080"},
		{"missing scheme", "api.openai.com/v1", ""},
		{"missing host", "https://", ""},
		{"garbage", "not a url ::::", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := Host(tc.in)
			if got != tc.want {
				t.Errorf("Host(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

func containsSubstring(haystack, needle string) bool {
	if len(needle) == 0 {
		return true
	}
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
