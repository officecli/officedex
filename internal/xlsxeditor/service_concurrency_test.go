package xlsxeditor

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"officedex/internal/preview"
)

// Two imports must be able to run at the same time: Prepare used to hold the
// service lock across the office2modoc conversion, so one slow workbook froze
// every other document's save and close.
func TestPrepareRunsImportsConcurrently(t *testing.T) {
	root := t.TempDir()
	entries := map[string]preview.ArtifactEntry{}
	for _, name := range []string{"a", "b"} {
		path := filepath.Join(root, name+".xlsx")
		writeXlsxFixture(t, path, "[Content_Types].xml", "xl/workbook.xml")
		entries["token-"+name] = preview.ArtifactEntry{FilePath: path, DocumentType: "xlsx"}
	}
	var mu sync.Mutex
	inside := 0
	release := make(chan struct{})
	var once sync.Once
	converter := &fakeConverter{importFn: func(_, shimo, _ string) error {
		mu.Lock()
		inside++
		if inside == 2 {
			once.Do(func() { close(release) })
		}
		mu.Unlock()
		select {
		case <-release:
		case <-time.After(5 * time.Second):
			return errors.New("the second import never started while the first was in flight")
		}
		return os.WriteFile(shimo, []byte("prepared-modoc"), 0o600)
	}}
	service := NewService(&fakePreviewResolver{entries: entries}, converter, filepath.Join(root, "sessions"))

	errs := make(chan error, 2)
	for _, token := range []string{"token-a", "token-b"} {
		go func(token string) {
			_, err := service.Prepare(context.Background(), token)
			errs <- err
		}(token)
	}
	for i := 0; i < 2; i++ {
		if err := <-errs; err != nil {
			t.Fatalf("Prepare: %v", err)
		}
	}
}

// Closing the service must not wait behind an in-flight import, and a Prepare
// whose import finishes after the close must register nothing.
func TestCloseAllIsNotBlockedByAnInFlightImport(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "slow.xlsx")
	writeXlsxFixture(t, path, "[Content_Types].xml", "xl/workbook.xml")
	entered := make(chan struct{})
	release := make(chan struct{})
	var enterOnce sync.Once
	converter := &fakeConverter{importFn: func(_, shimo, _ string) error {
		enterOnce.Do(func() { close(entered) })
		<-release
		return os.WriteFile(shimo, []byte("prepared-modoc"), 0o600)
	}}
	service := NewService(&fakePreviewResolver{entries: map[string]preview.ArtifactEntry{
		"token": {FilePath: path, DocumentType: "xlsx"},
	}}, converter, filepath.Join(root, "sessions"))

	result := make(chan error, 1)
	go func() {
		_, err := service.Prepare(context.Background(), "token")
		result <- err
	}()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("Prepare never reached the converter")
	}

	closeDone := make(chan error, 1)
	go func() { closeDone <- service.CloseAll() }()
	select {
	case err := <-closeDone:
		if err != nil {
			t.Fatalf("CloseAll: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("CloseAll blocked behind an in-flight import: the service lock is still held across the conversion")
	}
	close(release)
	if err := <-result; !errors.Is(err, ErrServiceClosed) {
		t.Fatalf("Prepare after close = %v, want ErrServiceClosed", err)
	}
	sessions, _ := os.ReadDir(filepath.Join(root, "sessions"))
	if len(sessions) != 0 {
		t.Fatalf("session directories left behind after a closed-service Prepare: %d", len(sessions))
	}
}
