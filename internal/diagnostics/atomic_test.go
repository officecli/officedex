package diagnostics

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"officedex/internal/types"
)

func TestAtomicWriteNoZipOnError(t *testing.T) {
	destDir := t.TempDir()
	userDataDir := t.TempDir()

	_, _, err := BuildBundle(context.Background(), BundleOptions{
		DestDir:     destDir,
		UserDataDir: userDataDir,
		LocalStore:  &failingQuerier{},
		Settings:    types.UserSettings{},
		BundleID:    "test-atomic",
		Now:         func() time.Time { return time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC) },
	})

	if err != nil {
		entries, _ := os.ReadDir(destDir)
		for _, e := range entries {
			if strings.HasSuffix(e.Name(), ".zip") || strings.HasSuffix(e.Name(), ".partial") {
				t.Errorf("found zip/partial file after error: %s", e.Name())
			}
		}
	}
}

func TestAtomicWriteNoPartialLeftover(t *testing.T) {
	destDir := t.TempDir()
	userDataDir := t.TempDir()

	settingsDir := userDataDir
	settingsJSON := `{"version":1,"defaults":{}}`
	_ = os.WriteFile(filepath.Join(settingsDir, "settings.json"), []byte(settingsJSON), 0o644)

	zipPath, _, err := BuildBundle(context.Background(), BundleOptions{
		DestDir:     destDir,
		UserDataDir: userDataDir,
		Settings:    types.UserSettings{},
		BundleID:    "test-no-partial",
		Now:         func() time.Time { return time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC) },
	})
	if err != nil {
		t.Fatalf("BuildBundle: %v", err)
	}

	if _, err := os.Stat(zipPath); err != nil {
		t.Fatalf("final zip should exist: %v", err)
	}

	entries, _ := os.ReadDir(destDir)
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".partial") {
			t.Errorf("partial file left in dest dir: %s", e.Name())
		}
	}

	tmpEntries, _ := filepath.Glob(filepath.Join(os.TempDir(), "officedex-bundle-*"))
	for _, p := range tmpEntries {
		t.Errorf("temp dir left behind: %s", p)
	}
}

func TestConcurrentBundleUniqueFilenames(t *testing.T) {
	destDir := t.TempDir()
	userDataDir := t.TempDir()
	_ = os.WriteFile(filepath.Join(userDataDir, "settings.json"), []byte(`{}`), 0o644)

	const n = 10
	type result struct {
		path string
		err  error
	}
	ch := make(chan result, n)

	for i := 0; i < n; i++ {
		go func(idx int) {
			bundleID := strings.Repeat(string(rune('a'+idx)), 8)
			p, _, err := BuildBundle(context.Background(), BundleOptions{
				DestDir:     destDir,
				UserDataDir: userDataDir,
				Settings:    types.UserSettings{},
				BundleID:    bundleID,
				Now:         time.Now,
			})
			ch <- result{p, err}
		}(i)
	}

	paths := make(map[string]bool)
	for i := 0; i < n; i++ {
		r := <-ch
		if r.err != nil {
			t.Errorf("bundle %d failed: %v", i, r.err)
			continue
		}
		if paths[r.path] {
			t.Errorf("duplicate path: %s", r.path)
		}
		paths[r.path] = true
	}

	entries, _ := os.ReadDir(destDir)
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".partial") {
			t.Errorf("partial file left: %s", e.Name())
		}
	}

	if len(paths) != n {
		t.Errorf("expected %d unique paths, got %d", n, len(paths))
	}
}

type failingQuerier struct{}

func (f *failingQuerier) QueryEventsByTask(_ context.Context, _ string) ([]types.BridgeEvent, error) {
	return nil, nil
}

func (f *failingQuerier) QueryRecentEvents(_ context.Context, _ int) ([]types.BridgeEvent, error) {
	return nil, nil
}
