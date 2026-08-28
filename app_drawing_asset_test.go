package main

import (
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func poolWithImage(t *testing.T, workspace string, data []byte) (string, string) {
	t.Helper()
	digest := fmt.Sprintf("%x", sha256.Sum256(data))
	assets := filepath.Join(workspace, "20260820-deck", ".mop-assets")
	if err := os.MkdirAll(assets, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(assets, digest+".jpg"), data, 0o644); err != nil {
		t.Fatal(err)
	}
	return assets, digest
}

func TestReadDrawingAssetReturnsPooledImageBytes(t *testing.T) {
	workspace := t.TempDir()
	data := []byte("not-really-a-jpeg-but-bytes")
	assets, digest := poolWithImage(t, workspace, data)
	app := &App{workspaceDir: workspace}

	asset, err := app.ReadDrawingAsset(ReadDrawingAssetInput{AssetsDir: assets, Digest: digest})
	if err != nil {
		t.Fatal(err)
	}
	if asset.Base64 != base64.StdEncoding.EncodeToString(data) {
		t.Fatalf("bytes = %q", asset.Base64)
	}
	if asset.ContentType != "image/jpeg" {
		t.Fatalf("contentType = %q, want image/jpeg", asset.ContentType)
	}
}

func TestReadDrawingAssetRefusesPathsOutsideTheWorkspace(t *testing.T) {
	workspace := t.TempDir()
	outside := t.TempDir()
	data := []byte("secret")
	digest := fmt.Sprintf("%x", sha256.Sum256(data))
	if err := os.WriteFile(filepath.Join(outside, digest+".jpg"), data, 0o644); err != nil {
		t.Fatal(err)
	}
	app := &App{workspaceDir: workspace}

	// The pool directory comes from the op stream, not from the user, so a
	// path that escapes the workspace must not be readable through it.
	for _, directory := range []string{outside, filepath.Join(workspace, "..", filepath.Base(outside))} {
		if _, err := app.ReadDrawingAsset(ReadDrawingAssetInput{AssetsDir: directory, Digest: digest}); err == nil {
			t.Fatalf("reading %s was allowed", directory)
		}
	}
}

func TestReadDrawingAssetRejectsMalformedDigests(t *testing.T) {
	workspace := t.TempDir()
	assets, _ := poolWithImage(t, workspace, []byte("bytes"))
	app := &App{workspaceDir: workspace}

	for _, digest := range []string{"", "../../etc/passwd", "ABC", "z" + fmt.Sprintf("%063d", 0)} {
		if _, err := app.ReadDrawingAsset(ReadDrawingAssetInput{AssetsDir: assets, Digest: digest}); err == nil {
			t.Fatalf("digest %q was accepted", digest)
		}
	}
}

func TestReadDrawingAssetReportsAMissingDigest(t *testing.T) {
	workspace := t.TempDir()
	assets, _ := poolWithImage(t, workspace, []byte("bytes"))
	app := &App{workspaceDir: workspace}

	missing := fmt.Sprintf("%x", sha256.Sum256([]byte("other")))
	if _, err := app.ReadDrawingAsset(ReadDrawingAssetInput{AssetsDir: assets, Digest: missing}); err == nil {
		t.Fatal("a digest that is not pooled must not resolve")
	}
}
