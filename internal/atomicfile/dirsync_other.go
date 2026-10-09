//go:build !windows

package atomicfile

import (
	"errors"
	"syscall"
)

// Some filesystems do not support fsync on a directory handle.
func isDirSyncUnsupported(err error) bool {
	return errors.Is(err, syscall.EINVAL) || errors.Is(err, syscall.ENOTSUP) || errors.Is(err, syscall.EBADF)
}
