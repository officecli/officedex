package diagnostics

import (
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"testing"

	"officedex/internal/types"
)

func TestScrubFixtures(t *testing.T) {
	fixtureDir := filepath.Join("testdata", "stderr-samples")
	entries, err := os.ReadDir(fixtureDir)
	if err != nil {
		t.Fatalf("cannot read fixture directory %s: %v", fixtureDir, err)
	}

	var fixtures []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".log") {
			fixtures = append(fixtures, e.Name())
		}
	}
	if len(fixtures) < 1 {
		t.Fatal("testdata/stderr-samples must contain at least 1 .log fixture; empty dir causes CI failure")
	}

	sensitivePatterns := []*regexp.Regexp{
		regexp.MustCompile(`Bearer\s+\S{8,}`),
		regexp.MustCompile(`sk-[A-Za-z0-9]{16,}`),
		regexp.MustCompile(`apiKey=\S{4,}`),
		regexp.MustCompile(`Authorization:\s*\S{8,}`),
		regexp.MustCompile(`eyJ[A-Za-z0-9_\-\.]{10,}`),
		regexp.MustCompile(`token=eyJ`),
	}

	scrubber := NewScrubber(types.UserSettings{}, nil)

	for _, name := range fixtures {
		t.Run(name, func(t *testing.T) {
			data, err := os.ReadFile(filepath.Join(fixtureDir, name))
			if err != nil {
				t.Fatalf("read fixture: %v", err)
			}
			scrubbed := scrubber.ScrubBytes(data)
			lines := strings.Split(string(scrubbed), "\n")

			for lineNum, line := range lines {
				for _, pat := range sensitivePatterns {
					if loc := pat.FindStringIndex(line); loc != nil {
						matched := line[loc[0]:loc[1]]
						if matched != "Bearer [REDACTED]" &&
							matched != "Authorization: [REDACTED]" &&
							matched != "apiKey=[REDACTED]" &&
							matched != "token=[REDACTED]" &&
							matched != "[REDACTED]" {
							t.Errorf("line %d: sensitive pattern %q still present: %q", lineNum+1, pat.String(), matched)
						}
					}
				}
			}
		})
	}

	if runtime.GOOS != "windows" {
		t.Run("home_path_scrubbed", func(t *testing.T) {
			home, _ := os.UserHomeDir()
			if home == "" {
				t.Skip("no home dir")
			}
			for _, name := range fixtures {
				data, _ := os.ReadFile(filepath.Join(fixtureDir, name))
				scrubbed := scrubber.ScrubBytes(data)
				if strings.Contains(string(scrubbed), home) {
					t.Errorf("fixture %s: $HOME path %q not scrubbed", name, home)
				}
			}
		})
	}
}
