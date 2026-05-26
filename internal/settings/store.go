// Package settings is the Go port of src/main/settingsStore.ts.
//
// Style conventions established by this package (used as the reference for
// every other migrated module):
//
//   - Logger is a tiny interface; nil is a valid no-op default.
//   - All on-disk JSON shapes use camelCase to match the TypeScript renderer.
//   - Sanitize parses a tolerant rawSettings struct first, then projects to the
//     canonical UserSettings shape so missing fields fall back to defaults and
//     unknown enum values get clamped rather than corrupting the cache.
//   - Atomic writes go through a sibling .tmp file + os.Rename.
package settings

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"

	"officedex/internal/netproxy"
	"officedex/internal/types"
)

// Logger is the warning sink the store calls when it has to discard malformed
// data. A nil Logger is treated as a no-op.
type Logger interface {
	Warn(msg string, err error)
}

var defaultSettings = types.UserSettings{
	Version: 1,
	Defaults: types.GenerateDefaults{
		DocumentType: types.DocPPTX,
		Mode:         types.ModeFast,
		RuntimeMode:  types.RuntimeHosted,
		EnableImages: true,
		ImageQuality: types.ImagePremium,
	},
}

// Defaults returns a copy of the package-level defaults.
func Defaults() types.UserSettings { return cloneDefaults() }

// Store owns the on-disk settings file at filePath and caches the last
// sanitized value in memory. Safe for concurrent use.
type Store struct {
	filePath string
	logger   Logger

	mu    sync.Mutex
	cache *types.UserSettings
}

// New creates a Store bound to filePath. A nil logger is acceptable.
func New(filePath string, logger Logger) *Store {
	return &Store{filePath: filePath, logger: logger}
}

// Load returns the cached settings, reading and sanitizing the file on first
// call.
func (s *Store) Load() (types.UserSettings, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.loadLocked()
}

// Reload discards the cache and re-reads the file.
func (s *Store) Reload() (types.UserSettings, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cache = nil
	return s.loadLocked()
}

// Update applies a patch and persists the result. Nil pointers in the patch
// leave the corresponding field unchanged; non-nil pointers overwrite. Use
// Patch.ClearLlmProvider to explicitly remove the provider.
func (s *Store) Update(patch Patch) (types.UserSettings, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	current, err := s.loadLocked()
	if err != nil {
		return types.UserSettings{}, err
	}
	merged := applyPatch(current, patch)
	sanitized := sanitizeCanonical(merged)
	if err := s.writeAtomic(sanitized); err != nil {
		return types.UserSettings{}, err
	}
	s.cache = &sanitized
	return sanitized, nil
}

func (s *Store) loadLocked() (types.UserSettings, error) {
	if s.cache != nil {
		return *s.cache, nil
	}
	merged, err := s.readAndSanitize()
	if err != nil {
		return types.UserSettings{}, err
	}
	s.cache = &merged
	return merged, nil
}

func (s *Store) readAndSanitize() (types.UserSettings, error) {
	data, err := os.ReadFile(s.filePath)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return cloneDefaults(), nil
		}
		s.warn(fmt.Sprintf("Failed to read settings file at %s", s.filePath), err)
		return cloneDefaults(), nil
	}
	var raw rawSettings
	if err := json.Unmarshal(data, &raw); err != nil {
		s.warn(fmt.Sprintf("Settings file at %s is not valid JSON; using defaults", s.filePath), err)
		return cloneDefaults(), nil
	}
	return sanitizeRaw(raw), nil
}

func (s *Store) writeAtomic(settings types.UserSettings) error {
	if err := os.MkdirAll(filepath.Dir(s.filePath), 0o755); err != nil {
		return fmt.Errorf("settings: mkdir parent: %w", err)
	}
	body, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return fmt.Errorf("settings: marshal: %w", err)
	}
	body = append(body, '\n')
	tmpPath := s.filePath + ".tmp"
	if err := os.WriteFile(tmpPath, body, 0o644); err != nil {
		return fmt.Errorf("settings: write tmp: %w", err)
	}
	if err := os.Rename(tmpPath, s.filePath); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("settings: rename: %w", err)
	}
	return nil
}

func (s *Store) warn(msg string, err error) {
	if s.logger != nil {
		s.logger.Warn(msg, err)
	}
}

// Patch describes a partial update to UserSettings. Pointer fields distinguish
// "leave unchanged" (nil) from "set to value" (non-nil). JSON tags keep the
// wire shape camelCase so the Wails-generated TypeScript matches the rest of
// the renderer-facing types.
type Patch struct {
	Defaults              *GenerateDefaultsPatch `json:"defaults,omitempty"`
	OutputDir             *string                `json:"outputDir,omitempty"`
	BridgeBinaryPath      *string                `json:"bridgeBinaryPath,omitempty"`
	LlmProvider           *types.LlmProvider     `json:"llmProvider,omitempty"`
	OnboardingCompletedAt *string                `json:"onboardingCompletedAt,omitempty"`
	SupportReportEndpoint *string                `json:"supportReportEndpoint,omitempty"`
	SupportReportToken    *string                `json:"supportReportToken,omitempty"`
	Proxy                 *types.ProxySettings   `json:"proxy,omitempty"`
	// ClearLlmProvider, when true, removes the stored provider. Ignored when
	// LlmProvider is non-nil.
	ClearLlmProvider bool `json:"clearLlmProvider,omitempty"`
	// ClearProxy, when true, removes the stored proxy. Ignored when Proxy is
	// non-nil.
	ClearProxy bool `json:"clearProxy,omitempty"`
}

// GenerateDefaultsPatch is the partial form of GenerateDefaults. Nil pointer =
// leave unchanged.
type GenerateDefaultsPatch struct {
	DocumentType *types.DocumentType `json:"documentType,omitempty"`
	Mode         *types.GenerateMode `json:"mode,omitempty"`
	RuntimeMode  *types.RuntimeMode  `json:"runtimeMode,omitempty"`
	EnableImages *bool               `json:"enableImages,omitempty"`
	ImageQuality *types.ImageQuality `json:"imageQuality,omitempty"`
}

func applyPatch(base types.UserSettings, patch Patch) types.UserSettings {
	out := base
	if patch.Defaults != nil {
		d := patch.Defaults
		if d.DocumentType != nil {
			out.Defaults.DocumentType = *d.DocumentType
		}
		if d.Mode != nil {
			out.Defaults.Mode = *d.Mode
		}
		if d.RuntimeMode != nil {
			out.Defaults.RuntimeMode = *d.RuntimeMode
		}
		if d.EnableImages != nil {
			out.Defaults.EnableImages = *d.EnableImages
		}
		if d.ImageQuality != nil {
			out.Defaults.ImageQuality = *d.ImageQuality
		}
	}
	if patch.OutputDir != nil {
		out.OutputDir = patch.OutputDir
	}
	if patch.BridgeBinaryPath != nil {
		out.BridgeBinaryPath = patch.BridgeBinaryPath
	}
	if patch.LlmProvider != nil {
		out.LlmProvider = patch.LlmProvider
	} else if patch.ClearLlmProvider {
		out.LlmProvider = nil
	}
	if patch.OnboardingCompletedAt != nil {
		out.OnboardingCompletedAt = patch.OnboardingCompletedAt
	}
	if patch.SupportReportEndpoint != nil {
		out.SupportReportEndpoint = patch.SupportReportEndpoint
	}
	if patch.SupportReportToken != nil {
		out.SupportReportToken = patch.SupportReportToken
	}
	if patch.Proxy != nil {
		out.Proxy = patch.Proxy
	} else if patch.ClearProxy {
		out.Proxy = nil
	}
	return out
}

// rawSettings mirrors the on-disk JSON with every field optional, so we can
// distinguish "missing field" from "explicit zero" during sanitize.
type rawSettings struct {
	Version               *int                 `json:"version,omitempty"`
	Defaults              *rawGenerateDefaults `json:"defaults,omitempty"`
	OutputDir             *string              `json:"outputDir,omitempty"`
	BridgeBinaryPath      *string              `json:"bridgeBinaryPath,omitempty"`
	LlmProvider           *rawLlmProvider      `json:"llmProvider,omitempty"`
	OnboardingCompletedAt *string              `json:"onboardingCompletedAt,omitempty"`
	SupportReportEndpoint *string              `json:"supportReportEndpoint,omitempty"`
	SupportReportToken    *string              `json:"supportReportToken,omitempty"`
	Proxy                 *rawProxySettings    `json:"proxy,omitempty"`
}

type rawGenerateDefaults struct {
	DocumentType *string `json:"documentType,omitempty"`
	Mode         *string `json:"mode,omitempty"`
	RuntimeMode  *string `json:"runtimeMode,omitempty"`
	EnableImages *bool   `json:"enableImages,omitempty"`
	ImageQuality *string `json:"imageQuality,omitempty"`
}

type rawLlmProvider struct {
	Type    *string `json:"type,omitempty"`
	BaseURL *string `json:"baseUrl,omitempty"`
	APIKey  *string `json:"apiKey,omitempty"`
	Model   *string `json:"model,omitempty"`
}

type rawProxySettings struct {
	Enabled *bool   `json:"enabled,omitempty"`
	URL     *string `json:"url,omitempty"`
}

func sanitizeRaw(raw rawSettings) types.UserSettings {
	out := cloneDefaults()
	if raw.Version != nil {
		out.Version = *raw.Version
	}
	if raw.Defaults != nil {
		d := raw.Defaults
		if d.DocumentType != nil && types.IsValidDocumentType(*d.DocumentType) {
			out.Defaults.DocumentType = types.DocumentType(*d.DocumentType)
		}
		if d.Mode != nil {
			if v, ok := pickMode(*d.Mode); ok {
				out.Defaults.Mode = v
			}
		}
		if d.RuntimeMode != nil {
			if v, ok := pickRuntimeMode(*d.RuntimeMode); ok {
				out.Defaults.RuntimeMode = v
			}
		}
		if d.EnableImages != nil {
			out.Defaults.EnableImages = *d.EnableImages
		}
		if d.ImageQuality != nil {
			if v, ok := pickImageQuality(*d.ImageQuality); ok {
				out.Defaults.ImageQuality = v
			}
		}
	}
	out.OutputDir = trimNullable(raw.OutputDir)
	out.BridgeBinaryPath = trimNullable(raw.BridgeBinaryPath)
	out.LlmProvider = sanitizeRawProvider(raw.LlmProvider)
	out.OnboardingCompletedAt = trimNullable(raw.OnboardingCompletedAt)
	out.SupportReportEndpoint = trimNullable(raw.SupportReportEndpoint)
	out.SupportReportToken = trimNullable(raw.SupportReportToken)
	out.Proxy = sanitizeRawProxy(raw.Proxy)
	return out
}

// sanitizeCanonical re-runs the same clamping rules against a fully-typed
// UserSettings (used after applyPatch).
func sanitizeCanonical(s types.UserSettings) types.UserSettings {
	out := cloneDefaults()
	if s.Version != 0 {
		out.Version = s.Version
	}
	if types.IsValidDocumentType(string(s.Defaults.DocumentType)) {
		out.Defaults.DocumentType = s.Defaults.DocumentType
	}
	if v, ok := pickMode(string(s.Defaults.Mode)); ok {
		out.Defaults.Mode = v
	}
	if v, ok := pickRuntimeMode(string(s.Defaults.RuntimeMode)); ok {
		out.Defaults.RuntimeMode = v
	}
	out.Defaults.EnableImages = s.Defaults.EnableImages
	if v, ok := pickImageQuality(string(s.Defaults.ImageQuality)); ok {
		out.Defaults.ImageQuality = v
	}
	out.OutputDir = trimNullable(s.OutputDir)
	out.BridgeBinaryPath = trimNullable(s.BridgeBinaryPath)
	out.LlmProvider = sanitizeCanonicalProvider(s.LlmProvider)
	out.OnboardingCompletedAt = trimNullable(s.OnboardingCompletedAt)
	out.SupportReportEndpoint = trimNullable(s.SupportReportEndpoint)
	out.SupportReportToken = trimNullable(s.SupportReportToken)
	out.Proxy = sanitizeCanonicalProxy(s.Proxy)
	return out
}

func cloneDefaults() types.UserSettings {
	out := defaultSettings
	return out
}

func pickMode(value string) (types.GenerateMode, bool) {
	switch types.GenerateMode(value) {
	case types.ModeFast, types.ModeBest:
		return types.GenerateMode(value), true
	}
	return "", false
}

func pickRuntimeMode(value string) (types.RuntimeMode, bool) {
	if value == "external" {
		return types.RuntimeCustom, true
	}
	switch types.RuntimeMode(value) {
	case types.RuntimeCustom, types.RuntimeHosted:
		return types.RuntimeMode(value), true
	}
	return "", false
}

func pickImageQuality(value string) (types.ImageQuality, bool) {
	switch types.ImageQuality(value) {
	case types.ImageStandard, types.ImagePremium:
		return types.ImageQuality(value), true
	}
	return "", false
}

func trimNullable(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func sanitizeRawProvider(p *rawLlmProvider) *types.LlmProvider {
	if p == nil {
		return nil
	}
	baseURL := derefString(p.BaseURL)
	apiKey := derefString(p.APIKey)
	model := derefString(p.Model)
	if baseURL == "" && apiKey == "" && model == "" {
		return nil
	}
	t := types.LlmOpenAI
	if p.Type != nil {
		if isValidProviderType(types.LlmProviderType(*p.Type)) {
			t = types.LlmProviderType(*p.Type)
		}
	}
	return &types.LlmProvider{Type: t, BaseURL: baseURL, APIKey: apiKey, Model: model}
}

func sanitizeCanonicalProvider(p *types.LlmProvider) *types.LlmProvider {
	if p == nil {
		return nil
	}
	if p.BaseURL == "" && p.APIKey == "" && p.Model == "" {
		return nil
	}
	t := p.Type
	if !isValidProviderType(t) {
		t = types.LlmOpenAI
	}
	return &types.LlmProvider{Type: t, BaseURL: p.BaseURL, APIKey: p.APIKey, Model: p.Model}
}

func derefString(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func isValidProviderType(t types.LlmProviderType) bool {
	return slices.Contains(types.LlmProviderTypes, t)
}

// sanitizeRawProxy lifts the optional on-disk proxy block into a typed value.
// An invalid URL silently drops the proxy so a corrupted settings file cannot
// brick the app at startup; the renderer will simply show the proxy as off.
func sanitizeRawProxy(p *rawProxySettings) *types.ProxySettings {
	if p == nil {
		return nil
	}
	url := strings.TrimSpace(derefString(p.URL))
	enabled := false
	if p.Enabled != nil {
		enabled = *p.Enabled
	}
	if url == "" && !enabled {
		return nil
	}
	if url != "" {
		parsed, err := netproxy.ValidateURL(url)
		if err != nil || parsed == nil {
			return nil
		}
		url = parsed.String()
	}
	if enabled && url == "" {
		return nil
	}
	return &types.ProxySettings{Enabled: enabled, URL: url}
}

// sanitizeCanonicalProxy re-validates a fully-typed ProxySettings after an
// applyPatch round-trip. Mirrors sanitizeRawProxy's tolerance.
func sanitizeCanonicalProxy(p *types.ProxySettings) *types.ProxySettings {
	if p == nil {
		return nil
	}
	url := strings.TrimSpace(p.URL)
	if url == "" && !p.Enabled {
		return nil
	}
	if url != "" {
		parsed, err := netproxy.ValidateURL(url)
		if err != nil || parsed == nil {
			return nil
		}
		url = parsed.String()
	}
	if p.Enabled && url == "" {
		return nil
	}
	return &types.ProxySettings{Enabled: p.Enabled, URL: url}
}
