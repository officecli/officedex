package bridge

import (
	"encoding/json"
	"errors"
	"testing"

	"officedex/internal/types"
)

func TestRPCErrorCarriesKindFromBridgeErrorType(t *testing.T) {
	cases := map[string]types.FailureKind{
		`{"type":"auth_error","code":"license_check_failed"}`:               types.FailureAuth,
		`{"type":"configuration_error","code":"llm_configuration_missing"}`: types.FailureSetup,
		`{"type":"llm_error","code":"llm_request_failed","retryable":true}`: types.FailureTask,
		`{"type":"execution_error","code":"execution_failed"}`:              types.FailureOther,
		`{"code":"task_not_found"}`:                                         types.FailureOther,
	}
	for data, want := range cases {
		err := &RPCError{Code: -32000, Message: "x", Data: json.RawMessage(data)}
		if got := types.FailureKindOf(err.Error()); got != want {
			t.Errorf("data %s: kind = %q, want %q (message %q)", data, got, want, err.Error())
		}
	}
	methodMissing := &RPCError{Code: jsonrpcMethodNotFound, Message: "method not found"}
	if types.FailureKindOf(methodMissing.Error()) != types.FailureSetup {
		t.Fatalf("an unknown method is a bridge/app version mismatch, a setup problem: %q", methodMissing.Error())
	}
	var target *RPCError
	if !errors.As(errors.Join(methodMissing), &target) || !IsMethodNotFound(methodMissing) {
		t.Fatal("RPCError must survive wrapping and IsMethodNotFound must see the -32601 code")
	}
}

func TestProcessErrorsAreTaggedConnection(t *testing.T) {
	c := New(Options{RequestTimeout: 0})
	_, err := c.Request(nil, MethodInitialize, nil)
	if err == nil {
		t.Fatal("request on a stopped client must fail")
	}
	if types.FailureKindOf(err.Error()) != types.FailureConnection {
		t.Fatalf("not-running error kind = %q: %v", types.FailureKindOf(err.Error()), err)
	}
}
