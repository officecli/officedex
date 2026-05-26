package bridge

import (
	"encoding/json"
	"path/filepath"
	"slices"
	"strings"

	"officedex/internal/types"
)

// proxyEnvSupplier returns proxy env entries (HTTP_PROXY=…, HTTPS_PROXY=…,
// etc.) layered onto the SKIP_* defaults. App-level wiring registers
// netproxy.Pool.SubprocessEnv so a renderer-side proxy toggle reaches the
// officecli subprocess on the next bridge restart.
var proxyEnvSupplier func() []string

// SetProxyEnvSupplier registers the proxy env supplier. Pass nil to clear.
func SetProxyEnvSupplier(fn func() []string) { proxyEnvSupplier = fn }

// proxyClearKeys lists proxy-related env-var keys (upper-case) that should be
// stripped from the child-process environment when no proxy is configured in
// OfficeDex settings. Stripping these prevents an unintentional system-level
// proxy leak that can block the officecli subprocess from reaching the hosted
// LLM service.
var proxyClearKeys = []string{
	"HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
}

// stripProxyKV removes all proxy-related entries (case-insensitive match
// against proxyClearKeys) from env. Used to erase system-level proxy settings
// so the subprocess gets a clean baseline.
func stripProxyKV(env []string) []string {
	filtered := env[:0]
	for _, kv := range env {
		key, _, ok := strings.Cut(kv, "=")
		if !ok {
			filtered = append(filtered, kv)
			continue
		}
		if !slices.Contains(proxyClearKeys, strings.ToUpper(key)) {
			filtered = append(filtered, kv)
		}
	}
	return filtered
}

// BuildBridgeEnv returns the child-process environment with the three
// officecli SKIP_* flags baked in. extra is a list of KEY=VALUE strings that
// override any earlier entry with the same key (mirroring shell semantics).
//
// System-level proxy env vars (HTTP_PROXY, etc.) are stripped before the
// OfficeDex-configured proxy (if any) is injected, so the subprocess always
// uses the proxy explicitly set in Settings – never an accidental system
// proxy leak.
func BuildBridgeEnv(extra []string) []string {
	base := append([]string{}, syscallEnviron()...)
	// Collect proxy env from the supplier once. When nil or no proxy is
	// configured, strip any system-level proxy vars so the subprocess uses a
	// direct connection.
	var suppliedProxy []string
	if proxyEnvSupplier != nil {
		suppliedProxy = proxyEnvSupplier()
	}
	if suppliedProxy == nil {
		base = stripProxyKV(base)
	}
	base = appendKV(base, "OFFICECLI_SKIP_SKILL_PREFLIGHT", "1")
	base = appendKV(base, "OFFICECLI_SKIP_PUBLISH_SETUP", "1")
	base = appendKV(base, "OFFICECLI_SKIP_UPDATE_CHECK", "1")
	for _, kv := range suppliedProxy {
		key, _, ok := strings.Cut(kv, "=")
		if !ok {
			continue
		}
		base = setKV(base, key, kv)
	}
	for _, kv := range extra {
		key, _, ok := strings.Cut(kv, "=")
		if !ok {
			continue
		}
		base = setKV(base, key, kv)
	}
	return base
}

// appendKV adds or overrides a key in the env slice.
func appendKV(env []string, key, value string) []string {
	prefix := key + "="
	filtered := env[:0]
	for _, kv := range env {
		if !strings.HasPrefix(kv, prefix) {
			filtered = append(filtered, kv)
		}
	}
	return append(filtered, prefix+value)
}

// setKV replaces (or appends) an entry whose key matches kv's prefix.
func setKV(env []string, key, kv string) []string {
	prefix := key + "="
	filtered := env[:0]
	for _, existing := range env {
		if !strings.HasPrefix(existing, prefix) {
			filtered = append(filtered, existing)
		}
	}
	return append(filtered, kv)
}

// buildAttachmentArgs projects renderer-supplied attachments into the args
// payload the bridge expects. Empty / over-cap values are filtered.
func buildAttachmentArgs(input types.GenerateInput) map[string]any {
	args := map[string]any{}
	if spec, ok := types.GetAttachmentSpec(input.DocumentType, types.SlotSourceWorkbook); ok {
		if input.SourceFile != "" {
			args[string(spec.BridgeArgKey)] = input.SourceFile
		}
	}
	if spec, ok := types.GetAttachmentSpec(input.DocumentType, types.SlotReferenceImages); ok {
		filtered := make([]string, 0, len(input.ReferenceImages))
		for _, ref := range input.ReferenceImages {
			if ref != "" {
				filtered = append(filtered, ref)
			}
		}
		if spec.MaxCount > 0 && len(filtered) > spec.MaxCount {
			filtered = filtered[:spec.MaxCount]
		}
		if len(filtered) > 0 {
			args[string(spec.BridgeArgKey)] = filtered
		}
	}
	return args
}

// ResultToArtifact projects a task result blob into the renderer
// Artifact shape. Returns nil if the result lacks a usable file path.
func ResultToArtifact(result []byte) *types.Artifact {
	if len(result) == 0 || string(result) == "null" {
		return nil
	}
	var obj map[string]any
	if err := json.Unmarshal(result, &obj); err != nil {
		return nil
	}
	filePath := firstString(obj, "file_path", "filePath")
	if filePath == "" {
		return nil
	}
	fileName := firstString(obj, "file_name", "fileName")
	if fileName == "" {
		fileName = filepath.Base(filePath)
	}
	documentType := firstString(obj, "document_type", "documentType")
	if documentType == "" {
		documentType = strings.TrimPrefix(filepath.Ext(fileName), ".")
	}
	previewURL := firstString(obj, "access_url", "preview_url", "previewUrl")
	fileID := firstString(obj, "file_id", "fileID")
	return &types.Artifact{
		FileID:       fileID,
		FilePath:     filePath,
		FileName:     fileName,
		DocumentType: documentType,
		PreviewURL:   previewURL,
	}
}

// bridgeResultToArtifact is the unexported alias kept for the existing tests.
// Both names point at the same logic.
func bridgeResultToArtifact(result []byte) *types.Artifact {
	return ResultToArtifact(result)
}

func firstString(obj map[string]any, keys ...string) string {
	for _, key := range keys {
		if v, ok := obj[key].(string); ok && v != "" {
			return v
		}
	}
	return ""
}
