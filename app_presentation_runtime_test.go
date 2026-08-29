package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPresentationRuntimeEnvFindsSiblingCheckout(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "pptx")
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
	t.Setenv("OFFICECLI_MOP_PRESENTATION_ROOT", "")
	t.Setenv("PRESENTATION_SOURCE_DIR", "")
	t.Setenv("OFFICECLI_MOP_SKILL_NODE", "/explicit/node")
	env := presentationRuntimeEnv(root)
	if len(env) != 2 || env[0] != "PRESENTATION_SOURCE_DIR="+source || env[1] != "OFFICECLI_MOP_PRESENTATION_ROOT="+source {
		t.Fatalf("presentationRuntimeEnv(%q) = %#v", root, env)
	}
}

func TestPresentationRuntimeEnvPreservesExplicitRoot(t *testing.T) {
	t.Setenv("OFFICECLI_MOP_PRESENTATION_ROOT", "/explicit/pptx")
	t.Setenv("PRESENTATION_SOURCE_DIR", "")
	t.Setenv("OFFICECLI_MOP_SKILL_NODE", "/explicit/node")
	if env := presentationRuntimeEnv("/does/not/exist"); env != nil {
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
	t.Setenv("OFFICECLI_MOP_PRESENTATION_ROOT", "/explicit/pptx")
	t.Setenv("PRESENTATION_SOURCE_DIR", "")
	t.Setenv("OFFICECLI_MOP_SKILL_NODE", "")
	if env := presentationRuntimeEnv("/does/not/exist"); len(env) != 1 || env[0] != "OFFICECLI_MOP_SKILL_NODE="+node {
		t.Fatalf("presentationRuntimeEnv did not inject the resolved node executable: %#v", env)
	}
}
