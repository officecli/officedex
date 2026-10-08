//go:build windows && amd64

package office2modoc

import (
	"testing"
	"unsafe"
)

func TestWindowsNativeABIFields(t *testing.T) {
	if got := unsafe.Sizeof(windowsImportParams{}); got != 80 {
		t.Fatalf("import ABI struct size = %d, want 80", got)
	}
	if got := unsafe.Sizeof(windowsExportParams{}); got != 80 {
		t.Fatalf("export ABI struct size = %d, want 80", got)
	}
}

// Kept as a compile-time/runtime smoke check on Windows; the actual FFI is
// exercised by the CI integration job with OFFICE2MODOC_FFI_PATH.
