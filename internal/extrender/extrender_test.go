package extrender

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestNew(t *testing.T) {
	r := New("/nonexistent/binary")
	if r == nil {
		t.Fatal("New returned nil")
	}
	if r.binaryPath != "/nonexistent/binary" {
		t.Fatalf("binaryPath = %q, want %q", r.binaryPath, "/nonexistent/binary")
	}
}

func TestAvailable_Nil(t *testing.T) {
	var r *Renderer
	if r.Available() {
		t.Error("nil Renderer should not be available")
	}
}

func TestAvailable_EmptyPath(t *testing.T) {
	r := New("")
	if r.Available() {
		t.Error("empty path should not be available")
	}
}

func TestAvailable_MissingBinary(t *testing.T) {
	r := New("/nonexistent/binary")
	if r.Available() {
		t.Error("nonexistent binary should not be available")
	}
}

func TestAvailable_ExistingFile(t *testing.T) {
	tmp := filepath.Join(t.TempDir(), "bin")
	if err := os.WriteFile(tmp, []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}
	r := New(tmp)
	if !r.Available() {
		t.Error("existing file should be available")
	}
}

func TestRenderHTML_NotAvailable(t *testing.T) {
	r := New("/nonexistent/binary")
	_, err := r.RenderHTML(context.Background(), "/tmp/test.pptx")
	if err == nil {
		t.Fatal("expected error for unavailable binary")
	}
}
