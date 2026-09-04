package report

import (
	"strings"
	"testing"

	"officedex/internal/types"
)

func TestLatestFailedEventReturnsACopyOfTheNewestFailure(t *testing.T) {
	events := []types.BridgeEvent{
		{Type: types.EventTaskFailed, Payload: map[string]any{"error_code": "first"}},
		{Type: types.EventTaskProgress},
		{Type: types.EventTaskFailed, Payload: map[string]any{"error_code": "second"}},
		{Type: types.EventTaskCancelled},
	}
	got := LatestFailedEvent(events)
	if got == nil || got.Payload["error_code"] != "second" {
		t.Fatalf("LatestFailedEvent = %+v", got)
	}
	got.Type = "mutated"
	if events[2].Type != types.EventTaskFailed {
		t.Fatal("the returned event must not alias the slice element")
	}
	if LatestFailedEvent([]types.BridgeEvent{{Type: types.EventTaskCompleted}}) != nil {
		t.Fatal("no failure must yield nil")
	}
}

func TestErrorFieldsAcceptEverySpellingAndCapTheMessage(t *testing.T) {
	code, msg := ErrorFields(&types.BridgeEvent{Payload: map[string]any{"errorCode": "E_AUTH", "errorMessage": "denied"}})
	if code != "E_AUTH" || msg != "denied" {
		t.Fatalf("camelCase: %q %q", code, msg)
	}
	code, msg = ErrorFields(&types.BridgeEvent{Payload: map[string]any{"code": "E_X", "error": "plain"}})
	if code != "E_X" || msg != "plain" {
		t.Fatalf("legacy keys: %q %q", code, msg)
	}
	code, msg = ErrorFields(&types.BridgeEvent{Payload: map[string]any{"message": strings.Repeat("m", ErrorMessageCap+50)}})
	if code != "unknown" || len(msg) != ErrorMessageCap {
		t.Fatalf("no code must read unknown and the message must be capped: %q len=%d", code, len(msg))
	}
}
