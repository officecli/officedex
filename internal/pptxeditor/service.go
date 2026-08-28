package pptxeditor

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"mime"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"officedex/internal/atomicfile"
	"officedex/internal/preview"
)

const (
	sessionDirectoryPrefix = "officedex-pptx-session-"
	maxSourcePptxBytes     = int64(512 << 20)
	maxMopContentBytes     = int64(512 << 20)
	maxAssetBytes          = int64(100 << 20)
	staleSessionAge        = 24 * time.Hour
)

var (
	ErrSessionMismatch = errors.New("pptx editor: preview token or session mismatch")
	ErrSourceChanged   = errors.New("pptx editor: source PPTX changed externally")
	ErrServiceClosed   = errors.New("pptx editor: service is closed")
)

type PreviewResolver interface {
	ResolveToken(string) (preview.ArtifactEntry, error)
}

type Asset struct {
	Path        string `json:"path"`
	ContentType string `json:"contentType"`
	Data        []byte `json:"data"`
}

type PrepareResult struct {
	SessionID        string  `json:"sessionId"`
	FileID           string  `json:"fileId"`
	Title            string  `json:"title"`
	SourceFileName   string  `json:"sourceFileName"`
	Content          []byte  `json:"content"`
	DocumentRevision int     `json:"documentRevision"`
	Assets           []Asset `json:"assets,omitempty"`
}

type SaveResult struct {
	FilePath string `json:"filePath"`
	Revision int    `json:"revision"`
}

type SaveAssetResult struct {
	ResourceURI  string `json:"resourceUri"`
	Digest       string `json:"digest"`
	ResourceSize int    `json:"resourceSize"`
	ContentType  string `json:"contentType"`
	Extension    string `json:"extension"`
}

type fileFingerprint struct {
	size            int64
	modTimeUnixNano int64
	sha256          [sha256.Size]byte
	info            os.FileInfo
}

func (f fileFingerprint) equal(other fileFingerprint) bool {
	return f.size == other.size && f.modTimeUnixNano == other.modTimeUnixNano &&
		f.sha256 == other.sha256 && f.info != nil && other.info != nil && os.SameFile(f.info, other.info)
}

type editSession struct {
	previewToken string
	filePath     string
	directory    string
	mopDirectory string
	contentPath  string
	fingerprint  fileFingerprint
	revision     int
}

type Service struct {
	mu           sync.Mutex
	resolver     PreviewResolver
	converter    Converter
	tempRoot     string
	sessions     map[string]*editSession
	now          func() time.Time
	newSessionID func() string
	closed       bool
}

func NewService(resolver PreviewResolver, converter Converter, tempRoot string) *Service {
	if tempRoot == "" {
		tempRoot = os.TempDir()
	}
	return &Service{
		resolver: resolver, converter: converter, tempRoot: tempRoot,
		sessions: make(map[string]*editSession), now: time.Now, newSessionID: uuid.NewString,
	}
}

func (s *Service) Prepare(ctx context.Context, previewToken string) (PrepareResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return PrepareResult{}, ErrServiceClosed
	}
	if s.resolver == nil || s.converter == nil {
		return PrepareResult{}, errors.New("pptx editor: service is not configured")
	}
	entry, err := s.resolver.ResolveToken(previewToken)
	if err != nil {
		return PrepareResult{}, err
	}
	filePath, err := canonicalPptxPath(entry)
	if err != nil {
		return PrepareResult{}, err
	}
	baseline, err := fingerprintPptx(filePath)
	if err != nil {
		return PrepareResult{}, fmt.Errorf("pptx editor: fingerprint source: %w", err)
	}
	// A reloaded page leaves its session behind — nothing tells the host the
	// tab is gone — and if the file was replaced underneath it, that session
	// can no longer save anything: it just fails on every attempt. Retire
	// those. A session whose source still matches is somebody's open document
	// (two panels, or a strict-mode double mount) and is left alone.
	s.retireUnusableSessionsLocked(filePath)
	if err := os.MkdirAll(s.tempRoot, 0o700); err != nil {
		return PrepareResult{}, fmt.Errorf("pptx editor: create temp root: %w", err)
	}
	directory, err := os.MkdirTemp(s.tempRoot, sessionDirectoryPrefix)
	if err != nil {
		return PrepareResult{}, fmt.Errorf("pptx editor: create session: %w", err)
	}
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.RemoveAll(directory)
		}
	}()
	if err := os.Chmod(directory, 0o700); err != nil {
		return PrepareResult{}, fmt.Errorf("pptx editor: secure session: %w", err)
	}
	mopDirectory := filepath.Join(directory, "presentation.mop")
	if err := s.converter.ImportPptx(ctx, filePath, mopDirectory); err != nil {
		return PrepareResult{}, fmt.Errorf("pptx editor: import PPTX: %w", err)
	}
	contentPath, err := resolveMopContentPath(mopDirectory)
	if err != nil {
		return PrepareResult{}, err
	}
	content, err := readBoundedFile(contentPath, maxMopContentBytes)
	if err != nil {
		return PrepareResult{}, fmt.Errorf("pptx editor: read MOP content: %w", err)
	}
	assets, err := collectAssets(mopDirectory)
	if err != nil {
		return PrepareResult{}, fmt.Errorf("pptx editor: read MOP assets: %w", err)
	}
	current, err := fingerprintPptx(filePath)
	if err != nil || !current.equal(baseline) {
		return PrepareResult{}, ErrSourceChanged
	}
	sessionID := s.newSessionID()
	s.sessions[sessionID] = &editSession{
		previewToken: previewToken, filePath: filePath, directory: directory,
		mopDirectory: mopDirectory, contentPath: contentPath, fingerprint: baseline,
	}
	cleanup = false
	return PrepareResult{
		SessionID: sessionID, FileID: sessionID, Title: strings.TrimSuffix(filepath.Base(filePath), filepath.Ext(filePath)),
		SourceFileName: filepath.Base(filePath), Content: content, DocumentRevision: 0, Assets: assets,
	}, nil
}

func (s *Service) SaveSnapshot(previewToken, sessionID string, content []byte, baseRevision, revision int) (SaveResult, error) {
	if len(content) == 0 || int64(len(content)) > maxMopContentBytes {
		return SaveResult{}, errors.New("pptx editor: invalid MOP content size")
	}
	if revision <= baseRevision {
		return SaveResult{}, errors.New("pptx editor: revision must advance")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	session, err := s.sessionLocked(previewToken, sessionID)
	if err != nil {
		return SaveResult{}, err
	}
	if baseRevision != session.revision {
		return SaveResult{}, fmt.Errorf("pptx editor: revision conflict: current=%d", session.revision)
	}
	if err := validateSourceUnchanged(session); err != nil {
		return SaveResult{}, err
	}
	// The editor writes fills set from raw bytes as inline data: URIs; stage
	// them as package assets so the saved package stays exportable.
	staged, err := stageInlineResources(content, session.mopDirectory)
	if err != nil {
		return SaveResult{}, err
	}
	if err := atomicfile.WriteFile(session.contentPath, staged, 0o600); err != nil {
		return SaveResult{}, fmt.Errorf("pptx editor: save MOP snapshot: %w", err)
	}
	session.revision = revision
	return SaveResult{FilePath: session.filePath, Revision: revision}, nil
}

func (s *Service) SaveAsset(previewToken, sessionID, relativePath, contentType string, data []byte) (SaveAssetResult, error) {
	if len(data) == 0 || int64(len(data)) > maxAssetBytes {
		return SaveAssetResult{}, errors.New("pptx editor: invalid asset size")
	}
	cleanPath, err := safeAssetPath(relativePath)
	if err != nil {
		return SaveAssetResult{}, err
	}
	digest := sha256.Sum256(data)
	digestHex := fmt.Sprintf("%x", digest[:])
	base := filepath.Base(cleanPath)
	if !strings.HasPrefix(strings.ToLower(base), digestHex+".") {
		return SaveAssetResult{}, errors.New("pptx editor: asset path does not match content digest")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	session, err := s.sessionLocked(previewToken, sessionID)
	if err != nil {
		return SaveAssetResult{}, err
	}
	target := filepath.Join(session.mopDirectory, filepath.FromSlash(cleanPath))
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		return SaveAssetResult{}, fmt.Errorf("pptx editor: create asset directory: %w", err)
	}
	if err := atomicfile.WriteFile(target, data, 0o600); err != nil {
		return SaveAssetResult{}, fmt.Errorf("pptx editor: save asset: %w", err)
	}
	extension := strings.TrimPrefix(strings.ToLower(filepath.Ext(cleanPath)), ".")
	if strings.TrimSpace(contentType) == "" {
		contentType = mime.TypeByExtension(filepath.Ext(cleanPath))
	}
	return SaveAssetResult{
		ResourceURI: "mop-asset:/" + cleanPath, Digest: "sha256:" + digestHex,
		ResourceSize: len(data), ContentType: contentType, Extension: extension,
	}, nil
}

// SnapshotResult is a session's document as it currently stands on disk,
// together with the media it references.
type SnapshotResult struct {
	Content  []byte  `json:"content"`
	Assets   []Asset `json:"assets,omitempty"`
	Revision int     `json:"revision"`
}

// Snapshot reads the session's saved MOP package. It reflects the last flush,
// so a caller that wants the newest edits must make the editor save first —
// running a script with the default snapshot wait does exactly that.
func (s *Service) Snapshot(previewToken, sessionID string) (SnapshotResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	session, err := s.sessionLocked(previewToken, sessionID)
	if err != nil {
		return SnapshotResult{}, err
	}
	content, err := os.ReadFile(session.contentPath)
	if err != nil {
		return SnapshotResult{}, fmt.Errorf("pptx editor: read MOP content: %w", err)
	}
	assets, err := collectAssets(session.mopDirectory)
	if err != nil {
		return SnapshotResult{}, err
	}
	return SnapshotResult{Content: content, Assets: assets, Revision: session.revision}, nil
}

func (s *Service) Export(ctx context.Context, previewToken, sessionID string, revision int) (SaveResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	session, err := s.sessionLocked(previewToken, sessionID)
	if err != nil {
		return SaveResult{}, err
	}
	if revision != session.revision {
		return SaveResult{}, fmt.Errorf("pptx editor: revision conflict: current=%d", session.revision)
	}
	if err := validateSourceUnchanged(session); err != nil {
		return SaveResult{}, err
	}
	exported, err := os.CreateTemp(filepath.Dir(session.filePath), ".officedex-pptx-*.pptx")
	if err != nil {
		return SaveResult{}, fmt.Errorf("pptx editor: create export: %w", err)
	}
	exportedPath := exported.Name()
	if err := exported.Close(); err != nil {
		_ = os.Remove(exportedPath)
		return SaveResult{}, err
	}
	defer os.Remove(exportedPath)
	if err := s.converter.ExportPptx(ctx, session.mopDirectory, exportedPath); err != nil {
		return SaveResult{}, fmt.Errorf("pptx editor: export PPTX: %w", err)
	}
	if err := replacePptxAtomically(session.filePath, exportedPath); err != nil {
		return SaveResult{}, err
	}
	refreshed, err := fingerprintPptx(session.filePath)
	if err != nil {
		return SaveResult{FilePath: session.filePath, Revision: revision}, fmt.Errorf("pptx editor: refresh source fingerprint: %w", err)
	}
	session.fingerprint = refreshed
	return SaveResult{FilePath: session.filePath, Revision: revision}, nil
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
	return s.closeLocked(sessionID, session)
}

func (s *Service) CloseByToken(previewToken string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	var failures []error
	for sessionID, session := range s.sessions {
		if session.previewToken == previewToken {
			failures = append(failures, s.closeLocked(sessionID, session))
		}
	}
	return errors.Join(failures...)
}

func (s *Service) CloseAll() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closed = true
	var failures []error
	for sessionID, session := range s.sessions {
		failures = append(failures, s.closeLocked(sessionID, session))
	}
	if s.converter != nil {
		failures = append(failures, s.converter.Close())
	}
	return errors.Join(failures...)
}

func (s *Service) CleanupStale() error {
	entries, err := os.ReadDir(s.tempRoot)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var failures []error
	for _, entry := range entries {
		if !strings.HasPrefix(entry.Name(), sessionDirectoryPrefix) || entry.Type()&os.ModeSymlink != 0 {
			continue
		}
		info, err := entry.Info()
		if err != nil || !info.IsDir() || s.now().Sub(info.ModTime()) <= staleSessionAge {
			continue
		}
		failures = append(failures, os.RemoveAll(filepath.Join(s.tempRoot, entry.Name())))
	}
	return errors.Join(failures...)
}

// CloseByFile retires every session editing a file. A caller about to replace
// or remove that file uses it so those sessions stop saving, rather than
// failing on every attempt once the file underneath them is gone.
func (s *Service) CloseByFile(filePath string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closeSessionsForFileLocked(filePath)
	return nil
}

// retireUnusableSessionsLocked closes the sessions on a file that can no longer
// save, because the file is no longer the one they fingerprinted.
func (s *Service) retireUnusableSessionsLocked(filePath string) {
	for id, session := range s.sessions {
		if session.filePath != filePath || validateSourceUnchanged(session) == nil {
			continue
		}
		_ = s.closeLocked(id, session)
	}
}

// closeSessionsForFileLocked retires every session already editing a file.
func (s *Service) closeSessionsForFileLocked(filePath string) {
	for id, session := range s.sessions {
		if session.filePath != filePath {
			continue
		}
		_ = s.closeLocked(id, session)
	}
}

func (s *Service) sessionLocked(previewToken, sessionID string) (*editSession, error) {
	if s.closed {
		return nil, ErrServiceClosed
	}
	session, ok := s.sessions[sessionID]
	if !ok || session.previewToken != previewToken {
		return nil, ErrSessionMismatch
	}
	entry, err := s.resolver.ResolveToken(previewToken)
	if err != nil {
		return nil, err
	}
	resolvedPath, err := canonicalPptxPath(entry)
	if err != nil || resolvedPath != session.filePath {
		return nil, ErrSessionMismatch
	}
	return session, nil
}

func (s *Service) closeLocked(sessionID string, session *editSession) error {
	err := os.RemoveAll(session.directory)
	if err == nil {
		delete(s.sessions, sessionID)
	}
	return err
}

func canonicalPptxPath(entry preview.ArtifactEntry) (string, error) {
	if !strings.EqualFold(entry.DocumentType, "pptx") || !strings.EqualFold(filepath.Ext(entry.FilePath), ".pptx") {
		return "", errors.New("pptx editor: preview token does not reference a PPTX file")
	}
	abs, err := filepath.Abs(entry.FilePath)
	if err != nil {
		return "", err
	}
	resolved, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", err
	}
	return filepath.Clean(resolved), nil
}

func fingerprintPptx(path string) (fileFingerprint, error) {
	pathInfo, err := os.Lstat(path)
	if err != nil || !pathInfo.Mode().IsRegular() {
		return fileFingerprint{}, errors.New("source PPTX is not a regular file")
	}
	file, err := os.Open(path)
	if err != nil {
		return fileFingerprint{}, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !os.SameFile(pathInfo, info) || info.Size() > maxSourcePptxBytes {
		return fileFingerprint{}, ErrSourceChanged
	}
	hash := sha256.New()
	readBytes, err := io.Copy(hash, io.LimitReader(file, maxSourcePptxBytes+1))
	if err != nil || readBytes > maxSourcePptxBytes {
		return fileFingerprint{}, ErrSourceChanged
	}
	afterInfo, err := file.Stat()
	currentPathInfo, pathErr := os.Lstat(path)
	if err != nil || pathErr != nil || !os.SameFile(info, afterInfo) || !os.SameFile(info, currentPathInfo) ||
		afterInfo.Size() != info.Size() || !afterInfo.ModTime().Equal(info.ModTime()) {
		return fileFingerprint{}, ErrSourceChanged
	}
	var digest [sha256.Size]byte
	copy(digest[:], hash.Sum(nil))
	return fileFingerprint{size: info.Size(), modTimeUnixNano: info.ModTime().UnixNano(), sha256: digest, info: info}, nil
}

func validateSourceUnchanged(session *editSession) error {
	current, err := fingerprintPptx(session.filePath)
	if err != nil || !current.equal(session.fingerprint) {
		return ErrSourceChanged
	}
	return nil
}

func resolveMopContentPath(directory string) (string, error) {
	for _, name := range []string{"content.json", "content.bin"} {
		candidate := filepath.Join(directory, name)
		if info, err := os.Stat(candidate); err == nil && info.Mode().IsRegular() {
			return candidate, nil
		}
	}
	return "", errors.New("pptx editor: imported MOP package has no content.json or content.bin")
}

func collectAssets(directory string) ([]Asset, error) {
	var assets []Asset
	var total int64
	for _, category := range []string{"media", "embeddings"} {
		root := filepath.Join(directory, category)
		err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
			if errors.Is(walkErr, os.ErrNotExist) {
				return filepath.SkipDir
			}
			if walkErr != nil {
				return walkErr
			}
			if entry.IsDir() {
				return nil
			}
			info, err := entry.Info()
			if err != nil || !info.Mode().IsRegular() || info.Size() > maxAssetBytes || total > maxMopContentBytes-info.Size() {
				return errors.New("pptx editor: MOP assets exceed limits")
			}
			data, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			total += int64(len(data))
			relative, err := filepath.Rel(directory, path)
			if err != nil {
				return err
			}
			assets = append(assets, Asset{Path: filepath.ToSlash(relative), ContentType: mime.TypeByExtension(filepath.Ext(path)), Data: data})
			return nil
		})
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return nil, err
		}
	}
	return assets, nil
}

func safeAssetPath(value string) (string, error) {
	clean := filepath.ToSlash(filepath.Clean(strings.TrimSpace(value)))
	if clean == "." || strings.HasPrefix(clean, "../") || strings.HasPrefix(clean, "/") ||
		!(strings.HasPrefix(clean, "media/") || strings.HasPrefix(clean, "embeddings/")) {
		return "", errors.New("pptx editor: invalid MOP asset path")
	}
	return clean, nil
}

func readBoundedFile(path string, maxBytes int64) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxBytes+1))
	if err != nil || len(data) == 0 || int64(len(data)) > maxBytes {
		return nil, errors.New("invalid bounded file")
	}
	return data, nil
}

func replacePptxAtomically(originalPath, exportedPath string) error {
	if filepath.Clean(filepath.Dir(originalPath)) != filepath.Clean(filepath.Dir(exportedPath)) {
		return errors.New("pptx editor: export must be beside source")
	}
	if err := validatePptx(exportedPath); err != nil {
		return err
	}
	originalInfo, err := os.Stat(originalPath)
	if err != nil {
		return err
	}
	exported, err := os.OpenFile(exportedPath, os.O_RDWR, 0)
	if err != nil {
		return err
	}
	if err := exported.Chmod(originalInfo.Mode().Perm()); err != nil {
		exported.Close()
		return err
	}
	if err := exported.Sync(); err != nil {
		exported.Close()
		return err
	}
	if err := exported.Close(); err != nil {
		return err
	}
	if err := os.Rename(exportedPath, originalPath); err != nil {
		return err
	}
	if directory, err := os.Open(filepath.Dir(originalPath)); err == nil {
		defer directory.Close()
		return directory.Sync()
	}
	return nil
}

func validatePptx(path string) error {
	reader, err := zip.OpenReader(path)
	if err != nil {
		return fmt.Errorf("pptx editor: exported file is not a ZIP: %w", err)
	}
	defer reader.Close()
	hasContentTypes := false
	hasPresentation := false
	for _, entry := range reader.File {
		switch entry.Name {
		case "[Content_Types].xml":
			hasContentTypes = true
		case "ppt/presentation.xml":
			hasPresentation = true
		}
	}
	if !hasContentTypes || !hasPresentation {
		return errors.New("pptx editor: exported PPTX is missing required package entries")
	}
	return nil
}
