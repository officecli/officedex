package report

import (
	"context"
	"encoding/json"
	"os/exec"
	"strings"
	"time"
)

// ReportCapability summarizes whether issue-report submission is possible
// and which paths are viable. Enabled is the OR of HasCLISubcommand and
// HasHTTPEndpoint — HasProtocolFlag is informational (a hint from the agent
// bridge that the server side is ready) but does not by itself enable
// submission since the client still needs a way to send the bundle.
type ReportCapability struct {
	HasCLISubcommand bool   `json:"hasCliSubcommand"`
	HasHTTPEndpoint  bool   `json:"hasHttpEndpoint"`
	HasProtocolFlag  bool   `json:"hasProtocolFlag"`
	Enabled          bool   `json:"enabled"`
	Reason           string `json:"reason,omitempty"`
}

// CapabilityOptions wires the inputs DetectCapability inspects. Any field may
// be empty; DetectCapability never panics and never returns an error — when
// nothing is available it returns ReportCapability{Enabled: false, Reason: ...}.
type CapabilityOptions struct {
	BinaryPath          string
	Env                 []string
	HTTPEndpoint        string
	CapabilitiesPayload []byte // raw JSON from bridge.GetCapabilities, optional
	// HelpProbe overrides the CLI probe for tests. Returns (stdout, exit, err).
	// When err is non-nil the probe is treated as failed (no CLI subcommand).
	HelpProbe func(ctx context.Context) (string, int, error)
	// ProbeTimeout caps the CLI help probe. Defaults to 5s.
	ProbeTimeout time.Duration
}

// DetectCapability inspects the environment and returns a capability struct.
// It is safe to call regardless of CLI / endpoint / protocol availability;
// every failure mode degrades to Enabled=false with a descriptive Reason.
func DetectCapability(ctx context.Context, opts CapabilityOptions) ReportCapability {
	cap := ReportCapability{}

	cap.HasHTTPEndpoint = strings.TrimSpace(opts.HTTPEndpoint) != ""
	cap.HasProtocolFlag = parseProtocolFlag(opts.CapabilitiesPayload)
	cap.HasCLISubcommand = probeCLI(ctx, opts)

	cap.Enabled = cap.HasCLISubcommand || cap.HasHTTPEndpoint
	switch {
	case cap.Enabled:
		cap.Reason = "ready"
	case !cap.HasCLISubcommand && !cap.HasHTTPEndpoint:
		cap.Reason = "no_cli_no_endpoint"
	case !cap.HasCLISubcommand:
		cap.Reason = "no_cli"
	default:
		cap.Reason = "no_endpoint"
	}
	return cap
}

// parseProtocolFlag walks a GetCapabilities JSON blob looking for a truthy
// "report.submit" entry. Both `{"report.submit": true}` and a nested
// `{"report": {"submit": true}}` shape are accepted to keep the desktop
// resilient to whichever convention the bridge ends up using.
func parseProtocolFlag(payload []byte) bool {
	if len(payload) == 0 {
		return false
	}
	var raw map[string]any
	if err := json.Unmarshal(payload, &raw); err != nil {
		return false
	}
	if v, ok := raw["report.submit"]; ok {
		if b, ok := v.(bool); ok && b {
			return true
		}
	}
	if v, ok := raw["report"]; ok {
		if m, ok := v.(map[string]any); ok {
			if sub, ok := m["submit"]; ok {
				if b, ok := sub.(bool); ok && b {
					return true
				}
			}
		}
	}
	if caps, ok := raw["capabilities"].(map[string]any); ok {
		if v, ok := caps["report.submit"]; ok {
			if b, ok := v.(bool); ok && b {
				return true
			}
		}
		if v, ok := caps["report"]; ok {
			if m, ok := v.(map[string]any); ok {
				if sub, ok := m["submit"]; ok {
					if b, ok := sub.(bool); ok && b {
						return true
					}
				}
			}
		}
	}
	return false
}

// probeCLI runs `officecli help report` and treats exit 0 + no "unknown" in
// the help text as a positive signal. Any error or non-zero exit is treated
// as the subcommand being absent.
func probeCLI(ctx context.Context, opts CapabilityOptions) bool {
	if opts.HelpProbe != nil {
		probeCtx, cancel := withTimeout(ctx, opts.ProbeTimeout)
		defer cancel()
		stdout, code, err := opts.HelpProbe(probeCtx)
		if err != nil || code != 0 {
			return false
		}
		return !strings.Contains(strings.ToLower(stdout), "unknown")
	}

	binary := opts.BinaryPath
	if binary == "" {
		binary = "officecli"
	}
	probeCtx, cancel := withTimeout(ctx, opts.ProbeTimeout)
	defer cancel()
	cmd := exec.CommandContext(probeCtx, binary, "help", "report")
	if len(opts.Env) > 0 {
		cmd.Env = opts.Env
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return false
	}
	text := strings.ToLower(string(out))
	if strings.Contains(text, "unknown") || strings.Contains(text, "no help topic") {
		return false
	}
	return true
}

func withTimeout(parent context.Context, d time.Duration) (context.Context, context.CancelFunc) {
	if parent == nil {
		parent = context.Background()
	}
	if d <= 0 {
		d = 5 * time.Second
	}
	return context.WithTimeout(parent, d)
}
