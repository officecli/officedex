package appupdate

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func fixedNow() time.Time { return time.Date(2026, 5, 22, 12, 0, 0, 0, time.UTC) }

func TestNew_RequiresManifestURL(t *testing.T) {
	if _, err := New(Options{CurrentVersion: "0.1.0", UpdatesDir: t.TempDir()}); err == nil {
		t.Fatal("expected error when ManifestURL is empty")
	}
}

func TestNew_RequiresCurrentVersion(t *testing.T) {
	if _, err := New(Options{ManifestURL: "https://x", UpdatesDir: t.TempDir()}); err == nil {
		t.Fatal("expected error when CurrentVersion is empty")
	}
}

func TestNew_RequiresUpdatesDir(t *testing.T) {
	if _, err := New(Options{ManifestURL: "https://x", CurrentVersion: "0.1.0"}); err == nil {
		t.Fatal("expected error when UpdatesDir is empty")
	}
}

func TestCompareSemver(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"0.1.0", "0.1.0", 0},
		{"0.1.0", "0.2.0", -1},
		{"0.2.0", "0.1.0", 1},
		{"1.0.0", "0.9.99", 1},
		{"v0.1.0", "0.1.0", 0},
		{"0.1", "0.1.0", 0},
		{"0.1.0-beta", "0.1.0", 0},
		{"", "0.0.1", -1},
		{"garbage", "0.0.0", 0},
	}
	for _, c := range cases {
		got := CompareSemver(c.a, c.b)
		if got != c.want {
			t.Errorf("CompareSemver(%q, %q)=%d want %d", c.a, c.b, got, c.want)
		}
	}
}

func TestIsMandatory(t *testing.T) {
	if IsMandatory(nil, "0.1.0") {
		t.Fatal("nil release must not be mandatory")
	}
	if IsMandatory(&ReleaseInfo{Mandatory: false}, "0.1.0") {
		t.Fatal("non-mandatory + no min must be false")
	}
	if !IsMandatory(&ReleaseInfo{Mandatory: true}, "0.1.0") {
		t.Fatal("explicit mandatory must be true")
	}
	if !IsMandatory(&ReleaseInfo{MinSupportedVersion: "0.2.0"}, "0.1.0") {
		t.Fatal("current below min must be true")
	}
	if IsMandatory(&ReleaseInfo{MinSupportedVersion: "0.1.0"}, "0.1.0") {
		t.Fatal("current equal to min must be false")
	}
	if IsMandatory(&ReleaseInfo{MinSupportedVersion: "0.0.5"}, "0.1.0") {
		t.Fatal("current above min must be false")
	}
}

func TestCheckLatest_Success(t *testing.T) {
	events := captureEvents()
	m := mustManager(t, withFetchManifest(staticManifest(`{
		"version":"0.2.0",
		"notes":"hello",
		"minSupportedVersion":"0.1.0",
		"mandatory":false,
		"assets": {
			"darwin-arm64": {"url":"https://x/OfficeDex-0.2.0-arm64.dmg","sha256":"abc","size":42}
		}
	}`)), withListener(events.append))

	rel, err := m.CheckLatest(context.Background())
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if rel.Version != "0.2.0" {
		t.Fatalf("version = %q", rel.Version)
	}
	status := m.Status()
	if status.LatestVersion == nil || *status.LatestVersion != "0.2.0" {
		t.Fatalf("latestVersion not set: %+v", status)
	}
	if !status.UpdateAvailable {
		t.Fatal("UpdateAvailable should be true (0.2.0 > 0.1.0)")
	}
	if status.LastCheckedAt == nil {
		t.Fatal("LastCheckedAt should be set")
	}
	if got := events.types(); !containsAll(got, EventStatus) {
		t.Fatalf("missing status event: %v", got)
	}
}

func TestCheckLatest_NetworkError(t *testing.T) {
	m := mustManager(t, withFetchManifest(func(ctx context.Context, url string) ([]byte, error) {
		return nil, errors.New("boom")
	}))
	if _, err := m.CheckLatest(context.Background()); err == nil {
		t.Fatal("expected error")
	}
	st := m.Status()
	if st.LastError == nil || !strings.Contains(*st.LastError, "boom") {
		t.Fatalf("LastError = %+v", st.LastError)
	}
}

func TestCheckLatest_MalformedJSON(t *testing.T) {
	m := mustManager(t, withFetchManifest(staticManifest("not json")))
	if _, err := m.CheckLatest(context.Background()); err == nil {
		t.Fatal("expected parse error")
	}
}

func TestCheckLatest_MissingVersion(t *testing.T) {
	m := mustManager(t, withFetchManifest(staticManifest(`{"assets":{}}`)))
	if _, err := m.CheckLatest(context.Background()); err == nil {
		t.Fatal("expected missing-version error")
	}
}

func TestCheckLatest_SameVersionNoUpdate(t *testing.T) {
	m := mustManager(t, withFetchManifest(staticManifest(`{"version":"0.1.0","assets":{}}`)))
	if _, err := m.CheckLatest(context.Background()); err != nil {
		t.Fatal(err)
	}
	if m.Status().UpdateAvailable {
		t.Fatal("same version must not flag UpdateAvailable")
	}
}

func TestDownloadUpdate_HappyPath(t *testing.T) {
	body := []byte("hello-world-payload")
	sum := sha256.Sum256(body)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Length", "19")
		_, _ = w.Write(body)
	}))
	defer srv.Close()

	dir := t.TempDir()
	events := captureEvents()
	manifest := `{
		"version":"0.2.0",
		"assets":{"darwin-arm64":{"url":"` + srv.URL + `/dl/OfficeDex-0.2.0.dmg","sha256":"` + hex.EncodeToString(sum[:]) + `","size":19}}
	}`
	m := mustManagerWithDir(t, dir, withFetchManifest(staticManifest(manifest)), withListener(events.append))
	if _, err := m.CheckLatest(context.Background()); err != nil {
		t.Fatal(err)
	}

	path, err := m.DownloadUpdate(context.Background())
	if err != nil {
		t.Fatalf("download: %v", err)
	}
	if !strings.HasSuffix(path, "OfficeDex-0.2.0.dmg") {
		t.Fatalf("unexpected path: %s", path)
	}
	got, err := os.ReadFile(path)
	if err != nil || string(got) != string(body) {
		t.Fatalf("payload mismatch: %v %q", err, got)
	}
	if _, err := os.Stat(path + ".part"); !os.IsNotExist(err) {
		t.Fatalf(".part still present: %v", err)
	}
	if dp := m.Status().DownloadedPath; dp == nil || *dp != path {
		t.Fatalf("DownloadedPath not set: %+v", dp)
	}
	if !containsAll(events.types(), EventDownloaded) {
		t.Fatalf("missing downloaded event: %v", events.types())
	}
}

func TestDownloadUpdate_ChecksumMismatch(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("tampered"))
	}))
	defer srv.Close()

	dir := t.TempDir()
	manifest := `{
		"version":"0.2.0",
		"assets":{"darwin-arm64":{"url":"` + srv.URL + `/x.dmg","sha256":"deadbeef","size":8}}
	}`
	m := mustManagerWithDir(t, dir, withFetchManifest(staticManifest(manifest)))
	if _, err := m.CheckLatest(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := m.DownloadUpdate(context.Background()); err == nil || !strings.Contains(err.Error(), "checksum mismatch") {
		t.Fatalf("expected checksum mismatch, got %v", err)
	}
	// .part removed
	versionDir := filepath.Join(dir, "0.2.0")
	entries, _ := os.ReadDir(versionDir)
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".part") {
			t.Fatalf(".part still present: %s", e.Name())
		}
	}
}

func TestDownloadUpdate_CachedOnSecondCall(t *testing.T) {
	body := []byte("cached")
	sum := sha256.Sum256(body)
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&hits, 1)
		_, _ = w.Write(body)
	}))
	defer srv.Close()

	dir := t.TempDir()
	manifest := `{
		"version":"0.2.0",
		"assets":{"darwin-arm64":{"url":"` + srv.URL + `/x.dmg","sha256":"` + hex.EncodeToString(sum[:]) + `","size":6}}
	}`
	m := mustManagerWithDir(t, dir, withFetchManifest(staticManifest(manifest)))
	if _, err := m.CheckLatest(context.Background()); err != nil {
		t.Fatal(err)
	}
	p1, err := m.DownloadUpdate(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	p2, err := m.DownloadUpdate(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if p1 != p2 {
		t.Fatalf("cached path mismatch: %s vs %s", p1, p2)
	}
	if got := atomic.LoadInt32(&hits); got != 1 {
		t.Fatalf("server hit %d times; expected 1", got)
	}
}

func TestDownloadUpdate_NoReleaseInfo(t *testing.T) {
	m := mustManager(t)
	if _, err := m.DownloadUpdate(context.Background()); err == nil || !strings.Contains(err.Error(), "no release info") {
		t.Fatalf("expected no-release error, got %v", err)
	}
}

func TestDownloadUpdate_CancelMidStream(t *testing.T) {
	// Slow server lets us cancel before EOF.
	block := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.(http.Flusher).Flush()
		_, _ = w.Write([]byte("a"))
		w.(http.Flusher).Flush()
		<-block
		_, _ = w.Write([]byte("rest"))
	}))
	defer srv.Close()
	defer close(block)

	dir := t.TempDir()
	manifest := `{"version":"0.2.0","assets":{"darwin-arm64":{"url":"` + srv.URL + `/x.dmg","sha256":"00","size":5}}}`
	m := mustManagerWithDir(t, dir, withFetchManifest(staticManifest(manifest)))
	if _, err := m.CheckLatest(context.Background()); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := m.DownloadUpdate(ctx)
		done <- err
	}()
	time.Sleep(50 * time.Millisecond)
	cancel()
	m.CancelDownload()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("expected error after cancel")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("download did not finish after cancel")
	}
}

// ----- helpers ---------------------------------------------------------

type eventLog struct {
	mu     sync.Mutex
	events []Event
}

func captureEvents() *eventLog { return &eventLog{} }

func (e *eventLog) append(ev Event) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.events = append(e.events, ev)
}

func (e *eventLog) types() []EventType {
	e.mu.Lock()
	defer e.mu.Unlock()
	out := make([]EventType, 0, len(e.events))
	for _, ev := range e.events {
		out = append(out, ev.Type)
	}
	return out
}

func containsAll(got []EventType, want ...EventType) bool {
	for _, w := range want {
		found := false
		for _, g := range got {
			if g == w {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

type managerOpt func(*Options)

func withFetchManifest(f FetchFunc) managerOpt { return func(o *Options) { o.FetchManifest = f } }
func withListener(l func(Event)) managerOpt    { return func(o *Options) { o.Listener = l } }

func mustManager(t *testing.T, opts ...managerOpt) *Manager {
	t.Helper()
	return mustManagerWithDir(t, t.TempDir(), opts...)
}

func mustManagerWithDir(t *testing.T, dir string, opts ...managerOpt) *Manager {
	t.Helper()
	o := Options{
		ManifestURL:    "https://example.test/manifest.json",
		CurrentVersion: "0.1.0",
		UpdatesDir:     dir,
		Platform:       "darwin",
		Arch:           "arm64",
		Now:            fixedNow,
	}
	for _, opt := range opts {
		opt(&o)
	}
	m, err := New(o)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return m
}

func staticManifest(body string) FetchFunc {
	return func(ctx context.Context, _ string) ([]byte, error) {
		return []byte(body), nil
	}
}
