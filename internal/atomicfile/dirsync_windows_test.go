//go:build windows

package atomicfile

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

// The failure that broke the first Windows run: Sync on a directory handle
// returns ERROR_ACCESS_DENIED, which must read as "unsupported here".
func TestIsDirSyncUnsupportedOnWindowsDirectoryHandles(t *testing.T) {
	if !IsDirSyncUnsupported(syscall.ERROR_ACCESS_DENIED) {
		t.Fatal("ERROR_ACCESS_DENIED from a directory Sync is the Windows way of saying unsupported")
	}
	dir := t.TempDir()
	if err := WriteFile(filepath.Join(dir, "identity.json"), []byte("{}"), 0o600); err != nil {
		t.Fatalf("atomic write on Windows: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "identity.json")); err != nil {
		t.Fatal(err)
	}
}
