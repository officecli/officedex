// Package mophttp serves the `/api/osuite/mop/*` HTTP API that the embedded
// learnof/pptx editor talks to.
//
// During development that API is provided by the pptx repo's Vite dev-server
// middleware (tools/lib/upstream-handler.mjs). A packaged OfficeDex embeds the
// editor's static bundle but runs no Vite server, so without this package every
// editor request 404s and importing a presentation fails. The handler here is a
// deliberate port of the dev-server contract: same routes, status codes, error
// codes, headers, and JSON shapes, so the editor cannot tell the two apart.
package mophttp

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	revisionFileName = ".mop-revision.json"
	metaFileName     = ".mop-meta.json"
	contentFileName  = "content.json"
	renderedFileName = "rendered-pictures.json"
)

var packageIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// Store owns the on-disk MOP packages. The dev server keeps them under
// `<repo>/example/mop`; a packaged app has no repo, so the root is supplied by
// the caller (a directory under the user's workspace).
type Store struct {
	root string

	mu     sync.Mutex
	queues map[string]chan struct{}
}

func NewStore(root string) *Store {
	return &Store{root: root, queues: make(map[string]chan struct{})}
}

func (s *Store) Root() string { return s.root }

// packageRoot mirrors the dev server's mopPackageRoot: one directory per file
// ID, named by the ID itself. IDs are validated by the callers that accept them
// from a request, so a traversal sequence can never reach this point.
func (s *Store) packageRoot(fileID string) string {
	return filepath.Join(s.root, fileID)
}

// withWriteLock serializes writes per file ID, matching withMopWriteLock. Reads
// stay unsynchronized: every write lands via an atomic rename, so a reader sees
// either the old file or the new one.
func (s *Store) withWriteLock(fileID string, action func() error) error {
	s.mu.Lock()
	queue, ok := s.queues[fileID]
	if !ok {
		queue = make(chan struct{}, 1)
		s.queues[fileID] = queue
	}
	s.mu.Unlock()

	queue <- struct{}{}
	defer func() { <-queue }()
	return action()
}

// validFileID rejects anything that is not a bare package directory name. This
// is the single gate that keeps a request-supplied file ID from escaping the
// store root via `..` or an absolute path.
func validFileID(fileID string) bool {
	if fileID == "" || len(fileID) > 128 {
		return false
	}
	return packageIDPattern.MatchString(fileID)
}

func (s *Store) exists(fileID string) bool {
	info, err := os.Stat(s.packageRoot(fileID))
	return err == nil && info.IsDir()
}

type metadata struct {
	SourceFileName string `json:"sourceFileName,omitempty"`
	Title          string `json:"title,omitempty"`
	SourceDigest   string `json:"sourceDigest,omitempty"`
	ImportedAt     string `json:"importedAt,omitempty"`
	CreatedAt      string `json:"createdAt,omitempty"`
}

type revisionState struct {
	Revision      int64  `json:"revision"`
	ContentDigest string `json:"contentDigest"`
	UpdatedAt     string `json:"updatedAt"`
}

func contentDigest(content []byte) string {
	sum := sha256.Sum256(content)
	return "sha256:" + hex.EncodeToString(sum[:])
}

func readJSONIfExists(path string, target any) (bool, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if err := json.Unmarshal(data, target); err != nil {
		return false, err
	}
	return true, nil
}

func (s *Store) readMetadata(fileID string) *metadata {
	var meta metadata
	found, err := readJSONIfExists(filepath.Join(s.packageRoot(fileID), metaFileName), &meta)
	if err != nil || !found {
		return nil
	}
	return &meta
}

// readRevision mirrors readMopRevision: a revision only counts when the stored
// digest still matches the content on disk. Anything else resets to 0, so a
// package edited out from under the app cannot resume at a stale revision.
func (s *Store) readRevision(fileID string, content []byte) int64 {
	var state revisionState
	found, err := readJSONIfExists(filepath.Join(s.packageRoot(fileID), revisionFileName), &state)
	if err != nil || !found {
		return 0
	}
	if state.Revision < 0 {
		return 0
	}
	if content != nil && state.ContentDigest != contentDigest(content) {
		return 0
	}
	return state.Revision
}

func writeRevisionAt(packageRoot string, revision int64, content []byte, now time.Time) error {
	payload, err := json.MarshalIndent(revisionState{
		Revision:      revision,
		ContentDigest: contentDigest(content),
		UpdatedAt:     now.UTC().Format(time.RFC3339Nano),
	}, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomically(filepath.Join(packageRoot, revisionFileName), append(payload, '\n'))
}

// writeFileAtomically writes through a temporary file in the destination
// directory and renames it into place, so a reader never observes a partial
// package file.
func writeFileAtomically(path string, data []byte) error {
	directory := filepath.Dir(path)
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(directory, "."+filepath.Base(path)+".*.tmp")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)

	if _, err := temporary.Write(data); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Chmod(temporaryPath, 0o644); err != nil {
		return err
	}
	return os.Rename(temporaryPath, path)
}

func readFileIfExists(path string) ([]byte, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return data, nil
}

// readPackageFile resolves a package-relative path and refuses anything that
// escapes the package root. Unlike the dev server there is no fallback to a
// bundled default package: a packaged app ships no examples, so an unknown file
// ID is simply absent.
func (s *Store) readPackageFile(fileID, relativePath string) ([]byte, string, error) {
	if !validFileID(fileID) {
		return nil, "", nil
	}
	packageRoot := s.packageRoot(fileID)
	resolved := filepath.Join(packageRoot, filepath.FromSlash(relativePath))
	if resolved != packageRoot && !strings.HasPrefix(resolved, packageRoot+string(filepath.Separator)) {
		return nil, "", nil
	}
	data, err := readFileIfExists(resolved)
	if err != nil {
		return nil, "", err
	}
	if data == nil {
		return nil, "", nil
	}
	return data, resolved, nil
}

// ExampleItem is one entry of the `/examples` listing that the editor's file
// browser renders.
type ExampleItem struct {
	FileID         string `json:"fileId"`
	Title          string `json:"title"`
	Route          string `json:"route"`
	SlideCount     int    `json:"slideCount"`
	UpdatedAt      string `json:"updatedAt"`
	SourceFileName string `json:"sourceFileName,omitempty"`
}

// listExamples enumerates readable packages, newest first. Individual packages
// that fail to parse are skipped rather than failing the whole listing, so one
// corrupt import cannot make the editor's file list unusable.
func (s *Store) listExamples() ([]ExampleItem, error) {
	entries, err := os.ReadDir(s.root)
	if errors.Is(err, os.ErrNotExist) {
		return []ExampleItem{}, nil
	}
	if err != nil {
		return nil, err
	}

	items := make([]ExampleItem, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") || !packageIDPattern.MatchString(entry.Name()) {
			continue
		}
		fileID := entry.Name()
		contentPath := filepath.Join(s.packageRoot(fileID), contentFileName)
		content, err := os.ReadFile(contentPath)
		if err != nil {
			continue
		}
		slideCount, err := snapshotSlideCount(content)
		if err != nil {
			continue
		}
		info, err := os.Stat(contentPath)
		if err != nil {
			continue
		}

		meta := s.readMetadata(fileID)
		title := fileID
		if meta != nil && strings.TrimSpace(meta.Title) != "" {
			title = strings.TrimSpace(meta.Title)
		}

		updatedAt := info.ModTime().UTC().Format(time.RFC3339Nano)
		var state revisionState
		if found, err := readJSONIfExists(filepath.Join(s.packageRoot(fileID), revisionFileName), &state); err == nil && found && state.UpdatedAt != "" {
			updatedAt = state.UpdatedAt
		} else if meta != nil && meta.ImportedAt != "" {
			updatedAt = meta.ImportedAt
		}

		item := ExampleItem{
			FileID:     fileID,
			Title:      title,
			Route:      "/p/" + fileID,
			SlideCount: slideCount,
			UpdatedAt:  updatedAt,
		}
		if meta != nil {
			item.SourceFileName = meta.SourceFileName
		}
		items = append(items, item)
	}

	sort.SliceStable(items, func(left, right int) bool {
		leftTime, leftErr := time.Parse(time.RFC3339Nano, items[left].UpdatedAt)
		rightTime, rightErr := time.Parse(time.RFC3339Nano, items[right].UpdatedAt)
		if leftErr != nil || rightErr != nil {
			return false
		}
		return leftTime.After(rightTime)
	})
	return items, nil
}

// deletePackage removes a package directory. The dev server refuses to delete
// its three registered demo packages; a packaged app has none, so every package
// is removable.
func (s *Store) deletePackage(fileID string) error {
	if !validFileID(fileID) {
		return fmt.Errorf("invalid file id")
	}
	return os.RemoveAll(s.packageRoot(fileID))
}

// copyInto duplicates the readable part of a package (content plus referenced
// media/embeddings) into a staging directory for export, matching
// copyMopExportSnapshot. Passing overrideContent exports the editor's in-memory
// snapshot instead of what is on disk; includedResources then limits the copied
// assets to those the snapshot actually references.
func (s *Store) copyInto(fileID, exportRoot string, includedResources map[string]bool, overrideContent []byte) ([]byte, error) {
	packageRoot := s.packageRoot(fileID)
	content, err := readFileIfExists(filepath.Join(packageRoot, contentFileName))
	if err != nil {
		return nil, err
	}
	if content == nil {
		return nil, &apiError{status: 404, code: "MOP_CONTENT_NOT_FOUND", message: "MOP package must contain exactly one content file"}
	}

	if err := os.MkdirAll(exportRoot, 0o755); err != nil {
		return nil, err
	}
	exportContent := content
	if overrideContent != nil {
		exportContent = overrideContent
	}
	// The converter rejects empty chartStyle nodes, which the editor can leave
	// behind after a chart edit. Strip them on the way out rather than failing
	// the export.
	exportContent = normalizeExportContent(exportContent)
	if err := writeFileAtomically(filepath.Join(exportRoot, contentFileName), exportContent); err != nil {
		return nil, err
	}

	for _, directoryName := range []string{"media", "embeddings"} {
		sourceDirectory := filepath.Join(packageRoot, directoryName)
		entries, err := os.ReadDir(sourceDirectory)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, err
		}
		for _, entry := range entries {
			if !entry.Type().IsRegular() || !assetNamePattern.MatchString(entry.Name()) {
				continue
			}
			relativePath := directoryName + "/" + entry.Name()
			if includedResources != nil && !includedResources[relativePath] {
				continue
			}
			data, err := os.ReadFile(filepath.Join(sourceDirectory, entry.Name()))
			if err != nil {
				return nil, err
			}
			if err := writeFileAtomically(filepath.Join(exportRoot, directoryName, entry.Name()), data); err != nil {
				return nil, err
			}
		}
	}
	return content, nil
}

var assetNamePattern = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

// drainAndClose is used where a body must be consumed before the connection is
// reused but its contents are irrelevant.
func drainAndClose(reader io.ReadCloser) {
	_, _ = io.Copy(io.Discard, reader)
	_ = reader.Close()
}
