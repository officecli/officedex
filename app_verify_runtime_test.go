package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"officedex/internal/config"
)

// stagePresentationRuntime writes the four files runtimeenv.IsRoot requires,
// plus the converter, so a temporary directory reads as a real runtime root.
func stagePresentationRuntime(t *testing.T, root string, withConverter bool) {
	t.Helper()
	for _, relative := range []string{
		"package.json",
		filepath.Join("node_modules", "vite", "dist", "node", "index.js"),
		filepath.Join("bos", "dist", "mop-wasm", "pkg", "mop_wasm_bg.wasm"),
		filepath.Join("tools", "fixtures", "blank-presentation", "content.json"),
	} {
		path := filepath.Join(root, relative)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("{}"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if !withConverter {
		return
	}
	binary := filepath.Join(root, "tools", "bin", config.ExecutableName("mop-convert"))
	if err := os.MkdirAll(filepath.Dir(binary), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(binary, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
}

// isolateRuntimeLookup points every resolver at an empty world, so a test only
// sees what it stages itself.
func isolateRuntimeLookup(t *testing.T) string {
	t.Helper()
	t.Setenv(config.MOPConvertBinEnv, "")
	t.Setenv(config.MOPConvertBinFallbackEnv, "")
	t.Setenv(config.PresentationSourceDirEnv, "")
	t.Setenv(config.Word2MowConvertBinEnv, "")
	t.Setenv(config.WriterFontsDirEnv, "")
	t.Setenv("PATH", t.TempDir())
	workdir := t.TempDir()
	t.Chdir(workdir)
	return workdir
}

// A local build stages nothing into Contents/Resources: it falls back to the
// presentation checkout beside the repository. That is the layout this check
// exists for, and the packaged-tree gate cannot see it.
func TestVerifyRuntimeDepsAcceptsACheckoutBesideTheRepository(t *testing.T) {
	workdir := isolateRuntimeLookup(t)
	stagePresentationRuntime(t, filepath.Join(workdir, "presentation"), true)

	var out bytes.Buffer
	if !verifyRuntimeDeps(&out) {
		t.Fatalf("verifyRuntimeDeps failed on a complete checkout:\n%s", out.String())
	}
	if !strings.Contains(out.String(), filepath.Join("presentation", "tools", "bin")) {
		t.Fatalf("report does not name the resolved converter:\n%s", out.String())
	}
}

// The bundle that shipped without a converter had a complete runtime tree, so
// every presence check passed. Only asking for the converter itself catches it.
func TestVerifyRuntimeDepsRejectsARuntimeWithoutTheConverter(t *testing.T) {
	workdir := isolateRuntimeLookup(t)
	stagePresentationRuntime(t, filepath.Join(workdir, "presentation"), false)

	var out bytes.Buffer
	if verifyRuntimeDeps(&out) {
		t.Fatalf("verifyRuntimeDeps passed without a converter:\n%s", out.String())
	}
	report := out.String()
	if !strings.Contains(report, "mop-convert") || !strings.Contains(report, "MISSING") {
		t.Fatalf("report does not explain the failure:\n%s", report)
	}
	if !strings.Contains(report, config.MOPConvertBinEnv) {
		t.Fatalf("report does not name the override variable:\n%s", report)
	}
}

// The Writer payloads are staged by packaging alone. Reporting them is useful;
// failing a local build over them is not.
func TestVerifyRuntimeDepsToleratesMissingWriterPayloads(t *testing.T) {
	workdir := isolateRuntimeLookup(t)
	stagePresentationRuntime(t, filepath.Join(workdir, "presentation"), true)

	var out bytes.Buffer
	if !verifyRuntimeDeps(&out) {
		t.Fatalf("verifyRuntimeDeps failed over Writer payloads alone:\n%s", out.String())
	}
	for _, label := range []string{"word2mow convert", "writer fonts"} {
		if !strings.Contains(out.String(), label) {
			t.Fatalf("report omits %q:\n%s", label, out.String())
		}
	}
}
