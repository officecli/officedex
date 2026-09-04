package report

import (
	"officedex/internal/payloadfield"
	"officedex/internal/types"
)

// ErrorMessageCap bounds the failure message copied into a report so a
// pathological payload cannot bloat the ticket.
const ErrorMessageCap = 500

// LatestFailedEvent walks the event slice in reverse and returns the most
// recent task.failed entry, or nil when none exists.
func LatestFailedEvent(events []types.BridgeEvent) *types.BridgeEvent {
	for i := len(events) - 1; i >= 0; i-- {
		if events[i].Type == types.EventTaskFailed {
			ev := events[i]
			return &ev
		}
	}
	return nil
}

// ErrorFields pulls error_code + error_message from a task.failed
// payload, handling both snake_case and camelCase keys the bridge has used
// over time. Falls back to ("unknown", message) when no explicit code field
// is present.
func ErrorFields(ev *types.BridgeEvent) (string, string) {
	code := payloadfield.String(ev.Payload, "error_code", "errorCode", "code")
	message := payloadfield.String(ev.Payload, "error_message", "errorMessage", "message", "error")
	if code == "" {
		code = "unknown"
	}
	if len(message) > ErrorMessageCap {
		message = message[:ErrorMessageCap]
	}
	return code, message
}
