package atomicfile

import (
	"errors"
	"syscall"
	"testing"
)

func TestIsDirSyncUnsupportedDistinguishesCannotFromFailed(t *testing.T) {
	if !IsDirSyncUnsupported(syscall.EINVAL) {
		t.Fatal("EINVAL from a directory Sync means the filesystem cannot fsync directories")
	}
	if IsDirSyncUnsupported(errors.New("forced directory sync failure")) {
		t.Fatal("an arbitrary error is a failed sync, not an unsupported one")
	}
	if IsDirSyncUnsupported(nil) {
		t.Fatal("nil is not an error")
	}
}
