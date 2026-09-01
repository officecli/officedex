package xlsxeditor

import (
	"context"
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"

	"officedex/internal/office2modoc"
	"officedex/internal/preview"
)

func TestIntegrationEditRealXlsxCopy(t *testing.T) {
	dylibPath := os.Getenv("OFFICE2MODOC_FFI_PATH")
	inputPath := os.Getenv("OFFICE2MODOC_TEST_XLSX")
	if dylibPath == "" || inputPath == "" {
		t.Skip("OFFICE2MODOC_FFI_PATH and OFFICE2MODOC_TEST_XLSX are required")
	}
	if _, err := os.Stat(dylibPath); err != nil {
		t.Skipf("configured dylib is unavailable: %v", err)
	}
	if _, err := os.Stat(inputPath); err != nil {
		t.Skipf("configured XLSX fixture is unavailable: %v", err)
	}

	workspace := t.TempDir()
	inputContent, err := os.ReadFile(inputPath)
	if err != nil {
		t.Fatalf("read XLSX fixture: %v", err)
	}
	workingPath := filepath.Join(workspace, "workbook.xlsx")
	if err := os.WriteFile(workingPath, inputContent, 0o600); err != nil {
		t.Fatalf("copy XLSX fixture: %v", err)
	}

	converter := office2modoc.New(t.TempDir())
	service := NewService(&fakePreviewResolver{entries: map[string]preview.ArtifactEntry{
		"token": {FilePath: workingPath, DocumentType: "xlsx"},
	}}, converter, t.TempDir())
	t.Cleanup(func() {
		if err := service.CloseAll(); err != nil {
			t.Errorf("close XLSX editor service: %v", err)
		}
	})

	result, err := service.Prepare(context.Background(), "token")
	if err != nil {
		t.Fatalf("prepare real XLSX: %v", err)
	}
	if result.SessionID == "" || result.ModocContent == "" {
		t.Fatalf("Prepare() = %+v, want non-empty session and MODoc content", result)
	}
	if _, err := service.Save(context.Background(), "token", result.SessionID, result.ModocContent, nil); err != nil {
		t.Fatalf("save real XLSX copy: %v", err)
	}
}

func TestIntegrationStagedImagesRemainReopenable(t *testing.T) {
	dylibPath := os.Getenv("OFFICE2MODOC_FFI_PATH")
	inputPath := os.Getenv("OFFICE2MODOC_TEST_XLSX")
	if dylibPath == "" || inputPath == "" {
		t.Skip("OFFICE2MODOC_FFI_PATH and OFFICE2MODOC_TEST_XLSX are required")
	}
	if _, err := os.Stat(dylibPath); err != nil {
		t.Skipf("configured dylib is unavailable: %v", err)
	}
	inputContent, err := os.ReadFile(inputPath)
	if err != nil {
		t.Fatalf("read XLSX fixture: %v", err)
	}
	workspace := t.TempDir()
	workingPath := filepath.Join(workspace, "workbook.xlsx")
	if err := os.WriteFile(workingPath, inputContent, 0o600); err != nil {
		t.Fatalf("copy XLSX fixture: %v", err)
	}

	converter := office2modoc.New(t.TempDir())
	service := NewService(&fakePreviewResolver{entries: map[string]preview.ArtifactEntry{
		"token": {FilePath: workingPath, DocumentType: "xlsx"},
	}}, converter, t.TempDir())
	t.Cleanup(func() {
		if err := service.CloseAll(); err != nil {
			t.Errorf("close XLSX editor service: %v", err)
		}
	})

	prepared, err := service.Prepare(context.Background(), "token")
	if err != nil {
		t.Fatalf("prepare real XLSX: %v", err)
	}
	png, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
	if err != nil {
		t.Fatal(err)
	}
	for _, column := range []int{6, 7, 8} {
		if _, err := service.StageImage("token", prepared.SessionID, png, "image/png", "Catalog Test", 4, column, 9); err != nil {
			t.Fatalf("stage image in column %d: %v", column, err)
		}
	}
	if _, err := service.Save(context.Background(), "token", prepared.SessionID, prepared.ModocContent, nil); err != nil {
		t.Fatalf("save staged images: %v", err)
	}
	if _, err := service.Prepare(context.Background(), "token"); err != nil {
		t.Fatalf("reopen saved XLSX: %v", err)
	}
}
