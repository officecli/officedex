package instance

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestLoadOrCreatePersistsStableIdentity(t *testing.T) {
	dir := t.TempDir()
	first, err := LoadOrCreate(dir)
	if err != nil {
		t.Fatal(err)
	}
	second, err := LoadOrCreate(dir)
	if err != nil {
		t.Fatal(err)
	}
	if first.DesktopInstanceID == "" || first.DesktopInstanceID != second.DesktopInstanceID {
		t.Fatalf("identity was not stable: first=%#v second=%#v", first, second)
	}
	info, err := os.Stat(filepath.Join(dir, identityFileName))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("identity permissions = %o, want 600", info.Mode().Perm())
	}
}

func TestLoadOrCreateConcurrentCallersShareOneIdentity(t *testing.T) {
	dir := t.TempDir()
	const callers = 8
	ids := make(chan string, callers)
	errs := make(chan error, callers)
	var wg sync.WaitGroup
	for i := 0; i < callers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			identity, err := LoadOrCreate(dir)
			if err != nil {
				errs <- err
				return
			}
			ids <- identity.DesktopInstanceID
		}()
	}
	wg.Wait()
	close(ids)
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	var want string
	for id := range ids {
		if want == "" {
			want = id
		}
		if id != want {
			t.Fatalf("concurrent identities differ: got %q want %q", id, want)
		}
	}
}

func TestLoadOrCreateRejectsCorruptIdentity(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, identityFileName), []byte(`{"desktop_instance_id":"not-a-uuid"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadOrCreate(dir); err == nil {
		t.Fatal("LoadOrCreate accepted a corrupt identity")
	}
}
