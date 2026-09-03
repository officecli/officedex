package bridge

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

// MinProtocolVersion is the oldest agent-bridge protocol this app can talk to.
//
// The bridge is a separate binary: the packaged one, a user-installed
// officecli, or whatever OFFICECLI_DESKTOP_BINARY points at. It announces a
// protocol version in its initialize response, and until this check that
// version was read and discarded. A mismatch surfaced as "method not found"
// from whichever call happened to need a newer method -- usually partway
// through a generation the user had already waited on.
//
// Raise this when the app starts depending on a method or field an older
// bridge does not have.
const MinProtocolVersion = "2026-04-03"

// protocolVersionPattern matches the dated versions the bridge announces.
// Same-length dates compare correctly as strings, which is why the shape is
// checked rather than assumed.
var protocolVersionPattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

type initializeResult struct {
	ServerVersion   string `json:"server_version"`
	ProtocolVersion string `json:"protocol_version"`
}

// checkProtocolVersion reports whether an initialize response comes from a
// bridge new enough to talk to, and says what to do when it does not.
func checkProtocolVersion(raw []byte) error {
	var result initializeResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return fmt.Errorf("bridge: unreadable initialize response: %w", err)
	}
	return checkProtocolVersionValue(result.ProtocolVersion, result.ServerVersion)
}

func checkProtocolVersionValue(announced, serverVersion string) error {
	announced = strings.TrimSpace(announced)
	if announced == "" {
		// Bridges older than the field itself. Naming the binary matters here:
		// the user may not know a second officecli is being used.
		return fmt.Errorf(
			"bridge: this officecli (version %s) is too old for OfficeDex: it announces no protocol version, and %s or newer is required. Update officecli, or unset OFFICECLI_DESKTOP_BINARY if it points at an older build",
			describeServerVersion(serverVersion), MinProtocolVersion)
	}
	if !protocolVersionPattern.MatchString(announced) {
		return fmt.Errorf(
			"bridge: officecli announced an unrecognised protocol version %q; OfficeDex needs %s or newer",
			announced, MinProtocolVersion)
	}
	if announced < MinProtocolVersion {
		return fmt.Errorf(
			"bridge: this officecli (version %s) speaks protocol %s, but OfficeDex needs %s or newer. Update officecli, or unset OFFICECLI_DESKTOP_BINARY if it points at an older build",
			describeServerVersion(serverVersion), announced, MinProtocolVersion)
	}
	return nil
}

func describeServerVersion(version string) string {
	if v := strings.TrimSpace(version); v != "" {
		return v
	}
	return "unknown"
}
