package main

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"officedex/internal/atomicfile"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
	"unicode/utf8"

	"officedex/internal/applog"
	"officedex/internal/pptxeditor"
	"officedex/internal/types"
	"officedex/internal/xlsxeditor"
)

// ─── Preview bindings ───────────────────────────────────────────────────────

// PreviewArtifact registers an artifact for preview and emits an event so the
// renderer can open it. Phase 3a uses the main-window preview pane instead of
// a separate window (Wails v2 multi-window is non-trivial); a follow-up phase
// can introduce a real second window if needed.
func (a *App) PreviewArtifact(artifact types.Artifact) error {
	if err := a.previewReg.AllowArtifact(artifact); err != nil {
		return err
	}
	grant, err := a.previewReg.IssueToken(artifact)
	if err != nil {
		return err
	}
	if a.ctx != nil {
		emit(a.ctx, previewEventChannel, grant)
	}
	return nil
}

// IssuePreviewToken mints a token for a previously-allowed artifact.
func (a *App) IssuePreviewToken(artifact types.Artifact) (types.PreviewGrant, error) {
	return a.previewReg.IssueToken(artifact)
}

type SaveXlsxEditorInput struct {
	PreviewToken  string                    `json:"previewToken"`
	SessionID     string                    `json:"sessionId"`
	ModocContent  string                    `json:"modocContent"`
	ManagedSheets []xlsxeditor.ManagedSheet `json:"managedSheets,omitempty"`
}

type StageXlsxEditorImageInput struct {
	PreviewToken string `json:"previewToken"`
	SessionID    string `json:"sessionId"`
	FilePath     string `json:"filePath,omitempty"`
	DataBase64   string `json:"dataBase64,omitempty"`
	Mime         string `json:"mime,omitempty"`
	SheetName    string `json:"sheetName"`
	Row          int    `json:"row"`
	Column       int    `json:"column"`
	StatusColumn int    `json:"statusColumn"`
}

type CloseXlsxEditorInput struct {
	PreviewToken string `json:"previewToken"`
	SessionID    string `json:"sessionId"`
}

func (a *App) PrepareXlsxEditor(previewToken string) (xlsxeditor.PrepareResult, error) {
	if a.xlsxEditorService == nil {
		return xlsxeditor.PrepareResult{}, errXlsxEditorUnavailable
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	return a.xlsxEditorService.Prepare(ctx, previewToken)
}

func (a *App) SaveXlsxEditor(input SaveXlsxEditorInput) (xlsxeditor.SaveResult, error) {
	if a.xlsxEditorService == nil {
		return xlsxeditor.SaveResult{}, errXlsxEditorUnavailable
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	return a.xlsxEditorService.Save(ctx, input.PreviewToken, input.SessionID, input.ModocContent, input.ManagedSheets)
}

func (a *App) StageXlsxEditorImage(input StageXlsxEditorImageInput) (xlsxeditor.StageImageResult, error) {
	if a.xlsxEditorService == nil {
		return xlsxeditor.StageImageResult{}, errXlsxEditorUnavailable
	}
	var data []byte
	mime := input.Mime
	if input.DataBase64 != "" || strings.TrimSpace(input.FilePath) == "" {
		decoded, err := base64.StdEncoding.DecodeString(input.DataBase64)
		if err != nil {
			return xlsxeditor.StageImageResult{}, fmt.Errorf("decode staged XLSX image: %w", err)
		}
		data = decoded
	} else {
		image, err := a.ReadLocalImage(input.FilePath)
		if err != nil {
			return xlsxeditor.StageImageResult{}, err
		}
		data = image.Data
		mime = image.Mime
	}
	return a.xlsxEditorService.StageImage(input.PreviewToken, input.SessionID, data, mime, input.SheetName, input.Row, input.Column, input.StatusColumn)
}

func (a *App) CloseXlsxEditor(input CloseXlsxEditorInput) error {
	if a.xlsxEditorService == nil {
		return errXlsxEditorUnavailable
	}
	return a.xlsxEditorService.Close(input.PreviewToken, input.SessionID)
}

// SavePptxEditorSnapshotInput carries an in-progress deck from the embedded
// presentation editor. Binary content travels as base64 because the packaged
// webview drops Blob bodies; only plain values survive the bridge.
type SavePptxEditorSnapshotInput struct {
	PreviewToken  string `json:"previewToken"`
	SessionID     string `json:"sessionId"`
	ContentBase64 string `json:"contentBase64"`
	BaseRevision  int    `json:"baseRevision"`
	Revision      int    `json:"revision"`
}

// SavePptxEditorAssetInput carries one embedded resource (an image, a font)
// that the editor added to the deck.
type SavePptxEditorAssetInput struct {
	PreviewToken string `json:"previewToken"`
	SessionID    string `json:"sessionId"`
	RelativePath string `json:"relativePath"`
	ContentType  string `json:"contentType"`
	DataBase64   string `json:"dataBase64"`
}

// ExportPptxEditorInput asks the session to write the deck back to its file.
type ExportPptxEditorInput struct {
	PreviewToken string `json:"previewToken"`
	SessionID    string `json:"sessionId"`
	Revision     int    `json:"revision"`
}

// ClosePptxEditorInput releases one editor session.
type ClosePptxEditorInput struct {
	PreviewToken string `json:"previewToken"`
	SessionID    string `json:"sessionId"`
}

// PreparePptxEditor opens an editing session for a granted preview token and
// returns the deck the embedded editor should load.
func (a *App) PreparePptxEditor(previewToken string) (pptxeditor.PrepareResult, error) {
	if a.pptxEditorService == nil {
		return pptxeditor.PrepareResult{}, errPptxEditorUnavailable
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	return a.pptxEditorService.Prepare(ctx, previewToken)
}

// SavePptxEditorSnapshot persists the editor's current document revision.
func (a *App) SavePptxEditorSnapshot(input SavePptxEditorSnapshotInput) (pptxeditor.SaveResult, error) {
	if a.pptxEditorService == nil {
		return pptxeditor.SaveResult{}, errPptxEditorUnavailable
	}
	content, err := base64.StdEncoding.DecodeString(input.ContentBase64)
	if err != nil {
		return pptxeditor.SaveResult{}, fmt.Errorf("decode PPTX editor snapshot: %w", err)
	}
	return a.pptxEditorService.SaveSnapshot(input.PreviewToken, input.SessionID, content, input.BaseRevision, input.Revision)
}

// SavePptxEditorAsset stores one resource the editor added to the deck.
func (a *App) SavePptxEditorAsset(input SavePptxEditorAssetInput) (pptxeditor.SaveAssetResult, error) {
	if a.pptxEditorService == nil {
		return pptxeditor.SaveAssetResult{}, errPptxEditorUnavailable
	}
	data, err := base64.StdEncoding.DecodeString(input.DataBase64)
	if err != nil {
		return pptxeditor.SaveAssetResult{}, fmt.Errorf("decode PPTX editor asset: %w", err)
	}
	return a.pptxEditorService.SaveAsset(input.PreviewToken, input.SessionID, input.RelativePath, input.ContentType, data)
}

// ExportPptxEditor writes the edited deck back to the file the preview token
// granted access to.
func (a *App) ExportPptxEditor(input ExportPptxEditorInput) (pptxeditor.SaveResult, error) {
	if a.pptxEditorService == nil {
		return pptxeditor.SaveResult{}, errPptxEditorUnavailable
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	return a.pptxEditorService.Export(ctx, input.PreviewToken, input.SessionID, input.Revision)
}

// ClosePptxEditor releases one editing session.
func (a *App) ClosePptxEditor(input ClosePptxEditorInput) error {
	if a.pptxEditorService == nil {
		return errPptxEditorUnavailable
	}
	return a.pptxEditorService.Close(input.PreviewToken, input.SessionID)
}

// CreateWorkbookFromSheetInput turns connector-fetched rows into a new
// workbook inside the workspace the caller is working in.
type CreateWorkbookFromSheetInput struct {
	FileName    string     `json:"fileName"`
	SheetName   string     `json:"sheetName"`
	Headers     []string   `json:"headers"`
	Rows        [][]string `json:"rows"`
	WorkspaceID string     `json:"workspaceId"`
}

// CreateWorkbookFromSheet writes a new .xlsx into the workspace and returns it
// as an artifact the spreadsheet stage can open. Jira and Liquipedia syncs use
// this on their first run, when there is no workbook to merge into yet.
func (a *App) CreateWorkbookFromSheet(input CreateWorkbookFromSheetInput) (types.Artifact, error) {
	fileName := strings.TrimSpace(input.FileName)
	if fileName == "" {
		return types.Artifact{}, errors.New("create workbook: file name is required")
	}
	if fileName != filepath.Base(fileName) {
		return types.Artifact{}, errors.New("create workbook: file name must not contain a path")
	}
	if !strings.EqualFold(filepath.Ext(fileName), ".xlsx") {
		return types.Artifact{}, errors.New("create workbook: file name must end in .xlsx")
	}
	sheetName := strings.TrimSpace(input.SheetName)
	if sheetName == "" {
		return types.Artifact{}, errors.New("create workbook: sheet name is required")
	}
	if len(input.Headers) == 0 {
		return types.Artifact{}, errors.New("create workbook: headers are required")
	}

	settings, err := a.settingsStore.Load()
	if err != nil {
		return types.Artifact{}, fmt.Errorf("create workbook: load settings: %w", err)
	}
	dir, err := a.effectiveWorkspaceDirForInput(input.WorkspaceID, false, settings)
	if err != nil {
		return types.Artifact{}, fmt.Errorf("create workbook: resolve workspace: %w", err)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return types.Artifact{}, fmt.Errorf("create workbook: mkdir workspace: %w", err)
	}

	dest := uniqueWorkbookPath(dir, fileName)
	rows := make([][]string, 0, len(input.Rows)+1)
	rows = append(rows, input.Headers)
	rows = append(rows, input.Rows...)
	if err := xlsxeditor.CreateWorkbook(dest, xlsxeditor.ManagedSheet{SheetName: sheetName, Rows: rows}); err != nil {
		return types.Artifact{}, fmt.Errorf("create workbook: %w", err)
	}

	artifact := types.Artifact{FilePath: dest, FileName: filepath.Base(dest), DocumentType: "xlsx"}
	if a.previewReg != nil {
		if err := a.previewReg.AllowArtifact(artifact); err != nil {
			return types.Artifact{}, fmt.Errorf("create workbook: grant preview: %w", err)
		}
	}
	return artifact, nil
}

// uniqueWorkbookPath keeps a second sync from overwriting the first run's file.
func uniqueWorkbookPath(dir, fileName string) string {
	dest := filepath.Join(dir, fileName)
	if _, err := os.Stat(dest); err != nil {
		return dest
	}
	extension := filepath.Ext(fileName)
	base := strings.TrimSuffix(fileName, extension)
	for suffix := 2; suffix < 1000; suffix++ {
		candidate := filepath.Join(dir, fmt.Sprintf("%s (%d)%s", base, suffix, extension))
		if _, err := os.Stat(candidate); err != nil {
			return candidate
		}
	}
	return filepath.Join(dir, fmt.Sprintf("%s (%d)%s", base, time.Now().UnixNano(), extension))
}

// RevokePreviewToken invalidates a token. No-op if unknown.
func (a *App) RevokePreviewToken(token string) {
	for _, editor := range a.editorSessions() {
		if err := editor.service.CloseByToken(token); err != nil && a.ctx != nil {
			applog.Logger().Warn("close sessions for revoked preview token",
				slog.String("editor", editor.label), applog.Err(err))
		}
	}
	a.previewReg.RevokeToken(token)
}

// ArtifactFile is the renderer-facing wrapper for raw artifact bytes.
type ArtifactFile struct {
	Data   []byte `json:"data"`
	SHA256 string `json:"sha256"`
}

// ReadArtifactFile returns the raw bytes for a granted preview token.
func (a *App) ReadArtifactFile(previewToken string) (ArtifactFile, error) {
	entry, err := a.previewReg.ResolveToken(previewToken)
	if err != nil {
		return ArtifactFile{}, err
	}
	data, err := os.ReadFile(entry.FilePath)
	if err != nil {
		return ArtifactFile{}, fmt.Errorf("read artifact: %w", err)
	}
	return ArtifactFile{Data: data, SHA256: sha256Hex(data)}, nil
}

// SaveDocxInput carries a locally exported DOCX. Overwriting is only allowed
// through the preview token that granted the renderer read access to the same
// source file. SaveAsCopy writes a distinct file to Downloads instead.
type SaveDocxInput struct {
	DataBase64     string `json:"dataBase64"`
	FileName       string `json:"fileName"`
	PreviewToken   string `json:"previewToken"`
	ExpectedSHA256 string `json:"expectedSHA256,omitempty"`
	SaveAsCopy     bool   `json:"saveAsCopy,omitempty"`
}

type SaveDocxResult struct {
	FilePath string `json:"filePath"`
	SHA256   string `json:"sha256"`
}

func (a *App) SaveDocx(input SaveDocxInput) (SaveDocxResult, error) {
	if strings.TrimSpace(input.DataBase64) == "" {
		return SaveDocxResult{}, errors.New("save docx: empty data")
	}
	data, err := base64.StdEncoding.DecodeString(input.DataBase64)
	if err != nil {
		return SaveDocxResult{}, fmt.Errorf("save docx: decode: %w", err)
	}
	if err := validateDocxPackage(data); err != nil {
		return SaveDocxResult{}, fmt.Errorf("save docx: invalid DOCX package: %w", err)
	}

	dest, err := a.resolveSaveDocxDestination(input)
	if err != nil {
		return SaveDocxResult{}, err
	}
	if !input.SaveAsCopy && strings.TrimSpace(input.ExpectedSHA256) != "" {
		current, readErr := os.ReadFile(dest)
		if readErr != nil {
			return SaveDocxResult{}, fmt.Errorf("save docx: read current file: %w", readErr)
		}
		if !strings.EqualFold(sha256Hex(current), strings.TrimSpace(input.ExpectedSHA256)) {
			return SaveDocxResult{}, errors.New("save docx: source file changed outside OfficeDex; reopen it before saving")
		}
	}
	if err := atomicfile.WriteFile(dest, data, 0o644); err != nil {
		return SaveDocxResult{}, fmt.Errorf("save docx: write: %w", err)
	}
	if a.previewReg != nil {
		_ = a.previewReg.AllowArtifact(types.Artifact{FilePath: dest, FileName: filepath.Base(dest), DocumentType: "docx"})
	}
	return SaveDocxResult{FilePath: dest, SHA256: sha256Hex(data)}, nil
}

func validateDocxPackage(data []byte) error {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return err
	}
	foundContentTypes := false
	foundDocument := false
	for _, file := range reader.File {
		switch file.Name {
		case "[Content_Types].xml":
			foundContentTypes = true
		case "word/document.xml":
			foundDocument = true
		}
	}
	if !foundContentTypes || !foundDocument {
		return errors.New("required Word document parts are missing")
	}
	return nil
}

func (a *App) resolveSaveDocxDestination(input SaveDocxInput) (string, error) {
	if !input.SaveAsCopy {
		if a.previewReg == nil {
			return "", errors.New("save docx: preview registry unavailable")
		}
		entry, err := a.previewReg.ResolveToken(input.PreviewToken)
		if err != nil {
			return "", fmt.Errorf("save docx: %w", err)
		}
		if strings.ToLower(filepath.Ext(entry.FilePath)) != ".docx" {
			return "", errors.New("save docx: preview token does not reference a DOCX file")
		}
		return entry.FilePath, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("save docx: home dir: %w", err)
	}
	dir := filepath.Join(home, "Downloads")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("save docx: mkdir: %w", err)
	}
	name := normalizeDocxFileName(input.FileName)
	base := strings.TrimSuffix(name, ".docx")
	return filepath.Join(dir, fmt.Sprintf("%s-edited-%d.docx", base, time.Now().UnixNano())), nil
}

func normalizeDocxFileName(name string) string {
	name = filepath.Base(strings.TrimSpace(name))
	if name == "" || name == "." {
		return "OfficeDex-Document.docx"
	}
	if strings.ToLower(filepath.Ext(name)) != ".docx" {
		name += ".docx"
	}
	return name
}

// LocalImageData wraps a read-back image for renderer preview.
type LocalImageData struct {
	Data []byte `json:"data"`
	Mime string `json:"mime"`
}

var localImageMimeByExt = map[string]string{
	"png":  "image/png",
	"jpg":  "image/jpeg",
	"jpeg": "image/jpeg",
	"gif":  "image/gif",
	"webp": "image/webp",
	"bmp":  "image/bmp",
	"svg":  "image/svg+xml",
}

// ReadLocalImage returns raw bytes for an image file the user has attached
// (via OpenMultiFileDialog / SavePastedImage). The extension whitelist mirrors
// the renderer-side reference-image spec so unrelated paths cannot be read.
func (a *App) ReadLocalImage(filePath string) (LocalImageData, error) {
	if filePath == "" {
		return LocalImageData{}, errors.New("read local image: empty path")
	}
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(filePath), "."))
	mime, ok := localImageMimeByExt[ext]
	if !ok {
		return LocalImageData{}, fmt.Errorf("read local image: unsupported extension %q", ext)
	}
	data, err := os.ReadFile(filePath)
	if err != nil {
		return LocalImageData{}, fmt.Errorf("read local image: %w", err)
	}
	return LocalImageData{Data: data, Mime: mime}, nil
}

// LocalTextDocument is one attached plain-text reference file.
type LocalTextDocument struct {
	FilePath  string `json:"filePath"`
	FileName  string `json:"fileName"`
	Text      string `json:"text"`
	Truncated bool   `json:"truncated"`
}

// localTextExtensions is the whitelist of plain-text reference formats. As with
// ReadLocalImage this is an allow-list, so an unrelated path cannot be read
// just because the user dropped it on the intake.
var localTextExtensions = map[string]bool{
	"txt": true, "md": true, "markdown": true, "csv": true, "tsv": true, "log": true, "json": true,
}

const (
	// maxLocalTextBytesPerFile bounds a single attachment, and
	// maxLocalTextBytesTotal bounds one intake, so a large folder cannot blow
	// past the model's context or stall the UI.
	maxLocalTextBytesPerFile = 256 * 1024
	maxLocalTextBytesTotal   = 1024 * 1024
	maxLocalTextDocuments    = 20
)

// ReadLocalTextDocuments reads attached plain-text files for prompt grounding.
// Oversized files are truncated rather than rejected: a partial document still
// grounds the request, while a hard failure would lose the whole attachment.
func (a *App) ReadLocalTextDocuments(filePaths []string) ([]LocalTextDocument, error) {
	if len(filePaths) == 0 {
		return nil, nil
	}
	if len(filePaths) > maxLocalTextDocuments {
		return nil, fmt.Errorf("read local text: at most %d files can be attached at once", maxLocalTextDocuments)
	}
	documents := make([]LocalTextDocument, 0, len(filePaths))
	total := 0
	for _, filePath := range filePaths {
		if strings.TrimSpace(filePath) == "" {
			return nil, errors.New("read local text: empty path")
		}
		ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(filePath), "."))
		if !localTextExtensions[ext] {
			return nil, fmt.Errorf("read local text: unsupported extension %q", ext)
		}
		info, err := os.Stat(filePath)
		if err != nil {
			return nil, fmt.Errorf("read local text: %w", err)
		}
		if info.IsDir() {
			return nil, fmt.Errorf("read local text: %s is a directory", filepath.Base(filePath))
		}
		if total >= maxLocalTextBytesTotal {
			break
		}
		data, err := os.ReadFile(filePath)
		if err != nil {
			return nil, fmt.Errorf("read local text: %w", err)
		}
		limit := maxLocalTextBytesPerFile
		if remaining := maxLocalTextBytesTotal - total; remaining < limit {
			limit = remaining
		}
		truncated := false
		if len(data) > limit {
			data = data[:limit]
			truncated = true
		}
		total += len(data)
		text := decodeLocalText(data)
		documents = append(documents, LocalTextDocument{
			FilePath:  filePath,
			FileName:  filepath.Base(filePath),
			Text:      text,
			Truncated: truncated,
		})
	}
	return documents, nil
}

// decodeLocalText normalises an attachment to valid UTF-8 text. Files written
// by Windows tools commonly carry a BOM or CRLF line endings, neither of which
// should reach the prompt.
func decodeLocalText(data []byte) string {
	data = bytes.TrimPrefix(data, []byte{0xEF, 0xBB, 0xBF})
	text := string(data)
	if !utf8.ValidString(text) {
		text = strings.ToValidUTF8(text, "\uFFFD")
	}
	text = strings.ReplaceAll(text, "\r\n", "\n")
	return strings.ReplaceAll(text, "\r", "\n")
}

// CopyImageToClipboard writes a local image file to the system clipboard. Wails
// only exposes text clipboard helpers, and macOS WebKit does not reliably
// support navigator.clipboard.write for image blobs inside the app webview.
func (a *App) CopyImageToClipboard(filePath string) error {
	if filePath == "" {
		return errors.New("copy image to clipboard: empty path")
	}
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(filePath), "."))
	if _, ok := localImageMimeByExt[ext]; !ok {
		return fmt.Errorf("copy image to clipboard: unsupported extension %q", ext)
	}
	info, err := os.Stat(filePath)
	if err != nil {
		return fmt.Errorf("copy image to clipboard: %w", err)
	}
	if info.IsDir() {
		return errors.New("copy image to clipboard: path is a directory")
	}
	if runtime.GOOS != "darwin" {
		return errors.New("copy image to clipboard: native image clipboard is only supported on macOS")
	}
	return copyImageToClipboardDarwin(filePath)
}

func copyImageToClipboardDarwin(filePath string) error {
	const script = `
ObjC.import("AppKit");
function run(argv) {
  const path = argv[0];
  const image = $.NSImage.alloc.initWithContentsOfFile(path);
  if (!image) {
    throw new Error("copy image to clipboard: could not load image");
  }
  const pasteboard = $.NSPasteboard.generalPasteboard;
  pasteboard.clearContents;
  const ok = pasteboard.writeObjects($.NSArray.arrayWithObject(image));
  if (!ok) {
    throw new Error("copy image to clipboard: NSPasteboard write failed");
  }
}
`
	cmd := exec.Command("/usr/bin/osascript", "-l", "JavaScript", "-e", script, filePath)
	out, err := cmd.CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			return fmt.Errorf("copy image to clipboard: %w", err)
		}
		return fmt.Errorf("copy image to clipboard: %w: %s", err, msg)
	}
	return nil
}
