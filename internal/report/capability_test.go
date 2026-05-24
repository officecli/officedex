package report

import (
	"context"
	"errors"
	"testing"
)

func TestDetectCapabilityAllPresent(t *testing.T) {
	cap := DetectCapability(context.Background(), CapabilityOptions{
		HTTPEndpoint:        "https://example.com/report",
		CapabilitiesPayload: []byte(`{"report.submit": true}`),
		HelpProbe: func(ctx context.Context) (string, int, error) {
			return "USAGE: officecli report submit ...", 0, nil
		},
	})
	if !cap.Enabled || !cap.HasCLISubcommand || !cap.HasHTTPEndpoint || !cap.HasProtocolFlag {
		t.Errorf("expected all true, got %+v", cap)
	}
	if cap.Reason != "ready" {
		t.Errorf("Reason = %q, want ready", cap.Reason)
	}
}

func TestDetectCapabilityNoCLINoEndpoint(t *testing.T) {
	cap := DetectCapability(context.Background(), CapabilityOptions{
		HelpProbe: func(ctx context.Context) (string, int, error) {
			return "unknown command 'report'", 1, nil
		},
	})
	if cap.Enabled {
		t.Errorf("expected disabled, got %+v", cap)
	}
	if cap.Reason != "no_cli_no_endpoint" {
		t.Errorf("Reason = %q, want no_cli_no_endpoint", cap.Reason)
	}
}

func TestDetectCapabilityCLIOnly(t *testing.T) {
	cap := DetectCapability(context.Background(), CapabilityOptions{
		HelpProbe: func(ctx context.Context) (string, int, error) {
			return "officecli report submit -- submit an issue report", 0, nil
		},
	})
	if !cap.Enabled || !cap.HasCLISubcommand || cap.HasHTTPEndpoint {
		t.Errorf("expected cli-only, got %+v", cap)
	}
	if cap.Reason != "ready" {
		t.Errorf("Reason = %q", cap.Reason)
	}
}

func TestDetectCapabilityEndpointOnly(t *testing.T) {
	cap := DetectCapability(context.Background(), CapabilityOptions{
		HTTPEndpoint: "https://example.com",
		HelpProbe: func(ctx context.Context) (string, int, error) {
			return "", 1, errors.New("nope")
		},
	})
	if !cap.Enabled || cap.HasCLISubcommand || !cap.HasHTTPEndpoint {
		t.Errorf("expected endpoint-only, got %+v", cap)
	}
}

func TestDetectCapabilityProbeError(t *testing.T) {
	cap := DetectCapability(context.Background(), CapabilityOptions{
		HelpProbe: func(ctx context.Context) (string, int, error) {
			return "", 0, errors.New("boom")
		},
	})
	if cap.HasCLISubcommand {
		t.Errorf("expected no CLI subcommand on probe error, got %+v", cap)
	}
}

func TestDetectCapabilityHelpSaysUnknown(t *testing.T) {
	cap := DetectCapability(context.Background(), CapabilityOptions{
		HelpProbe: func(ctx context.Context) (string, int, error) {
			return "Unknown help topic: report", 0, nil
		},
	})
	if cap.HasCLISubcommand {
		t.Errorf("'unknown' text should disable CLI capability, got %+v", cap)
	}
}

func TestDetectCapabilityProtocolFlagShapes(t *testing.T) {
	cases := []struct {
		name    string
		payload string
		want    bool
	}{
		{"flat true", `{"report.submit": true}`, true},
		{"flat false", `{"report.submit": false}`, false},
		{"nested true", `{"report": {"submit": true}}`, true},
		{"nested false", `{"report": {"submit": false}}`, false},
		{"capabilities wrapper", `{"capabilities": {"report.submit": true}}`, true},
		{"empty", ``, false},
		{"malformed", `not json`, false},
		{"missing", `{"other": 1}`, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := parseProtocolFlag([]byte(tc.payload))
			if got != tc.want {
				t.Errorf("parseProtocolFlag(%q) = %v, want %v", tc.payload, got, tc.want)
			}
		})
	}
}

// TestDetectCapabilityMatrix exhaustively walks the CLI x HTTP x protocol grid.
// Enabled is defined as HasCLISubcommand || HasHTTPEndpoint per task spec
// (the protocol flag is informational only — the client still needs a way to
// send the bundle).
func TestDetectCapabilityMatrix(t *testing.T) {
	cases := []struct {
		name         string
		cliPresent   bool
		httpPresent  bool
		protoPresent bool
		wantEnabled  bool
	}{
		{"all three", true, true, true, true},
		{"cli+http", true, true, false, true},
		{"cli+proto", true, false, true, true},
		{"http+proto", false, true, true, true},
		{"cli only", true, false, false, true},
		{"http only", false, true, false, true},
		{"proto only", false, false, true, false},
		{"none", false, false, false, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			opts := CapabilityOptions{
				HelpProbe: func(ctx context.Context) (string, int, error) {
					if tc.cliPresent {
						return "officecli report submit help", 0, nil
					}
					return "unknown command", 1, nil
				},
			}
			if tc.httpPresent {
				opts.HTTPEndpoint = "https://example.com/report"
			}
			if tc.protoPresent {
				opts.CapabilitiesPayload = []byte(`{"report.submit": true}`)
			}
			got := DetectCapability(context.Background(), opts)
			if got.Enabled != tc.wantEnabled {
				t.Errorf("Enabled = %v, want %v (got %+v)", got.Enabled, tc.wantEnabled, got)
			}
			if got.HasCLISubcommand != tc.cliPresent {
				t.Errorf("HasCLISubcommand = %v, want %v", got.HasCLISubcommand, tc.cliPresent)
			}
			if got.HasHTTPEndpoint != tc.httpPresent {
				t.Errorf("HasHTTPEndpoint = %v, want %v", got.HasHTTPEndpoint, tc.httpPresent)
			}
			if got.HasProtocolFlag != tc.protoPresent {
				t.Errorf("HasProtocolFlag = %v, want %v", got.HasProtocolFlag, tc.protoPresent)
			}
		})
	}
}

func TestDetectCapabilityNeverPanicsOnNilCtx(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("panicked: %v", r)
		}
	}()
	_ = DetectCapability(nil, CapabilityOptions{
		HelpProbe: func(ctx context.Context) (string, int, error) {
			if ctx == nil {
				t.Error("expected non-nil ctx after withTimeout")
			}
			return "", 1, nil
		},
	})
}
