package runtimeenv

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPresentationRuntimeEnvFindsSiblingCheckout(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "presentation")
	writePresentationCheckout(t, source)
	t.Setenv("PWD", "")
	t.Setenv("OFFICECLI_MOP_PRESENTATION_ROOT", "")
	t.Setenv("PRESENTATION_SOURCE_DIR", "")
	t.Setenv("OFFICECLI_MOP_SKILL_NODE", "/explicit/node")
	// An empty executable keeps this test about the working directory; the
	// launcher case is covered separately below.
	env := bridgeEnv("", root)
	if len(env) != 2 || env[0] != "PRESENTATION_SOURCE_DIR="+source || env[1] != "OFFICECLI_MOP_PRESENTATION_ROOT="+source {
		t.Fatalf("bridgeEnv(%q) = %#v", root, env)
	}
}

// A development build opened by a launcher gets cwd "/" and no PWD, so it can
// only reach the checkout it was built from through its own executable path.
// <checkout>/officedex/build/bin/OfficeDex.app is the layout
// scripts/build-local-latest.sh produces, and this is the lookup that failed
// with "The PPTX converter command-line tool is unavailable".
//
// The staged tree under officedex/build/presentation is deliberately present in
// this fixture. It is nearer to the executable than the checkout, it passes
// IsRoot, and choosing it is the bug that shipped and broke PPTX generation: it
// omits tools/execute-jssdk.mjs.
func TestCheckoutBesideExecutableSkipsStagedRuntime(t *testing.T) {
	checkout := t.TempDir()
	source := filepath.Join(checkout, "presentation")
	writePresentationCheckout(t, source)
	writePresentationRuntime(t, filepath.Join(checkout, "officedex", "build", "presentation"))
	executable := filepath.Join(checkout, "officedex", "build", "bin", "OfficeDex.app", "Contents", "MacOS", "officedex")

	if err := os.MkdirAll(filepath.Dir(executable), 0o755); err != nil {
		t.Fatal(err)
	}
	got := firstPresentationCheckout(checkoutCandidatesBesideExecutable(executable))
	if got != source {
		t.Fatalf("checkout beside executable = %q, want %q", got, source)
	}
}

// A source checkout whose runtime is not a sibling -- a git worktree builds
// under a directory the repository is not named after -- still resolves from an
// ancestor, because the walk follows the executable rather than a directory
// name.
func TestCheckoutBesideExecutableReachesSharedCheckoutFromWorktree(t *testing.T) {
	workspace := t.TempDir()
	source := filepath.Join(workspace, "presentation")
	writePresentationCheckout(t, source)
	executable := filepath.Join(workspace, ".worktrees", "officedex-embed-shell", "build", "bin",
		"OfficeDex.app", "Contents", "MacOS", "officedex")

	if err := os.MkdirAll(filepath.Dir(executable), 0o755); err != nil {
		t.Fatal(err)
	}
	if got := firstPresentationCheckout(checkoutCandidatesBesideExecutable(executable)); got != source {
		t.Fatalf("checkout beside worktree executable = %q, want %q", got, source)
	}
}

// Root's documented development layout keeps working: the repository root is
// still searched, runtime inside it or beside it.
func TestRootFindsCheckoutFromRepositoryRoot(t *testing.T) {
	repoRoot := t.TempDir()
	source := filepath.Join(repoRoot, "presentation")
	writePresentationCheckout(t, source)
	t.Setenv("PWD", "")
	// An empty executable keeps this test about the repository root.
	if got := rootFrom("", repoRoot); got != source {
		t.Fatalf("Root(%q) = %q, want %q", repoRoot, got, source)
	}
}

// The whole failure, end to end: a local app bundle is opened by a launcher, so
// it has no working directory to resolve from, and the nearest directory that
// looks like a runtime is the staged tree inside build/. Root must reach the
// checkout it was built from and skip the staged copy.
func TestRootFromLauncherSkipsStagedRuntimeForCheckout(t *testing.T) {
	checkout := t.TempDir()
	source := filepath.Join(checkout, "presentation")
	writePresentationCheckout(t, source)
	writePresentationRuntime(t, filepath.Join(checkout, "officedex", "build", "presentation"))
	executable := filepath.Join(checkout, "officedex", "build", "bin", "OfficeDex.app", "Contents", "MacOS", "officedex")
	if err := os.MkdirAll(filepath.Dir(executable), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PWD", "")
	if got := rootFrom(executable, ""); got != source {
		t.Fatalf("Root from launcher = %q, want %q", got, source)
	}
}

// A staged runtime satisfies IsRoot, and must still be refused where a checkout
// is what is being looked for.
func TestFirstPresentationCheckoutRejectsStagedRuntime(t *testing.T) {
	staged := t.TempDir()
	writePresentationRuntime(t, staged)
	if !IsRoot(staged) {
		t.Fatal("fixture is not a valid staged runtime")
	}
	if got := firstPresentationCheckout([]string{staged}); got != "" {
		t.Fatalf("firstPresentationCheckout accepted a staged runtime: %q", got)
	}
}

// A build with no converter must report it rather than resolve a directory that
// merely has the right name.
func TestFirstPresentationRootRejectsIncompleteTree(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "package.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := firstPresentationRoot([]string{dir}); got != "" {
		t.Fatalf("firstPresentationRoot accepted an incomplete tree: %q", got)
	}
}

// writePresentationRuntime lays down the four files IsRoot requires, so a
// fixture directory is a bootable runtime: the staged tree a packaged app
// carries, or the base of a source checkout.
func writePresentationRuntime(t *testing.T, root string) {
	t.Helper()
	for _, relative := range []string{
		"package.json",
		filepath.Join("node_modules", "vite", "dist", "node", "index.js"),
		filepath.Join("bos", "dist", "mop-wasm", "pkg", "mop_wasm_bg.wasm"),
		filepath.Join("tools", "fixtures", "blank-presentation", "content.json"),
	} {
		writeFixtureFile(t, filepath.Join(root, relative))
	}
}

// writePresentationCheckout is writePresentationRuntime plus the JSSDK host
// runner a staged copy omits.
func writePresentationCheckout(t *testing.T, root string) {
	t.Helper()
	writePresentationRuntime(t, root)
	writeFixtureFile(t, filepath.Join(root, filepath.FromSlash(checkoutMarker)))
}

func writeFixtureFile(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("fixture"), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestPresentationRuntimeEnvPreservesExplicitRoot(t *testing.T) {
	t.Setenv("PWD", "")
	t.Setenv("OFFICECLI_MOP_PRESENTATION_ROOT", "/explicit/presentation")
	t.Setenv("PRESENTATION_SOURCE_DIR", "")
	t.Setenv("OFFICECLI_MOP_SKILL_NODE", "/explicit/node")
	if env := BridgeEnv("/does/not/exist"); env != nil {
		t.Fatalf("presentationRuntimeEnv returned %v with explicit root", env)
	}
}

func TestPresentationRuntimeEnvInjectsNodeForExplicitRoot(t *testing.T) {
	dir := t.TempDir()
	node := filepath.Join(dir, "node")
	if err := os.WriteFile(node, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
	t.Setenv("PWD", "")
	t.Setenv("OFFICECLI_MOP_PRESENTATION_ROOT", "/explicit/presentation")
	t.Setenv("PRESENTATION_SOURCE_DIR", "")
	t.Setenv("OFFICECLI_MOP_SKILL_NODE", "")
	if env := BridgeEnv("/does/not/exist"); len(env) != 1 || env[0] != "OFFICECLI_MOP_SKILL_NODE="+node {
		t.Fatalf("presentationRuntimeEnv did not inject the resolved node executable: %#v", env)
	}
}

func TestBridgeEnvPassesPortableProgressiveSkill(t *testing.T) {
	root := t.TempDir()
	skill := filepath.Join(root, "skills", "aippt-jssdk-design")
	if err := os.MkdirAll(skill, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(skill, "policy.json"), []byte(`{"contract":"jssdk-progressive/v2"}`), 0644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PWD", "")
	t.Setenv("OFFICECLI_MOP_PRESENTATION_ROOT", "/explicit/runtime")
	t.Setenv("OFFICECLI_MOP_SKILL_NODE", "/explicit/node")
	t.Setenv("OFFICECLI_MOP_SKILL_DIR", "")
	t.Setenv("OFFICECLI_JSSDK_DESIGN_SKILL_DIR", "")
	env := BridgeEnv(root)
	if len(env) != 2 || env[1] != "OFFICECLI_JSSDK_DESIGN_SKILL_DIR="+skill {
		t.Fatalf("skill not passed: %v", env)
	}
	t.Setenv("OFFICECLI_JSSDK_DESIGN_SKILL_DIR", "/explicit/skill")
	if env := BridgeEnv(root); len(env) != 1 {
		t.Fatalf("overrode explicit skill: %v", env)
	}
}
