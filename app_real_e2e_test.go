//go:build real_e2e

package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"officedex/internal/appupdate"
	"officedex/internal/bridge"
	"officedex/internal/demoflow"
	"officedex/internal/localstore"
	"officedex/internal/netproxy"
	"officedex/internal/preview"
	runtimemgr "officedex/internal/runtime"
	"officedex/internal/settings"
	"officedex/internal/types"
)

type realAppE2ERecord struct {
	Name       string `json:"name"`
	Operation  string `json:"operation"`
	Group      string `json:"group"`
	Detail     string `json:"detail,omitempty"`
	FilePath   string `json:"filePath,omitempty"`
	FileSize   int64  `json:"fileSize,omitempty"`
	DurationMS int64  `json:"durationMs"`
}

var realAppE2EReport = struct {
	mu      sync.Mutex
	records []realAppE2ERecord
}{}

func TestMain(m *testing.M) {
	code := m.Run()
	if path := os.Getenv("OFFICEDEX_REAL_E2E_APP_REPORT"); path != "" {
		_ = writeRealAppE2EReport(path, code)
	}
	os.Exit(code)
}

func TestRealOfficeDexAppBindings(t *testing.T) {
	app := newRealOfficeDexApp(t)
	reportServer := newRealReportServer(t)

	runRealAppStep(t, "shell-settings", "defaults, onboarding, proxy, runtime paths", func() (string, string) {
		got, err := app.GetSettings()
		if err != nil {
			t.Fatalf("GetSettings: %v", err)
		}
		if got.Defaults.DocumentType != types.DocPPTX {
			t.Fatalf("default document type = %q, want pptx", got.Defaults.DocumentType)
		}

		docType := types.DocDOCX
		enableImages := false
		onboardingAt := time.Now().UTC().Format(time.RFC3339)
		patch := settings.Patch{
			Defaults: &settings.GenerateDefaultsPatch{
				DocumentType: &docType,
				EnableImages: &enableImages,
			},
			OnboardingCompletedAt: &onboardingAt,
		}
		if proxy := strings.TrimSpace(os.Getenv("OFFICEDEX_E2E_PROXY")); proxy != "" {
			patch.Proxy = &types.ProxySettings{Enabled: true, URL: proxy}
		}
		updated, err := app.UpdateSettings(patch)
		if err != nil {
			t.Fatalf("UpdateSettings: %v", err)
		}
		if updated.Defaults.DocumentType != types.DocDOCX || updated.Defaults.EnableImages {
			t.Fatalf("updated defaults = %+v", updated.Defaults)
		}
		if updated.OnboardingCompletedAt == nil || *updated.OnboardingCompletedAt != onboardingAt {
			t.Fatalf("onboarding timestamp not persisted: %+v", updated.OnboardingCompletedAt)
		}
		return fmt.Sprintf("documentType=%s onboardingCompleted=true proxyConfigured=%t", updated.Defaults.DocumentType, updated.Proxy != nil && updated.Proxy.Enabled), ""
	})

	runRealAppStep(t, "login-account", "whoami and credit status", func() (string, string) {
		whoami, err := app.WhoAmI()
		if err != nil {
			t.Fatalf("WhoAmI: %v", err)
		}
		credit, err := app.GetCreditStatus()
		if err != nil {
			t.Fatalf("GetCreditStatus: %v", err)
		}
		if strings.TrimSpace(credit.Raw) == "" {
			t.Fatal("credit status raw output is empty")
		}
		return fmt.Sprintf("mode=%s access=%s plan=%s paidEntitlement=%t", whoami.Mode, credit.AccessMode, credit.PlanName, credit.PaidEntitlement), ""
	})

	runRealAppStep(t, "settings-provider", "official provider paid probe", func() (string, string) {
		result, err := app.TestProviderWithInput(types.ProviderTestInput{AllowPaidOfficialProbe: true})
		if err != nil {
			t.Fatalf("TestProviderWithInput: %v", err)
		}
		if !result.OK || result.ProbeType != "officialPaid" {
			t.Fatalf("official provider probe = %+v, want ok officialPaid", result)
		}
		return fmt.Sprintf("latencyMs=%d", result.LatencyMs), ""
	})

	runRealAppStep(t, "bridge-runtime", "initialize, capabilities, image templates, runtime snapshot", func() (string, string) {
		if _, err := app.Initialize(); err != nil {
			t.Fatalf("Initialize: %v", err)
		}
		caps, err := app.GetCapabilities()
		if err != nil {
			t.Fatalf("GetCapabilities: %v", err)
		}
		capsText := string(caps)
		for _, want := range []string{"office.generate", "office.modify", "pptx", "docx", "xlsx", "report", "img"} {
			if !strings.Contains(capsText, want) {
				t.Fatalf("capabilities missing %q: %s", want, truncateRealApp(capsText, 1024))
			}
		}
		templates, err := app.ListImageTemplates()
		if err != nil {
			t.Fatalf("ListImageTemplates: %v", err)
		}
		snapshot, err := app.GetBridgeRuntimeSnapshot()
		if err != nil {
			t.Fatalf("GetBridgeRuntimeSnapshot: %v", err)
		}
		if !snapshot.EnvApplied || snapshot.BinaryPath == "" {
			t.Fatalf("runtime snapshot not applied: %+v", snapshot)
		}
		return fmt.Sprintf("templates=%d runtime=%s binary=%s", len(templates), snapshot.RuntimeMode, snapshot.BinaryPath), ""
	})

	runRealAppStep(t, "workspace-documents", "workspace selection and document runs", func() (string, string) {
		projectDir := filepath.Join(realAppOutputRoot(t), "_app-project")
		if err := os.MkdirAll(projectDir, 0o755); err != nil {
			t.Fatalf("mkdir project: %v", err)
		}
		workspace, err := app.AddWorkspace(projectDir)
		if err != nil {
			t.Fatalf("AddWorkspace: %v", err)
		}
		if !workspace.Active {
			t.Fatalf("new workspace is not active: %+v", workspace)
		}
		if err := app.recordTaskWorkspaceContext("real-app-history-project-task", workspace.ID, "real-project-chat", "", "Real OfficeDex E2E project chat", false); err != nil {
			t.Fatalf("record project task context: %v", err)
		}
		workspaces, err := app.ListWorkspaces()
		if err != nil {
			t.Fatalf("ListWorkspaces: %v", err)
		}
		if len(workspaces) == 0 {
			t.Fatalf("ListWorkspaces returned no project: %+v", workspaces)
		}
		return fmt.Sprintf("workspace=%s", workspace.Path), ""
	})

	runRealAppStep(t, "artifacts-preview", "generated artifact preview token, bytes, html, revoke", func() (string, string) {
		artifactPath := realPreviewArtifactPath(t)
		if err := app.previewReg.SetTrustedRoots([]string{app.workspaceDir, filepath.Dir(artifactPath)}); err != nil {
			t.Fatalf("SetTrustedRoots for preview artifact: %v", err)
		}
		artifact := types.Artifact{
			TaskID:       "real-preview-task",
			FilePath:     artifactPath,
			FileName:     filepath.Base(artifactPath),
			DocumentType: realPreviewDocumentType(artifactPath),
		}

		oldCtx := app.ctx
		app.ctx = nil
		if err := app.PreviewArtifact(artifact); err != nil {
			app.ctx = oldCtx
			t.Fatalf("PreviewArtifact: %v", err)
		}
		app.ctx = oldCtx

		grant, err := app.IssuePreviewToken(artifact)
		if err != nil {
			t.Fatalf("IssuePreviewToken: %v", err)
		}
		file, err := app.ReadArtifactFile(grant.Token)
		if err != nil {
			t.Fatalf("ReadArtifactFile: %v", err)
		}
		if len(file.Data) == 0 {
			t.Fatal("ReadArtifactFile returned empty bytes")
		}
		app.RevokePreviewToken(grant.Token)
		if _, err := app.ReadArtifactFile(grant.Token); err == nil {
			t.Fatal("ReadArtifactFile succeeded after RevokePreviewToken")
		}
		return fmt.Sprintf("bytes=%d tokenRevoked=true", len(file.Data)), artifactPath
	})

	runRealAppStep(t, "artifacts-preview", "pasted image save and read", func() (string, string) {
		pngBase64 := "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
		path, err := app.SavePastedImage(PastedImageInput{DataBase64: pngBase64, Ext: "png"})
		if err != nil {
			t.Fatalf("SavePastedImage: %v", err)
		}
		image, err := app.ReadLocalImage(path)
		if err != nil {
			t.Fatalf("ReadLocalImage: %v", err)
		}
		if image.Mime != "image/png" || len(image.Data) == 0 {
			t.Fatalf("ReadLocalImage = mime %q, bytes %d", image.Mime, len(image.Data))
		}
		return fmt.Sprintf("mime=%s bytes=%d", image.Mime, len(image.Data)), path
	})

	runRealAppStep(t, "diagnostics-feedback", "export logs, report capability, submit report", func() (string, string) {
		taskID := "real-diagnostics-task"
		if err := app.localStore.RecordEvent(types.BridgeEvent{
			EventID:   "real-e2e-failed",
			TaskID:    taskID,
			RequestID: "req-real-e2e",
			Type:      "task.failed",
			TS:        time.Now().UTC().Format(time.RFC3339Nano),
			Payload: map[string]any{
				"error_code":    "real_e2e",
				"error_message": "Real E2E diagnostic failure fixture",
			},
		}); err != nil {
			t.Fatalf("RecordEvent failed: %v", err)
		}
		if cap := app.GetReportCapability(); cap.Enabled {
			t.Fatalf("report capability enabled before endpoint configuration: %+v", cap)
		}
		endpoint := reportServer.URL
		token := "real-e2e-token"
		if _, err := app.UpdateSettings(settings.Patch{SupportReportEndpoint: &endpoint, SupportReportToken: &token}); err != nil {
			t.Fatalf("UpdateSettings report endpoint: %v", err)
		}
		if cap := app.GetReportCapability(); !cap.Enabled {
			t.Fatalf("report capability disabled after endpoint configuration: %+v", cap)
		}
		peek, err := app.PeekReportContext(taskID)
		if err != nil {
			t.Fatalf("PeekReportContext: %v", err)
		}
		if peek.RequestID != "req-real-e2e" || peek.ErrorCode != "real_e2e" {
			t.Fatalf("PeekReportContext = %+v", peek)
		}
		submitted, err := app.SubmitReport(SubmitReportInput{
			TaskID:       taskID,
			Description:  "This is a real OfficeDex E2E issue report payload.",
			ContactEmail: "e2e@example.com",
		})
		if err != nil {
			t.Fatalf("SubmitReport: %v", err)
		}
		if !submitted.Uploaded || submitted.TicketID == "" {
			t.Fatalf("SubmitReport = %+v", submitted)
		}
		if got := reportServer.PayloadBytes(); got <= 0 || got > 4096 {
			t.Fatalf("report payload size = %d, want 1..4096", got)
		}
		restoreHome := setRealAppTemporaryHome(t)
		defer restoreHome()
		exported, err := app.ExportLogs(ExportLogsInput{TaskID: taskID, IncludeSettings: true, IncludeEvents: true, IncludeRecent: true, IncludeLogs: true})
		if err != nil {
			t.Fatalf("ExportLogs: %v", err)
		}
		if _, err := os.Stat(exported.Path); err != nil {
			t.Fatalf("diagnostics zip missing: %v", err)
		}
		if len(exported.Manifest.Items) == 0 {
			t.Fatal("diagnostics manifest is empty")
		}
		return fmt.Sprintf("manifestItems=%d reportBytes=%d", len(exported.Manifest.Items), reportServer.PayloadBytes()), exported.Path
	})

	runRealAppStep(t, "updates", "available, downloaded, error status", func() (string, string) {
		checked, err := app.CheckAppUpdate()
		if err != nil {
			t.Fatalf("CheckAppUpdate: %v", err)
		}
		if checked.Release == nil || !checked.Status.UpdateAvailable {
			t.Fatalf("CheckAppUpdate = %+v", checked)
		}
		downloaded, err := app.DownloadAppUpdate()
		if err != nil {
			t.Fatalf("DownloadAppUpdate: %v", err)
		}
		info, err := os.Stat(downloaded)
		if err != nil {
			t.Fatalf("downloaded update missing: %v", err)
		}
		errorMgr := newRealAppUpdateManager(t, filepath.Join(app.userDataDir, "updates-error"), appUpdateFixtureOptions{ManifestPath: "/manifest-error.json"})
		app.appUpdateMgr = errorMgr
		if _, err := app.CheckAppUpdate(); err == nil {
			t.Fatal("CheckAppUpdate error fixture returned nil error")
		}
		status := app.GetAppUpdateStatus()
		if status.LastError == nil || len(status.LastErrors) == 0 {
			t.Fatalf("app update error status missing: %+v", status)
		}
		return fmt.Sprintf("downloadedBytes=%d lastError=%s", info.Size(), *status.LastError), downloaded
	})

	runRealAppStep(t, "runtime", "runtime manager status", func() (string, string) {
		status := app.GetRuntimeStatus()
		return fmt.Sprintf("installed=%t updating=%t", status.Installed, status.Updating), ""
	})
}

func runRealAppStep(t *testing.T, group string, name string, fn func() (detail string, filePath string)) {
	t.Helper()
	start := time.Now()
	detail, filePath := fn()
	record := realAppE2ERecord{
		Name:       name,
		Operation:  group,
		Group:      group,
		Detail:     detail,
		FilePath:   filePath,
		DurationMS: time.Since(start).Milliseconds(),
	}
	if filePath != "" {
		if info, err := os.Stat(filePath); err == nil {
			record.FileSize = info.Size()
		}
	}
	recordRealAppE2E(record)
}

func newRealOfficeDexApp(t *testing.T) *App {
	t.Helper()
	if os.Getenv("OFFICEDEX_E2E_REAL") != "1" {
		t.Skip("OFFICEDEX_E2E_REAL=1 is required for real OfficeDex E2E")
	}
	seedRealE2EOfficeCLIAuth(t)
	// Keep every real E2E run's OfficeCLI subprocess isolated from the user's
	// global CLI home. Without this, stale sessions/jobs from earlier runs are
	// reattached by the bridge and appear as duplicate image generations.
	restoreHome := setRealAppTemporaryHome(t)
	t.Cleanup(restoreHome)

	binary := realAppBinary(t)
	root := filepath.Join(realAppOutputRoot(t), "_app")
	if err := os.RemoveAll(root); err != nil {
		t.Fatalf("reset app e2e root: %v", err)
	}
	home := filepath.Join(root, "home")
	userDataDir := filepath.Join(root, "user-data")
	workspaceDir := filepath.Join(root, "workspace")
	for _, dir := range []string{home, filepath.Join(home, "Downloads"), userDataDir, workspaceDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", dir, err)
		}
	}

	oldVersion := appVersion
	appVersion = "0.5.39"
	t.Cleanup(func() { appVersion = oldVersion })

	settingsStore := settings.New(filepath.Join(userDataDir, "settings.json"), nil)
	patch := settings.Patch{
		BridgeBinaryPath: &binary,
		WorkspaceDir:     &workspaceDir,
	}
	if proxy := strings.TrimSpace(os.Getenv("OFFICEDEX_E2E_PROXY")); proxy != "" {
		patch.Proxy = &types.ProxySettings{Enabled: true, URL: proxy}
	}
	cached, err := settingsStore.Update(patch)
	if err != nil {
		t.Fatalf("seed settings: %v", err)
	}

	localStore := localstore.New(filepath.Join(userDataDir, "officedex.sqlite"))
	ctx := context.Background()
	if err := localStore.Open(ctx); err != nil {
		t.Fatalf("open local store: %v", err)
	}
	t.Cleanup(func() { _ = localStore.Close() })

	previewReg, err := preview.New(preview.RegistryOptions{TrustedRoots: []string{workspaceDir}})
	if err != nil {
		t.Fatalf("preview registry: %v", err)
	}

	proxyPool := netproxy.NewPool()
	if cached.Proxy != nil && cached.Proxy.Enabled && cached.Proxy.URL != "" {
		if err := proxyPool.Set(cached.Proxy.URL); err != nil {
			t.Fatalf("proxy pool: %v", err)
		}
	}
	bridge.SetProxyEnvSupplier(proxyPool.SubprocessEnv)
	t.Cleanup(func() { bridge.SetProxyEnvSupplier(nil) })

	runtimeMgr, err := runtimemgr.New(runtimemgr.ManagerOptions{
		InstallRoot: filepath.Join(userDataDir, "runtime"),
		Repo:        "officecli/officecli-dist",
		FetchJSON: func(ctx context.Context, url string) ([]byte, error) {
			return []byte(`{"tag_name":"v0.2.117","assets":[]}`), nil
		},
		FetchDownload: func(ctx context.Context, url string) (*runtimemgr.FetchDownload, error) {
			return &runtimemgr.FetchDownload{Stream: io.NopCloser(strings.NewReader("")), Size: 0}, nil
		},
	})
	if err != nil {
		t.Fatalf("runtime manager: %v", err)
	}

	app := &App{
		ctx:            ctx,
		userDataDir:    userDataDir,
		workspaceDir:   workspaceDir,
		settingsStore:  settingsStore,
		localStore:     localStore,
		previewReg:     previewReg,
		cachedSettings: cached,
		proxyPool:      proxyPool,
		appUpdateMgr:   newRealAppUpdateManager(t, filepath.Join(userDataDir, "updates"), appUpdateFixtureOptions{ManifestPath: "/manifest.json"}),
		runtimeMgr:     runtimeMgr,
	}
	app.demoFlow = demoflow.New(demoflow.Options{Recorder: app})
	if err := app.initializeWorkspaces(ctx); err != nil {
		t.Fatalf("initializeWorkspaces: %v", err)
	}
	return app
}

// seedRealE2EOfficeCLIAuth carries the user's existing hosted session into the
// per-run isolated HOME. This keeps the E2E environment isolated without
// silently falling back to anonymous image quota.
func seedRealE2EOfficeCLIAuth(t *testing.T) {
	t.Helper()
	home := strings.TrimSpace(os.Getenv("HOME"))
	if home == "" {
		return
	}
	path := filepath.Join(home, "Library", "Application Support", "officecli", "config.json")
	body, err := os.ReadFile(path)
	if err != nil {
		return
	}
	var cfg struct {
		License struct {
			BaseURL      string `json:"base_url"`
			SessionToken string `json:"session_token"`
			UserID       uint64 `json:"user_id"`
		} `json:"license"`
	}
	if json.Unmarshal(body, &cfg) != nil || strings.TrimSpace(cfg.License.SessionToken) == "" {
		return
	}
	for key, value := range map[string]string{
		"OFFICE_CLI_SESSION_TOKEN":    cfg.License.SessionToken,
		"OFFICE_CLI_LICENSE_BASE_URL": strings.TrimSpace(cfg.License.BaseURL),
		"OFFICE_CLI_LICENSE_ENABLED":  "1",
		"OFFICE_CLI_RUNTIME_MODE":     "hosted",
	} {
		if value != "" {
			t.Setenv(key, value)
		}
	}
	if cfg.License.UserID != 0 {
		t.Setenv("OFFICE_CLI_LICENSE_USER_ID", fmt.Sprintf("%d", cfg.License.UserID))
	}
}

type appUpdateFixtureOptions struct {
	ManifestPath string
}

func newRealAppUpdateManager(t *testing.T, updatesDir string, opts appUpdateFixtureOptions) *appupdate.Manager {
	t.Helper()
	asset := []byte("OfficeDex real E2E update asset\n")
	sum := sha256.Sum256(asset)
	sha := hex.EncodeToString(sum[:])
	manifestPath := opts.ManifestPath
	if manifestPath == "" {
		manifestPath = "/manifest.json"
	}

	var server *httptest.Server
	mux := http.NewServeMux()
	mux.HandleFunc("/manifest.json", func(w http.ResponseWriter, r *http.Request) {
		key := runtime.GOOS + "-" + runtime.GOARCH
		body, _ := json.Marshal(map[string]any{
			"version":             "9.9.9",
			"notes":               "Real E2E local update fixture",
			"minSupportedVersion": "0.1.0",
			"mandatory":           false,
			"publishedAt":         time.Now().UTC().Format(time.RFC3339),
			"assets": map[string]any{
				key: map[string]any{
					"url":    server.URL + "/OfficeDex-real-e2e.bin",
					"sha256": sha,
					"size":   len(asset),
				},
			},
		})
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	})
	mux.HandleFunc("/manifest-error.json", func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "real e2e manifest failure", http.StatusInternalServerError)
	})
	mux.HandleFunc("/OfficeDex-real-e2e.bin", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Length", fmt.Sprintf("%d", len(asset)))
		_, _ = w.Write(asset)
	})
	server = httptest.NewServer(mux)
	t.Cleanup(server.Close)

	mgr, err := appupdate.New(appupdate.Options{
		ManifestURL:    server.URL + manifestPath,
		CurrentVersion: "0.5.39",
		UpdatesDir:     updatesDir,
		HTTPClient:     server.Client(),
	})
	if err != nil {
		t.Fatalf("appupdate manager: %v", err)
	}
	return mgr
}

type realReportServer struct {
	*httptest.Server
	mu           sync.Mutex
	payloadBytes int
}

func newRealReportServer(t *testing.T) *realReportServer {
	t.Helper()
	server := &realReportServer{}
	server.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		body, _ := io.ReadAll(io.LimitReader(r.Body, 8192))
		server.mu.Lock()
		server.payloadBytes = len(body)
		server.mu.Unlock()
		if !bytes.Contains(body, []byte("real OfficeDex E2E issue report")) && !bytes.Contains(body, []byte("real OfficeDex E2E")) {
			http.Error(w, "missing description", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ticketId":"real-e2e-ticket","viewUrl":"https://support.local/real-e2e-ticket"}`))
	}))
	t.Cleanup(server.Close)
	return server
}

func (s *realReportServer) PayloadBytes() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.payloadBytes
}

func realAppBinary(t *testing.T) string {
	t.Helper()
	binary := strings.TrimSpace(os.Getenv("OFFICECLI_DESKTOP_BINARY"))
	if binary == "" {
		t.Fatal("OFFICECLI_DESKTOP_BINARY is required for real OfficeDex E2E")
	}
	abs, err := filepath.Abs(binary)
	if err != nil {
		t.Fatalf("abs officecli binary: %v", err)
	}
	if info, err := os.Stat(abs); err != nil {
		t.Fatalf("officecli binary not accessible: %v", err)
	} else if info.IsDir() {
		t.Fatalf("OFFICECLI_DESKTOP_BINARY points to a directory: %s", abs)
	}
	return abs
}

func realAppOutputRoot(t *testing.T) string {
	t.Helper()
	root := strings.TrimSpace(os.Getenv("OFFICEDEX_E2E_OUTPUT_DIR"))
	if root == "" {
		root = filepath.Join("test-results", "real-e2e-artifacts")
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		t.Fatalf("abs output root: %v", err)
	}
	if err := os.MkdirAll(abs, 0o755); err != nil {
		t.Fatalf("mkdir output root: %v", err)
	}
	return abs
}

func realPreviewArtifactPath(t *testing.T) string {
	t.Helper()
	if p := strings.TrimSpace(os.Getenv("OFFICEDEX_E2E_PREVIEW_ARTIFACT")); p != "" {
		abs, err := filepath.Abs(p)
		if err != nil {
			t.Fatalf("abs preview artifact: %v", err)
		}
		if _, err := os.Stat(abs); err != nil {
			t.Fatalf("preview artifact missing: %v", err)
		}
		return abs
	}
	path, err := newestRealAppArtifact(realAppOutputRoot(t))
	if err != nil {
		t.Fatalf("preview artifact not provided and none found: %v", err)
	}
	return path
}

func newestRealAppArtifact(root string) (string, error) {
	var newest string
	var newestMod time.Time
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || strings.Contains(path, string(filepath.Separator)+"_app"+string(filepath.Separator)) {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		switch ext {
		case ".pptx", ".docx", ".xlsx", ".pdf", ".html", ".htm", ".png", ".jpg", ".jpeg", ".webp":
		default:
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		if newest == "" || info.ModTime().After(newestMod) {
			newest = path
			newestMod = info.ModTime()
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	if newest == "" {
		return "", fmt.Errorf("no previewable artifact under %s", root)
	}
	return newest, nil
}

func realPreviewDocumentType(path string) string {
	if value := strings.TrimSpace(os.Getenv("OFFICEDEX_E2E_PREVIEW_DOCUMENT_TYPE")); value != "" {
		return value
	}
	return strings.TrimPrefix(strings.ToLower(filepath.Ext(path)), ".")
}

func setRealAppTemporaryHome(t *testing.T) func() {
	t.Helper()
	home := filepath.Join(realAppOutputRoot(t), "_app", "home")
	if err := os.MkdirAll(filepath.Join(home, "Downloads"), 0o755); err != nil {
		t.Fatalf("mkdir temporary home downloads: %v", err)
	}
	oldHome, hadHome := os.LookupEnv("HOME")
	if err := os.Setenv("HOME", home); err != nil {
		t.Fatalf("set HOME: %v", err)
	}
	return func() {
		if hadHome {
			_ = os.Setenv("HOME", oldHome)
		} else {
			_ = os.Unsetenv("HOME")
		}
	}
}

func recordRealAppE2E(record realAppE2ERecord) {
	realAppE2EReport.mu.Lock()
	realAppE2EReport.records = append(realAppE2EReport.records, record)
	realAppE2EReport.mu.Unlock()
}

func writeRealAppE2EReport(path string, exitCode int) error {
	realAppE2EReport.mu.Lock()
	records := append([]realAppE2ERecord(nil), realAppE2EReport.records...)
	realAppE2EReport.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	body, err := json.MarshalIndent(map[string]any{
		"status":      statusFromRealAppExitCode(exitCode),
		"exitCode":    exitCode,
		"generatedAt": time.Now().Format(time.RFC3339),
		"records":     records,
	}, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(body, '\n'), 0o644)
}

func statusFromRealAppExitCode(code int) string {
	if code == 0 {
		return "passed"
	}
	return "failed"
}

func truncateRealApp(value string, n int) string {
	if len(value) <= n {
		return value
	}
	return strings.ReplaceAll(value[:n], "\n", " ") + "..."
}
