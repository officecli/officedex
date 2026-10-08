package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"officedex/internal/bridge"
	"officedex/internal/types"
)

// Wails hands the renderer nothing but error.Error(), so the bridge's
// error.data.code has to travel inside the text. The renderer used to match
// the sentence ("not found", "no pending input") instead.
func TestBridgeErrorCodeTravelsInTheMessage(t *testing.T) {
	rpc := &bridge.RPCError{Code: -32000, Message: "task t-1: has no pending input", Data: json.RawMessage(`{"code":"no_pending_input","type":"execution_error"}`)}
	err := withBridgeErrorCode(fmt.Errorf("respond: %w", rpc))
	if got := types.ErrorCodeOf(err.Error()); got != bridge.ErrorCodeNoPendingInput {
		t.Fatalf("code in message = %q, want no_pending_input: %q", got, err.Error())
	}
	if !errors.Is(err, rpc) {
		t.Fatal("wrapping must keep the RPCError reachable")
	}
	if !bridge.IsNoPendingInput(err) {
		t.Fatal("IsNoPendingInput must see through the wrap")
	}

	plain := errors.New("connection reset")
	if got := withBridgeErrorCode(plain); got != plain {
		t.Fatalf("an error without a code must pass through unchanged, got %v", got)
	}
	noCode := &bridge.RPCError{Code: -32000, Message: "boom"}
	if got := withBridgeErrorCode(noCode); got != noCode {
		t.Fatalf("an RPC error without data.code must pass through unchanged, got %v", got)
	}
	if withBridgeErrorCode(nil) != nil {
		t.Fatal("nil in, nil out")
	}
}
