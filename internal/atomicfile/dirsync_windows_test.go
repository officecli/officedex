//go:build windows

package atomicfile

import (
	"path/filepath"
	"testing"
)

// On Windows SyncDir must not even open the directory: a missing one is fine.
func TestSyncDirIsANoOpOnWindows(t *testing.T) {
	if err := SyncDir(filepath.Join(t.TempDir(), "missing")); err != nil {
		t.Fatalf("SyncDir must not touch the directory on Windows: %v", err)
	}
}
