//go:build !windows

package atomicfile

import (
	"errors"
	"os"
	"syscall"
)

// SyncDir flushes a directory's entries after a rename into it, so the rename
// survives a crash. Some filesystems cannot fsync a directory handle at all;
// the rename itself already happened, so that is reported as success rather
// than as a failed write.
func SyncDir(dir string) error {
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

func isDirSyncUnsupported(err error) bool {
	return errors.Is(err, syscall.EINVAL) || errors.Is(err, syscall.ENOTSUP) || errors.Is(err, syscall.EBADF)
}
