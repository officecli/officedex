package main

import (
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

	t.Run("full-external-env", func(t *testing.T) {
		env := []string{
			"OFFICE_CLI_RUNTIME_MODE=external",
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

func TestGetBridgeRuntimeSnapshot(t *testing.T) {
	t.Run("pre-spawn-hosted", func(t *testing.T) {
		a := &App{
			proxyPool: netproxy.NewPool(),
			cachedSettings: types.UserSettings{
				Defaults: types.GenerateDefaults{RuntimeMode: types.RuntimeHosted},
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
			t.Errorf("expected Provider=nil for hosted mode")
		}
		if snap.RuntimeMode != types.RuntimeHosted {
			t.Errorf("RuntimeMode = %q, want hosted", snap.RuntimeMode)
		}
	})

	t.Run("post-spawn-external", func(t *testing.T) {
		now := time.Now()
		a := &App{
			proxyPool: netproxy.NewPool(),
			cachedSettings: types.UserSettings{
				Defaults: types.GenerateDefaults{RuntimeMode: types.RuntimeExternal},
			},
			resolvedBinaryPath: "/tmp/officecli",
			resolvedBinaryEnv: []string{
				"OFFICE_CLI_RUNTIME_MODE=external",
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
			t.Fatalf("Provider unset for external mode")
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
			proxyPool: netproxy.NewPool(),
			cachedSettings: types.UserSettings{
				Defaults: types.GenerateDefaults{RuntimeMode: types.RuntimeHosted},
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

func TestValidateExternalProvider(t *testing.T) {
	cases := []struct {
		name    string
		input   types.UserSettings
		wantErr string
	}{
		{
			name: "hosted-mode-skips-check",
			input: types.UserSettings{
				Defaults: types.GenerateDefaults{RuntimeMode: types.RuntimeHosted},
			},
		},
		{
			name: "external-without-provider-blocks",
			input: types.UserSettings{
				Defaults: types.GenerateDefaults{RuntimeMode: types.RuntimeExternal},
			},
			wantErr: "generate.external_provider_missing",
		},
		{
			name: "external-missing-base-url-blocks",
			input: types.UserSettings{
				Defaults: types.GenerateDefaults{RuntimeMode: types.RuntimeExternal},
				LlmProvider: &types.LlmProvider{
					Type: types.LlmOpenAI, APIKey: "sk-x", Model: "gpt-4",
				},
			},
			wantErr: "generate.external_provider_incomplete",
		},
		{
			name: "external-missing-api-key-blocks",
			input: types.UserSettings{
				Defaults: types.GenerateDefaults{RuntimeMode: types.RuntimeExternal},
				LlmProvider: &types.LlmProvider{
					Type: types.LlmOpenAI, BaseURL: "https://api.openai.com/v1", Model: "gpt-4",
				},
			},
			wantErr: "generate.external_provider_incomplete",
		},
		{
			name: "external-missing-model-blocks",
			input: types.UserSettings{
				Defaults: types.GenerateDefaults{RuntimeMode: types.RuntimeExternal},
				LlmProvider: &types.LlmProvider{
					Type: types.LlmOpenAI, BaseURL: "https://api.openai.com/v1", APIKey: "sk-x",
				},
			},
			wantErr: "generate.external_provider_incomplete",
		},
		{
			name: "external-whitespace-counts-as-missing",
			input: types.UserSettings{
				Defaults: types.GenerateDefaults{RuntimeMode: types.RuntimeExternal},
				LlmProvider: &types.LlmProvider{
					Type: types.LlmOpenAI, BaseURL: "   ", APIKey: "sk-x", Model: "gpt-4",
				},
			},
			wantErr: "generate.external_provider_incomplete",
		},
		{
			name: "external-fully-configured-passes",
			input: types.UserSettings{
				Defaults: types.GenerateDefaults{RuntimeMode: types.RuntimeExternal},
				LlmProvider: &types.LlmProvider{
					Type: types.LlmOpenAI, BaseURL: "https://api.openai.com/v1", APIKey: "sk-x", Model: "gpt-4",
				},
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateExternalProvider(tc.input)
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
