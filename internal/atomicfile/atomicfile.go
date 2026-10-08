// Package atomicfile writes files via a same-directory temp file + rename so
// readers never observe a partially written target.
package atomicfile

import (
	"errors"
	"os"
	"path/filepath"
	"syscall"
)

// Some filesystems (and Windows directory handles) do not support fsync on a
// directory; the rename itself already happened, so treat that as success.
func isDirSyncUnsupported(err error) bool {
	return errors.Is(err, syscall.EINVAL) || errors.Is(err, syscall.ENOTSUP) || errors.Is(err, syscall.EBADF)
}

// WriteFile writes data to path atomically: the bytes are staged in a hidden
// temp file beside path, fsync'd, chmod'd to perm, then renamed over path.
// On any failure the temp file is removed and path is left untouched.
func WriteFile(path string, data []byte, perm os.FileMode) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".tmp-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	committed := false
	defer func() {
		if !committed {
			_ = os.Remove(tmpPath)
		}
	}()
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Chmod(perm); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return err
	}
	committed = true
	// The rename is durable only once the directory entry is flushed; without
	// this a crash right after the rename can bring back the old file.
	return syncDir(filepath.Dir(path))
}

func syncDir(dir string) error {
	handle, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer handle.Close()
	if err := handle.Sync(); err != nil && !isDirSyncUnsupported(err) {
		return err
	}
	return nil
}
