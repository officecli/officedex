package main

import (
	"encoding/base64"
	"fmt"
	"mime"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// Drawing ops carry no image bytes — they name images by content digest and
// point at the pool the render left beside the artifact. This resolves one of
// those digests so the renderer can draw the real picture while the deck is
// being drawn, and again whenever it replays a deck from its op history.
var drawingAssetDigestPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

// maxDrawingAssetBytes bounds what a single op's image may cost to deliver.
const maxDrawingAssetBytes = 32 << 20

// ReadDrawingAssetInput addresses one image of a drawing op stream.
type ReadDrawingAssetInput struct {
	// AssetsDir is the pool named by the stream's deck.begin op.
	AssetsDir string `json:"assetsDir"`
	Digest    string `json:"digest"`
}

// DrawingAsset is one image from a render's asset pool, ready for the
// presentation editor's image API.
type DrawingAsset struct {
	Digest      string `json:"digest"`
	ContentType string `json:"contentType"`
	Base64      string `json:"base64"`
}

// ReadDrawingAsset returns the pooled image bytes for a digest. The pool
// directory arrives from the op stream rather than from the user, so it is
// confined to this app's workspace: a task's assets live beside its artifact,
// and nothing outside the workspace is readable through this path.
func (a *App) ReadDrawingAsset(input ReadDrawingAssetInput) (DrawingAsset, error) {
	digest := strings.ToLower(strings.TrimSpace(input.Digest))
	if !drawingAssetDigestPattern.MatchString(digest) {
		return DrawingAsset{}, fmt.Errorf("invalid asset digest")
	}
	directory, err := a.resolveWorkspacePath(input.AssetsDir)
	if err != nil {
		return DrawingAsset{}, err
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		return DrawingAsset{}, fmt.Errorf("read asset pool: %w", err)
	}
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasPrefix(name, digest+".") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return DrawingAsset{}, fmt.Errorf("read asset: %w", err)
		}
		if info.Size() > maxDrawingAssetBytes {
			return DrawingAsset{}, fmt.Errorf("asset %s is too large", digest)
		}
		data, err := os.ReadFile(filepath.Join(directory, name))
		if err != nil {
			return DrawingAsset{}, fmt.Errorf("read asset: %w", err)
		}
		contentType := mime.TypeByExtension(filepath.Ext(name))
		if strings.TrimSpace(contentType) == "" {
			contentType = "application/octet-stream"
		}
		return DrawingAsset{
			Digest:      digest,
			ContentType: contentType,
			Base64:      base64.StdEncoding.EncodeToString(data),
		}, nil
	}
	return DrawingAsset{}, fmt.Errorf("asset %s is not in the pool", digest)
}

// resolveWorkspacePath accepts a directory only when it resolves inside the
// app's workspace, with symlinks followed on both sides so a link cannot walk
// out of it.
func (a *App) resolveWorkspacePath(directory string) (string, error) {
	directory = strings.TrimSpace(directory)
	if directory == "" || a.workspaceDir == "" {
		return "", fmt.Errorf("asset pool is unavailable")
	}
	resolved, err := filepath.EvalSymlinks(directory)
	if err != nil {
		return "", fmt.Errorf("asset pool is unavailable")
	}
	root, err := filepath.EvalSymlinks(a.workspaceDir)
	if err != nil {
		return "", fmt.Errorf("asset pool is unavailable")
	}
	relative, err := filepath.Rel(root, resolved)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("asset pool is outside the workspace")
	}
	return resolved, nil
}
