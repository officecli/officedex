package office2modoc

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestResolveLibraryPathPrefersEnvironment(t *testing.T) {
	override := filepath.Join(t.TempDir(), "liboffice2modoc_ffi.dylib")
	t.Setenv("OFFICE2MODOC_FFI_PATH", override)

	got, err := ResolveLibraryPath("/repository")
	if err != nil || got != override {
		t.Fatalf("got %q, %v", got, err)
	}
}

func TestResolveLibraryPathUsesRepositoryCache(t *testing.T) {
	t.Setenv("OFFICE2MODOC_FFI_PATH", "")
	repoRoot := t.TempDir()

	got, err := ResolveLibraryPath(repoRoot)
	want := filepath.Join(repoRoot, DefaultRelativeLibraryPath)
	if err != nil || got != want {
		t.Fatalf("got %q, %v; want %q", got, err, want)
	}
}

func TestStatusErrorMapsImportCodes(t *testing.T) {
	tests := []struct {
		status uint8
		want   error
	}{
		{10, ErrInvalidFormat},
		{11, ErrPasswordProtected},
		{30, ErrSingleSheetCellLimit},
		{31, ErrAllSheetCellLimit},
	}

	for _, tt := range tests {
		t.Run("status", func(t *testing.T) {
			if !errors.Is(StatusError("import", tt.status), tt.want) {
				t.Fatalf("status %d must map to %v", tt.status, tt.want)
			}
		})
	}
}

func TestStatusErrorMapsExportCodes(t *testing.T) {
	if !errors.Is(StatusError("export", 10), ErrInvalidFormat) {
		t.Fatal("status 10 must map to ErrInvalidFormat")
	}
	if err := StatusError("export", 99); err == nil || err.Error() != "office2modoc export failed with status 99" {
		t.Fatalf("unexpected generic error: %v", err)
	}
}

func TestGenerateOfflineTokenMatchesFFIContract(t *testing.T) {
	got, err := generateOfflineToken("asdfjhhthhthwert", 1613801446)
	if err != nil {
		t.Fatal(err)
	}
	if want := "ESvh1Doa/j8GzNA/MgRqcQ=="; got != want {
		t.Fatalf("token = %q, want %q", got, want)
	}
}

func TestConverterSerializesNativeCalls(t *testing.T) {
	inputOfficePath := makeFile(t, "input.xlsx", 0)
	shimoPath := makeFile(t, "input.modoc", 0)
	releaseImport := make(chan struct{})
	importEntered := make(chan struct{})
	exportEntered := make(chan struct{}, 1)
	native := &fakeNative{
		importFn: func(ImportParams) (uint8, error) {
			close(importEntered)
			<-releaseImport
			return 0, nil
		},
		exportFn: func(ExportParams) (uint8, error) {
			exportEntered <- struct{}{}
			return 0, nil
		},
	}
	converter := NewConverter(t.TempDir(), func(string) (Native, error) { return native, nil })

	importDone := make(chan error, 1)
	go func() {
		importDone <- converter.ImportXlsx(context.Background(), inputOfficePath, shimoPath, t.TempDir())
	}()
	<-importEntered

	exportDone := make(chan error, 1)
	go func() {
		exportDone <- converter.ExportXlsx(context.Background(), inputOfficePath, shimoPath, t.TempDir())
	}()

	select {
	case <-exportEntered:
		t.Fatal("export entered native while import was still running")
	case <-time.After(50 * time.Millisecond):
	}

	close(releaseImport)
	if err := <-importDone; err != nil {
		t.Fatalf("import: %v", err)
	}
	if err := <-exportDone; err != nil {
		t.Fatalf("export: %v", err)
	}
}

func TestConverterRejectsOversizedInput(t *testing.T) {
	inputOfficePath := makeFile(t, "input.xlsx", MaxOfficeBytes+1)
	var calls int
	converter := NewConverter(t.TempDir(), func(string) (Native, error) {
		calls++
		return &fakeNative{}, nil
	})

	err := converter.ImportXlsx(context.Background(), inputOfficePath, makeFile(t, "input.modoc", 0), t.TempDir())
	if !errors.Is(err, ErrOfficeTooLarge) {
		t.Fatalf("got %v, want ErrOfficeTooLarge", err)
	}
	if calls != 0 {
		t.Fatalf("factory called %d times", calls)
	}
}

func TestConverterPopulatesImportParams(t *testing.T) {
	inputOfficePath := makeFile(t, "input.xlsx", 0)
	shimoPath := makeFile(t, "input.modoc", 0)
	tempPath := t.TempDir()
	var got ImportParams
	converter := NewConverter(t.TempDir(), func(string) (Native, error) {
		return &fakeNative{importFn: func(params ImportParams) (uint8, error) {
			got = params
			return 0, nil
		}}, nil
	})

	if err := converter.ImportXlsx(context.Background(), inputOfficePath, shimoPath, tempPath); err != nil {
		t.Fatalf("import: %v", err)
	}
	if got.InputOfficePath != inputOfficePath || got.ShimoPath != shimoPath || got.TempPath != tempPath || got.Lang != "zh-CN" || got.RequestID == "" {
		t.Fatalf("unexpected params: %+v", got)
	}
}

func TestConverterPopulatesExportParams(t *testing.T) {
	outputOfficePath := makeFile(t, "output.xlsx", 0)
	shimoPath := makeFile(t, "input.modoc", 0)
	tempPath := t.TempDir()
	var got ExportParams
	converter := NewConverter(t.TempDir(), func(string) (Native, error) {
		return &fakeNative{exportFn: func(params ExportParams) (uint8, error) {
			got = params
			return 0, nil
		}}, nil
	})

	if err := converter.ExportXlsx(context.Background(), outputOfficePath, shimoPath, tempPath); err != nil {
		t.Fatalf("export: %v", err)
	}
	if got.OutputOfficePath != outputOfficePath || got.ShimoPath != shimoPath || got.TempPath != tempPath || got.Lang != "zh-CN" || got.RequestID == "" {
		t.Fatalf("unexpected params: %+v", got)
	}
}

func TestConverterRejectsOversizedModocInput(t *testing.T) {
	shimoPath := makeFile(t, "input.modoc", MaxModocBytes+1)
	var calls int
	converter := NewConverter(t.TempDir(), func(string) (Native, error) {
		calls++
		return &fakeNative{}, nil
	})

	err := converter.ExportXlsx(context.Background(), makeFile(t, "output.xlsx", 0), shimoPath, t.TempDir())
	if !errors.Is(err, ErrModocTooLarge) {
		t.Fatalf("got %v, want ErrModocTooLarge", err)
	}
	if calls != 0 {
		t.Fatalf("factory called %d times", calls)
	}
}

func TestConverterHonorsCanceledContextBeforeLoadingNative(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	called := false
	converter := NewConverter(t.TempDir(), func(string) (Native, error) {
		called = true
		return &fakeNative{}, nil
	})

	err := converter.ImportXlsx(ctx, makeFile(t, "input.xlsx", 0), makeFile(t, "input.modoc", 0), t.TempDir())
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("got %v, want context.Canceled", err)
	}
	if called {
		t.Fatal("factory was called after context cancellation")
	}
}

func TestConverterDoesNotImportWhenContextIsCanceledDuringNativeLoad(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	importCalls := 0
	converter := NewConverter(t.TempDir(), func(string) (Native, error) {
		cancel()
		return &fakeNative{importFn: func(ImportParams) (uint8, error) {
			importCalls++
			return 0, nil
		}}, nil
	})

	err := converter.ImportXlsx(ctx, makeFile(t, "input.xlsx", 0), makeFile(t, "input.modoc", 0), t.TempDir())
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("got %v, want context.Canceled", err)
	}
	if importCalls != 0 {
		t.Fatalf("native import called %d times", importCalls)
	}
}

func TestConverterDoesNotExportWhenContextIsCanceledDuringNativeLoad(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	exportCalls := 0
	converter := NewConverter(t.TempDir(), func(string) (Native, error) {
		cancel()
		return &fakeNative{exportFn: func(ExportParams) (uint8, error) {
			exportCalls++
			return 0, nil
		}}, nil
	})

	err := converter.ExportXlsx(ctx, makeFile(t, "output.xlsx", 0), makeFile(t, "input.modoc", 0), t.TempDir())
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("got %v, want context.Canceled", err)
	}
	if exportCalls != 0 {
		t.Fatalf("native export called %d times", exportCalls)
	}
}

func TestConverterCloseIsSafeBeforeAndAfterLoading(t *testing.T) {
	unloaded := NewConverter(t.TempDir(), func(string) (Native, error) { return &fakeNative{}, nil })
	if err := unloaded.Close(); err != nil {
		t.Fatalf("close before loading: %v", err)
	}

	native := &fakeNative{}
	converter := NewConverter(t.TempDir(), func(string) (Native, error) { return native, nil })
	if err := converter.ImportXlsx(context.Background(), makeFile(t, "input.xlsx", 0), makeFile(t, "input.modoc", 0), t.TempDir()); err != nil {
		t.Fatalf("import: %v", err)
	}
	if err := converter.Close(); err != nil {
		t.Fatalf("close after loading: %v", err)
	}
	if err := converter.Close(); err != nil {
		t.Fatalf("second close: %v", err)
	}
	if native.closeCalls != 1 {
		t.Fatalf("native close calls = %d, want 1", native.closeCalls)
	}
}

func makeFile(t *testing.T, name string, size int64) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Truncate(path, size); err != nil {
		t.Fatal(err)
	}
	return path
}

type fakeNative struct {
	importFn   func(ImportParams) (uint8, error)
	exportFn   func(ExportParams) (uint8, error)
	closeCalls int
	mu         sync.Mutex
}

func (n *fakeNative) Import(params ImportParams) (uint8, error) {
	if n.importFn != nil {
		return n.importFn(params)
	}
	return 0, nil
}

func (n *fakeNative) Export(params ExportParams) (uint8, error) {
	if n.exportFn != nil {
		return n.exportFn(params)
	}
	return 0, nil
}

func (n *fakeNative) Close() error {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.closeCalls++
	return nil
}
