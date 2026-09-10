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

const workingNode = "#!/bin/sh\necho v24.18.0\n"

// abortingNode stands in for a runtime copied out of a package manager's tree:
// a real, executable file that dies the moment it is started.
const abortingNode = "#!/bin/sh\necho 'dyld: Library not loaded: @rpath/libnode.147.dylib' >&2\nexit 1\n"

// stageNode writes a node executable and returns its path.
func stageNode(t *testing.T, script string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), config.ExecutableName("node"))
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
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
	// NodeExecutable falls back to absolute paths that PATH cannot hide, so the
	// node in force is pinned explicitly -- the same variable officecli reads
	// first, and the one EffectiveNode reports.
	t.Setenv(config.SkillNodeEnv, stageNode(t, workingNode))
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

// The failure this check was blind to: a Node that resolves, is executable, and
// aborts on start. Presence said yes for four days of builds while every PPTX
// generation died in the worker.
func TestVerifyRuntimeDepsRejectsANodeThatDoesNotStart(t *testing.T) {
	workdir := isolateRuntimeLookup(t)
	stagePresentationRuntime(t, filepath.Join(workdir, "presentation"), true)
	t.Setenv(config.SkillNodeEnv, stageNode(t, abortingNode))

	var out bytes.Buffer
	if verifyRuntimeDeps(&out) {
		t.Fatalf("verifyRuntimeDeps passed with a Node that cannot start:\n%s", out.String())
	}
	report := out.String()
	for _, want := range []string{"mop node runtime", "BROKEN", "libnode.147.dylib", config.SkillNodeEnv} {
		if !strings.Contains(report, want) {
			t.Fatalf("report does not carry %q, so it cannot be acted on:\n%s", want, report)
		}
	}
}

// Naming the version is what makes "which Node won" answerable on a user's
// machine, which is the question this incident turned on.
func TestVerifyRuntimeDepsNamesTheNodeAndItsVersion(t *testing.T) {
	workdir := isolateRuntimeLookup(t)
	stagePresentationRuntime(t, filepath.Join(workdir, "presentation"), true)
	node := stageNode(t, workingNode)
	t.Setenv(config.SkillNodeEnv, node)

	var out bytes.Buffer
	if !verifyRuntimeDeps(&out) {
		t.Fatalf("verifyRuntimeDeps failed on a working Node:\n%s", out.String())
	}
	report := out.String()
	if !strings.Contains(report, node) || !strings.Contains(report, "v24.18.0") {
		t.Fatalf("report should name the Node in force and what it reported:\n%s", report)
	}
}

// An override naming something unrunnable is not the same as a broken runtime:
// officecli ignores such a value and resolves for itself, so the report has to
// fall back the same way rather than declaring the app broken over a stale
// variable. What cannot happen is the line going missing.
func TestVerifyRuntimeDepsFallsBackWhenTheOverrideIsUnusable(t *testing.T) {
	workdir := isolateRuntimeLookup(t)
	stagePresentationRuntime(t, filepath.Join(workdir, "presentation"), true)
	absent := filepath.Join(t.TempDir(), "absent-node")
	t.Setenv(config.SkillNodeEnv, absent)

	var out bytes.Buffer
	verifyRuntimeDeps(&out)
	report := out.String()
	if !strings.Contains(report, "mop node runtime") {
		t.Fatalf("report omits the node runtime entirely:\n%s", report)
	}
	if strings.Contains(report, absent) {
		t.Fatalf("report names an override that cannot be run:\n%s", report)
	}
}
