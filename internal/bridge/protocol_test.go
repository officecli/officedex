package bridge

import (
	"strings"
	"testing"
)

// The version the officecli in this workspace announces has to pass, or the
// gate would refuse the very bridge it ships against.
func TestCurrentBridgeProtocolIsAccepted(t *testing.T) {
	if err := checkProtocolVersionValue(MinProtocolVersion, "1.2.3"); err != nil {
		t.Fatalf("the minimum version must itself be accepted: %v", err)
	}
	if err := checkProtocolVersionValue("2099-01-01", "9.9.9"); err != nil {
		t.Fatalf("a newer bridge must be accepted: %v", err)
	}
}

// Before this gate an older bridge was accepted and then failed later, from
// whichever call first needed a method it did not have.
func TestOlderProtocolIsRefusedAtTheHandshake(t *testing.T) {
	err := checkProtocolVersionValue("2025-01-01", "0.9.0")
	if err == nil {
		t.Fatal("an older protocol version was accepted")
	}
	for _, want := range []string{"2025-01-01", MinProtocolVersion, "0.9.0", "OFFICECLI_DESKTOP_BINARY"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("the error should mention %q so the user can act on it; got: %v", want, err)
		}
	}
}

// A bridge predating the field itself sends nothing, which is older still.
func TestMissingProtocolVersionIsRefused(t *testing.T) {
	err := checkProtocolVersionValue("", "")
	if err == nil {
		t.Fatal("a bridge announcing no protocol version was accepted")
	}
	if !strings.Contains(err.Error(), "unknown") {
		t.Errorf("an unknown server version should be named as such; got: %v", err)
	}
}

// Dates of equal length compare correctly as strings; anything else does not,
// so an unexpected shape is refused rather than compared.
func TestUnrecognisedProtocolShapeIsRefused(t *testing.T) {
	for _, announced := range []string{"v2", "2026-4-3", "2026-04-03-beta", "latest"} {
		if err := checkProtocolVersionValue(announced, "1.0.0"); err == nil {
			t.Errorf("%q should not be treated as a comparable version", announced)
		}
	}
}

// Initialize parses the response it was handed, not a re-request.
func TestCheckProtocolVersionReadsTheInitializeResponse(t *testing.T) {
	ok := []byte(`{"server_name":"officecli-agent-bridge","server_version":"1.0.0","protocol_version":"` + MinProtocolVersion + `"}`)
	if err := checkProtocolVersion(ok); err != nil {
		t.Fatalf("a well-formed response was refused: %v", err)
	}
	if err := checkProtocolVersion([]byte(`not json`)); err == nil {
		t.Fatal("an unreadable response was accepted")
	}
}
