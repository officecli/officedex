package main

import (
	"errors"
	"os"
	"path/filepath"
	"sync"
)

// The digest of every source file this app has read out to an editor or written
// back for one, keyed by absolute path.
//
// It exists so a save can tell "the file is as we left it" from "something else
// rewrote it". Both editor services carry their own fingerprint for this, and
// SaveDocx asks the renderer for the digest it loaded; the deck path that the
// presentation workbench saves through had neither, so a deck edited in
// PowerPoint while OfficeDex held it open was overwritten without a word.
//
// Keeping the baseline here rather than in the renderer means it also covers
// callers that never loaded the file through a preview token.
type sourceDigests struct {
	mu     sync.Mutex
	byPath map[string]string
}

func newSourceDigests() *sourceDigests {
	return &sourceDigests{byPath: make(map[string]string)}
}

// remember records what a path holds right now, as far as this app is
// concerned: the bytes it just handed an editor, or the bytes it just wrote.
func (d *sourceDigests) remember(path, digest string) {
	if d == nil || path == "" || digest == "" {
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	d.byPath[canonicalPath(path)] = digest
}

// forget drops a path's baseline, so the next save adopts whatever is there.
func (d *sourceDigests) forget(path string) {
	if d == nil || path == "" {
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	delete(d.byPath, canonicalPath(path))
}

// SourceChangedMarker is the stable part of the conflict message. Wails hands
// the renderer an error's text and nothing else, so this substring is what the
// editor matches on to tell a conflict apart from any other save failure and
// offer the right way out. TestSourceChangedErrorKeepsItsMarker pins it, and
// the renderer's copy of the literal points back here.
const SourceChangedMarker = "changed outside OfficeDex"

var errSourceChangedExternally = errors.New("source file " + SourceChangedMarker + "; reopen it before saving")

// assertUnchanged reports whether a path still holds what this app last saw.
//
// A path with no baseline is not a conflict: this is a guard against silent
// overwrites, not an access check, and refusing to write a file we never read
// would break every first save. A path that has since been deleted is not a
// conflict either -- recreating it is what the user asked for.
func (d *sourceDigests) assertUnchanged(path string) error {
	if d == nil || path == "" {
		return nil
	}
	d.mu.Lock()
	baseline, known := d.byPath[canonicalPath(path)]
	d.mu.Unlock()
	if !known {
		return nil
	}
	current, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if sha256Hex(current) == baseline {
		return nil
	}
	return errSourceChangedExternally
}

// canonicalPath is the map key: one file must not have two baselines because
// two callers spelled its path differently. The preview registry resolves
// symlinks before recording a path and the save side only makes it absolute,
// which on macOS is the difference between /var/... and /private/var/... --
// enough to make the guard silently never fire.
func canonicalPath(path string) string {
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		return resolved
	}
	if absolute, err := filepath.Abs(path); err == nil {
		return filepath.Clean(absolute)
	}
	return filepath.Clean(path)
}
