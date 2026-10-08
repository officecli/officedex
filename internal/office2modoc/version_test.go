package office2modoc

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// office2modoc.version at the repository root pins the release for the
// scripts and the release workflow; the Go constant must say the same thing.
func TestVersionMatchesRepositoryPin(t *testing.T) {
	pinned, err := os.ReadFile(filepath.Join("..", "..", "office2modoc.version"))
	if err != nil {
		t.Fatalf("read office2modoc.version: %v", err)
	}
	if got := strings.TrimSpace(string(pinned)); got != Version {
		t.Fatalf("office2modoc.version pins %q but the Go side expects %q", got, Version)
	}
}
