package pptxeditor

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveMopConvertBinaryFromPresentationSource(t *testing.T) {
	root := t.TempDir()
	binary := filepath.Join(root, "tools", "bin", executableName("mop-convert"))
	if err := os.MkdirAll(filepath.Dir(binary), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(binary, []byte("test"), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("OFFICEDEX_MOP_CONVERT_BIN", "")
	t.Setenv("MOP_CONVERT_BIN", "")
	t.Setenv("PRESENTATION_SOURCE_DIR", root)
	if got := resolveMopConvertBinary(""); got != binary {
		t.Fatalf("resolveMopConvertBinary = %q, want %q", got, binary)
	}
}
