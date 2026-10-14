//go:build !windows

package atomicfile

import (
	"errors"
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

func TestSyncDirOpensTheDirectoryAndToleratesOnlyUnsupported(t *testing.T) {
	if err := SyncDir(filepath.Join(t.TempDir(), "missing")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("SyncDir on a missing directory = %v, want not-exist: it must really open the directory", err)
	}
	for _, unsupported := range []error{syscall.EINVAL, syscall.ENOTSUP, syscall.EBADF} {
		if !isDirSyncUnsupported(unsupported) {
			t.Fatalf("%v should read as 'cannot fsync a directory here'", unsupported)
		}
	}
	if isDirSyncUnsupported(errors.New("forced directory sync failure")) || isDirSyncUnsupported(syscall.EIO) {
		t.Fatal("a failed sync must stay an error")
	}
}
