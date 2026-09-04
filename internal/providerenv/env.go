// Package providerenv is the codec between the user's LLM provider settings
// and the environment variables handed to the officecli bridge.
package providerenv

import (
	"strings"

	"officedex/internal/mask"
	"officedex/internal/types"
)

// Env encodes the provider settings as the OFFICECLI_* environment the
// bridge subprocess reads. Hosted mode carries only the runtime mode.
func Env(s types.UserSettings) []string {
	out := []string{}
	if s.LlmProvider == nil {
		out = append(out, "OFFICE_CLI_RUNTIME_MODE=hosted")
		return out
	}
	out = append(out, "OFFICE_CLI_RUNTIME_MODE=custom")
	if s.LlmProvider.Type != "" {
		out = append(out, "OFFICECLI_LLM_PROVIDER="+string(s.LlmProvider.Type))
	}
	if s.LlmProvider.BaseURL != "" {
		out = append(out, "OFFICECLI_LLM_BASE_URL="+s.LlmProvider.BaseURL)
	}
	if s.LlmProvider.APIKey != "" {
		out = append(out, "OFFICECLI_LLM_API_KEY="+s.LlmProvider.APIKey)
	}
	if s.LlmProvider.Model != "" {
		out = append(out, "OFFICECLI_LLM_MODEL="+s.LlmProvider.Model)
	}
	return out
}

// providerSnapshotFromEnv parses the OFFICECLI_LLM_* lines emitted by
// llmProviderEnv and returns a renderer-safe view. Returns nil when none of
// the provider keys are present (e.g. hosted mode subprocess).
// Snapshot decodes Env back into the masked view the renderer shows; nil
// when the environment names no provider.
func Snapshot(env []string) *types.ProviderSnapshot {
	const (
		keyType    = "OFFICECLI_LLM_PROVIDER="
		keyBaseURL = "OFFICECLI_LLM_BASE_URL="
		keyKey     = "OFFICECLI_LLM_API_KEY="
		keyModel   = "OFFICECLI_LLM_MODEL="
	)
	var providerType, baseURL, apiKey, model string
	var found bool
	for _, kv := range env {
		switch {
		case strings.HasPrefix(kv, keyType):
			providerType = kv[len(keyType):]
			found = true
		case strings.HasPrefix(kv, keyBaseURL):
			baseURL = kv[len(keyBaseURL):]
			found = true
		case strings.HasPrefix(kv, keyKey):
			apiKey = kv[len(keyKey):]
			found = true
		case strings.HasPrefix(kv, keyModel):
			model = kv[len(keyModel):]
			found = true
		}
	}
	if !found {
		return nil
	}
	return &types.ProviderSnapshot{
		Type:         types.LlmProviderType(providerType),
		BaseURLHost:  mask.Host(baseURL),
		Model:        model,
		APIKeyMasked: mask.APIKey(apiKey),
		APIKeyLength: len([]rune(strings.TrimSpace(apiKey))),
	}
}
