package main

import (
	"path/filepath"
	"testing"
	"time"

	"officedex/internal/netproxy"
	"officedex/internal/types"
)

func TestProviderSnapshotFromEnv(t *testing.T) {
	t.Run("hosted-mode-env-has-no-provider-keys", func(t *testing.T) {
		got := providerSnapshotFromEnv([]string{"OFFICE_CLI_RUNTIME_MODE=hosted"})
		if got != nil {
			t.Fatalf("expected nil for env without OFFICECLI_LLM_*, got %+v", got)
		}
	})

	t.Run("full-custom-env", func(t *testing.T) {
		env := []string{
			"OFFICE_CLI_RUNTIME_MODE=custom",
			"OFFICECLI_LLM_PROVIDER=openai",
			"OFFICECLI_LLM_BASE_URL=https://api.openai.com/v1",
			"OFFICECLI_LLM_API_KEY=sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD",
			"OFFICECLI_LLM_MODEL=gpt-4o-mini",
		}
		got := providerSnapshotFromEnv(env)
		if got == nil {
			t.Fatal("expected non-nil snapshot")
		}
		if got.Type != types.LlmOpenAI {
			t.Errorf("Type = %q, want openai", got.Type)
		}
		if got.BaseURLHost != "https://api.openai.com" {
			t.Errorf("BaseURLHost = %q, want https://api.openai.com", got.BaseURLHost)
		}
		if got.Model != "gpt-4o-mini" {
			t.Errorf("Model = %q, want gpt-4o-mini", got.Model)
		}
		if got.APIKeyMasked == "sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD" {
			t.Errorf("APIKeyMasked leaked raw value")
		}
		if got.APIKeyLength != 43 {
			t.Errorf("APIKeyLength = %d, want 43", got.APIKeyLength)
		}
	})

	t.Run("partial-env-still-returns-snapshot", func(t *testing.T) {
		env := []string{"OFFICECLI_LLM_PROVIDER=anthropic"}
		got := providerSnapshotFromEnv(env)
		if got == nil || got.Type != types.LlmAnthropic {
			t.Fatalf("expected anthropic snapshot, got %+v", got)
		}
		if got.Model != "" || got.APIKeyMasked != "" || got.BaseURLHost != "" {
			t.Errorf("unset fields should be empty, got %+v", got)
		}
	})
}

func TestFindBundledBinaryPathFindsWindowsSiblingRuntime(t *testing.T) {
	exePath := filepath.Join("C:", "Users", "test", "AppData", "Local", "Programs", "OfficeDex", "OfficeDex.exe")
	want := filepath.Join("C:", "Users", "test", "AppData", "Local", "Programs", "OfficeDex", "officecli", "officecli.exe")

	got := findBundledBinaryPath("windows", exePath, "", func(path string) bool {
		return path == want
	})

	if got != want {
		t.Fatalf("findBundledBinaryPath = %q, want %q", got, want)
	}
}

func TestGetBridgeRuntimeSnapshot(t *testing.T) {
	t.Run("pre-spawn-hosted", func(t *testing.T) {
		a := &App{
			proxyPool:      netproxy.NewPool(),
			cachedSettings: types.UserSettings{
				// No LlmProvider → official (hosted) mode
			},
		}
		snap, err := a.GetBridgeRuntimeSnapshot()
		if err != nil {
			t.Fatalf("GetBridgeRuntimeSnapshot: %v", err)
		}
		if snap.EnvApplied {
			t.Errorf("expected EnvApplied=false pre-spawn")
		}
		if snap.Provider != nil {
			t.Errorf("expected Provider=nil for official mode")
		}
		if snap.RuntimeMode != types.RuntimeHosted {
			t.Errorf("RuntimeMode = %q, want hosted", snap.RuntimeMode)
		}
	})

	t.Run("post-spawn-custom", func(t *testing.T) {
		now := time.Now()
		a := &App{
			proxyPool: netproxy.NewPool(),
			cachedSettings: types.UserSettings{
				LlmProvider: &types.LlmProvider{
					Type: types.LlmAnthropic,
				},
			},
			resolvedBinaryPath: "/tmp/officecli",
			resolvedBinaryEnv: []string{
				"OFFICE_CLI_RUNTIME_MODE=custom",
				"OFFICECLI_LLM_PROVIDER=anthropic",
				"OFFICECLI_LLM_BASE_URL=https://api.anthropic.com",
				"OFFICECLI_LLM_API_KEY=sk-ant-livekey-1234567890abcdef",
				"OFFICECLI_LLM_MODEL=claude-sonnet-4-6",
			},
			binaryResolvedAt: now,
		}
		snap, err := a.GetBridgeRuntimeSnapshot()
		if err != nil {
			t.Fatalf("GetBridgeRuntimeSnapshot: %v", err)
		}
		if !snap.EnvApplied {
			t.Errorf("expected EnvApplied=true")
		}
		if snap.BinaryPath != "/tmp/officecli" {
			t.Errorf("BinaryPath = %q", snap.BinaryPath)
		}
		if snap.ResolvedAt == "" {
			t.Errorf("ResolvedAt unset")
		}
		if snap.Provider == nil {
			t.Fatalf("Provider unset for custom mode")
		}
		if snap.Provider.Type != types.LlmAnthropic {
			t.Errorf("Provider.Type = %q", snap.Provider.Type)
		}
		if snap.Provider.APIKeyMasked == "" || snap.Provider.APIKeyMasked == "sk-ant-livekey-1234567890abcdef" {
			t.Errorf("APIKeyMasked = %q (leaked or empty)", snap.Provider.APIKeyMasked)
		}
	})

	t.Run("post-spawn-hosted-has-no-provider", func(t *testing.T) {
		a := &App{
			proxyPool:      netproxy.NewPool(),
			cachedSettings: types.UserSettings{
				// No LlmProvider → official (hosted) mode
			},
			resolvedBinaryPath: "/tmp/officecli",
			resolvedBinaryEnv:  []string{"OFFICE_CLI_RUNTIME_MODE=hosted"},
			binaryResolvedAt:   time.Now(),
		}
		snap, err := a.GetBridgeRuntimeSnapshot()
		if err != nil {
			t.Fatalf("GetBridgeRuntimeSnapshot: %v", err)
		}
		if !snap.EnvApplied {
			t.Errorf("expected EnvApplied=true after spawn")
		}
		if snap.Provider != nil {
			t.Errorf("expected Provider=nil for hosted mode, got %+v", snap.Provider)
		}
	})

	t.Run("proxy-host-masked", func(t *testing.T) {
		pool := netproxy.NewPool()
		if err := pool.Set("http://user:pass@127.0.0.1:7890"); err != nil {
			t.Fatalf("pool.Set: %v", err)
		}
		a := &App{proxyPool: pool, cachedSettings: types.UserSettings{}}
		snap, err := a.GetBridgeRuntimeSnapshot()
		if err != nil {
			t.Fatalf("GetBridgeRuntimeSnapshot: %v", err)
		}
		if snap.ProxyHost != "http://127.0.0.1:7890" {
			t.Errorf("ProxyHost = %q, want http://127.0.0.1:7890", snap.ProxyHost)
		}
	})
}

func TestCurrentRuntimeModeLockedUsesCachedSettingsUnderAppLock(t *testing.T) {
	a := &App{}

	a.mu.Lock()
	if got := a.currentRuntimeModeLocked(); got != types.RuntimeHosted {
		t.Errorf("hosted mode = %q, want %q", got, types.RuntimeHosted)
	}
	a.cachedSettings.LlmProvider = &types.LlmProvider{Type: types.LlmOpenAI}
	if got := a.currentRuntimeModeLocked(); got != types.RuntimeCustom {
		t.Errorf("custom mode = %q, want %q", got, types.RuntimeCustom)
	}
	a.mu.Unlock()
}

func TestValidateCustomProvider(t *testing.T) {
	cases := []struct {
		name    string
		input   types.UserSettings
		wantErr string
	}{
		{
			name:  "hosted-mode-skips-check",
			input: types.UserSettings{
				// No LlmProvider → official (hosted) mode → skip check
			},
		},
		{
			name: "custom-without-provider-blocks",
			input: types.UserSettings{
				LlmProvider: &types.LlmProvider{
					Type: types.LlmOpenAI, APIKey: "sk-x", Model: "gpt-4",
					// BaseURL is missing
				},
			},
			wantErr: "generate.custom_provider_incomplete",
		},
		{
			name: "custom-missing-base-url-blocks",
			input: types.UserSettings{
				LlmProvider: &types.LlmProvider{
					Type: types.LlmOpenAI, APIKey: "sk-x", Model: "gpt-4",
				},
			},
			wantErr: "generate.custom_provider_incomplete",
		},
		{
			name: "custom-missing-api-key-blocks",
			input: types.UserSettings{
				LlmProvider: &types.LlmProvider{
					Type: types.LlmOpenAI, BaseURL: "https://api.openai.com/v1", Model: "gpt-4",
				},
			},
			wantErr: "generate.custom_provider_incomplete",
		},
		{
			name: "custom-missing-model-blocks",
			input: types.UserSettings{
				LlmProvider: &types.LlmProvider{
					Type: types.LlmOpenAI, BaseURL: "https://api.openai.com/v1", APIKey: "sk-x",
				},
			},
			wantErr: "generate.custom_provider_incomplete",
		},
		{
			name: "custom-whitespace-counts-as-missing",
			input: types.UserSettings{
				LlmProvider: &types.LlmProvider{
					Type: types.LlmOpenAI, BaseURL: "   ", APIKey: "sk-x", Model: "gpt-4",
				},
			},
			wantErr: "generate.custom_provider_incomplete",
		},
		{
			name: "custom-fully-configured-passes",
			input: types.UserSettings{
				LlmProvider: &types.LlmProvider{
					Type: types.LlmOpenAI, BaseURL: "https://api.openai.com/v1", APIKey: "sk-x", Model: "gpt-4",
				},
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateCustomProvider(tc.input)
			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("expected nil, got %v", err)
				}
				return
			}
			if err == nil || err.Error() != tc.wantErr {
				t.Fatalf("err = %v, want %q", err, tc.wantErr)
			}
		})
	}
}
