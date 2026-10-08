// Package workspace holds the path rules for where OfficeDex reads and writes
// documents: what counts as a valid workspace directory, which directories
// the preview server may serve from, and how a generation task's output
// folder is named.
package workspace

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"

	"officedex/internal/types"
)

const (
	slugMaxLen   = 40
	taskIDLen    = 8
	taskDirStamp = "20060102-150405"
)

// CleanDir validates a workspace path without touching the filesystem: it
// must be absolute and free of NUL bytes.
func CleanDir(dir string) (string, error) {
	return cleanAbsolute(dir, "workspace dir")
}

// CleanOutputDir is CleanDir for a caller-supplied generation output dir.
func CleanOutputDir(dir string) (string, error) {
	return cleanAbsolute(dir, "generate output dir")
}

func cleanAbsolute(dir, label string) (string, error) {
	cleaned := strings.TrimSpace(dir)
	if strings.ContainsRune(cleaned, 0) {
		return "", errors.New(label + " is invalid")
	}
	if !filepath.IsAbs(cleaned) {
		return "", errors.New(label + " must be absolute")
	}
	return cleaned, nil
}

// CleanExistingDir is CleanDir plus the requirement that the path exists and
// is a directory.
func CleanExistingDir(dir string) (string, error) {
	cleaned, err := CleanDir(dir)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(cleaned)
	if err != nil {
		return "", fmt.Errorf("workspace dir is unavailable: %w", err)
	}
	if !info.IsDir() {
		return "", errors.New("workspace dir must be a directory")
	}
	return cleaned, nil
}

// SamePath reports whether two non-empty paths clean to the same string.
func SamePath(a, b string) bool {
	if strings.TrimSpace(a) == "" || strings.TrimSpace(b) == "" {
		return false
	}
	return filepath.Clean(a) == filepath.Clean(b)
}

// settingsDir is the workspace the user configured: WorkspaceDir, or the
// older OutputDir setting when WorkspaceDir is unset.
func settingsDir(s types.UserSettings) (raw string, set bool) {
	if s.WorkspaceDir != nil && strings.TrimSpace(*s.WorkspaceDir) != "" {
		return *s.WorkspaceDir, true
	}
	if s.OutputDir != nil && strings.TrimSpace(*s.OutputDir) != "" {
		return *s.OutputDir, true
	}
	return "", false
}

// SettingsDir returns the configured workspace when it is set and valid.
func SettingsDir(s types.UserSettings) (string, bool) {
	raw, set := settingsDir(s)
	if !set {
		return "", false
	}
	cleaned, err := CleanDir(raw)
	return cleaned, err == nil
}

// HasInvalidSettingsDir reports a configured workspace that fails CleanDir;
// callers keep the previous trusted roots rather than trusting a bad path.
func HasInvalidSettingsDir(s types.UserSettings) bool {
	raw, set := settingsDir(s)
	if !set {
		return false
	}
	_, err := CleanDir(raw)
	return err != nil
}

// TrustedRoots is the baseline set of directories the preview server may
// serve: the default workspace plus the configured one when valid.
func TrustedRoots(defaultDir string, s types.UserSettings) []string {
	roots := []string{defaultDir}
	if custom, ok := SettingsDir(s); ok {
		return append(roots, custom)
	}
	return roots
}

// TaskDirName returns a unique, filesystem-safe folder name for a single
// generation task: `<yyyymmdd-HHMMSS>-<slug>-<shortid>`, so directories sort
// chronologically and remain readable when browsed.
func TaskDirName(topic, docType string) string {
	return taskDirName(topic, docType, time.Now(), uuid.NewString())
}

func taskDirName(topic, docType string, now time.Time, id string) string {
	slug := Slugify(topic)
	if slug == "" {
		slug = Slugify(docType)
	}
	if slug == "" {
		slug = "task"
	}
	short := strings.ReplaceAll(id, "-", "")
	if len(short) > taskIDLen {
		short = short[:taskIDLen]
	}
	return fmt.Sprintf("%s-%s-%s", now.Format(taskDirStamp), slug, short)
}

// Slugify maps an arbitrary topic/document-type label to an ASCII, lowercase,
// hyphen-separated slug capped at 40 characters. Non-ASCII characters (CJK
// for instance) are dropped; the caller supplies the fallback for an empty
// result.
func Slugify(input string) string {
	var b strings.Builder
	b.Grow(len(input))
	lastDash := true
	for _, r := range strings.ToLower(strings.TrimSpace(input)) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			lastDash = false
		default:
			if !lastDash {
				b.WriteByte('-')
				lastDash = true
			}
		}
		if b.Len() >= slugMaxLen {
			break
		}
	}
	return strings.Trim(b.String(), "-")
}
