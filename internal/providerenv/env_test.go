package providerenv

import (
	"reflect"
	"strings"
	"testing"

	"officedex/internal/types"
)

func TestSnapshotDecodesTheProviderEnvWithSecretsMasked(t *testing.T) {
	t.Run("hosted-mode-env-has-no-provider-keys", func(t *testing.T) {
		got := Snapshot([]string{"OFFICE_CLI_RUNTIME_MODE=hosted"})
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
		got := Snapshot(env)
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
		got := Snapshot(env)
		if got == nil || got.Type != types.LlmAnthropic {
			t.Fatalf("expected anthropic snapshot, got %+v", got)
		}
		if got.Model != "" || got.APIKeyMasked != "" || got.BaseURLHost != "" {
			t.Errorf("unset fields should be empty, got %+v", got)
		}
	})
}

func TestEnvHostedModeCarriesOnlyTheRuntimeMode(t *testing.T) {
	if got := Env(types.UserSettings{}); !reflect.DeepEqual(got, []string{"OFFICE_CLI_RUNTIME_MODE=hosted"}) {
		t.Fatalf("Env(hosted) = %v", got)
	}
	if Snapshot(Env(types.UserSettings{})) != nil {
		t.Fatal("a hosted environment names no provider")
	}
}

func TestEnvAndSnapshotRoundTrip(t *testing.T) {
	s := types.UserSettings{LlmProvider: &types.LlmProvider{Type: "openai", BaseURL: "https://api.example.com/v1", APIKey: "sk-1234567890abcdef", Model: "gpt-x"}}
	env := Env(s)
	if env[0] != "OFFICE_CLI_RUNTIME_MODE=custom" {
		t.Fatalf("custom provider must run in custom mode: %v", env)
	}
	for _, want := range []string{"OFFICECLI_LLM_PROVIDER=openai", "OFFICECLI_LLM_BASE_URL=https://api.example.com/v1", "OFFICECLI_LLM_API_KEY=sk-1234567890abcdef", "OFFICECLI_LLM_MODEL=gpt-x"} {
		found := false
		for _, kv := range env {
			found = found || kv == want
		}
		if !found {
			t.Errorf("env lacks %q: %v", want, env)
		}
	}
	snap := Snapshot(env)
	if snap == nil || snap.Type != "openai" || snap.Model != "gpt-x" || snap.BaseURLHost != "https://api.example.com" {
		t.Fatalf("Snapshot = %+v", snap)
	}
	if strings.Contains(snap.APIKeyMasked, "1234567890") || snap.APIKeyLength != len("sk-1234567890abcdef") {
		t.Fatalf("API key must be masked but its length kept: %+v", snap)
	}
}
