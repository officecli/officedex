package bridge

import (
	"strings"
	"testing"
	"time"
)

// dayBeforeMinProtocolVersion is the newest version the gate must still
// refuse. Deriving it keeps the refusal case attached to the floor wherever
// the floor is moved to.
func dayBeforeMinProtocolVersion(t *testing.T) string {
	t.Helper()
	parsed, err := time.Parse("2006-01-02", MinProtocolVersion)
	if err != nil {
		t.Fatalf("MinProtocolVersion %q is not a date the gate can compare: %v", MinProtocolVersion, err)
	}
	return parsed.AddDate(0, 0, -1).Format("2006-01-02")
}

// The version the officecli in this workspace announces has to pass, or the
// gate would refuse the very bridge it ships against.
func TestCurrentBridgeProtocolIsAccepted(t *testing.T) {
	if err := checkProtocolVersionValue(MinProtocolVersion, "1.2.3"); err != nil {
		t.Fatalf("the minimum version must itself be accepted: %v", err)
	}
	if err := checkProtocolVersionValue("2099-01-01", "9.9.9"); err != nil {
		t.Fatalf("a newer bridge must be accepted: %v", err)
	}
	// The check has to be able to say no, or the two passes above prove
	// nothing: the day before the minimum is refused, and so is a bridge that
	// announces no protocol at all.
	//
	// The day before is derived rather than written out. As a literal it was
	// pinned to whatever the floor happened to be the day it was typed, and
	// when the floor moved down to meet the bundled bridge the literal
	// silently became a version *newer* than the minimum -- so the assertion
	// that the gate can refuse was itself asserting nothing.
	dayBefore := dayBeforeMinProtocolVersion(t)
	switch err := checkProtocolVersionValue(dayBefore, "0.2.120"); {
	case err == nil:
		t.Fatalf("a bridge announcing %s, the day before MinProtocolVersion (%s), was accepted", dayBefore, MinProtocolVersion)
	case !strings.Contains(err.Error(), "speaks protocol"):
		// A refusal is not enough: a malformed date is refused too, for being
		// the wrong shape rather than for being old, and that would let this
		// case pass while proving nothing about the comparison.
		t.Fatalf("%s should be refused for being older than the minimum, not for its shape; got: %v", dayBefore, err)
	}
	if err := checkProtocolVersionValue("", "0.1.0"); err == nil {
		t.Fatal("a bridge announcing no protocol version was accepted")
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
