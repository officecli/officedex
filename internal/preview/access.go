// Package preview is the Go port of src/main/previewAccess.ts.
//
// Style conventions inherited from internal/settings:
//
//   - Errors use fmt.Errorf with the "preview: <action>: %w" prefix when
//     wrapping; pure-message errors use errors.New with the same prefix.
//   - Concurrency-sensitive state lives behind a single sync.Mutex on Registry.
//   - Canonical paths are produced by canonicalPath: absolute + EvalSymlinks,
//     falling back to filepath.Clean if symlink resolution fails (mirroring
//     fs.realpathSync.native + catch in the TS source).
//   - Public error messages mirror the TS strings so renderer-side checks
//     keep working without translation.
package preview

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"

	"github.com/google/uuid"

	"officedex/internal/types"
)

// supportedPreviewExtensions mirrors SUPPORTED_PREVIEW_EXTENSIONS from the TS
// source. Keys are stored lowercase without the leading dot.
var supportedPreviewExtensions = map[string]struct{}{
	"docx": {},
	"xlsx": {},
	"pptx": {},
	"pdf":  {},
	"html": {},
	"htm":  {},
	"png":  {},
	"jpg":  {},
	"jpeg": {},
	"gif":  {},
	"webp": {},
	"svg":  {},
	"bmp":  {},
}

// ArtifactEntry is the canonical, trusted-root-validated form of an Artifact
// that the registry hands back to preview handlers.
type ArtifactEntry struct {
	FilePath     string
	FileName     string
	DocumentType string
}

// RegistryOptions configures a new Registry. TrustedRoots must contain at
// least one entry. CreateToken is optional; when nil, UUIDv4 is used.
type RegistryOptions struct {
	TrustedRoots []string
	CreateToken  func() string
}

// Registry tracks which artifact paths are allowed for local preview and
// mints opaque tokens that map back to them. Safe for concurrent use.
type Registry struct {
	mu               sync.Mutex
	allowedArtifacts map[string]ArtifactEntry
	tokens           map[string]ArtifactEntry
	trustedRoots     []string
	createToken      func() string
}

// New constructs a Registry. Returns an error if no trusted roots are given.
func New(opts RegistryOptions) (*Registry, error) {
	roots, err := canonicalTrustedRoots(opts.TrustedRoots)
	if err != nil {
		return nil, err
	}
	create := opts.CreateToken
	if create == nil {
		create = func() string { return uuid.NewString() }
	}
	return &Registry{
		allowedArtifacts: make(map[string]ArtifactEntry),
		tokens:           make(map[string]ArtifactEntry),
		trustedRoots:     roots,
		createToken:      create,
	}, nil
}

// SetTrustedRoots atomically replaces the preview trust boundary. It validates
// every root before mutating state so a bad settings value cannot partially
// update the registry.
func (r *Registry) SetTrustedRoots(trustedRoots []string) error {
	roots, err := canonicalTrustedRoots(trustedRoots)
	if err != nil {
		return err
	}
	r.mu.Lock()
	r.trustedRoots = roots
	r.mu.Unlock()
	return nil
}

// AllowArtifact registers an artifact path so future IssueToken calls can
// hand out tokens for it. Returns an error if the path is invalid, has an
// unsupported extension, or lives outside the trusted roots.
func (r *Registry) AllowArtifact(artifact types.Artifact) error {
	entry, err := r.entryFromArtifact(artifact)
	if err != nil {
		return err
	}
	r.mu.Lock()
	r.allowedArtifacts[entry.FilePath] = entry
	r.mu.Unlock()
	return nil
}

// IssueToken returns a fresh PreviewGrant for an artifact that was previously
// registered via AllowArtifact. Returns an error if the artifact is not
// registered or fails canonicalization.
func (r *Registry) IssueToken(artifact types.Artifact) (types.PreviewGrant, error) {
	requested, err := r.entryFromArtifact(artifact)
	if err != nil {
		return types.PreviewGrant{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	allowed, ok := r.allowedArtifacts[requested.FilePath]
	if !ok {
		return types.PreviewGrant{}, errors.New("preview: artifact is not registered for local preview")
	}
	token := r.createToken()
	r.tokens[token] = allowed
	return types.PreviewGrant{
		Token:        token,
		FileName:     allowed.FileName,
		DocumentType: allowed.DocumentType,
	}, nil
}

// ResolveToken returns the registered ArtifactEntry for a token, or an error
// if the token is unknown or has been revoked.
func (r *Registry) ResolveToken(token string) (ArtifactEntry, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	entry, ok := r.tokens[token]
	if !ok {
		return ArtifactEntry{}, errors.New("preview: invalid preview token")
	}
	return entry, nil
}

// RevokeToken removes a token from the registry. No-op if the token is not
// present.
func (r *Registry) RevokeToken(token string) {
	r.mu.Lock()
	delete(r.tokens, token)
	r.mu.Unlock()
}

func (r *Registry) entryFromArtifact(artifact types.Artifact) (ArtifactEntry, error) {
	canonical, err := canonicalPath(artifact.FilePath)
	if err != nil {
		return ArtifactEntry{}, err
	}
	extension := previewExtension(canonical)
	if _, ok := supportedPreviewExtensions[extension]; !ok {
		return ArtifactEntry{}, errors.New("preview: unsupported preview file type")
	}
	if !r.withinTrustedRoots(canonical) {
		return ArtifactEntry{}, errors.New("preview: preview file is outside trusted preview roots")
	}
	return ArtifactEntry{
		FilePath:     canonical,
		FileName:     filepath.Base(canonical),
		DocumentType: extension,
	}, nil
}

func (r *Registry) withinTrustedRoots(filePath string) bool {
	r.mu.Lock()
	roots := append([]string(nil), r.trustedRoots...)
	r.mu.Unlock()
	for _, root := range roots {
		if isWithinRoot(filePath, root) {
			return true
		}
	}
	return false
}

func canonicalTrustedRoots(trustedRoots []string) ([]string, error) {
	if len(trustedRoots) == 0 {
		return nil, errors.New("preview: at least one trusted preview root is required")
	}
	roots := make([]string, 0, len(trustedRoots))
	seen := make(map[string]struct{}, len(trustedRoots))
	for _, root := range trustedRoots {
		canonical, err := canonicalPath(root)
		if err != nil {
			return nil, fmt.Errorf("preview: trusted root: %w", err)
		}
		if _, ok := seen[canonical]; ok {
			continue
		}
		seen[canonical] = struct{}{}
		roots = append(roots, canonical)
	}
	return roots, nil
}

func canonicalPath(filePath string) (string, error) {
	if filePath == "" {
		return "", errors.New("preview: invalid preview file path")
	}
	if strings.ContainsRune(filePath, 0) {
		return "", errors.New("preview: invalid preview file path")
	}
	if !filepath.IsAbs(filePath) {
		return "", errors.New("preview: preview file path must be absolute")
	}
	resolved, err := filepath.EvalSymlinks(filePath)
	if err != nil {
		return filepath.Clean(filePath), nil
	}
	return resolved, nil
}

func previewExtension(value string) string {
	ext := filepath.Ext(value)
	ext = strings.TrimPrefix(ext, ".")
	return strings.ToLower(ext)
}

func isWithinRoot(filePath, root string) bool {
	rel, err := filepath.Rel(root, filePath)
	if err != nil {
		return false
	}
	if rel == "." {
		return true
	}
	if rel == "" {
		return false
	}
	if strings.HasPrefix(rel, "..") {
		return false
	}
	if filepath.IsAbs(rel) {
		return false
	}
	return true
}
