package bridge

import "testing"

// Agent-runtime notifications carry run_id and step_id on the envelope. The
// desktop's BridgeEvent used to lack the fields, so decoding dropped them and
// the renderer never saw which run a client-tool request belonged to.
func TestNormalizeBridgeEventKeepsRunAndStepIDs(t *testing.T) {
	params := []byte(`{"event_id":"e1","run_id":"run-7","step_id":"step-2","type":"client-tool.requested","ts":"2026-09-04T00:00:00Z","payload":{"call_id":"c1"}}`)
	event := normalizeBridgeEvent("event", params)
	if event.RunID != "run-7" || event.StepID != "step-2" {
		t.Fatalf("run_id/step_id dropped on decode: %+v", event)
	}
	if event.Type != "client-tool.requested" || event.Payload["call_id"] != "c1" {
		t.Fatalf("envelope decoded wrongly: %+v", event)
	}
}
