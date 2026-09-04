package main

import (
	"encoding/base64"
	"errors"
	"fmt"
	"officedex/internal/atomicfile"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"officedex/internal/subprocess"
	"officedex/internal/types"
)

// ─── Shell / dialog bindings ────────────────────────────────────────────────

// OpenPath opens filePath with the OS default handler.
func (a *App) OpenPath(filePath string) error {
	return openOSPath(filePath)
}

// ShowItemInFolder reveals filePath in the platform file manager.
func (a *App) ShowItemInFolder(filePath string) error {
	return revealOSPath(filePath)
}

// OpenExternal opens an http(s) URL in the user's default browser.
func (a *App) OpenExternal(url string) error {
	if a.ctx == nil {
		return errors.New("app: not started")
	}
	wailsruntime.BrowserOpenURL(a.ctx, url)
	return nil
}

// FileDialogFilter matches the renderer-facing filter shape.
type FileDialogFilter struct {
	Name       string   `json:"name"`
	Extensions []string `json:"extensions"`
}

// FileDialogOptions matches the renderer-facing dialog options.
type FileDialogOptions struct {
	Filters []FileDialogFilter `json:"filters,omitempty"`
}

// OpenFileDialog shows a single-file picker. Returns "" when the user
// cancels.
func (a *App) OpenFileDialog(options *FileDialogOptions) (string, error) {
	if a.ctx == nil {
		return "", errors.New("app: not started")
	}
	return wailsruntime.OpenFileDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Filters: dialogFilters(options),
	})
}

// OpenDirectoryDialog shows a folder picker. Returns "" when the user cancels.
func (a *App) OpenDirectoryDialog() (string, error) {
	if a.ctx == nil {
		return "", errors.New("app: not started")
	}
	return wailsruntime.OpenDirectoryDialog(a.ctx, wailsruntime.OpenDialogOptions{})
}

// OpenMultiFileDialog shows a multi-file picker. Returns an empty slice when
// the user cancels.
func (a *App) OpenMultiFileDialog(options *FileDialogOptions) ([]string, error) {
	if a.ctx == nil {
		return nil, errors.New("app: not started")
	}
	return wailsruntime.OpenMultipleFilesDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Filters: dialogFilters(options),
	})
}

// PastedImageInput is the renderer-facing payload for SavePastedImage.
// DataBase64 is the standard base64-encoded image bytes (no data: URL
// prefix), and Ext is the file extension without a leading dot. Unsupported
// extensions normalise to "png".
type PastedImageInput struct {
	DataBase64 string `json:"dataBase64"`
	Ext        string `json:"ext"`
}

// SavePastedImage persists clipboard image bytes inside the workspace and
// returns the absolute file path so the renderer can append it to the
// reference-images list.
func (a *App) SavePastedImage(input PastedImageInput) (string, error) {
	if input.DataBase64 == "" {
		return "", errors.New("save pasted image: empty data")
	}
	data, err := base64.StdEncoding.DecodeString(input.DataBase64)
	if err != nil {
		return "", fmt.Errorf("decode pasted image: %w", err)
	}
	if len(data) == 0 {
		return "", errors.New("save pasted image: empty data")
	}
	ext := normalizePastedImageExt(input.Ext)
	settings, err := a.settingsStore.Load()
	if err != nil {
		return "", fmt.Errorf("load settings: %w", err)
	}
	workspaceDir, err := a.effectiveWorkspaceDir(settings)
	if err != nil {
		return "", err
	}
	dir := filepath.Join(workspaceDir, ".pasted-images")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("mkdir pasted-images dir: %w", err)
	}
	name := fmt.Sprintf("paste-%d.%s", time.Now().UnixNano(), ext)
	dest := filepath.Join(dir, name)
	if err := os.WriteFile(dest, data, 0o644); err != nil {
		return "", fmt.Errorf("write pasted image: %w", err)
	}
	return dest, nil
}

// SavePptxInput carries a base64-encoded .pptx plus its desired file name.
type SavePptxInput struct {
	DataBase64     string `json:"dataBase64"`
	FileName       string `json:"fileName"`
	TargetFilePath string `json:"targetFilePath,omitempty"`
}

// SavePptx writes a client-exported .pptx to the
// user's Downloads folder and returns the path. Desktop webviews can't surface
// blob downloads from inside an iframe, so the embed hands the bytes back and the
// host persists them natively.
func (a *App) SavePptx(input SavePptxInput) (string, error) {
	if input.DataBase64 == "" {
		return "", errors.New("save pptx: empty data")
	}
	data, err := base64.StdEncoding.DecodeString(input.DataBase64)
	if err != nil {
		return "", fmt.Errorf("decode pptx: %w", err)
	}
	if len(data) == 0 {
		return "", errors.New("save pptx: empty data")
	}
	dest, err := a.resolveSavePptxDestination(input)
	if err != nil {
		return "", err
	}
	if err := atomicfile.WriteFile(dest, data, 0o644); err != nil {
		return "", fmt.Errorf("write pptx: %w", err)
	}
	if a.previewReg != nil {
		_ = a.previewReg.AllowArtifact(types.Artifact{FilePath: dest, FileName: filepath.Base(dest), DocumentType: "pptx"})
	}
	return dest, nil
}

func (a *App) resolveSavePptxDestination(input SavePptxInput) (string, error) {
	if strings.TrimSpace(input.TargetFilePath) != "" {
		dest, err := filepath.Abs(input.TargetFilePath)
		if err != nil {
			return "", fmt.Errorf("save pptx: target path: %w", err)
		}
		if strings.ToLower(filepath.Ext(dest)) != ".pptx" {
			return "", errors.New("save pptx: target file must be .pptx")
		}
		if a.previewReg != nil {
			if err := a.previewReg.AllowArtifact(types.Artifact{FilePath: dest, FileName: filepath.Base(dest), DocumentType: "pptx"}); err != nil {
				return "", fmt.Errorf("save pptx: %w", err)
			}
		}
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			return "", fmt.Errorf("save pptx: mkdir target: %w", err)
		}
		return dest, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("save pptx: home dir: %w", err)
	}
	dir := filepath.Join(home, "Downloads")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("save pptx: mkdir: %w", err)
	}
	name := normalizePptxFileName(input.FileName)
	dest := filepath.Join(dir, name)
	if _, statErr := os.Stat(dest); statErr == nil {
		base := strings.TrimSuffix(name, ".pptx")
		dest = filepath.Join(dir, fmt.Sprintf("%s-%d.pptx", base, time.Now().UnixNano()))
	}
	return dest, nil
}

// normalizePptxFileName strips any path separators and guarantees a .pptx suffix.
func normalizePptxFileName(name string) string {
	name = strings.TrimSpace(name)
	name = filepath.Base(strings.ReplaceAll(name, "\\", "/"))
	if name == "" || name == "." || name == "/" {
		name = "deck.pptx"
	}
	if !strings.HasSuffix(strings.ToLower(name), ".pptx") {
		name += ".pptx"
	}
	return name
}

func normalizePastedImageExt(ext string) string {
	cleaned := strings.ToLower(strings.TrimPrefix(strings.TrimSpace(ext), "."))
	switch cleaned {
	case "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg":
		return cleaned
	default:
		return "png"
	}
}

// SetPreviewMode resizes the main window to make room for the preview pane,
// or restores the pre-preview width when active is false. The widened window
// is clamped to the current screen width, and if the right edge would overflow
// the screen the window is shifted left to keep it fully visible.
func (a *App) SetPreviewMode(active bool) error {
	if a.ctx == nil {
		return errors.New("app: not started")
	}
	w, h := wailsruntime.WindowGetSize(a.ctx)
	if active {
		if !a.preview.enter(w) {
			return nil
		}
		targetW := w + previewExtraWidth
		a.mu.Lock()
		screenW := a.currentScreenWidthLocked()
		a.mu.Unlock()
		if screenW > 0 && targetW > screenW {
			targetW = screenW
		}

		x, y := wailsruntime.WindowGetPosition(a.ctx)
		if screenW > 0 && x+targetW > screenW {
			newX := screenW - targetW
			if newX < 0 {
				newX = 0
			}
			a.preview.shift(x)
			wailsruntime.WindowSetPosition(a.ctx, newX, y)
		}

		wailsruntime.WindowSetSize(a.ctx, targetW, h)
		return nil
	}
	width, x, moved, ok := a.preview.take()
	if !ok {
		return nil
	}
	wailsruntime.WindowSetSize(a.ctx, width, h)
	if moved {
		_, y := wailsruntime.WindowGetPosition(a.ctx)
		wailsruntime.WindowSetPosition(a.ctx, x, y)
	}
	return nil
}

// currentScreenWidthLocked returns the logical width of the screen currently
// hosting the window, falling back to the primary screen, or 0 when unknown.
// Caller must hold a.mu (the function does not touch shared state, but the
// name documents the calling context).
func (a *App) currentScreenWidthLocked() int {
	screens, err := wailsruntime.ScreenGetAll(a.ctx)
	if err != nil {
		return 0
	}
	for _, s := range screens {
		if s.IsCurrent {
			return s.Size.Width
		}
	}
	for _, s := range screens {
		if s.IsPrimary {
			return s.Size.Width
		}
	}
	return 0
}

func dialogFilters(options *FileDialogOptions) []wailsruntime.FileFilter {
	if options == nil || len(options.Filters) == 0 {
		return []wailsruntime.FileFilter{
			{DisplayName: "All Files (*.*)", Pattern: "*.*"},
		}
	}
	out := make([]wailsruntime.FileFilter, 0, len(options.Filters))
	for _, f := range options.Filters {
		pattern := strings.Join(toGlobPatterns(f.Extensions), ";")
		out = append(out, wailsruntime.FileFilter{
			DisplayName: f.Name,
			Pattern:     pattern,
		})
	}
	return out
}

func toGlobPatterns(extensions []string) []string {
	out := make([]string, 0, len(extensions))
	for _, ext := range extensions {
		ext = strings.TrimPrefix(ext, ".")
		if ext == "" || ext == "*" {
			out = append(out, "*.*")
			continue
		}
		out = append(out, "*."+ext)
	}
	return out
}

func openOSPath(filePath string) error {
	switch runtime.GOOS {
	case "darwin":
		return subprocess.Command("open", filePath).Start()
	case "windows":
		return subprocess.Command("cmd", "/c", "start", "", filePath).Start()
	default:
		return subprocess.Command("xdg-open", filePath).Start()
	}
}

func revealOSPath(filePath string) error {
	switch runtime.GOOS {
	case "darwin":
		return subprocess.Command("open", "-R", filePath).Start()
	case "windows":
		return subprocess.Command("explorer", "/select,", filePath).Start()
	default:
		return subprocess.Command("xdg-open", filepath.Dir(filePath)).Start()
	}
}
