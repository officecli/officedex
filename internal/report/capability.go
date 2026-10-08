package report

import (
	"context"
	"encoding/json"
	"strings"
)

// ReportCapability summarizes whether issue-report submission is possible.
// Enabled is gated by HasHTTPEndpoint; the minimal report flow has no CLI
// fallback. HasProtocolFlag is informational only.
type ReportCapability struct {
	HasHTTPEndpoint bool   `json:"hasHttpEndpoint"`
	HasProtocolFlag bool   `json:"hasProtocolFlag"`
	Enabled         bool   `json:"enabled"`
	Reason          string `json:"reason,omitempty"`
}

// CapabilityOptions wires the inputs DetectCapability inspects. Any field may
// be empty; DetectCapability never panics and never returns an error.
type CapabilityOptions struct {
	HTTPEndpoint        string
	CapabilitiesPayload []byte
}

// DetectCapability inspects the environment and returns a capability struct.
func DetectCapability(ctx context.Context, opts CapabilityOptions) ReportCapability {
	cap := ReportCapability{
		HasHTTPEndpoint: strings.TrimSpace(opts.HTTPEndpoint) != "",
		HasProtocolFlag: parseProtocolFlag(opts.CapabilitiesPayload),
	}
	cap.Enabled = cap.HasHTTPEndpoint
	if cap.Enabled {
		cap.Reason = "ready"
	} else {
		cap.Reason = "no_endpoint"
	}
	return cap
}

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
