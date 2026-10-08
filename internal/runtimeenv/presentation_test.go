package runtimeenv

import (
	"os"
	"path/filepath"
	"testing"
)

func writePresentationRoot(t *testing.T, source string) {
	t.Helper()
	for _, relative := range []string{
		"package.json",
		filepath.Join("node_modules", "vite", "dist", "node", "index.js"),
		filepath.Join("bos", "dist", "mop-wasm", "pkg", "mop_wasm_bg.wasm"),
		filepath.Join("tools", "fixtures", "blank-presentation", "content.json"),
	} {
		path := filepath.Join(source, relative)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("fixture"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func TestPresentationRuntimeEnvFindsSiblingCheckout(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "presentation")
	writePresentationRoot(t, source)
	t.Setenv("PWD", "")
	t.Setenv("OFFICECLI_MOP_PRESENTATION_ROOT", "")
	t.Setenv("PRESENTATION_SOURCE_DIR", "")
	t.Setenv("OFFICECLI_MOP_SKILL_NODE", "/explicit/node")
	env := BridgeEnv(root)
	if len(env) != 2 || env[0] != "PRESENTATION_SOURCE_DIR="+source || env[1] != "OFFICECLI_MOP_PRESENTATION_ROOT="+source {
		t.Fatalf("BridgeEnv(%q) = %#v", root, env)
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

func localAppExecutable(t *testing.T, workspace string) string {
	t.Helper()
	exe := filepath.Join(workspace, "officedex", "build", "bin", "OfficeDex.app", "Contents", "MacOS", "officedex")
	if err := os.MkdirAll(filepath.Dir(exe), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(exe, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	return exe
}

func TestFirstPresentationRootFindsCheckoutFromLocalApp(t *testing.T) {
	// `open` / Finder start OfficeDex.app with cwd "/". A local build stages
	// no Contents/Resources/presentation, so the converter is the sibling
	// checkout reached by walking up from the executable.
	workspace := t.TempDir()
	source := filepath.Join(workspace, "presentation")
	writePresentationRoot(t, source)
	exe := localAppExecutable(t, workspace)

	got := firstPresentationRoot(exe, "/", "")
	want, err := filepath.Abs(source)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("firstPresentationRoot = %q, want the sibling checkout %q", got, want)
	}
}

func TestFirstPresentationRootPrefersBundledRuntime(t *testing.T) {
	workspace := t.TempDir()
	writePresentationRoot(t, filepath.Join(workspace, "presentation"))
	exe := localAppExecutable(t, workspace)
	bundled := filepath.Join(workspace, "officedex", "build", "bin", "OfficeDex.app", "Contents", "Resources", "presentation")
	writePresentationRoot(t, bundled)

	got := firstPresentationRoot(exe, "/", "")
	want, err := filepath.Abs(bundled)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("firstPresentationRoot = %q, want the bundled runtime %q", got, want)
	}
}
