package runtime

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"officedex/internal/types"
)

func fixedNow() time.Time {
	return time.Date(2026, 5, 22, 12, 0, 0, 0, time.UTC)
}

func newTestManager(t *testing.T, opts ManagerOptions) *Manager {
	t.Helper()
	if opts.InstallRoot == "" {
		opts.InstallRoot = t.TempDir()
	}
	if opts.Repo == "" {
		opts.Repo = "owner/repo"
	}
	if opts.Platform == "" {
		opts.Platform = "darwin"
	}
	if opts.Arch == "" {
		opts.Arch = "arm64"
	}
	if opts.Now == nil {
		opts.Now = fixedNow
	}
	m, err := New(opts)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return m
}

func TestNew_RequiresInstallRoot(t *testing.T) {
	if _, err := New(ManagerOptions{Repo: "owner/repo"}); err == nil {
		t.Fatal("expected error when InstallRoot is empty")
	}
}

func TestNew_RequiresRepo(t *testing.T) {
	if _, err := New(ManagerOptions{InstallRoot: "/tmp/x"}); err == nil {
		t.Fatal("expected error when Repo is empty")
	}
}

func TestExpectedAssetName(t *testing.T) {
	cases := []struct {
		platform, arch, tag, want string
	}{
		{"darwin", "arm64", "v0.2.97", "officecli_0.2.97_darwin_arm64.tar.gz"},
		{"darwin", "x64", "v0.2.97", "officecli_0.2.97_darwin_amd64.tar.gz"},
		{"linux", "x64", "v1.0.0", "officecli_1.0.0_linux_amd64.tar.gz"},
		{"win32", "x64", "v1.0.0", "officecli_1.0.0_windows_amd64.tar.gz"},
		{"win32", "arm64", "2.5.1", "officecli_2.5.1_windows_arm64.tar.gz"},
	}
	for _, tc := range cases {
		m := newTestManager(t, ManagerOptions{Platform: tc.platform, Arch: tc.arch})
		if got := m.ExpectedAssetName(tc.tag); got != tc.want {
			t.Errorf("ExpectedAssetName(%s,%s,%s) = %q, want %q", tc.platform, tc.arch, tc.tag, got, tc.want)
		}
	}
}

func TestLoadFromDisk_VersionAndBinaryPresent(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "version.json"), []byte(`{"version":"1.2.3"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "officecli"), []byte("binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	m := newTestManager(t, ManagerOptions{InstallRoot: root})
	if err := m.LoadFromDisk(); err != nil {
		t.Fatalf("LoadFromDisk: %v", err)
	}
	st := m.Status()
	if !st.Installed {
		t.Fatal("expected installed=true")
	}
	if st.CurrentVersion == nil || *st.CurrentVersion != "1.2.3" {
		t.Errorf("currentVersion = %v, want 1.2.3", st.CurrentVersion)
	}
}

func TestLoadFromDisk_VersionFileMissing(t *testing.T) {
	m := newTestManager(t, ManagerOptions{})
	if err := m.LoadFromDisk(); err != nil {
		t.Fatalf("LoadFromDisk: %v", err)
	}
	if m.Status().Installed {
		t.Fatal("expected installed=false when version.json missing")
	}
}

func TestLoadFromDisk_BinaryMissing(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "version.json"), []byte(`{"version":"1.0.0"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	m := newTestManager(t, ManagerOptions{InstallRoot: root})
	if err := m.LoadFromDisk(); err != nil {
		t.Fatalf("LoadFromDisk: %v", err)
	}
	if m.Status().Installed {
		t.Fatal("expected installed=false when binary missing")
	}
}

func TestLoadFromDisk_CorruptJSON(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "version.json"), []byte("not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "officecli"), []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}
	m := newTestManager(t, ManagerOptions{InstallRoot: root})
	if err := m.LoadFromDisk(); err != nil {
		t.Fatalf("LoadFromDisk: %v", err)
	}
	if m.Status().Installed {
		t.Fatal("expected installed=false on corrupt JSON")
	}
}

func TestSetManualPath_ClearsOnWhitespace(t *testing.T) {
	var events []types.RuntimeEvent
	var mu sync.Mutex
	m := newTestManager(t, ManagerOptions{
		Listener: func(e types.RuntimeEvent) {
			mu.Lock()
			defer mu.Unlock()
			events = append(events, e)
		},
	})
	m.SetManualPath("/path/to/bin")
	if got := m.Status().ManualPath; got == nil || *got != "/path/to/bin" {
		t.Errorf("manualPath = %v, want /path/to/bin", got)
	}
	m.SetManualPath("   ")
	if got := m.Status().ManualPath; got != nil {
		t.Errorf("manualPath = %v, want nil after whitespace", got)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(events) != 2 {
		t.Fatalf("expected 2 status events, got %d", len(events))
	}
	for _, e := range events {
		if e.Type != types.RuntimeEventStatus {
			t.Errorf("event type = %s, want status", e.Type)
		}
	}
}

func TestResolveBinaryPath(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "version.json"), []byte(`{"version":"1.0"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "officecli"), []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}
	m := newTestManager(t, ManagerOptions{InstallRoot: root})
	if got := m.ResolveBinaryPath(); got != nil {
		t.Fatalf("expected nil before load, got %v", *got)
	}
	if err := m.LoadFromDisk(); err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(root, "officecli")
	if got := m.ResolveBinaryPath(); got == nil || *got != want {
		t.Errorf("managed path = %v, want %s", got, want)
	}
	m.SetManualPath("/manual/bin")
	if got := m.ResolveBinaryPath(); got == nil || *got != "/manual/bin" {
		t.Errorf("manual path wins = %v, want /manual/bin", got)
	}
}

func releaseJSON(tag, assetName, assetURL string, size int64) []byte {
	body, _ := json.Marshal(map[string]any{
		"tag_name": tag,
		"assets": []map[string]any{
			{"name": assetName, "browser_download_url": assetURL, "size": size},
		},
	})
	return body
}

func TestCheckLatestVersion_Success(t *testing.T) {
	m := newTestManager(t, ManagerOptions{
		FetchJSON: func(ctx context.Context, url string) ([]byte, error) {
			return releaseJSON("v2.0.0", "officecli_2.0.0_darwin_arm64.tar.gz", "https://dl/example", 1234), nil
		},
	})
	rel, err := m.CheckLatestVersion(context.Background())
	if err != nil {
		t.Fatalf("CheckLatestVersion: %v", err)
	}
	if rel.Version != "v2.0.0" || rel.Size != 1234 || rel.AssetURL != "https://dl/example" {
		t.Errorf("unexpected release: %+v", rel)
	}
	if rel.AssetName != "officecli_2.0.0_darwin_arm64.tar.gz" {
		t.Errorf("AssetName = %q", rel.AssetName)
	}
	st := m.Status()
	if st.LatestVersion == nil || *st.LatestVersion != "v2.0.0" {
		t.Errorf("latestVersion = %v", st.LatestVersion)
	}
	if st.LastCheckedAt == nil {
		t.Error("lastCheckedAt should be set")
	}
}

func TestCheckLatestVersion_AssetMissing(t *testing.T) {
	var errEvent string
	m := newTestManager(t, ManagerOptions{
		FetchJSON: func(ctx context.Context, url string) ([]byte, error) {
			return releaseJSON("v1.0.0", "officecli_1.0.0_windows_amd64.tar.gz", "https://dl/other", 0), nil
		},
		Listener: func(e types.RuntimeEvent) {
			if e.Type == types.RuntimeEventError {
				errEvent = e.Message
			}
		},
	})
	if rel, err := m.CheckLatestVersion(context.Background()); rel != nil || err == nil {
		t.Fatalf("expected nil rel + error, got rel=%v err=%v", rel, err)
	}
	if !strings.Contains(errEvent, "no asset named officecli_1.0.0_darwin_arm64.tar.gz") {
		t.Errorf("error event = %q", errEvent)
	}
	if last := m.Status().LastError; last == nil || !strings.Contains(*last, "no asset named") {
		t.Errorf("status.lastError = %v", last)
	}
}

func TestCheckLatestVersion_FetchFails(t *testing.T) {
	var errEvent bool
	m := newTestManager(t, ManagerOptions{
		FetchJSON: func(ctx context.Context, url string) ([]byte, error) {
			return nil, errors.New("network down")
		},
		Listener: func(e types.RuntimeEvent) {
			if e.Type == types.RuntimeEventError {
				errEvent = true
			}
		},
	})
	if rel, err := m.CheckLatestVersion(context.Background()); rel != nil || err == nil {
		t.Fatalf("expected failure, got rel=%v err=%v", rel, err)
	}
	if !errEvent {
		t.Error("expected error event")
	}
	if last := m.Status().LastError; last == nil || *last != "network down" {
		t.Errorf("lastError = %v", last)
	}
}

// makeTarGz builds an in-memory tar.gz containing the given files.
func makeTarGz(t *testing.T, files map[string][]byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	gw := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gw)
	for name, body := range files {
		hdr := &tar.Header{
			Name:     name,
			Mode:     0o755,
			Size:     int64(len(body)),
			Typeflag: tar.TypeReg,
		}
		if err := tw.WriteHeader(hdr); err != nil {
			t.Fatalf("tar header: %v", err)
		}
		if _, err := tw.Write(body); err != nil {
			t.Fatalf("tar write: %v", err)
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatalf("tar close: %v", err)
	}
	if err := gw.Close(); err != nil {
		t.Fatalf("gzip close: %v", err)
	}
	return buf.Bytes()
}

func TestDownloadAndInstall_HappyPath(t *testing.T) {
	root := t.TempDir()
	binary := []byte("the-binary-bytes")
	archive := makeTarGz(t, map[string][]byte{
		"officecli":  binary,
		"LICENSE.md": []byte("noise"),
	})
	var progressEvents []types.RuntimeEvent
	var installedEvent bool
	var mu sync.Mutex
	m := newTestManager(t, ManagerOptions{
		InstallRoot: root,
		FetchJSON: func(ctx context.Context, url string) ([]byte, error) {
			return releaseJSON("v3.0.0", "officecli_3.0.0_darwin_arm64.tar.gz", "https://dl/asset", int64(len(archive))), nil
		},
		FetchDownload: func(ctx context.Context, url string) (*FetchDownload, error) {
			return &FetchDownload{
				Stream: io.NopCloser(bytes.NewReader(archive)),
				Size:   int64(len(archive)),
			}, nil
		},
		Listener: func(e types.RuntimeEvent) {
			mu.Lock()
			defer mu.Unlock()
			if e.Type == types.RuntimeEventProgress {
				progressEvents = append(progressEvents, e)
			}
			if e.Type == types.RuntimeEventInstalled {
				installedEvent = true
			}
		},
	})
	status, err := m.DownloadAndInstall(context.Background())
	if err != nil {
		t.Fatalf("DownloadAndInstall: %v", err)
	}
	if !status.Installed || status.CurrentVersion == nil || *status.CurrentVersion != "v3.0.0" {
		t.Fatalf("status = %+v", status)
	}
	if status.Updating {
		t.Error("updating should be false after success")
	}
	binPath := filepath.Join(root, "officecli")
	got, err := os.ReadFile(binPath)
	if err != nil {
		t.Fatalf("read binary: %v", err)
	}
	if !bytes.Equal(got, binary) {
		t.Errorf("binary content mismatch")
	}
	info, err := os.Stat(binPath)
	if err != nil {
		t.Fatal(err)
	}
	// POSIX-only assertion: NTFS reports a synthetic 0666 mode that drops the
	// executable bit even after a chmod 0755, so this check is meaningless on
	// Windows. The OpenFile with 0o755 is still exercised above.
	if goruntime.GOOS != "windows" && info.Mode().Perm()&0o111 == 0 {
		t.Errorf("binary not executable: %v", info.Mode())
	}
	versionData, err := os.ReadFile(filepath.Join(root, "version.json"))
	if err != nil {
		t.Fatalf("read version.json: %v", err)
	}
	var record struct {
		Version   string `json:"version"`
		AssetName string `json:"assetName"`
	}
	if err := json.Unmarshal(versionData, &record); err != nil {
		t.Fatalf("unmarshal version: %v", err)
	}
	if record.Version != "v3.0.0" || record.AssetName != "officecli_3.0.0_darwin_arm64.tar.gz" {
		t.Errorf("version record = %+v", record)
	}
	if _, err := os.Stat(filepath.Join(root, "tmp")); !os.IsNotExist(err) {
		t.Errorf("tmp directory should be cleaned up, got err=%v", err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(progressEvents) == 0 {
		t.Error("expected progress events")
	}
	var sawDownloading bool
	for _, e := range progressEvents {
		if e.Phase == types.RuntimePhaseDownloading && e.BytesDone != nil {
			sawDownloading = true
		}
	}
	if !sawDownloading {
		t.Error("expected at least one downloading progress event with BytesDone")
	}
	if !installedEvent {
		t.Error("expected installed event")
	}
}

func TestExtractOfficecliFromTarGz_MissingBinary(t *testing.T) {
	dir := t.TempDir()
	archive := makeTarGz(t, map[string][]byte{"README.md": []byte("only docs")})
	archivePath := filepath.Join(dir, "asset.tar.gz")
	if err := os.WriteFile(archivePath, archive, 0o644); err != nil {
		t.Fatal(err)
	}
	out := filepath.Join(dir, "officecli")
	if err := extractOfficecliFromTarGz(archivePath, out, "darwin"); err == nil {
		t.Fatal("expected error when archive lacks officecli")
	}
}

func TestExtractOfficecliFromTarGz_Windows(t *testing.T) {
	dir := t.TempDir()
	archive := makeTarGz(t, map[string][]byte{"officecli.exe": []byte("win-binary")})
	archivePath := filepath.Join(dir, "asset.tar.gz")
	if err := os.WriteFile(archivePath, archive, 0o644); err != nil {
		t.Fatal(err)
	}
	out := filepath.Join(dir, "officecli.exe")
	if err := extractOfficecliFromTarGz(archivePath, out, "win32"); err != nil {
		t.Fatalf("extract: %v", err)
	}
	got, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "win-binary" {
		t.Errorf("content = %q", got)
	}
}

func TestAssertManualBinaryAccessible_Missing(t *testing.T) {
	if err := AssertManualBinaryAccessible("/no/such/path/officecli", "darwin"); err == nil {
		t.Error("expected error for missing file")
	}
}

func TestAssertManualBinaryAccessible_NotExecutablePOSIX(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "officecli")
	if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := AssertManualBinaryAccessible(p, "darwin"); err == nil {
		t.Error("expected error for non-executable file on POSIX")
	}
}

func TestAssertManualBinaryAccessible_ExecutableOK(t *testing.T) {
	if goruntime.GOOS == "windows" {
		t.Skip("POSIX-only: NTFS does not honour chmod 0755, so the X_OK path cannot be exercised on Windows runners")
	}
	dir := t.TempDir()
	p := filepath.Join(dir, "officecli")
	if err := os.WriteFile(p, []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := AssertManualBinaryAccessible(p, "darwin"); err != nil {
		t.Errorf("executable file should pass: %v", err)
	}
}

func TestAssertManualBinaryAccessible_WindowsExistenceOnly(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "officecli.exe")
	if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := AssertManualBinaryAccessible(p, "win32"); err != nil {
		t.Errorf("windows should accept any file that exists: %v", err)
	}
}

func TestSetRepo(t *testing.T) {
	m := newTestManager(t, ManagerOptions{})
	m.SetRepo("other/repo")
	if m.repo != "other/repo" {
		t.Errorf("repo = %q", m.repo)
	}
}

func TestVersionAndManagedPaths(t *testing.T) {
	root := t.TempDir()
	m := newTestManager(t, ManagerOptions{InstallRoot: root, Platform: "win32"})
	wantBin := filepath.Join(root, "officecli.exe")
	if m.ManagedBinaryPath() != wantBin {
		t.Errorf("ManagedBinaryPath = %q, want %q", m.ManagedBinaryPath(), wantBin)
	}
	wantVer := filepath.Join(root, "version.json")
	if m.VersionFilePath() != wantVer {
		t.Errorf("VersionFilePath = %q, want %q", m.VersionFilePath(), wantVer)
	}
}
