package login

import (
	"os"
	"strings"
)

// proxyEnvSupplier mirrors bridge.proxyEnvSupplier — see SetProxyEnvSupplier.
var proxyEnvSupplier func() []string

// SetProxyEnvSupplier registers the proxy env supplier. Pass nil to clear.
func SetProxyEnvSupplier(fn func() []string) { proxyEnvSupplier = fn }

// BuildBridgeEnv layers the officecli "skip" environment variables on top of
// os.Environ(). The extra slice (KEY=VAL entries) takes precedence: any KEY
// present in extra replaces an earlier occurrence with the same key. This is
// the Go port of buildBridgeEnv in src/main/bridgeClient.ts; the bridge
// package re-exports it so callers outside login can reuse the same layering
// rules.
func BuildBridgeEnv(extra []string) []string {
	defaults := []string{
		"OFFICECLI_SKIP_SKILL_PREFLIGHT=1",
		"OFFICECLI_SKIP_PUBLISH_SETUP=1",
		"OFFICECLI_SKIP_UPDATE_CHECK=1",
	}
	merged := append([]string{}, os.Environ()...)
	merged = append(merged, defaults...)
	if proxyEnvSupplier != nil {
		merged = append(merged, proxyEnvSupplier()...)
	}
	for _, kv := range extra {
		merged = append(merged, kv)
	}
	return dedupeEnv(merged)
}

// dedupeEnv keeps only the last occurrence of each KEY, preserving the
// original order of those last occurrences.
func dedupeEnv(entries []string) []string {
	lastIndex := make(map[string]int, len(entries))
	for i, kv := range entries {
		key := envKey(kv)
		lastIndex[key] = i
	}
	out := make([]string, 0, len(lastIndex))
	for i, kv := range entries {
		key := envKey(kv)
		if lastIndex[key] == i {
			out = append(out, kv)
		}
	}
	return out
}

func envKey(kv string) string {
	if idx := strings.IndexByte(kv, '='); idx >= 0 {
		return kv[:idx]
	}
	return kv
}
