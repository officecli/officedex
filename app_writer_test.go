package main

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"officedex/internal/config"
)

// The Writer resources are staged by one script and found by another code path
// entirely -- scripts/bundle-runtime.mjs writes Contents/Resources, app_writer.go
// reads it. A rename on either side produces an app that starts fine and then
// answers 503 on every DOCX import, so pin the layout both agree on.
func TestWriterResourceCandidatesCoverBundleAndCheckout(t *testing.T) {
	candidates := writerResourceCandidates("writer-fonts", filepath.Join("build", "writer-fonts"))
	if len(candidates) == 0 {
		t.Fatal("no candidates")
	}

	executable, err := os.Executable()
	if err != nil {
		t.Fatalf("os.Executable: %v", err)
	}
	bundle := filepath.Join(filepath.Dir(executable), "..", "Resources", "writer-fonts")
	if candidates[0] != bundle {
		t.Fatalf("first candidate is %q, want the packaged Resources path %q", candidates[0], bundle)
	}

	cwd, ok := config.ProcessCwd()
	if !ok {
		t.Skip("no process cwd")
	}
	checkout := filepath.Join(cwd, "build", "writer-fonts")
	if !contains(candidates, checkout) {
		t.Fatalf("candidates %v do not include the checkout path %q", candidates, checkout)
	}
}

func TestResolveWriterFontsRootPrefersTheEnvironmentOverride(t *testing.T) {
	staged := t.TempDir()
	t.Setenv(config.WriterFontsDirEnv, staged)
	if resolved := resolveWriterFontsRoot(); resolved != staged {
		t.Fatalf("resolveWriterFontsRoot() = %q, want %q", resolved, staged)
	}

	// A path that is not a directory is ignored rather than returned, so a stale
	// override cannot mask a correctly staged closure.
	t.Setenv(config.WriterFontsDirEnv, filepath.Join(staged, "missing"))
	if resolved := resolveWriterFontsRoot(); resolved == filepath.Join(staged, "missing") {
		t.Fatal("resolveWriterFontsRoot() returned a path that is not a directory")
	}
}

func TestResolveWord2MowConvertPrefersTheEnvironmentOverride(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the executable bit is a POSIX concept")
	}
	binary := filepath.Join(t.TempDir(), "convert")
	if err := os.WriteFile(binary, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatalf("write: %v", err)
	}
	t.Setenv(config.Word2MowConvertBinEnv, binary)
	if resolved := resolveWord2MowConvert(); resolved != binary {
		t.Fatalf("resolveWord2MowConvert() = %q, want %q", resolved, binary)
	}
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
