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
	// ExportParam_t (native_darwin.go) has three trailing pointers -- to_type,
	// sheet_id, lang -- after the padded file_type byte: 7*8 + 8 + 3*8.
	if got := unsafe.Sizeof(windowsExportParams{}); got != 88 {
		t.Fatalf("export ABI struct size = %d, want 88", got)
	}
}

// Kept as a compile-time/runtime smoke check on Windows; the actual FFI is
// exercised by the CI integration job with OFFICE2MODOC_FFI_PATH.
