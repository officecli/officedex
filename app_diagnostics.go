package main

import (
	"context"
	"encoding/json"
	"fmt"
	"officedex/internal/providerenv"
	"officedex/internal/providerprobe"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"

	"officedex/internal/binresolver"
	"officedex/internal/diagnostics"
	"officedex/internal/mask"
	"officedex/internal/netproxy"
	"officedex/internal/types"
)

// ─── Diagnostics ────────────────────────────────────────────────────────────

// ExportLogsInput is the optional input shape passed from the renderer. A
// zero-value struct (no input from the renderer) is treated as "include all"
// so that A0 callers continue to receive a fully-populated bundle.
type ExportLogsInput struct {
	TaskID          string `json:"taskId,omitempty"`
	IncludeSettings bool   `json:"includeSettings"`
	IncludeEvents   bool   `json:"includeEvents"`
	IncludeLogs     bool   `json:"includeLogs"`
	IncludeRecent   bool   `json:"includeRecent"`
}

// ExportLogsResult is the value returned by ExportLogs to the renderer.
type ExportLogsResult struct {
	Path     string                     `json:"path"`
	Manifest diagnostics.BundleManifest `json:"manifest"`
}

type RendererLogInput struct {
	Source  string         `json:"source"`
	Event   string         `json:"event"`
	AtMs    int            `json:"atMs,omitempty"`
	Details map[string]any `json:"details,omitempty"`
}

func (a *App) RecordRendererLog(input RendererLogInput) error {
	source := strings.TrimSpace(input.Source)
	event := strings.TrimSpace(input.Event)
	if source == "" || event == "" {
		return nil
	}
	if len(source) > 160 {
		source = source[:160]
	}
	if len(event) > 200 {
		event = event[:200]
	}

	details := input.Details
	if details == nil {
		details = map[string]any{}
	}
	detailsJSON, err := json.Marshal(details)
	if err != nil {
		detailsJSON = []byte(`{"marshalError":true}`)
	}
	if len(detailsJSON) > 65536 {
		detailsJSON = []byte(`{"truncated":true}`)
	}

	entry := map[string]any{
		"ts":      time.Now().UTC().Format(time.RFC3339Nano),
		"source":  source,
		"event":   event,
		"atMs":    input.AtMs,
		"details": json.RawMessage(detailsJSON),
	}
	line, err := json.Marshal(entry)
	if err != nil {
		return fmt.Errorf("record renderer log: marshal: %w", err)
	}

	logDir := filepath.Join(a.userDataDir, "logs")
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		return fmt.Errorf("record renderer log: mkdir: %w", err)
	}
	logPath := filepath.Join(logDir, "renderer-"+time.Now().Format("20060102")+".log")
	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return fmt.Errorf("record renderer log: open: %w", err)
	}
	defer f.Close()
	if _, err := f.Write(append(line, '\n')); err != nil {
		return fmt.Errorf("record renderer log: write: %w", err)
	}
	return nil
}

// ExportLogs assembles a diagnostics bundle (scrubbed settings, events, logs)
// into ~/Downloads and returns the path + manifest.
func (a *App) ExportLogs(input ExportLogsInput) (ExportLogsResult, error) {
	// Zero-value struct from a renderer that omitted input → default to all-on.
	if !input.IncludeSettings && !input.IncludeEvents && !input.IncludeLogs && !input.IncludeRecent {
		input.IncludeSettings = true
		input.IncludeEvents = true
		input.IncludeLogs = true
		input.IncludeRecent = true
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return ExportLogsResult{}, fmt.Errorf("export logs: home dir: %w", err)
	}
	downloads := filepath.Join(home, "Downloads")

	a.mu.Lock()
	currentSettings := a.cachedSettings
	a.mu.Unlock()
	bridgeClients := a.bridges.all()

	var droppedBytes int64
	for _, client := range bridgeClients {
		droppedBytes += client.LogfileDroppedBytes()
	}

	bundleID := uuid.New().String()

	zipPath, manifest, err := diagnostics.BuildBundle(a.ctx, diagnostics.BundleOptions{
		DestDir:             downloads,
		UserDataDir:         a.userDataDir,
		WorkspaceDir:        a.effectiveWorkspaceDirForRuntime(currentSettings),
		LocalStore:          a.localStore,
		Settings:            currentSettings,
		CachedBridgeEnv:     a.currentBridgeEnv(),
		TaskID:              input.TaskID,
		IncludeSettings:     input.IncludeSettings,
		IncludeEvents:       input.IncludeEvents,
		IncludeRecent:       input.IncludeRecent,
		IncludeLogs:         input.IncludeLogs,
		AppVersion:          appVersion,
		BundleID:            bundleID,
		RuntimeDroppedBytes: droppedBytes,
	})
	if err != nil {
		return ExportLogsResult{}, fmt.Errorf("export logs: %w", err)
	}
	return ExportLogsResult{Path: zipPath, Manifest: manifest}, nil
}

func (a *App) currentBridgeEnv() []string {
	a.mu.Lock()
	s := a.cachedSettings
	a.mu.Unlock()
	return providerenv.Env(s)
}

// GetBridgeRuntimeSnapshot returns the renderer-facing description of the
// officecli subprocess as it was actually resolved. EnvApplied is true only
// when ensureBridge has populated the cached path/env/timestamp — i.e. a real
// subprocess has been spawned. Provider is parsed strictly from the env slice
// that was handed to the subprocess; we do not consult cachedSettings as a
// stand-in, because the whole point of this method is to prove what is
// running rather than echo what is merely configured.
func (a *App) GetBridgeRuntimeSnapshot() (types.BridgeRuntimeSnapshot, error) {
	a.mu.Lock()
	provider := a.cachedSettings.LlmProvider
	var mode types.RuntimeMode
	if provider == nil {
		mode = types.RuntimeHosted
	} else {
		mode = types.RuntimeCustom
	}
	a.mu.Unlock()
	path, env, at := a.binary.load()

	snap := types.BridgeRuntimeSnapshot{
		RuntimeMode: mode,
		BinaryPath:  path,
		EnvApplied:  path != "" && len(env) > 0 && !at.IsZero(),
	}
	if !at.IsZero() {
		snap.ResolvedAt = at.UTC().Format(time.RFC3339)
	}
	if a.proxyPool != nil {
		if u := a.proxyPool.Get(); u != nil {
			snap.ProxyHost = mask.Host(u.String())
		}
	}
	if snap.EnvApplied && mode == types.RuntimeCustom {
		snap.Provider = providerenv.Snapshot(env)
	}
	return snap, nil
}

// TestProvider issues a probe against the configured provider. For custom
// providers (OpenAI/Azure/Anthropic/Custom) it sends a real "hi" chat
// completion. Official hosted mode does not expose a zero-cost provider ping, so
// it returns an explicit unavailable result instead of treating a local bridge
// handshake as proof that the hosted provider is reachable.
func (a *App) TestProvider() (types.ProviderTestResult, error) {
	a.mu.Lock()
	s := a.cachedSettings
	a.mu.Unlock()

	return a.testProviderWithSettings(s, a.proxyPool, false)
}

// TestProviderWithInput runs the same provider probe as TestProvider, but with
// per-call provider/proxy overrides. It is used by onboarding before draft
// settings have been persisted.
func (a *App) TestProviderWithInput(input types.ProviderTestInput) (types.ProviderTestResult, error) {
	a.mu.Lock()
	s := a.cachedSettings
	a.mu.Unlock()
	if input.UseProviderOverride {
		s.LlmProvider = input.LlmProvider
	}

	pool := a.proxyPool
	if input.UseProxyOverride {
		tempPool := netproxy.NewPool()
		if input.Proxy != nil && input.Proxy.Enabled && strings.TrimSpace(input.Proxy.URL) != "" {
			if err := tempPool.Set(input.Proxy.URL); err != nil {
				return types.ProviderTestResult{}, fmt.Errorf("apply test proxy: %w", err)
			}
		}
		pool = tempPool
	}
	return a.testProviderWithSettings(s, pool, input.AllowPaidOfficialProbe)
}

func (a *App) testProviderWithSettings(s types.UserSettings, pool *netproxy.Pool, allowPaidOfficialProbe bool) (types.ProviderTestResult, error) {
	if s.LlmProvider == nil {
		if allowPaidOfficialProbe {
			return a.runOfficialPaidProviderProbe(s, pool)
		}
		return providerprobe.Unavailable(), nil
	}
	if err := a.requireLoggedInForCustomProvider(s); err != nil {
		return types.ProviderTestResult{}, err
	}

	probe, err := providerprobe.For(*s.LlmProvider)
	if err != nil {
		return types.ProviderTestResult{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return providerprobe.Run(ctx, pool, probe), nil
}

func (a *App) runOfficialPaidProviderProbe(s types.UserSettings, pool *netproxy.Pool) (types.ProviderTestResult, error) {
	probeCtx := a.ctx
	if probeCtx == nil {
		probeCtx = context.Background()
	}
	ctx, cancel := context.WithTimeout(probeCtx, providerprobe.OfficialPaidTimeout)
	defer cancel()
	return providerprobe.RunOfficialPaid(ctx, providerprobe.OfficialPaidOptions{
		Binary: binresolver.ResolvePath(a.resolverOptions(s)),
		Env:    providerprobe.OfficialEnv(os.Environ(), providerenv.Env(types.UserSettings{}), pool),
	})
}
