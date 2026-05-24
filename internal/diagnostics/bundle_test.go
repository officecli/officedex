package diagnostics

import (
	"archive/zip"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"officedex/internal/types"
)

type mockQuerier struct {
	taskEvents  map[string][]types.BridgeEvent
	recentEvents []types.BridgeEvent
}

func (m *mockQuerier) QueryEventsByTask(_ context.Context, taskID string) ([]types.BridgeEvent, error) {
	return m.taskEvents[taskID], nil
}

func (m *mockQuerier) QueryRecentEvents(_ context.Context, limit int) ([]types.BridgeEvent, error) {
	if limit >= len(m.recentEvents) {
		return m.recentEvents, nil
	}
	return m.recentEvents[:limit], nil
}

func TestBuildBundleBasic(t *testing.T) {
	destDir := t.TempDir()
	userDataDir := t.TempDir()

	_ = os.WriteFile(filepath.Join(userDataDir, "settings.json"), []byte(`{
		"version": 1,
		"llmProvider": {"apiKey": "test-key-123", "baseUrl": "https://api.test.com"}
	}`), 0o644)

	logsDir := filepath.Join(userDataDir, "logs")
	_ = os.MkdirAll(logsDir, 0o755)
	_ = os.WriteFile(filepath.Join(logsDir, "bridge-20240301.log"), []byte("log line 1\nlog line 2\n"), 0o644)

	querier := &mockQuerier{
		taskEvents: map[string][]types.BridgeEvent{
			"task-1": {
				{EventID: "e1", TaskID: "task-1", Type: "task.started", Payload: map[string]any{"topic": "test"}},
				{EventID: "e2", TaskID: "task-1", Type: "task.completed"},
			},
		},
		recentEvents: []types.BridgeEvent{
			{EventID: "r1", TaskID: "task-1", Type: "task.started"},
			{EventID: "r2", TaskID: "task-2", Type: "task.progress"},
		},
	}

	now := time.Date(2024, 3, 2, 12, 0, 0, 0, time.UTC)
	zipPath, manifest, err := BuildBundle(context.Background(), BundleOptions{
		DestDir:         destDir,
		UserDataDir:     userDataDir,
		LocalStore:      querier,
		Settings:        types.UserSettings{LlmProvider: &types.LlmProvider{APIKey: "test-key-123", BaseURL: "https://api.test.com"}},
		TaskID:          "task-1",
		IncludeSettings: true,
		IncludeEvents:   true,
		IncludeRecent:   true,
		IncludeLogs:     true,
		AppVersion:      "1.0.0",
		BundleID:        "test-bundle-id-123",
		Now:           func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("BuildBundle: %v", err)
	}

	if _, err := os.Stat(zipPath); err != nil {
		t.Fatalf("zip not found at %s: %v", zipPath, err)
	}

	if !strings.Contains(filepath.Base(zipPath), "officedex-logs-") {
		t.Errorf("unexpected zip name: %s", filepath.Base(zipPath))
	}

	if manifest.SchemaVersion != 1 {
		t.Errorf("schema version = %d, want 1", manifest.SchemaVersion)
	}
	if manifest.BundleID != "test-bundle-id-123" {
		t.Errorf("bundle id = %q", manifest.BundleID)
	}

	sectionIDs := make(map[string]bool)
	pathSet := make(map[string]bool)
	for _, item := range manifest.Items {
		sectionIDs[item.SectionID] = true
		pathSet[item.Path] = true
	}

	for _, expected := range []string{"meta", "settings", "events", "logs"} {
		if !sectionIDs[expected] {
			t.Errorf("missing section %q in manifest", expected)
		}
	}
	if !pathSet["events/task-task-1.jsonl"] {
		t.Error("missing events/task-task-1.jsonl")
	}
	if !pathSet["events/recent.jsonl"] {
		t.Error("missing events/recent.jsonl")
	}

	r, err := zip.OpenReader(zipPath)
	if err != nil {
		t.Fatalf("open zip: %v", err)
	}
	defer r.Close()

	zipFiles := make(map[string]bool)
	for _, f := range r.File {
		zipFiles[f.Name] = true
	}
	for _, expected := range []string{"meta.json", "settings.scrubbed.json"} {
		if !zipFiles[expected] {
			t.Errorf("missing %s in zip", expected)
		}
	}
}

func TestBuildBundleSettingsScrubbed(t *testing.T) {
	destDir := t.TempDir()
	userDataDir := t.TempDir()

	apiKey := "real-secret-api-key-value"
	baseURL := "https://secret-api.example.com/v1"
	_ = os.WriteFile(filepath.Join(userDataDir, "settings.json"), []byte(`{
		"version": 1,
		"llmProvider": {"apiKey": "`+apiKey+`", "baseUrl": "`+baseURL+`"}
	}`), 0o644)

	zipPath, _, err := BuildBundle(context.Background(), BundleOptions{
		DestDir:     destDir,
		UserDataDir: userDataDir,
		Settings: types.UserSettings{LlmProvider: &types.LlmProvider{
			APIKey:  apiKey,
			BaseURL: baseURL,
		}},
		BundleID: "scrub-test",
		Now:      func() time.Time { return time.Now() },
	})
	if err != nil {
		t.Fatalf("BuildBundle: %v", err)
	}

	r, err := zip.OpenReader(zipPath)
	if err != nil {
		t.Fatalf("open zip: %v", err)
	}
	defer r.Close()

	for _, f := range r.File {
		rc, _ := f.Open()
		buf := make([]byte, f.UncompressedSize64+1)
		n, _ := rc.Read(buf)
		rc.Close()
		content := string(buf[:n])
		if strings.Contains(content, apiKey) {
			t.Errorf("file %s contains literal API key", f.Name)
		}
		if strings.Contains(content, baseURL) {
			t.Errorf("file %s contains literal base URL", f.Name)
		}
	}
}

func TestBuildBundleTruncation(t *testing.T) {
	destDir := t.TempDir()
	userDataDir := t.TempDir()

	_ = os.WriteFile(filepath.Join(userDataDir, "settings.json"), []byte(`{}`), 0o644)

	logsDir := filepath.Join(userDataDir, "logs")
	_ = os.MkdirAll(logsDir, 0o755)

	bigLog := make([]byte, 12*1024*1024) // 12MB
	for i := range bigLog {
		bigLog[i] = byte('A' + (i % 26))
	}
	_ = os.WriteFile(filepath.Join(logsDir, "bridge-20240301.log"), bigLog, 0o644)

	now := time.Date(2024, 3, 2, 12, 0, 0, 0, time.UTC)
	_, manifest, err := BuildBundle(context.Background(), BundleOptions{
		DestDir:     destDir,
		UserDataDir: userDataDir,
		Settings:    types.UserSettings{},
		IncludeLogs: true,
		BundleID:    "truncate-test",
		Now:         func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("BuildBundle: %v", err)
	}

	if !manifest.Truncated {
		t.Error("expected manifest.Truncated=true for 12MB log")
	}
}

func TestBuildBundleMetaJSON(t *testing.T) {
	destDir := t.TempDir()
	userDataDir := t.TempDir()
	_ = os.WriteFile(filepath.Join(userDataDir, "settings.json"), []byte(`{}`), 0o644)

	now := time.Date(2024, 6, 15, 10, 30, 0, 0, time.UTC)
	zipPath, _, err := BuildBundle(context.Background(), BundleOptions{
		DestDir:             destDir,
		UserDataDir:         userDataDir,
		Settings:            types.UserSettings{},
		BundleID:            "meta-test",
		AppVersion:          "2.0.0",
		TaskID:              "task-42",
		RuntimeDroppedBytes: 1024,
		Now:                 func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("BuildBundle: %v", err)
	}

	r, err := zip.OpenReader(zipPath)
	if err != nil {
		t.Fatalf("open zip: %v", err)
	}
	defer r.Close()

	for _, f := range r.File {
		if f.Name != "meta.json" {
			continue
		}
		rc, _ := f.Open()
		var meta map[string]any
		_ = json.NewDecoder(rc).Decode(&meta)
		rc.Close()

		if meta["appVersion"] != "2.0.0" {
			t.Errorf("appVersion = %v", meta["appVersion"])
		}
		if meta["bundleId"] != "meta-test" {
			t.Errorf("bundleId = %v", meta["bundleId"])
		}
		if meta["taskId"] != "task-42" {
			t.Errorf("taskId = %v", meta["taskId"])
		}
		if v, ok := meta["runtimeDroppedBytes"].(float64); !ok || v != 1024 {
			t.Errorf("runtimeDroppedBytes = %v", meta["runtimeDroppedBytes"])
		}
		if meta["bundleSchemaVersion"] != float64(1) {
			t.Errorf("bundleSchemaVersion = %v", meta["bundleSchemaVersion"])
		}
	}
}

func TestBuildBundleSizeExclusion(t *testing.T) {
	destDir := t.TempDir()
	userDataDir := t.TempDir()
	_ = os.WriteFile(filepath.Join(userDataDir, "settings.json"), []byte(`{}`), 0o644)

	logsDir := filepath.Join(userDataDir, "logs")
	_ = os.MkdirAll(logsDir, 0o755)

	bigLog := make([]byte, 9*1024*1024) // 9MB each, 3 files = 27MB > 25MB
	for i := range bigLog {
		bigLog[i] = byte('A' + (i % 26))
	}
	_ = os.WriteFile(filepath.Join(logsDir, "bridge-20240301.log"), bigLog, 0o644)
	_ = os.WriteFile(filepath.Join(logsDir, "bridge-20240302.log"), bigLog, 0o644)
	_ = os.WriteFile(filepath.Join(logsDir, "bridge-20240303.log"), bigLog, 0o644)

	bigRecent := make([]types.BridgeEvent, 200)
	for i := range bigRecent {
		payload := map[string]any{"data": strings.Repeat("x", 1024)}
		bigRecent[i] = types.BridgeEvent{EventID: fmt.Sprintf("r%d", i), Type: "task.progress", Payload: payload}
	}

	now := time.Date(2024, 3, 4, 12, 0, 0, 0, time.UTC)
	_, manifest, err := BuildBundle(context.Background(), BundleOptions{
		DestDir:       destDir,
		UserDataDir:   userDataDir,
		LocalStore:    &mockQuerier{recentEvents: bigRecent},
		Settings:      types.UserSettings{},
		IncludeRecent: true,
		IncludeLogs:   true,
		BundleID:      "size-test",
		Now:           func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("BuildBundle: %v", err)
	}

	if len(manifest.ExcludedReasons) == 0 {
		t.Error("expected ExcludedReasons to be populated when total > 25MB")
	}

	for _, item := range manifest.Items {
		if item.Path == "events/recent.jsonl" {
			t.Error("recent.jsonl should be excluded when total > 25MB")
		}
	}
}
