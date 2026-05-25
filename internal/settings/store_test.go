package settings

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"officedex/internal/types"
)

type recordingLogger struct {
	calls []string
}

func (r *recordingLogger) Warn(msg string, err error) {
	r.calls = append(r.calls, msg)
}

func ptr[T any](v T) *T { return &v }

func newTempStore(t *testing.T) (*Store, string, *recordingLogger) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	logger := &recordingLogger{}
	return New(path, logger), path, logger
}

func TestLoadMissingFileReturnsDefaults(t *testing.T) {
	store, _, logger := newTempStore(t)
	got, err := store.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	want := Defaults()
	if got.Version != want.Version {
		t.Errorf("Version = %d, want %d", got.Version, want.Version)
	}
	if got.Defaults != want.Defaults {
		t.Errorf("Defaults = %+v, want %+v", got.Defaults, want.Defaults)
	}
	if got.OutputDir != nil || got.BridgeBinaryPath != nil || got.LlmProvider != nil || got.OnboardingCompletedAt != nil {
		t.Errorf("expected nil pointer fields, got %+v", got)
	}
	if len(logger.calls) != 0 {
		t.Errorf("expected no warnings for missing file, got %v", logger.calls)
	}
}

func TestLoadInvalidJSONFallsBackAndWarns(t *testing.T) {
	store, path, logger := newTempStore(t)
	if err := os.WriteFile(path, []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := store.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got.Defaults.DocumentType != types.DocPPTX {
		t.Errorf("expected default doc type, got %v", got.Defaults.DocumentType)
	}
	if len(logger.calls) == 0 {
		t.Errorf("expected warning, got none")
	}
}

func TestLoadUnknownEnumFallsBack(t *testing.T) {
	store, path, _ := newTempStore(t)
	raw := map[string]any{
		"version": 1,
		"defaults": map[string]any{
			"documentType": "no-such-doc",
			"mode":         "experimental",
			"runtimeMode":  "remote",
			"enableImages": false,
			"imageQuality": "ultra",
		},
	}
	body, _ := json.Marshal(raw)
	if err := os.WriteFile(path, body, 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := store.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got.Defaults.DocumentType != types.DocPPTX {
		t.Errorf("DocumentType = %v, want pptx", got.Defaults.DocumentType)
	}
	if got.Defaults.Mode != types.ModeFast {
		t.Errorf("Mode = %v, want fast", got.Defaults.Mode)
	}
	if got.Defaults.RuntimeMode != types.RuntimeHosted {
		t.Errorf("RuntimeMode = %v, want hosted", got.Defaults.RuntimeMode)
	}
	if got.Defaults.EnableImages {
		t.Errorf("EnableImages should preserve explicit false")
	}
	if got.Defaults.ImageQuality != types.ImageStandard {
		t.Errorf("ImageQuality = %v, want standard", got.Defaults.ImageQuality)
	}
}

func TestUpdatePersistsAndSanitizes(t *testing.T) {
	store, path, _ := newTempStore(t)
	got, err := store.Update(Patch{
		Defaults: &GenerateDefaultsPatch{
			DocumentType: ptr(types.DocDOCX),
			Mode:         ptr(types.ModeBest),
			EnableImages: ptr(false),
		},
		OutputDir: ptr("  /Users/lu/Documents  "),
		LlmProvider: &types.LlmProvider{
			Type:    types.LlmAnthropic,
			BaseURL: "https://api.anthropic.com",
			APIKey:  "sk-abc",
			Model:   "claude-sonnet-4-6",
		},
	})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if got.Defaults.DocumentType != types.DocDOCX {
		t.Errorf("DocumentType = %v, want docx", got.Defaults.DocumentType)
	}
	if got.Defaults.Mode != types.ModeBest {
		t.Errorf("Mode = %v, want best", got.Defaults.Mode)
	}
	if got.Defaults.EnableImages {
		t.Errorf("EnableImages should be false")
	}
	if got.OutputDir == nil || *got.OutputDir != "/Users/lu/Documents" {
		t.Errorf("OutputDir = %v, want trimmed path", got.OutputDir)
	}
	if got.LlmProvider == nil || got.LlmProvider.Type != types.LlmAnthropic {
		t.Errorf("LlmProvider = %+v", got.LlmProvider)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	var roundtrip types.UserSettings
	if err := json.Unmarshal(data, &roundtrip); err != nil {
		t.Fatalf("roundtrip unmarshal: %v", err)
	}
	if roundtrip.Defaults.DocumentType != types.DocDOCX {
		t.Errorf("persisted DocumentType = %v, want docx", roundtrip.Defaults.DocumentType)
	}
}

func TestUpdateLeavesUnsetFieldsUnchanged(t *testing.T) {
	store, _, _ := newTempStore(t)
	if _, err := store.Update(Patch{
		Defaults: &GenerateDefaultsPatch{DocumentType: ptr(types.DocXLSX)},
	}); err != nil {
		t.Fatalf("first update: %v", err)
	}
	got, err := store.Update(Patch{
		Defaults: &GenerateDefaultsPatch{Mode: ptr(types.ModeBest)},
	})
	if err != nil {
		t.Fatalf("second update: %v", err)
	}
	if got.Defaults.DocumentType != types.DocXLSX {
		t.Errorf("DocumentType lost, got %v", got.Defaults.DocumentType)
	}
	if got.Defaults.Mode != types.ModeBest {
		t.Errorf("Mode = %v, want best", got.Defaults.Mode)
	}
}

func TestUpdateClearsLlmProvider(t *testing.T) {
	store, _, _ := newTempStore(t)
	if _, err := store.Update(Patch{
		LlmProvider: &types.LlmProvider{
			Type:    types.LlmOpenAI,
			BaseURL: "https://api.openai.com",
			APIKey:  "sk-x",
			Model:   "gpt-4",
		},
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}
	got, err := store.Update(Patch{ClearLlmProvider: true})
	if err != nil {
		t.Fatalf("clear: %v", err)
	}
	if got.LlmProvider != nil {
		t.Errorf("LlmProvider = %+v, want nil after clear", got.LlmProvider)
	}
}

func TestProviderWithAllEmptyFieldsBecomesNil(t *testing.T) {
	store, path, _ := newTempStore(t)
	raw := map[string]any{
		"version":     1,
		"defaults":    map[string]any{},
		"llmProvider": map[string]any{"type": "openai", "baseUrl": "", "apiKey": "", "model": ""},
	}
	body, _ := json.Marshal(raw)
	if err := os.WriteFile(path, body, 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := store.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got.LlmProvider != nil {
		t.Errorf("LlmProvider = %+v, want nil for all-empty provider", got.LlmProvider)
	}
}

func TestProviderUnknownTypeFallsBackToOpenAI(t *testing.T) {
	store, path, _ := newTempStore(t)
	raw := map[string]any{
		"llmProvider": map[string]any{
			"type":    "gemini",
			"baseUrl": "https://example.com",
			"apiKey":  "k",
			"model":   "m",
		},
	}
	body, _ := json.Marshal(raw)
	if err := os.WriteFile(path, body, 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := store.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got.LlmProvider == nil {
		t.Fatalf("expected non-nil provider")
	}
	if got.LlmProvider.Type != types.LlmOpenAI {
		t.Errorf("provider type = %v, want fallback to openai", got.LlmProvider.Type)
	}
}

func TestReloadDiscardsCache(t *testing.T) {
	store, path, _ := newTempStore(t)
	if _, err := store.Load(); err != nil {
		t.Fatalf("first load: %v", err)
	}
	raw := map[string]any{
		"defaults": map[string]any{"documentType": "docx"},
	}
	body, _ := json.Marshal(raw)
	if err := os.WriteFile(path, body, 0o644); err != nil {
		t.Fatal(err)
	}
	cached, _ := store.Load()
	if cached.Defaults.DocumentType != types.DocPPTX {
		t.Errorf("expected cached default, got %v", cached.Defaults.DocumentType)
	}
	got, err := store.Reload()
	if err != nil {
		t.Fatalf("Reload: %v", err)
	}
	if got.Defaults.DocumentType != types.DocDOCX {
		t.Errorf("Reload returned %v, want docx", got.Defaults.DocumentType)
	}
}

func TestAtomicWriteCleansUpTmp(t *testing.T) {
	store, path, _ := newTempStore(t)
	if _, err := store.Update(Patch{OutputDir: ptr("/tmp")}); err != nil {
		t.Fatalf("Update: %v", err)
	}
	if _, err := os.Stat(path + ".tmp"); !os.IsNotExist(err) {
		t.Errorf("expected .tmp removed, stat err = %v", err)
	}
}

func TestProxyRoundTrip(t *testing.T) {
	store, path, _ := newTempStore(t)
	patch := Patch{Proxy: &types.ProxySettings{Enabled: true, URL: "http://127.0.0.1:7890"}}
	got, err := store.Update(patch)
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if got.Proxy == nil || !got.Proxy.Enabled || got.Proxy.URL != "http://127.0.0.1:7890" {
		t.Fatalf("Proxy = %+v, want enabled + url", got.Proxy)
	}

	// Read back from disk via a fresh store to confirm persistence + sanitize.
	logger := &recordingLogger{}
	fresh := New(path, logger)
	reloaded, err := fresh.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if reloaded.Proxy == nil || reloaded.Proxy.URL != "http://127.0.0.1:7890" {
		t.Fatalf("reloaded Proxy = %+v", reloaded.Proxy)
	}
}

func TestProxyInvalidSchemeIsDropped(t *testing.T) {
	store, path, logger := newTempStore(t)
	raw := map[string]any{
		"version":  1,
		"defaults": map[string]any{},
		"proxy":    map[string]any{"enabled": true, "url": "ftp://nope:21"},
	}
	body, _ := json.Marshal(raw)
	if err := os.WriteFile(path, body, 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	got, err := store.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got.Proxy != nil {
		t.Errorf("Proxy = %+v, want nil (invalid scheme dropped)", got.Proxy)
	}
	if len(logger.calls) != 0 {
		// The store currently only warns for top-level JSON errors; proxy
		// rejection is silent. If that ever changes, the assertion lives here.
		t.Logf("logger calls: %v", logger.calls)
	}
}

func TestProxyClearRemovesValue(t *testing.T) {
	store, _, _ := newTempStore(t)
	if _, err := store.Update(Patch{Proxy: &types.ProxySettings{Enabled: true, URL: "http://h:1"}}); err != nil {
		t.Fatalf("seed: %v", err)
	}
	got, err := store.Update(Patch{ClearProxy: true})
	if err != nil {
		t.Fatalf("clear: %v", err)
	}
	if got.Proxy != nil {
		t.Errorf("Proxy = %+v, want nil after clear", got.Proxy)
	}
}

func TestProxyEnabledWithoutURLDropped(t *testing.T) {
	store, _, _ := newTempStore(t)
	got, err := store.Update(Patch{Proxy: &types.ProxySettings{Enabled: true, URL: "   "}})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if got.Proxy != nil {
		t.Errorf("Proxy = %+v, want nil (enabled but empty URL is meaningless)", got.Proxy)
	}
}
