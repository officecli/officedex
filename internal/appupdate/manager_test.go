package appupdate

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
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
	if _, err := New(Options{CurrentVersion: "0.1.0", UpdatesDir: t.TempDir(), ManifestPublicKey: testKeys.pub}); err == nil {
		t.Fatal("expected error when ManifestURL is empty")
	}
}

func TestNew_RequiresCurrentVersion(t *testing.T) {
	if _, err := New(Options{ManifestURL: "https://x", UpdatesDir: t.TempDir(), ManifestPublicKey: testKeys.pub}); err == nil {
		t.Fatal("expected error when CurrentVersion is empty")
	}
}

func TestNew_RequiresUpdatesDir(t *testing.T) {
	if _, err := New(Options{ManifestURL: "https://x", CurrentVersion: "0.1.0", ManifestPublicKey: testKeys.pub}); err == nil {
		t.Fatal("expected error when UpdatesDir is empty")
	}
}

func TestNew_RequiresManifestPublicKey(t *testing.T) {
	_, err := New(Options{ManifestURL: "https://x", CurrentVersion: "0.1.0", UpdatesDir: t.TempDir()})
	if err == nil || !strings.Contains(err.Error(), "ManifestPublicKey") {
		t.Fatalf("expected public-key error, got %v", err)
	}
	_, err = New(Options{ManifestURL: "https://x", CurrentVersion: "0.1.0", UpdatesDir: t.TempDir(), ManifestPublicKey: testKeys.pub[:16]})
	if err == nil || !strings.Contains(err.Error(), "ManifestPublicKey") {
		t.Fatalf("expected public-key error for a short key, got %v", err)
	}
}

func TestNew_RejectsHTTPManifestURL(t *testing.T) {
	_, err := New(Options{ManifestURL: "http://example.test/manifest.json", CurrentVersion: "0.1.0", UpdatesDir: t.TempDir(), ManifestPublicKey: testKeys.pub})
	if err == nil || !strings.Contains(err.Error(), "must be https") {
		t.Fatalf("expected https error, got %v", err)
	}
	if _, err := New(Options{ManifestURL: "ftp://example.test/manifest.json", CurrentVersion: "0.1.0", UpdatesDir: t.TempDir(), ManifestPublicKey: testKeys.pub}); err == nil {
		t.Fatal("expected error for ftp manifest url")
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
	if status.ManifestURL != "https://example.test/manifest.json" {
		t.Fatalf("ManifestURL = %q", status.ManifestURL)
	}
}

func TestStatus_IncludesChannel(t *testing.T) {
	m := mustManager(t, func(o *Options) { o.Channel = "1.0" })
	status := m.Status()
	if status.UpdateChannel != "1.0" {
		t.Fatalf("UpdateChannel = %q", status.UpdateChannel)
	}
	if status.ManifestURL != "https://example.test/manifest.json" {
		t.Fatalf("ManifestURL = %q", status.ManifestURL)
	}
}

func TestCheckLatest_DevModeShortCircuit(t *testing.T) {
	var fetched int32
	events := captureEvents()
	dir := t.TempDir()
	o := Options{
		ManifestURL:       "https://example.test/manifest.json",
		ManifestPublicKey: testKeys.pub,
		CurrentVersion:    "dev",
		UpdatesDir:        dir,
		Platform:          "darwin",
		Arch:              "arm64",
		Now:               fixedNow,
		FetchManifest: func(ctx context.Context, _ string) ([]byte, error) {
			atomic.AddInt32(&fetched, 1)
			return []byte(`{"version":"0.2.0","assets":{}}`), nil
		},
		Listener: events.append,
	}
	m, err := New(o)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	rel, err := m.CheckLatest(context.Background())
	if err != nil {
		t.Fatalf("dev CheckLatest must not error: %v", err)
	}
	if rel != nil {
		t.Fatalf("dev CheckLatest must return nil release, got %+v", rel)
	}
	if got := atomic.LoadInt32(&fetched); got != 0 {
		t.Fatalf("dev mode should not hit fetchManifest; calls=%d", got)
	}
	st := m.Status()
	if st.UpdateAvailable {
		t.Fatal("dev mode must not flag UpdateAvailable")
	}
	if st.Mandatory {
		t.Fatal("dev mode must not flag Mandatory")
	}
	if st.LastCheckedAt == nil {
		t.Fatal("dev mode should still record LastCheckedAt")
	}
	if !containsAll(events.types(), EventStatus) {
		t.Fatalf("missing status event in dev mode: %v", events.types())
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

func TestCheckLatest_RejectsBadSignature(t *testing.T) {
	manifest := `{"version":"0.2.0","assets":{}}`
	// Signed by a key this manager does not trust.
	_, otherPriv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	m := mustManager(t, withFetchManifest(signedManifestWith(manifest, otherPriv, testKeys.pub)))
	_, err = m.CheckLatest(context.Background())
	if err == nil || !errors.Is(err, ErrSignatureInvalid) {
		t.Fatalf("expected ErrSignatureInvalid, got %v", err)
	}
	st := m.Status()
	if st.LatestVersion != nil {
		t.Fatalf("a rejected manifest must not become the latest release: %+v", st)
	}
	if st.LastError == nil || !strings.Contains(*st.LastError, "signature") {
		t.Fatalf("LastError = %+v", st.LastError)
	}
}

func TestCheckLatest_RejectsTamperedManifest(t *testing.T) {
	signed := `{"version":"0.2.0","assets":{}}`
	served := `{"version":"9.9.9","assets":{}}`
	m := mustManager(t, withFetchManifest(func(ctx context.Context, url string) ([]byte, error) {
		if strings.HasSuffix(url, SignatureSuffix) {
			return testKeys.signatureFile([]byte(signed)), nil
		}
		return []byte(served), nil
	}))
	if _, err := m.CheckLatest(context.Background()); !errors.Is(err, ErrSignatureInvalid) {
		t.Fatalf("expected ErrSignatureInvalid for tampered body, got %v", err)
	}
	if m.Status().UpdateAvailable {
		t.Fatal("tampered manifest must not flag an update")
	}
}

func TestCheckLatest_RejectsMissingSignature(t *testing.T) {
	m := mustManager(t, withFetchManifest(func(ctx context.Context, url string) ([]byte, error) {
		if strings.HasSuffix(url, SignatureSuffix) {
			return nil, errors.New("manifest request: status 404")
		}
		return []byte(`{"version":"0.2.0","assets":{}}`), nil
	}))
	_, err := m.CheckLatest(context.Background())
	if err == nil || !strings.Contains(err.Error(), "fetch manifest signature") {
		t.Fatalf("expected signature fetch error, got %v", err)
	}
}

func TestCheckLatest_RejectsSignatureByOtherKeyID(t *testing.T) {
	manifest := []byte(`{"version":"0.2.0","assets":{}}`)
	sig := testKeys.signatureFile(manifest)
	var parsed SignatureFile
	if err := json.Unmarshal(sig, &parsed); err != nil {
		t.Fatal(err)
	}
	parsed.KeyID = "0000000000000000"
	tampered, _ := json.Marshal(parsed)
	m := mustManager(t, withFetchManifest(func(ctx context.Context, url string) ([]byte, error) {
		if strings.HasSuffix(url, SignatureSuffix) {
			return tampered, nil
		}
		return manifest, nil
	}))
	_, err := m.CheckLatest(context.Background())
	if err == nil || !strings.Contains(err.Error(), "signed with key 0000000000000000") {
		t.Fatalf("expected key-id mismatch error, got %v", err)
	}
}

func TestCheckLatest_FetchesSignatureBesideManifest(t *testing.T) {
	var urls []string
	m := mustManager(t, withFetchManifest(func(ctx context.Context, url string) ([]byte, error) {
		urls = append(urls, url)
		return signedManifest(`{"version":"0.2.0","assets":{}}`)(ctx, url)
	}))
	if _, err := m.CheckLatest(context.Background()); err != nil {
		t.Fatal(err)
	}
	want := []string{"https://example.test/manifest.json", "https://example.test/manifest.json.sig"}
	if strings.Join(urls, ",") != strings.Join(want, ",") {
		t.Fatalf("fetched %v, want %v", urls, want)
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
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
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
	m := mustManagerWithDir(t, dir, withFetchManifest(staticManifest(manifest)), withListener(events.append), withHTTPClient(srv.Client()))
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
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("tampered"))
	}))
	defer srv.Close()

	dir := t.TempDir()
	wrong := sha256.Sum256([]byte("the-bytes-we-signed-off-on"))
	manifest := `{
		"version":"0.2.0",
		"assets":{"darwin-arm64":{"url":"` + srv.URL + `/x.dmg","sha256":"` + hex.EncodeToString(wrong[:]) + `","size":8}}
	}`
	m := mustManagerWithDir(t, dir, withFetchManifest(staticManifest(manifest)), withHTTPClient(srv.Client()))
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
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&hits, 1)
		_, _ = w.Write(body)
	}))
	defer srv.Close()

	dir := t.TempDir()
	manifest := `{
		"version":"0.2.0",
		"assets":{"darwin-arm64":{"url":"` + srv.URL + `/x.dmg","sha256":"` + hex.EncodeToString(sum[:]) + `","size":6}}
	}`
	m := mustManagerWithDir(t, dir, withFetchManifest(staticManifest(manifest)), withHTTPClient(srv.Client()))
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

func TestDownloadUpdate_RejectsMissingSHA256(t *testing.T) {
	var hits int32
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&hits, 1)
		_, _ = w.Write([]byte("payload"))
	}))
	defer srv.Close()

	for name, sha := range map[string]string{"missing": "", "blank": "   ", "short": "deadbeef", "nonhex": strings.Repeat("zz", 32)} {
		t.Run(name, func(t *testing.T) {
			manifest := `{"version":"0.2.0","assets":{"darwin-arm64":{"url":"` + srv.URL + `/x.dmg","sha256":"` + sha + `","size":7}}}`
			m := mustManager(t, withFetchManifest(staticManifest(manifest)), withHTTPClient(srv.Client()))
			if _, err := m.CheckLatest(context.Background()); err != nil {
				t.Fatal(err)
			}
			_, err := m.DownloadUpdate(context.Background())
			if err == nil || !strings.Contains(err.Error(), "sha256") {
				t.Fatalf("expected sha256 error, got %v", err)
			}
			if m.Status().Downloading {
				t.Fatal("manager left in downloading state")
			}
		})
	}
	if got := atomic.LoadInt32(&hits); got != 0 {
		t.Fatalf("server must not be contacted for an unverifiable asset; hits=%d", got)
	}
}

func TestDownloadUpdate_RejectsHTTPAssetURL(t *testing.T) {
	sum := sha256.Sum256([]byte("payload"))
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&hits, 1)
		_, _ = w.Write([]byte("payload"))
	}))
	defer srv.Close()
	if !strings.HasPrefix(srv.URL, "http://") {
		t.Fatalf("test server should be plain http, got %s", srv.URL)
	}

	manifest := `{"version":"0.2.0","assets":{"darwin-arm64":{"url":"` + srv.URL + `/x.dmg","sha256":"` + hex.EncodeToString(sum[:]) + `","size":7}}}`
	m := mustManager(t, withFetchManifest(staticManifest(manifest)))
	if _, err := m.CheckLatest(context.Background()); err != nil {
		t.Fatal(err)
	}
	_, err := m.DownloadUpdate(context.Background())
	if err == nil || !strings.Contains(err.Error(), "must be https") {
		t.Fatalf("expected https error, got %v", err)
	}
	if got := atomic.LoadInt32(&hits); got != 0 {
		t.Fatalf("plain-http asset must never be fetched; hits=%d", got)
	}
}

func TestDownloadUpdate_RejectsSizeMismatch(t *testing.T) {
	body := []byte("payload")
	sum := sha256.Sum256(body)
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(body)
	}))
	defer srv.Close()
	manifest := `{"version":"0.2.0","assets":{"darwin-arm64":{"url":"` + srv.URL + `/x.dmg","sha256":"` + hex.EncodeToString(sum[:]) + `","size":99}}}`
	m := mustManager(t, withFetchManifest(staticManifest(manifest)), withHTTPClient(srv.Client()))
	if _, err := m.CheckLatest(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := m.DownloadUpdate(context.Background()); err == nil || !strings.Contains(err.Error(), "size mismatch") {
		t.Fatalf("expected size mismatch, got %v", err)
	}
}

func TestDownloadUpdate_CancelMidStream(t *testing.T) {
	// Slow server lets us cancel before EOF.
	block := make(chan struct{})
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.(http.Flusher).Flush()
		_, _ = w.Write([]byte("a"))
		w.(http.Flusher).Flush()
		<-block
		_, _ = w.Write([]byte("rest"))
	}))
	defer srv.Close()
	defer close(block)

	dir := t.TempDir()
	manifest := `{"version":"0.2.0","assets":{"darwin-arm64":{"url":"` + srv.URL + `/x.dmg","sha256":"` + strings.Repeat("00", 32) + `","size":5}}}`
	m := mustManagerWithDir(t, dir, withFetchManifest(staticManifest(manifest)), withHTTPClient(srv.Client()))
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
func withHTTPClient(c *http.Client) managerOpt { return func(o *Options) { o.HTTPClient = c } }

// testKeyPair is the Ed25519 key every test manifest is signed with. The
// manager under test trusts testKeys.pub; signedManifestWith lets a test sign
// with some other key to exercise rejection.
type testKeyPair struct {
	pub  ed25519.PublicKey
	priv ed25519.PrivateKey
}

var testKeys = func() testKeyPair {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		panic(err)
	}
	return testKeyPair{pub: pub, priv: priv}
}()

func (k testKeyPair) signatureFile(manifest []byte) []byte {
	return signatureFileWith(manifest, k.priv, k.pub)
}

func signatureFileWith(manifest []byte, priv ed25519.PrivateKey, keyIDOf ed25519.PublicKey) []byte {
	sig := ed25519.Sign(priv, manifest)
	out, err := json.Marshal(SignatureFile{
		Format:    SignatureFormat,
		Version:   SignatureVersion,
		Algorithm: SignatureAlgorithm,
		KeyID:     KeyID(keyIDOf),
		Signature: base64.StdEncoding.EncodeToString(sig),
	})
	if err != nil {
		panic(err)
	}
	return out
}

func mustManager(t *testing.T, opts ...managerOpt) *Manager {
	t.Helper()
	return mustManagerWithDir(t, t.TempDir(), opts...)
}

func mustManagerWithDir(t *testing.T, dir string, opts ...managerOpt) *Manager {
	t.Helper()
	o := Options{
		ManifestURL:       "https://example.test/manifest.json",
		ManifestPublicKey: testKeys.pub,
		CurrentVersion:    "0.1.0",
		UpdatesDir:        dir,
		Platform:          "darwin",
		Arch:              "arm64",
		Now:               fixedNow,
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

// staticManifest serves body as the manifest and a valid signature (by the
// trusted test key) for it at the .sig URL.
func staticManifest(body string) FetchFunc {
	return signedManifest(body)
}

func signedManifest(body string) FetchFunc {
	return signedManifestWith(body, testKeys.priv, testKeys.pub)
}

func signedManifestWith(body string, priv ed25519.PrivateKey, keyIDOf ed25519.PublicKey) FetchFunc {
	manifest := []byte(body)
	sig := signatureFileWith(manifest, priv, keyIDOf)
	return func(ctx context.Context, url string) ([]byte, error) {
		if strings.HasSuffix(url, SignatureSuffix) {
			return sig, nil
		}
		return manifest, nil
	}
}

func TestSwitchChannelResetsStateAndPersistsAtomically(t *testing.T) {
	m := mustManager(t, withFetchManifest(staticManifest(`{"version":"0.2.0","mandatory":true}`)))
	if _, err := m.CheckLatest(context.Background()); err != nil {
		t.Fatal(err)
	}
	cached := "/tmp/old-channel.zip"
	m.downloadedPath = &cached
	before := m.Status()
	if err := m.SwitchChannel("beta", "https://example.test/beta.json", func() error { return errors.New("disk full") }); err == nil {
		t.Fatal("expected persistence failure")
	}
	if got := m.Status(); got.ManifestURL != before.ManifestURL || got.DownloadedPath == nil {
		t.Fatalf("failed write changed updater: %+v", got)
	}
	persisted := false
	if err := m.SwitchChannel("beta", "https://example.test/beta.json", func() error { persisted = true; return nil }); err != nil {
		t.Fatal(err)
	}
	s := m.Status()
	if !persisted || s.UpdateChannel != "beta" || s.LatestVersion != nil || s.DownloadedPath != nil || s.Mandatory || s.LastCheckedAt != nil {
		t.Fatalf("stale state after switch: %+v", s)
	}
	if err := m.InstallDownloaded(func(string) error { t.Fatal("old archive must not be installed"); return nil }); err == nil {
		t.Fatal("install must require a new download")
	}
}

func TestSwitchChannelRefusesInFlightCheck(t *testing.T) {
	started, resume, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
	m := mustManager(t, withFetchManifest(func(ctx context.Context, url string) ([]byte, error) {
		close(started)
		<-resume
		return nil, errors.New("offline")
	}))
	go func() { defer close(done); _, _ = m.CheckLatest(context.Background()) }()
	<-started
	err := m.SwitchChannel("beta", "https://example.test/beta.json", func() error { t.Error("must not persist while busy"); return nil })
	close(resume)
	<-done
	if err == nil {
		t.Fatal("expected busy error")
	}
	if err := m.SwitchChannel("beta", "https://example.test/beta.json", func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	if s := m.Status(); s.LastError != nil || len(s.LastErrors) != 0 {
		t.Fatalf("old errors survived: %+v", s)
	}
}

func TestSwitchBackToStableDoesNotOfferDowngrade(t *testing.T) {
	m := mustManager(t, func(o *Options) { o.CurrentVersion = "1.0.14" }, withFetchManifest(staticManifest(`{"version":"1.0.13","mandatory":true}`)))
	if err := m.SwitchChannel("stable", "https://example.test/manifest.json", func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	if _, err := m.CheckLatest(context.Background()); err != nil {
		t.Fatal(err)
	}
	if s := m.Status(); s.UpdateAvailable || s.Mandatory {
		t.Fatalf("offered a downgrade: %+v", s)
	}
}

func TestSwitchChannelRefusesDownloadAndInstall(t *testing.T) {
	for _, operation := range []string{"download", "install"} {
		t.Run(operation, func(t *testing.T) {
			started, resume, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
			m := mustManager(t)
			if operation == "download" {
				m.latestRelease = &ReleaseInfo{Version: "0.2.0", Assets: map[string]Asset{"darwin-arm64": {URL: "https://example.test/app.zip", SHA256: strings.Repeat("a", 64)}}}
				m.fetchDownload = func(ctx context.Context, url string) (io.ReadCloser, int64, error) {
					close(started)
					<-resume
					return nil, 0, errors.New("test cancellation")
				}
				go func() { defer close(done); _, _ = m.DownloadUpdate(context.Background()) }()
			} else {
				archive := "/tmp/test.zip"
				m.downloadedPath = &archive
				go func() {
					defer close(done)
					_ = m.InstallDownloaded(func(string) error { close(started); <-resume; return nil })
				}()
			}
			<-started
			err := m.SwitchChannel("beta", "https://example.test/beta.json", func() error { t.Error("persisted while busy"); return nil })
			close(resume)
			<-done
			if err == nil {
				t.Fatal("expected busy error")
			}
		})
	}
}
