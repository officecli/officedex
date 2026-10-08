package diagnostics

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"officedex/internal/types"
)

func TestScrubLineRegexPatterns(t *testing.T) {
	scrubber := NewScrubber(types.UserSettings{}, nil)

	cases := []struct {
		name  string
		input string
		check func(string) bool
	}{
		{"bearer_token", "Authorization: Bearer sk-abc123def456ghi789", func(s string) bool {
			return s == "Authorization: [REDACTED]"
		}},
		{"authorization_no_bearer", "Authorization: SecretToken12345678", func(s string) bool {
			return s == "Authorization: [REDACTED]"
		}},
		{"api_key_param", "url?apiKey=my_secret_key_value", func(s string) bool {
			return strings.Contains(s, "apiKey=[REDACTED]")
		}},
		{"token_param", "token=eyJhbGciOiJIUzI1NiJ9.payload.sig", func(s string) bool {
			return strings.Contains(s, "token=[REDACTED]")
		}},
		{"sk_key", "key is sk-ABCDEFGHIJKLMNOP1234567890", func(s string) bool {
			return !strings.Contains(s, "sk-ABCDEFGHIJKLMNOP")
		}},
		{"jwt_token", "got eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.sig", func(s string) bool {
			return !strings.Contains(s, "eyJhbGciOiJ")
		}},
		{"clean_line_unchanged", "INFO: task completed successfully", func(s string) bool {
			return strings.Contains(s, "task completed successfully")
		}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			result := scrubber.ScrubLine(tc.input)
			if !tc.check(result) {
				t.Errorf("scrub(%q) = %q", tc.input, result)
			}
		})
	}
}

func TestScrubLineLiteralSubstitution(t *testing.T) {
	settings := types.UserSettings{
		LlmProvider: &types.LlmProvider{
			APIKey:  "real-api-key-from-settings",
			BaseURL: "https://api.example.com/v1",
		},
	}
	bridgeEnv := []string{
		"OFFICECLI_LLM_API_KEY=env-api-key-12345",
		"OFFICECLI_LLM_BASE_URL=https://env.example.com/api",
		"OFFICECLI_LLM_MODEL=gpt-4",
	}
	scrubber := NewScrubber(settings, bridgeEnv)

	cases := []struct {
		name  string
		input string
		want  string
	}{
		{"settings_api_key", "using key real-api-key-from-settings here", "using key [REDACTED_API_KEY] here"},
		{"settings_base_url", "calling https://api.example.com/v1/chat", "calling [REDACTED_BASE_URL]/chat"},
		{"env_api_key", "env key is env-api-key-12345", "env key is [REDACTED_API_KEY]"},
		{"env_base_url", "url=https://env.example.com/api/completions", "url=[REDACTED_BASE_URL]/completions"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := scrubber.ScrubLine(tc.input)
			if got != tc.want {
				t.Errorf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestScrubPathHome(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		t.Skip("no home dir available")
	}
	scrubber := NewScrubber(types.UserSettings{}, nil)
	input := "file at " + filepath.ToSlash(home) + "/Documents/test.txt"
	got := scrubber.ScrubLine(input)
	if strings.Contains(got, filepath.ToSlash(home)) {
		t.Errorf("home not scrubbed: %q", got)
	}
	if !strings.Contains(got, "~/Documents/test.txt") {
		t.Errorf("expected ~/Documents/test.txt in result, got %q", got)
	}
}

func TestScrubPathWorkspace(t *testing.T) {
	workspace := "/Volumes/Work/officedex-workspace"
	scrubber := NewScrubberWithWorkspace(types.UserSettings{}, nil, workspace)
	input := "wrote " + workspace + "/output/report.docx"
	got := scrubber.ScrubLine(input)
	if strings.Contains(got, workspace) {
		t.Errorf("workspace not scrubbed: %q", got)
	}
	if !strings.Contains(got, "<workspace>/output/report.docx") {
		t.Errorf("expected <workspace>/output/report.docx in result, got %q", got)
	}
}

func TestScrubBytesMultiLine(t *testing.T) {
	scrubber := NewScrubber(types.UserSettings{}, nil)
	input := "line1 Bearer sk-ABCDEFGHIJKLMNOP1234\nline2 clean\nline3 apiKey=secret123"
	got := scrubber.ScrubBytes([]byte(input))
	result := string(got)
	if strings.Contains(result, "sk-ABCDEFGHIJKLMNOP") {
		t.Error("sk- key not scrubbed in multiline")
	}
	if !strings.Contains(result, "apiKey=[REDACTED]") {
		t.Error("apiKey not scrubbed in multiline")
	}
}
