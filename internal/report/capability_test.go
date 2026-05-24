package report

import (
	"context"
	"testing"
)

func TestDetectCapabilityEndpointOnly(t *testing.T) {
	cap := DetectCapability(context.Background(), CapabilityOptions{
		HTTPEndpoint: "https://example.com/report",
	})
	if !cap.Enabled || !cap.HasHTTPEndpoint || cap.HasProtocolFlag {
		t.Errorf("expected endpoint-only enabled, got %+v", cap)
	}
	if cap.Reason != "ready" {
		t.Errorf("Reason = %q, want ready", cap.Reason)
	}
}

func TestDetectCapabilityNoEndpoint(t *testing.T) {
	cap := DetectCapability(context.Background(), CapabilityOptions{})
	if cap.Enabled {
		t.Errorf("expected disabled, got %+v", cap)
	}
	if cap.Reason != "no_endpoint" {
		t.Errorf("Reason = %q, want no_endpoint", cap.Reason)
	}
}

func TestDetectCapabilityProtocolFlagInformationalOnly(t *testing.T) {
	cap := DetectCapability(context.Background(), CapabilityOptions{
		CapabilitiesPayload: []byte(`{"report.submit": true}`),
	})
	if cap.Enabled {
		t.Errorf("protocol flag alone must not enable submission, got %+v", cap)
	}
	if !cap.HasProtocolFlag {
		t.Errorf("HasProtocolFlag = false, want true")
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

func TestDetectCapabilityNeverPanicsOnNilCtx(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("panicked: %v", r)
		}
	}()
	_ = DetectCapability(nil, CapabilityOptions{HTTPEndpoint: "https://example.com"})
}
