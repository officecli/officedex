package pptxeditor

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

// barrierConverter blocks each import until `parties` imports are in flight at
// once, which is only possible if Prepare no longer holds the service lock
// across the conversion.
type barrierConverter struct {
	fakeConverter
	mu      sync.Mutex
	inside  int
	parties int
	release chan struct{}
	once    sync.Once
}

func (c *barrierConverter) ImportPptx(ctx context.Context, source, mopDirectory string) error {
	c.mu.Lock()
	c.inside++
	if c.inside == c.parties {
		c.once.Do(func() { close(c.release) })
	}
	c.mu.Unlock()
	select {
	case <-c.release:
	case <-ctx.Done():
		return ctx.Err()
	}
	return c.fakeConverter.ImportPptx(ctx, source, mopDirectory)
}

func TestPrepareRunsConversionsConcurrently(t *testing.T) {
	root := t.TempDir()
	entries := map[string]preview.ArtifactEntry{}
	for _, name := range []string{"a", "b"} {
		path := filepath.Join(root, name+".pptx")
		writeTestPptx(t, path)
		entries["token-"+name] = preview.ArtifactEntry{FilePath: path, DocumentType: "pptx"}
	}
	converter := &barrierConverter{parties: 2, release: make(chan struct{})}
	service := NewService(&fakeResolver{entries: entries}, converter, filepath.Join(root, "sessions"))

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	errs := make(chan error, 2)
	for _, token := range []string{"token-a", "token-b"} {
		go func(token string) {
			_, err := service.Prepare(ctx, token)
			errs <- err
		}(token)
	}
	for i := 0; i < 2; i++ {
		if err := <-errs; err != nil {
			t.Fatalf("Prepare: %v (the two conversions never overlapped, so the lock is still held across the import)", err)
		}
	}
}

// Closing the service while a conversion is in flight must not leave a session
// registered afterwards, and the session directory must be cleaned up.
func TestPrepareAfterCloseDuringImportRegistersNothing(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "deck.pptx")
	writeTestPptx(t, path)
	converter := &barrierConverter{parties: 1, release: make(chan struct{})}
	entered := make(chan struct{})
	gate := &gatedConverter{barrierConverter: converter, entered: entered, done: make(chan struct{})}
	service := NewService(&fakeResolver{entries: map[string]preview.ArtifactEntry{
		"token": {FilePath: path, DocumentType: "pptx"},
	}}, gate, filepath.Join(root, "sessions"))

	result := make(chan error, 1)
	go func() {
		_, err := service.Prepare(context.Background(), "token")
		result <- err
	}()
	<-entered
	if err := service.CloseAll(); err != nil {
		t.Fatal(err)
	}
	gate.finish()
	if err := <-result; !errors.Is(err, ErrServiceClosed) {
		t.Fatalf("Prepare after close = %v, want ErrServiceClosed", err)
	}
	sessions, _ := os.ReadDir(filepath.Join(root, "sessions"))
	if len(sessions) != 0 {
		t.Fatalf("session directories left behind after a closed-service Prepare: %d", len(sessions))
	}
}

type gatedConverter struct {
	*barrierConverter
	entered   chan struct{}
	enterOnce sync.Once
	done      chan struct{}
	doneOnce  sync.Once
}

func (g *gatedConverter) ImportPptx(ctx context.Context, source, mopDirectory string) error {
	g.enterOnce.Do(func() { close(g.entered) })
	<-g.done
	return g.fakeConverter.ImportPptx(ctx, source, mopDirectory)
}

func (g *gatedConverter) finish() { g.doneOnce.Do(func() { close(g.done) }) }
