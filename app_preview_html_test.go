package main

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInlineSidecarResources_NoBaseDir(t *testing.T) {
	got := inlineSidecarResources(`<img src="x.png">`, "")
	if got != `<img src="x.png">` {
		t.Fatalf("empty baseDir should be a no-op, got %q", got)
	}
}

func TestInlineSidecarResources_ImgRelative(t *testing.T) {
	dir := t.TempDir()
	pngBytes := []byte("\x89PNG\r\n\x1a\nfakebody")
	if err := os.WriteFile(filepath.Join(dir, "image1.png"), pngBytes, 0o644); err != nil {
		t.Fatalf("seed png: %v", err)
	}
	html := `<html><body><img src="image1.png" alt="x"></body></html>`
	got := inlineSidecarResources(html, dir)
	wantData := "data:image/png;base64," + base64.StdEncoding.EncodeToString(pngBytes)
	if !strings.Contains(got, wantData) {
		t.Fatalf("expected data URL in output, got %q", got)
	}
	if strings.Contains(got, `src="image1.png"`) {
		t.Fatalf("relative src should have been replaced, got %q", got)
	}
}

func TestInlineSidecarResources_LinkCss(t *testing.T) {
	dir := t.TempDir()
	css := []byte("body{color:red}")
	if err := os.WriteFile(filepath.Join(dir, "style.css"), css, 0o644); err != nil {
		t.Fatalf("seed css: %v", err)
	}
	html := `<link rel="stylesheet" href='style.css'>`
	got := inlineSidecarResources(html, dir)
	wantData := "data:text/css;base64," + base64.StdEncoding.EncodeToString(css)
	if !strings.Contains(got, wantData) {
		t.Fatalf("expected inlined css data URL, got %q", got)
	}
}

func TestInlineSidecarResources_AbsoluteSkipped(t *testing.T) {
	dir := t.TempDir()
	cases := []string{
		`<img src="https://cdn.example.com/a.png">`,
		`<img src="http://cdn.example.com/a.png">`,
		`<img src="data:image/png;base64,AAA">`,
		`<img src="//cdn.example.com/a.png">`,
		`<img src="/abs/path.png">`,
		`<link href="#anchor">`,
	}
	for _, in := range cases {
		got := inlineSidecarResources(in, dir)
		if got != in {
			t.Errorf("absolute reference should be left as-is: in=%q got=%q", in, got)
		}
	}
}

func TestInlineSidecarResources_MissingFileLeftAlone(t *testing.T) {
	dir := t.TempDir()
	in := `<img src="not-there.png">`
	got := inlineSidecarResources(in, dir)
	if got != in {
		t.Fatalf("missing file should leave src untouched, got %q", got)
	}
}

func TestInlineSidecarResources_RefusesParentTraversal(t *testing.T) {
	dir := t.TempDir()
	outside := filepath.Join(filepath.Dir(dir), "outside.png")
	if err := os.WriteFile(outside, []byte("x"), 0o644); err != nil {
		t.Fatalf("seed outside: %v", err)
	}
	defer os.Remove(outside)
	in := `<img src="../outside.png">`
	got := inlineSidecarResources(in, dir)
	if got != in {
		t.Fatalf("parent traversal should be refused, got %q", got)
	}
}

func TestInlineSidecarResources_UnknownExtensionSkipped(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "thing.txt"), []byte("x"), 0o644); err != nil {
		t.Fatalf("seed: %v", err)
	}
	in := `<link href="thing.txt">`
	got := inlineSidecarResources(in, dir)
	if got != in {
		t.Fatalf("non-allowlisted extension should be skipped, got %q", got)
	}
}

func TestInlineSidecarResources_StripQueryAndFragment(t *testing.T) {
	dir := t.TempDir()
	pngBytes := []byte("PNGBODY")
	if err := os.WriteFile(filepath.Join(dir, "image1.png"), pngBytes, 0o644); err != nil {
		t.Fatalf("seed: %v", err)
	}
	in := `<img src="image1.png?v=2#frag">`
	got := inlineSidecarResources(in, dir)
	wantData := "data:image/png;base64," + base64.StdEncoding.EncodeToString(pngBytes)
	if !strings.Contains(got, wantData) {
		t.Fatalf("expected query/fragment to be stripped during read, got %q", got)
	}
}
