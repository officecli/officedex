package main

import (
	"fmt"
	"os"
	"path/filepath"

	"officedex/internal/atomicfile"
)

type HtmlAppFileInput struct {
	Root  string            `json:"root"`
	Files map[string][]byte `json:"files"`
}

// WriteHtmlAppFiles materializes the renderer's Vite-shaped HTML app inside a
// caller-selected project directory. Every path is checked to stay below Root
// before any write occurs.
func (a *App) WriteHtmlAppFiles(input HtmlAppFileInput) ([]string, error) {
	root, err := filepath.Abs(filepath.Clean(input.Root))
	if err != nil || root == "." {
		return nil, fmt.Errorf("invalid HTML app root")
	}
	if len(input.Files) == 0 {
		return nil, fmt.Errorf("HTML app contains no files")
	}
	if err := ensureDir(root); err != nil {
		return nil, err
	}
	paths := make([]string, 0, len(input.Files))
	for name, data := range input.Files {
		clean := filepath.Clean(name)
		if clean == "." || filepath.IsAbs(name) || clean == ".." || len(clean) >= 3 && clean[:3] == ".."+string(filepath.Separator) {
			return nil, fmt.Errorf("HTML app path escapes root: %q", name)
		}
		dest := filepath.Join(root, clean)
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			return nil, fmt.Errorf("create HTML app directory: %w", err)
		}
		if err := atomicfile.WriteFile(dest, data, 0o644); err != nil {
			return nil, fmt.Errorf("write HTML app file %s: %w", name, err)
		}
		paths = append(paths, dest)
	}
	return paths, nil
}

func ensureDir(path string) error {
	return os.MkdirAll(path, 0o755)
}
