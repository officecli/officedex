//go:build windows

package atomicfile

import (
	"errors"
	"syscall"
)

// Windows has no directory fsync. os.Open opens a directory for reading only,
// so FlushFileBuffers on it fails with ERROR_ACCESS_DENIED (and on some
// filesystems ERROR_INVALID_FUNCTION); NTFS journals the directory update
// itself. Either answer means "cannot sync a directory here", not "the sync
// failed", and the rename that preceded it stands.
func isDirSyncUnsupported(err error) bool {
	return errors.Is(err, syscall.ERROR_ACCESS_DENIED) ||
		errors.Is(err, syscall.Errno(1)) || // ERROR_INVALID_FUNCTION
		errors.Is(err, syscall.EINVAL) ||
		errors.Is(err, syscall.ENOTSUP)
}
