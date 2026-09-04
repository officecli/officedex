package providerprobe

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"officedex/internal/netproxy"
	"officedex/internal/subprocess"
	"officedex/internal/types"
)

const (
	// OfficialPaidProbeType tags results of the credit-consuming hosted probe.
	OfficialPaidProbeType = "officialPaid"
	// OfficialPaidTimeout bounds one paid probe run.
	OfficialPaidTimeout = 2 * time.Minute
	// outputCap is how much of the probe's stdout/stderr a failure summary keeps.
	outputCap = 2000
)

const officialUnavailableMessage = "official provider connection test is not available; run a generation task to verify the hosted provider"

// testOfficialProvider deliberately does not call bridge initialize. That RPC is
// a local stdio handshake and can return in 0ms even when no hosted LLM request
// would succeed, so reporting it as a provider connection test is misleading.
// Unavailable is the hosted-mode answer when a paid probe was not allowed:
// there is no zero-cost hosted ping, and a local bridge handshake would be a
// misleading stand-in.
func Unavailable() types.ProviderTestResult {
	return types.ProviderTestResult{
		URL:         "official",
		Error:       officialUnavailableMessage,
		Unavailable: true,
	}
}

// OfficialEnv builds the subprocess environment for the paid probe from the
// base environment: proxy variables stripped (the pool supplies its own),
// preflight/publish/update checks skipped, then pool and extra overrides.
func OfficialEnv(base []string, extra []string, pool *netproxy.Pool) []string {
	env := stripProxyEnv(append([]string{}, base...))
	env = appendKVForCommand(env, "OFFICECLI_SKIP_SKILL_PREFLIGHT", "1")
	env = appendKVForCommand(env, "OFFICECLI_SKIP_PUBLISH_SETUP", "1")
	env = appendKVForCommand(env, "OFFICECLI_SKIP_UPDATE_CHECK", "1")
	if pool != nil {
		for _, kv := range pool.SubprocessEnv() {
			key, _, ok := strings.Cut(kv, "=")
			if ok {
				env = setKVForCommand(env, key, kv)
			}
		}
	}
	for _, kv := range extra {
		key, _, ok := strings.Cut(kv, "=")
		if ok {
			env = setKVForCommand(env, key, kv)
		}
	}
	return env
}

func stripProxyEnv(env []string) []string {
	filtered := env[:0]
	for _, kv := range env {
		key, _, ok := strings.Cut(kv, "=")
		if !ok {
			filtered = append(filtered, kv)
			continue
		}
		switch strings.ToUpper(key) {
		case "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY":
			continue
		default:
			filtered = append(filtered, kv)
		}
	}
	return filtered
}

func appendKVForCommand(env []string, key, value string) []string {
	return setKVForCommand(env, key, key+"="+value)
}

func setKVForCommand(env []string, key, kv string) []string {
	prefix := key + "="
	for i, current := range env {
		if strings.HasPrefix(current, prefix) {
			env[i] = kv
			return env
		}
	}
	return append(env, kv)
}

func failureSummary(exitCode int, stdout string, stderr string, runErr error) string {
	parts := []string{fmt.Sprintf("official provider paid probe exited with exit code %d", exitCode)}
	if trimmed := limitOutput(stderr); trimmed != "" {
		parts = append(parts, "stderr: "+trimmed)
	}
	if trimmed := limitOutput(stdout); trimmed != "" {
		parts = append(parts, "stdout: "+trimmed)
	}
	if len(parts) == 1 && runErr != nil {
		parts = append(parts, runErr.Error())
	}
	return strings.Join(parts, "\n")
}

func limitOutput(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	if len(trimmed) > outputCap {
		return trimmed[:outputCap] + "...(truncated)"
	}
	return trimmed
}

// OfficialPaidOptions configures RunOfficialPaid.
type OfficialPaidOptions struct {
	// Binary is the officecli executable; "officecli" on PATH when empty.
	Binary string
	// Env is the full subprocess environment, normally from OfficialEnv.
	Env []string
}

// RunOfficialPaid verifies the hosted provider the only way it can be
// verified: by running a tiny fast-mode docx generation through officecli.
// It costs credits, so callers gate it behind an explicit user opt-in. The
// caller bounds ctx (it is the probe timeout).
func RunOfficialPaid(ctx context.Context, opts OfficialPaidOptions) (types.ProviderTestResult, error) {
	outDir, err := os.MkdirTemp("", "officedex-provider-test-*")
	if err != nil {
		return types.ProviderTestResult{}, fmt.Errorf("official provider test temp dir: %w", err)
	}
	defer os.RemoveAll(outDir)

	binary := strings.TrimSpace(opts.Binary)
	if binary == "" {
		binary = "officecli"
	}
	args := []string{
		"new",
		"docx",
		"OfficeDex Provider Connection Test",
		"--prompt",
		"Write exactly: OfficeDex provider connection test OK.",
		"--mode",
		"fast",
		"--out",
		outDir,
		"--no-publish",
		"--json",
	}
	cmd := subprocess.CommandContext(ctx, binary, args...)
	cmd.Env = opts.Env

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	start := time.Now()
	err = cmd.Run()
	latency := time.Since(start).Milliseconds()
	if ctx.Err() != nil {
		return types.ProviderTestResult{
			URL:       "official",
			LatencyMs: latency,
			Error:     "official provider paid probe timed out",
			ProbeType: OfficialPaidProbeType,
		}, nil
	}
	if err != nil {
		exitCode := -1
		if cmd.ProcessState != nil {
			exitCode = cmd.ProcessState.ExitCode()
		}
		return types.ProviderTestResult{
			URL:       "official",
			LatencyMs: latency,
			Error:     failureSummary(exitCode, stdout.String(), stderr.String(), err),
			ProbeType: OfficialPaidProbeType,
		}, nil
	}
	return types.ProviderTestResult{
		OK:        true,
		URL:       "official",
		LatencyMs: latency,
		ProbeType: OfficialPaidProbeType,
	}, nil
}
