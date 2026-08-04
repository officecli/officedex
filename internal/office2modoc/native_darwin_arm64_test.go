//go:build darwin && arm64 && cgo

package office2modoc

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestOpenNativeRejectsMissingFile(t *testing.T) {
	_, err := openNative(filepath.Join(t.TempDir(), "missing.dylib"))
	if err == nil || !strings.Contains(err.Error(), "does not exist") {
		t.Fatalf("openNative missing file error = %v, want does not exist", err)
	}
}

func TestOpenNativeRejectsDirectory(t *testing.T) {
	_, err := openNative(t.TempDir())
	if err == nil || !strings.Contains(err.Error(), "not a regular file") {
		t.Fatalf("openNative directory error = %v, want not a regular file", err)
	}
}

func TestOpenNativeRejectsLibraryMissingRequiredSymbol(t *testing.T) {
	path := buildTestDylib(t, `
#include <stdint.h>
typedef struct { const char *request_id; } ImportParam_t;
uint8_t shimo_import(const ImportParam_t *param) { return param == 0 ? 1 : 0; }
`)

	_, err := openNative(path)
	if err == nil || !strings.Contains(err.Error(), "shimo_export") {
		t.Fatalf("openNative missing symbol error = %v, want shimo_export", err)
	}
}

func TestNativeCallsDynamicLibraryWithExpectedParams(t *testing.T) {
	path := buildTestDylib(t, `
#include <stdint.h>
#include <string.h>
typedef struct {
  const char *request_id;
  const char *input_office_file_path;
  const char *shimo_file_path;
  const char *temp_path;
  const char *token;
  const char *config_path;
  const char *password;
  uint8_t file_type;
  const char *limit;
  const char *lang;
} ImportParam_t;
typedef struct {
  const char *request_id;
  const char *output_office_file_path;
  const char *shimo_file_path;
  const char *temp_path;
  const char *token;
  const char *config_path;
  const char *password;
  uint8_t file_type;
  const char *to_type;
  const char *sheet_id;
  const char *lang;
} ExportParam_t;
uint8_t shimo_import(const ImportParam_t *p) {
  return p != 0 && p->file_type == 1 && strcmp(p->request_id, "import-request") == 0 &&
    strcmp(p->input_office_file_path, "/input.xlsx") == 0 && strcmp(p->shimo_file_path, "/input.modoc") == 0 &&
    strcmp(p->temp_path, "/tmp") == 0 && strcmp(p->password, "password") == 0 &&
	    strcmp(p->limit, "{\"slideSize\":10000,\"wordCharCount\":100000000,\"excelSingleSheetCell\":2000000,\"excelAllSheetCell\":5000000}") == 0 &&
    strcmp(p->lang, "en-US") == 0 ? 41 : 201;
}
uint8_t shimo_export(const ExportParam_t *p) {
  return p != 0 && p->file_type == 1 && strcmp(p->request_id, "export-request") == 0 &&
    strcmp(p->output_office_file_path, "/output.xlsx") == 0 && strcmp(p->shimo_file_path, "/input.modoc") == 0 &&
    strcmp(p->temp_path, "/tmp") == 0 && strcmp(p->password, "password") == 0 &&
    strcmp(p->to_type, "xlsx") == 0 && strcmp(p->sheet_id, "") == 0 && strcmp(p->lang, "en-US") == 0 ? 42 : 202;
}
`)

	native, err := openNative(path)
	if err != nil {
		t.Fatalf("openNative: %v", err)
	}
	t.Cleanup(func() {
		if err := native.Close(); err != nil {
			t.Fatalf("close: %v", err)
		}
		if err := native.Close(); err != nil {
			t.Fatalf("second close: %v", err)
		}
	})

	importStatus, err := native.Import(ImportParams{
		RequestID:       "import-request",
		InputOfficePath: "/input.xlsx",
		ShimoPath:       "/input.modoc",
		TempPath:        "/tmp",
		Password:        "password",
		Lang:            "en-US",
	})
	if err != nil || importStatus != 41 {
		t.Fatalf("import = (%d, %v), want (41, nil)", importStatus, err)
	}

	exportStatus, err := native.Export(ExportParams{
		RequestID:        "export-request",
		OutputOfficePath: "/output.xlsx",
		ShimoPath:        "/input.modoc",
		TempPath:         "/tmp",
		Password:         "password",
		Lang:             "en-US",
	})
	if err != nil || exportStatus != 42 {
		t.Fatalf("export = (%d, %v), want (42, nil)", exportStatus, err)
	}
}

func TestOpenNativeLoadsConfiguredRealLibrary(t *testing.T) {
	path := os.Getenv("OFFICE2MODOC_FFI_PATH")
	if path == "" {
		t.Skip("OFFICE2MODOC_FFI_PATH is not configured")
	}

	native, err := openNative(path)
	if err != nil {
		t.Fatalf("openNative real library: %v", err)
	}
	if err := native.Close(); err != nil {
		t.Fatalf("close real library: %v", err)
	}
}

func TestNativeImportCallsConfiguredRealLibrary(t *testing.T) {
	path := os.Getenv("OFFICE2MODOC_FFI_PATH")
	if path == "" {
		t.Skip("OFFICE2MODOC_FFI_PATH is not configured")
	}

	native, err := openNative(path)
	if err != nil {
		t.Fatalf("openNative real library: %v", err)
	}
	t.Cleanup(func() {
		if err := native.Close(); err != nil {
			t.Fatalf("close real library: %v", err)
		}
	})

	dir := t.TempDir()
	status, err := native.Import(ImportParams{
		RequestID:       "office2modoc-ffi-abi-test",
		InputOfficePath: filepath.Join(dir, "missing-input.xlsx"),
		ShimoPath:       filepath.Join(dir, "result.modoc"),
		TempPath:        dir,
		Lang:            "zh-CN",
	})
	if err != nil {
		t.Fatalf("real library import call: %v", err)
	}
	if status == 0 {
		t.Fatal("real library import unexpectedly succeeded for a missing input file")
	}
}

func TestNewUsesNativeLoader(t *testing.T) {
	converter := New(t.TempDir())
	if converter == nil || converter.factory == nil {
		t.Fatal("New must configure the native loader")
	}
}

func buildTestDylib(t *testing.T, source string) string {
	t.Helper()
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "library.c")
	if err := os.WriteFile(sourcePath, []byte(source), 0o600); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "library.dylib")
	command := exec.Command("cc", "-dynamiclib", "-o", path, sourcePath)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("compile test dylib: %v\n%s", err, output)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestNativeCloseReturnsNoErrorAfterAlreadyClosed(t *testing.T) {
	path := buildTestDylib(t, `
#include <stdint.h>
typedef struct { const char *request_id; } ImportParam_t;
typedef struct { const char *request_id; } ExportParam_t;
uint8_t shimo_import(const ImportParam_t *param) { return param == 0 ? 1 : 0; }
uint8_t shimo_export(const ExportParam_t *param) { return param == 0 ? 1 : 0; }
`)
	native, err := openNative(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := native.Close(); err != nil {
		t.Fatal(err)
	}
	if err := native.Close(); err != nil {
		t.Fatal(err)
	}
	_, err = native.Import(ImportParams{})
	if !errors.Is(err, ErrClosed) {
		t.Fatalf("import after close error = %v, want ErrClosed", err)
	}
}
