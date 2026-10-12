package atomicfile

import (
	"os"
	"path/filepath"
	"testing"
)

// WriteFile's rename is followed by SyncDir on every platform; on all of them
// an atomic write into a real directory must simply succeed.
func TestWriteFileSurvivesDirectorySyncOnThisPlatform(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "identity.json")
	if err := WriteFile(target, []byte("{}"), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	data, err := os.ReadFile(target)
	if err != nil || string(data) != "{}" {
		t.Fatalf("read back %q, %v", data, err)
	}
	if err := SyncDir(dir); err != nil {
		t.Fatalf("SyncDir on an existing directory: %v", err)
	}
}
