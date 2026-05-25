package bridge

import (
	"encoding/json"
	"path/filepath"
	"strings"

	"officedex/internal/types"
)

// BuildBridgeEnv returns the child-process environment with the three
// officecli SKIP_* flags baked in. extra is a list of KEY=VALUE strings that
// override any earlier entry with the same key (mirroring shell semantics).
func BuildBridgeEnv(extra []string) []string {
	base := append([]string{}, syscallEnviron()...)
	base = appendKV(base, "OFFICECLI_SKIP_SKILL_PREFLIGHT", "1")
	base = appendKV(base, "OFFICECLI_SKIP_PUBLISH_SETUP", "1")
	base = appendKV(base, "OFFICECLI_SKIP_UPDATE_CHECK", "1")
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
