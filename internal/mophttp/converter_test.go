package mophttp

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func writeScript(t *testing.T, body string) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("shell script stubs are not portable to Windows")
	}
	path := filepath.Join(t.TempDir(), "mop-convert")
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"+body+"\n"), 0o755); err != nil {
		t.Fatalf("write stub: %v", err)
	}
	return path
}

func TestConverterReportsAMissingBinaryAsUnavailable(t *testing.T) {
	converter := NewCLIConverter("")
	err := converter.Export(context.Background(), t.TempDir(), filepath.Join(t.TempDir(), "out.pptx"))

	var typed *apiError
	if !errors.As(err, &typed) {
		t.Fatalf("error = %v, want an apiError", err)
	}
	// 503 rather than 500: the request is fine, the tool is simply not there,
	// and the editor shows a different message for each.
	if typed.status != 503 || typed.code != "MOP_CONVERTER_CLI_UNAVAILABLE" {
		t.Errorf("error = %d/%s", typed.status, typed.code)
	}
}

func TestConverterClassifiesAConversionGap(t *testing.T) {
	// A conversion gap means the file is valid but uses a feature the
	// converter cannot represent yet; the editor surfaces that to the user
	// differently from a crash, so it must not collapse into a generic failure.
	binary := writeScript(t, `echo "structured gap(s) detected: SmartArt" >&2; exit 1`)
	converter := NewCLIConverter(binary)

	err := converter.Export(context.Background(), t.TempDir(), filepath.Join(t.TempDir(), "out.pptx"))
	var typed *apiError
	if !errors.As(err, &typed) {
		t.Fatalf("error = %v, want an apiError", err)
	}
	if typed.status != 422 || typed.code != "PPTX_CONVERSION_GAP" {
		t.Errorf("error = %d/%s, want 422/PPTX_CONVERSION_GAP", typed.status, typed.code)
	}
	if typed.detail == "" {
		t.Error("conversion gap dropped the converter's own explanation")
	}
}

func TestConverterClassifiesAPlainFailure(t *testing.T) {
	binary := writeScript(t, `echo "boom" >&2; exit 2`)
	converter := NewCLIConverter(binary)

	err := converter.Export(context.Background(), t.TempDir(), filepath.Join(t.TempDir(), "out.pptx"))
	var typed *apiError
	if !errors.As(err, &typed) {
		t.Fatalf("error = %v, want an apiError", err)
	}
	if typed.code != "PPTX_GENERATION_FAILED" {
		t.Errorf("code = %s, want PPTX_GENERATION_FAILED", typed.code)
	}
}

func TestImportFailureUsesTheImportErrorCode(t *testing.T) {
	binary := writeScript(t, `exit 1`)
	converter := NewCLIConverter(binary)

	err := converter.Import(context.Background(), "in.pptx", t.TempDir())
	var typed *apiError
	if !errors.As(err, &typed) {
		t.Fatalf("error = %v, want an apiError", err)
	}
	if typed.code != "PPTX_CONVERSION_FAILED" {
		t.Errorf("code = %s, want PPTX_CONVERSION_FAILED", typed.code)
	}
}

func TestImportNormalizesLegacyTimingAttributes(t *testing.T) {
	packageDirectory := t.TempDir()
	legacy := map[string]any{
		"magic":   "mop0",
		"version": 1,
		"blocks": []any{map[string]any{
			"type": "slides",
			"data": []any{map[string]any{
				"type":  "timingBuild",
				"attrs": map[string]any{"autoAdvance": "2000"},
			}},
		}},
	}
	encoded, err := json.Marshal(legacy)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	binary := writeScript(t, "exit 0")
	if err := os.WriteFile(filepath.Join(packageDirectory, contentFileName), encoded, 0o644); err != nil {
		t.Fatalf("seed content: %v", err)
	}

	converter := NewCLIConverter(binary)
	if err := converter.Import(context.Background(), "in.pptx", packageDirectory); err != nil {
		t.Fatalf("import: %v", err)
	}

	rewritten, err := os.ReadFile(filepath.Join(packageDirectory, contentFileName))
	if err != nil {
		t.Fatalf("read content: %v", err)
	}
	var snapshot map[string]any
	if err := json.Unmarshal(rewritten, &snapshot); err != nil {
		t.Fatalf("decode: %v", err)
	}
	blocks, _ := snapshot["blocks"].([]any)
	slides, _ := blocks[0].(map[string]any)
	data, _ := slides["data"].([]any)
	node, _ := data[0].(map[string]any)
	attrs, _ := node["attrs"].(map[string]any)
	if _, present := attrs["autoAdvance"]; present {
		t.Error("legacy autoAdvance survived normalization")
	}
	if attrs["paragraphAutoAdvance"] != "2000" {
		t.Errorf("paragraphAutoAdvance = %v, want \"2000\"", attrs["paragraphAutoAdvance"])
	}
}

func TestImportRejectsConflictingTimingAttributes(t *testing.T) {
	packageDirectory := t.TempDir()
	conflicting := `{"magic":"mop0","version":1,"blocks":[{"type":"slides","data":[
		{"type":"timingBuild","attrs":{"autoAdvance":"2000","paragraphAutoAdvance":"5000"}}]}]}`
	if err := os.WriteFile(filepath.Join(packageDirectory, contentFileName), []byte(conflicting), 0o644); err != nil {
		t.Fatalf("seed content: %v", err)
	}
	converter := NewCLIConverter(writeScript(t, "exit 0"))

	if err := converter.Import(context.Background(), "in.pptx", packageDirectory); err == nil {
		t.Fatal("conflicting timing attributes were silently reconciled")
	}
}
