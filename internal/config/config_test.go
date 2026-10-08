package config

import (
	"os"
	"path/filepath"
	"testing"
)

func writeExecutable(t *testing.T, dir, name string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

// The app and the pptxeditor package resolved mop-convert from the same two
// variables, but only one of them made the path absolute. A packaged app does
// not run from the directory the value was written relative to, so the
// relative reading found nothing -- or worse, something else.
func TestExecutablePathIsAlwaysAbsolute(t *testing.T) {
	dir := t.TempDir()
	writeExecutable(t, dir, "mop-convert")
	t.Chdir(dir)
	t.Setenv(MOPConvertBinEnv, "./mop-convert")

	got := ExecutablePath(MOPConvertBinEnv)
	if !filepath.IsAbs(got) {
		t.Fatalf("ExecutablePath returned %q, want an absolute path", got)
	}
	if filepath.Base(got) != "mop-convert" {
		t.Fatalf("ExecutablePath returned %q", got)
	}
}

func TestExecutablePathRejectsWhatCannotBeRun(t *testing.T) {
	dir := t.TempDir()
	notExecutable := filepath.Join(dir, "data.txt")
	if err := os.WriteFile(notExecutable, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	for name, value := range map[string]string{
		"unset":          "",
		"whitespace":     "   ",
		"missing":        filepath.Join(dir, "absent"),
		"a directory":    dir,
		"not executable": notExecutable,
	} {
		t.Setenv(MOPConvertBinEnv, value)
		if got := ExecutablePath(MOPConvertBinEnv); got != "" {
			t.Errorf("%s: ExecutablePath = %q, want empty", name, got)
		}
	}
}

// The fallback variable is consulted only when the first names nothing usable.
func TestFirstExecutablePathPrefersTheEarlierVariable(t *testing.T) {
	dir := t.TempDir()
	primary := writeExecutable(t, dir, "primary")
	fallback := writeExecutable(t, dir, "fallback")

	t.Setenv(MOPConvertBinEnv, primary)
	t.Setenv(MOPConvertBinFallbackEnv, fallback)
	if got := FirstExecutablePath(MOPConvertBinaryEnvKeys...); got != primary {
		t.Fatalf("got %q, want the primary variable's value %q", got, primary)
	}

	t.Setenv(MOPConvertBinEnv, filepath.Join(dir, "absent"))
	if got := FirstExecutablePath(MOPConvertBinaryEnvKeys...); got != fallback {
		t.Fatalf("got %q, want the fallback %q when the primary names nothing runnable", got, fallback)
	}
}

// The demo and e2e gates each compared against a literal "1".
func TestEnabledAcceptsTheUsualWordsForTrue(t *testing.T) {
	for _, word := range []string{"1", "true", "on", "YES"} {
		t.Setenv(E2EHostEnv, word)
		if !Enabled(E2EHostEnv) {
			t.Errorf("%q should read as enabled", word)
		}
	}
	for _, word := range []string{"", "0", "false", "off", "maybe"} {
		t.Setenv(E2EHostEnv, word)
		if Enabled(E2EHostEnv) {
			t.Errorf("%q should not read as enabled", word)
		}
	}
}

// stageMopConvert writes a runnable mop-convert under dir/relative, named the
// way this platform names an executable.
func stageMopConvert(t *testing.T, dir string, relative ...string) string {
	t.Helper()
	target := filepath.Join(append([]string{dir}, relative...)...)
	if err := os.MkdirAll(target, 0o755); err != nil {
		t.Fatal(err)
	}
	return writeExecutable(t, target, ExecutableName("mop-convert"))
}

func clearMopConvertEnv(t *testing.T) {
	t.Helper()
	t.Setenv(MOPConvertBinEnv, "")
	t.Setenv(MOPConvertBinFallbackEnv, "")
	t.Setenv(PresentationSourceDirEnv, "")
}

// A packaged Windows build stages mop-convert.exe, but the MOP HTTP service
// looked for a suffix-less "mop-convert" and reported the converter as
// unavailable for every import and export. Both callers now build the name the
// same way.
func TestMopConvertBinaryUsesThePlatformExecutableName(t *testing.T) {
	clearMopConvertEnv(t)
	root := t.TempDir()
	binary := stageMopConvert(t, root, "tools", "bin")
	if got := MopConvertBinary(root, ""); got != binary {
		t.Fatalf("MopConvertBinary = %q, want %q", got, binary)
	}
}

// The PPTX editor searched a development checkout's build/presentation/bin and
// the MOP HTTP service did not, so a converter one of them could run was
// invisible to the other.
func TestMopConvertBinaryFindsTheDevelopmentCheckout(t *testing.T) {
	clearMopConvertEnv(t)
	repoRoot := t.TempDir()
	binary := stageMopConvert(t, repoRoot, "build", "presentation", "bin")
	if got := MopConvertBinary("", repoRoot); got != binary {
		t.Fatalf("MopConvertBinary = %q, want %q", got, binary)
	}
}

func TestMopConvertBinaryPrefersAnExplicitVariable(t *testing.T) {
	clearMopConvertEnv(t)
	bundled := t.TempDir()
	stageMopConvert(t, bundled, "tools", "bin")
	override := writeExecutable(t, t.TempDir(), ExecutableName("mop-convert"))
	t.Setenv(MOPConvertBinEnv, override)
	if got := MopConvertBinary(bundled, ""); got != override {
		t.Fatalf("MopConvertBinary = %q, want the override %q", got, override)
	}
}

func TestMopConvertBinaryReportsNothingWhenNoBuildStagedIt(t *testing.T) {
	clearMopConvertEnv(t)
	t.Setenv("PATH", t.TempDir())
	if got := MopConvertBinary(t.TempDir(), t.TempDir()); got != "" {
		t.Fatalf("MopConvertBinary = %q, want \"\"", got)
	}
}
