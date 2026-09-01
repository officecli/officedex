package xlsxeditor

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"officedex/internal/preview"
)

const (
	sessionDirectoryPrefix = "officedex-xlsx-session-"
	maxSourceXlsxBytes     = int64(100 << 20)
	defaultMaxModocBytes   = int64(256 << 20)
	maxStagedImageBytes    = int64(50 << 20)
	staleSessionAge        = 24 * time.Hour
)

var (
	ErrSessionMismatch = errors.New("xlsx editor: preview token or session mismatch")
	ErrModocTooLarge   = errors.New("xlsx editor: MODoc content exceeds size limit")
	ErrSourceChanged   = errors.New("xlsx editor: source XLSX changed externally")
	ErrServiceClosed   = errors.New("xlsx editor: service is closed")
)

type PreviewResolver interface {
	ResolveToken(string) (preview.ArtifactEntry, error)
}

type Converter interface {
	ImportXlsx(context.Context, string, string, string) error
	ExportXlsx(context.Context, string, string, string) error
	Close() error
}

type PrepareResult struct {
	SessionID    string            `json:"sessionId"`
	ModocContent string            `json:"modocContent"`
	ImageAssets  []ModocImageAsset `json:"imageAssets,omitempty"`
}

type ModocImageAsset struct {
	URL     string `json:"url"`
	DataURL string `json:"dataUrl"`
}

type SaveResult struct {
	FilePath string `json:"filePath"`
}

type StageImageResult struct {
	URL string `json:"url"`
}

type ManagedSheet struct {
	SheetName string     `json:"sheetName"`
	Rows      [][]string `json:"rows"`
}

type fileFingerprint struct {
	Size            int64
	ModTimeUnixNano int64
	SHA256          [sha256.Size]byte
	FileInfo        os.FileInfo
}

func (fingerprint fileFingerprint) Equal(other fileFingerprint) bool {
	return fingerprint.Size == other.Size &&
		fingerprint.ModTimeUnixNano == other.ModTimeUnixNano &&
		fingerprint.SHA256 == other.SHA256 &&
		fingerprint.FileInfo != nil && other.FileInfo != nil &&
		os.SameFile(fingerprint.FileInfo, other.FileInfo)
}

type editSession struct {
	previewToken     string
	filePath         string
	directory        string
	modocPath        string
	modocContentPath string
	fingerprint      fileFingerprint
	stagedImages     []stagedImage
}

type stagedImage struct {
	filePath  string
	extension string
	sheetName string
	row       int
	column    int
	statusCol int
}

type Service struct {
	mu               sync.Mutex
	resolver         PreviewResolver
	converter        Converter
	tempRoot         string
	sessions         map[string]*editSession
	maxModocBytes    int64
	now              func() time.Time
	newSessionID     func() string
	mkdirTemp        func(string, string) (string, error)
	removeAll        func(string) error
	saveStagedImages func(string, string, []stagedImage) error
	closed           bool
	converterClosed  bool
}

func NewService(resolver PreviewResolver, converter Converter, tempRoot string) *Service {
	if tempRoot == "" {
		tempRoot = os.TempDir()
	}
	return &Service{
		resolver:         resolver,
		converter:        converter,
		tempRoot:         tempRoot,
		sessions:         make(map[string]*editSession),
		maxModocBytes:    defaultMaxModocBytes,
		now:              time.Now,
		newSessionID:     uuid.NewString,
		mkdirTemp:        os.MkdirTemp,
		removeAll:        os.RemoveAll,
		saveStagedImages: saveStagedImagesToXlsx,
	}
}

func (s *Service) Prepare(ctx context.Context, previewToken string) (PrepareResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return PrepareResult{}, ErrServiceClosed
	}
	if s.resolver == nil || s.converter == nil {
		return PrepareResult{}, errors.New("xlsx editor: service is not configured")
	}

	entry, err := s.resolver.ResolveToken(previewToken)
	if err != nil {
		return PrepareResult{}, err
	}
	filePath, err := canonicalXlsxPath(entry)
	if err != nil {
		return PrepareResult{}, err
	}
	baseline, err := fingerprintXlsx(filePath, maxSourceXlsxBytes)
	if err != nil {
		return PrepareResult{}, fmt.Errorf("xlsx editor: fingerprint source XLSX: %w", err)
	}

	if err := os.MkdirAll(s.tempRoot, 0o700); err != nil {
		return PrepareResult{}, fmt.Errorf("xlsx editor: create temp root: %w", err)
	}
	directory, err := s.mkdirTemp(s.tempRoot, sessionDirectoryPrefix)
	if err != nil {
		return PrepareResult{}, fmt.Errorf("xlsx editor: create session directory: %w", err)
	}
	cleanup := true
	defer func() {
		if cleanup {
			_ = s.removeAll(directory)
		}
	}()
	if err := os.Chmod(directory, 0o700); err != nil {
		return PrepareResult{}, fmt.Errorf("xlsx editor: secure session directory: %w", err)
	}

	importPath, cleanupImport, err := normalizeWorksheetDrawingTargets(filePath)
	if err != nil {
		return PrepareResult{}, fmt.Errorf("xlsx editor: normalize XLSX drawings: %w", err)
	}
	defer cleanupImport()
	modocPath := filepath.Join(directory, "workbook.modoc")
	if err := s.converter.ImportXlsx(ctx, importPath, modocPath, directory); err != nil {
		return PrepareResult{}, fmt.Errorf("xlsx editor: import XLSX: %w", err)
	}
	modocContentPath, err := resolveModocContentPath(modocPath)
	if err != nil {
		return PrepareResult{}, fmt.Errorf("xlsx editor: resolve imported MODoc content: %w", err)
	}
	modoc, err := readBoundedNonEmptyFile(modocContentPath, s.maxModocBytes)
	if err != nil {
		return PrepareResult{}, fmt.Errorf("xlsx editor: read imported MODoc: %w", err)
	}
	current, err := fingerprintXlsx(filePath, maxSourceXlsxBytes)
	if err != nil || !current.Equal(baseline) {
		return PrepareResult{}, ErrSourceChanged
	}
	imageAssets, err := collectModocImageAssets(modocPath)
	if err != nil {
		return PrepareResult{}, fmt.Errorf("xlsx editor: read MODoc image assets: %w", err)
	}

	sessionID := s.newSessionID()
	s.sessions[sessionID] = &editSession{
		previewToken:     previewToken,
		filePath:         filePath,
		directory:        directory,
		modocPath:        modocPath,
		modocContentPath: modocContentPath,
		fingerprint:      baseline,
	}
	cleanup = false
	return PrepareResult{SessionID: sessionID, ModocContent: string(modoc), ImageAssets: imageAssets}, nil
}

func collectModocImageAssets(modocPath string) ([]ModocImageAsset, error) {
	info, err := os.Lstat(modocPath)
	if err != nil || !info.IsDir() {
		return nil, err
	}
	mediaDir := filepath.Join(modocPath, "media")
	entries, err := os.ReadDir(mediaDir)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	mimeByExt := map[string]string{
		".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
		".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp", ".svg": "image/svg+xml",
	}
	assets := make([]ModocImageAsset, 0, len(entries))
	var total int64
	for _, entry := range entries {
		if !entry.Type().IsRegular() {
			continue
		}
		mime, ok := mimeByExt[strings.ToLower(filepath.Ext(entry.Name()))]
		if !ok {
			continue
		}
		data, err := os.ReadFile(filepath.Join(mediaDir, entry.Name()))
		if err != nil {
			return nil, err
		}
		total += int64(len(data))
		if total > maxStagedImageBytes {
			return nil, errors.New("MODoc image assets exceed size limit")
		}
		assets = append(assets, ModocImageAsset{
			URL:     "modoc-assets:/media/" + entry.Name(),
			DataURL: "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data),
		})
	}
	return assets, nil
}

func (s *Service) Save(ctx context.Context, previewToken, sessionID, modocContent string, managedSheets []ManagedSheet) (SaveResult, error) {
	if int64(len(modocContent)) > s.maxModocBytes {
		return SaveResult{}, ErrModocTooLarge
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return SaveResult{}, ErrServiceClosed
	}
	session, ok := s.sessions[sessionID]
	if !ok || session.previewToken != previewToken {
		return SaveResult{}, ErrSessionMismatch
	}
	entry, err := s.resolver.ResolveToken(previewToken)
	if err != nil {
		return SaveResult{}, err
	}
	resolvedPath, err := canonicalXlsxPath(entry)
	if err != nil {
		return SaveResult{}, err
	}
	if resolvedPath != session.filePath {
		return SaveResult{}, ErrSessionMismatch
	}
	current, err := fingerprintXlsx(session.filePath, maxSourceXlsxBytes)
	if err != nil || !current.Equal(session.fingerprint) {
		return SaveResult{}, ErrSourceChanged
	}
	if len(session.stagedImages) > 0 {
		return s.saveWithStagedImages(ctx, session)
	}
	if err := os.WriteFile(session.modocContentPath, []byte(modocContent), 0o600); err != nil {
		return SaveResult{}, fmt.Errorf("xlsx editor: write MODoc: %w", err)
	}

	exportedFile, err := createTempXlsx(session.filePath)
	if err != nil {
		return SaveResult{}, fmt.Errorf("xlsx editor: create export file: %w", err)
	}
	exportedPath := exportedFile.Name()
	if err := exportedFile.Close(); err != nil {
		_ = os.Remove(exportedPath)
		return SaveResult{}, fmt.Errorf("xlsx editor: close export file: %w", err)
	}
	defer os.Remove(exportedPath)

	if err := s.converter.ExportXlsx(ctx, exportedPath, session.modocPath, session.directory); err != nil {
		return SaveResult{}, fmt.Errorf("xlsx editor: export XLSX: %w", err)
	}
	if len(managedSheets) > 0 {
		if err := writeManagedSheetsToXlsx(exportedPath, managedSheets); err != nil {
			return SaveResult{}, fmt.Errorf("xlsx editor: write managed sheets: %w", err)
		}
	}
	if err := replaceAtomically(session.filePath, exportedPath); err != nil {
		var postCommit *PostCommitError
		if errors.As(err, &postCommit) && postCommit.Replaced {
			if refreshed, refreshErr := fingerprintXlsx(session.filePath, maxSourceXlsxBytes); refreshErr == nil {
				session.fingerprint = refreshed
			}
			return SaveResult{FilePath: session.filePath}, err
		}
		return SaveResult{}, fmt.Errorf("xlsx editor: replace XLSX: %w", err)
	}
	refreshed, err := fingerprintXlsx(session.filePath, maxSourceXlsxBytes)
	if err != nil {
		return SaveResult{FilePath: session.filePath}, &PostCommitError{
			Replaced: true,
			Err:      fmt.Errorf("refresh source fingerprint: %w", err),
		}
	}
	session.fingerprint = refreshed
	return SaveResult{FilePath: session.filePath}, nil
}

func (s *Service) saveWithStagedImages(ctx context.Context, session *editSession) (SaveResult, error) {
	exportedFile, err := createTempXlsx(session.filePath)
	if err != nil {
		return SaveResult{}, fmt.Errorf("xlsx editor: create image export file: %w", err)
	}
	exportedPath := exportedFile.Name()
	if err := exportedFile.Close(); err != nil {
		_ = os.Remove(exportedPath)
		return SaveResult{}, fmt.Errorf("xlsx editor: close image export file: %w", err)
	}
	defer os.Remove(exportedPath)
	if err := s.saveStagedImages(session.filePath, exportedPath, session.stagedImages); err != nil {
		return SaveResult{}, fmt.Errorf("xlsx editor: write staged images: %w", err)
	}
	validationDir, err := s.mkdirTemp(s.tempRoot, "officedex-xlsx-validation-")
	if err != nil {
		return SaveResult{}, fmt.Errorf("xlsx editor: create image validation directory: %w", err)
	}
	defer s.removeAll(validationDir)
	if err := s.converter.ImportXlsx(ctx, exportedPath, filepath.Join(validationDir, "workbook.modoc"), validationDir); err != nil {
		return SaveResult{}, fmt.Errorf("xlsx editor: validate staged-image XLSX import: %w", err)
	}
	if err := replaceAtomically(session.filePath, exportedPath); err != nil {
		return SaveResult{}, fmt.Errorf("xlsx editor: replace XLSX with staged images: %w", err)
	}
	refreshed, err := fingerprintXlsx(session.filePath, maxSourceXlsxBytes)
	if err != nil {
		return SaveResult{FilePath: session.filePath}, &PostCommitError{
			Replaced: true,
			Err:      fmt.Errorf("refresh source fingerprint: %w", err),
		}
	}
	session.fingerprint = refreshed
	session.stagedImages = nil
	return SaveResult{FilePath: session.filePath}, nil
}

func (s *Service) StageImage(previewToken, sessionID string, data []byte, mime, sheetName string, row, column, statusCol int) (StageImageResult, error) {
	if len(data) == 0 {
		return StageImageResult{}, errors.New("xlsx editor: staged image is empty")
	}
	if int64(len(data)) > maxStagedImageBytes {
		return StageImageResult{}, errors.New("xlsx editor: staged image exceeds size limit")
	}
	ext, ok := map[string]string{
		"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif",
		"image/webp": "webp", "image/bmp": "bmp", "image/svg+xml": "svg",
	}[mime]
	if !ok {
		return StageImageResult{}, fmt.Errorf("xlsx editor: unsupported staged image mime %q", mime)
	}
	if strings.TrimSpace(sheetName) == "" || row < 0 || column < 0 || statusCol < -1 {
		return StageImageResult{}, errors.New("xlsx editor: staged image target is invalid")
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return StageImageResult{}, ErrServiceClosed
	}
	session, ok := s.sessions[sessionID]
	if !ok || session.previewToken != previewToken {
		return StageImageResult{}, ErrSessionMismatch
	}
	info, err := os.Lstat(session.modocPath)
	if err != nil {
		return StageImageResult{}, fmt.Errorf("xlsx editor: inspect MODoc package: %w", err)
	}
	if !info.IsDir() {
		return StageImageResult{}, errors.New("xlsx editor: MODoc package does not support media assets")
	}
	mediaDir := filepath.Join(session.modocPath, "media")
	if err := os.MkdirAll(mediaDir, 0o700); err != nil {
		return StageImageResult{}, fmt.Errorf("xlsx editor: create MODoc media directory: %w", err)
	}
	name := uuid.NewString() + "." + ext
	assetPath := filepath.Join(mediaDir, name)
	if err := os.WriteFile(assetPath, data, 0o600); err != nil {
		return StageImageResult{}, fmt.Errorf("xlsx editor: write MODoc image: %w", err)
	}
	assetURL := "modoc-assets:/media/" + name
	session.stagedImages = append(session.stagedImages, stagedImage{
		filePath:  assetPath,
		extension: "." + ext,
		sheetName: sheetName,
		row:       row,
		column:    column,
		statusCol: statusCol,
	})
	return StageImageResult{URL: assetURL}, nil
}

func (s *Service) Close(previewToken, sessionID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	session, ok := s.sessions[sessionID]
	if !ok {
		return nil
	}
	if session.previewToken != previewToken {
		return ErrSessionMismatch
	}
	return s.closeSessionLocked(sessionID, session)
}

func (s *Service) CloseByToken(previewToken string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	var cleanupErrors []error
	for sessionID, session := range s.sessions {
		if session.previewToken != previewToken {
			continue
		}
		if err := s.closeSessionLocked(sessionID, session); err != nil {
			cleanupErrors = append(cleanupErrors, err)
		}
	}
	return errors.Join(cleanupErrors...)
}

func (s *Service) CloseAll() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closed = true
	var cleanupErrors []error
	for sessionID, session := range s.sessions {
		if err := s.closeSessionLocked(sessionID, session); err != nil {
			cleanupErrors = append(cleanupErrors, err)
		}
	}
	if !s.converterClosed && s.converter != nil {
		s.converterClosed = true
		if err := s.converter.Close(); err != nil {
			cleanupErrors = append(cleanupErrors, fmt.Errorf("xlsx editor: close converter: %w", err))
		}
	}
	return errors.Join(cleanupErrors...)
}

func (s *Service) CleanupStale() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	entries, err := os.ReadDir(s.tempRoot)
	if err != nil {
		return fmt.Errorf("xlsx editor: read temp root: %w", err)
	}
	active := make(map[string]struct{}, len(s.sessions))
	for _, session := range s.sessions {
		active[filepath.Clean(session.directory)] = struct{}{}
	}
	var cleanupErrors []error
	for _, entry := range entries {
		if !strings.HasPrefix(entry.Name(), sessionDirectoryPrefix) || entry.Type()&os.ModeSymlink != 0 {
			continue
		}
		path := filepath.Join(s.tempRoot, entry.Name())
		if _, ok := active[filepath.Clean(path)]; ok {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			cleanupErrors = append(cleanupErrors, fmt.Errorf("xlsx editor: inspect stale session %q: %w", path, err))
			continue
		}
		if !info.IsDir() || s.now().Sub(info.ModTime()) <= staleSessionAge {
			continue
		}
		if err := s.removeAll(path); err != nil {
			cleanupErrors = append(cleanupErrors, fmt.Errorf("xlsx editor: remove stale session %q: %w", path, err))
		}
	}
	return errors.Join(cleanupErrors...)
}

func (s *Service) closeSessionLocked(sessionID string, session *editSession) error {
	if err := s.removeAll(session.directory); err != nil {
		return fmt.Errorf("xlsx editor: remove session directory: %w", err)
	}
	delete(s.sessions, sessionID)
	return nil
}

func canonicalXlsxPath(entry preview.ArtifactEntry) (string, error) {
	if !strings.EqualFold(entry.DocumentType, "xlsx") || !strings.EqualFold(filepath.Ext(entry.FilePath), ".xlsx") {
		return "", errors.New("xlsx editor: preview token does not reference an XLSX file")
	}
	abs, err := filepath.Abs(entry.FilePath)
	if err != nil {
		return "", fmt.Errorf("xlsx editor: resolve XLSX path: %w", err)
	}
	resolved, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", fmt.Errorf("xlsx editor: resolve XLSX symlinks: %w", err)
	}
	return filepath.Clean(resolved), nil
}

func fingerprintXlsx(path string, maxBytes int64) (fileFingerprint, error) {
	pathInfo, err := os.Lstat(path)
	if err != nil {
		return fileFingerprint{}, err
	}
	if !pathInfo.Mode().IsRegular() {
		return fileFingerprint{}, errors.New("source XLSX is not a regular file")
	}
	file, err := os.Open(path)
	if err != nil {
		return fileFingerprint{}, err
	}
	defer file.Close()
	openedInfo, err := file.Stat()
	if err != nil {
		return fileFingerprint{}, err
	}
	if !openedInfo.Mode().IsRegular() || !os.SameFile(pathInfo, openedInfo) {
		return fileFingerprint{}, ErrSourceChanged
	}
	if openedInfo.Size() > maxBytes {
		return fileFingerprint{}, fmt.Errorf("source XLSX exceeds size limit of %d bytes", maxBytes)
	}
	hash := sha256.New()
	readBytes, err := io.Copy(hash, io.LimitReader(file, maxBytes+1))
	if err != nil {
		return fileFingerprint{}, err
	}
	if readBytes > maxBytes {
		return fileFingerprint{}, fmt.Errorf("source XLSX exceeds size limit of %d bytes", maxBytes)
	}
	afterInfo, err := file.Stat()
	if err != nil {
		return fileFingerprint{}, err
	}
	currentPathInfo, err := os.Lstat(path)
	if err != nil {
		return fileFingerprint{}, err
	}
	if !os.SameFile(openedInfo, afterInfo) || !os.SameFile(openedInfo, currentPathInfo) ||
		afterInfo.Size() != openedInfo.Size() || !afterInfo.ModTime().Equal(openedInfo.ModTime()) {
		return fileFingerprint{}, ErrSourceChanged
	}
	var digest [sha256.Size]byte
	copy(digest[:], hash.Sum(nil))
	return fileFingerprint{
		Size:            openedInfo.Size(),
		ModTimeUnixNano: openedInfo.ModTime().UnixNano(),
		SHA256:          digest,
		FileInfo:        openedInfo,
	}, nil
}

func readBoundedNonEmptyFile(path string, maxBytes int64) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	content, err := io.ReadAll(io.LimitReader(file, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if len(content) == 0 {
		return nil, errors.New("MODoc output is empty")
	}
	if int64(len(content)) > maxBytes {
		return nil, ErrModocTooLarge
	}
	return content, nil
}

func resolveModocContentPath(path string) (string, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return "", err
	}
	if info.Mode().IsRegular() {
		return path, nil
	}
	if !info.IsDir() {
		return "", fmt.Errorf("MODoc output is neither a regular file nor a directory")
	}

	contentPath := filepath.Join(path, "content")
	contentInfo, err := os.Lstat(contentPath)
	if err != nil {
		return "", fmt.Errorf("inspect MODoc directory content: %w", err)
	}
	if !contentInfo.Mode().IsRegular() {
		return "", fmt.Errorf("MODoc directory content is not a regular file")
	}
	return contentPath, nil
}
