// Multi-line tokens are NOT supported; each line is scrubbed independently.
package diagnostics

import (
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"

	"officedex/internal/types"
)

var scrubPatterns = []*regexp.Regexp{
	regexp.MustCompile(`Authorization:\s*\S+(\s+\S+)?`),
	regexp.MustCompile(`Bearer\s+\S+`),
	regexp.MustCompile(`apiKey=\S+`),
	regexp.MustCompile(`token=\S+`),
	regexp.MustCompile(`sk-[A-Za-z0-9]{16,}`),
	regexp.MustCompile(`eyJ[A-Za-z0-9_\-\.]{10,}`),
}

var scrubReplacements = []string{
	"Authorization: [REDACTED]",
	"Bearer [REDACTED]",
	"apiKey=[REDACTED]",
	"token=[REDACTED]",
	"[REDACTED]",
	"[REDACTED]",
}

type Scrubber struct {
	literals      map[string]string
	homePath      string
	workspacePath string
}

func NewScrubber(settings types.UserSettings, bridgeEnv []string) *Scrubber {
	return NewScrubberWithWorkspace(settings, bridgeEnv, "")
}

func NewScrubberWithWorkspace(settings types.UserSettings, bridgeEnv []string, workspaceDir string) *Scrubber {
	s := &Scrubber{
		literals:      make(map[string]string),
		workspacePath: workspaceDir,
	}
	s.homePath, _ = os.UserHomeDir()

	if settings.LlmProvider != nil {
		if settings.LlmProvider.APIKey != "" {
			s.literals[settings.LlmProvider.APIKey] = "[REDACTED_API_KEY]"
		}
		if settings.LlmProvider.BaseURL != "" {
			s.literals[settings.LlmProvider.BaseURL] = "[REDACTED_BASE_URL]"
		}
	}

	for _, kv := range bridgeEnv {
		if k, v, ok := strings.Cut(kv, "="); ok && v != "" {
			switch k {
			case "OFFICECLI_LLM_API_KEY":
				s.literals[v] = "[REDACTED_API_KEY]"
			case "OFFICECLI_LLM_BASE_URL":
				s.literals[v] = "[REDACTED_BASE_URL]"
			}
		}
	}

	return s
}

func (s *Scrubber) ScrubLine(line string) string {
	for literal, replacement := range s.literals {
		if strings.Contains(line, literal) {
			line = strings.ReplaceAll(line, literal, replacement)
		}
	}

	for i, pat := range scrubPatterns {
		line = pat.ReplaceAllStringFunc(line, func(match string) string {
			if strings.Contains(match, "[REDACTED]") {
				return match
			}
			return scrubReplacements[i]
		})
	}

	line = s.scrubPaths(line)
	return line
}

func (s *Scrubber) ScrubBytes(data []byte) []byte {
	lines := strings.Split(string(data), "\n")
	for i, line := range lines {
		lines[i] = s.ScrubLine(line)
	}
	return []byte(strings.Join(lines, "\n"))
}

func (s *Scrubber) scrubPaths(line string) string {
	normalized := filepath.ToSlash(line)

	if s.workspacePath != "" {
		wsSlash := filepath.ToSlash(s.workspacePath)
		normalized = strings.ReplaceAll(normalized, wsSlash, "<workspace>")
	}

	if s.homePath != "" {
		homeSlash := filepath.ToSlash(s.homePath)
		normalized = strings.ReplaceAll(normalized, homeSlash, "~")
	}

	if runtime.GOOS == "windows" {
		winHomeRe := regexp.MustCompile(`[A-Z]:/Users/[^/]+`)
		normalized = winHomeRe.ReplaceAllString(normalized, "~")
	}

	return normalized
}
