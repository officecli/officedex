package bridge

import (
	"encoding/json"
	"errors"
	"strings"

	"officedex/internal/types"
)

// RPCError is a JSON-RPC error answer from the bridge. It keeps the code and
// the structured data the bridge attached, so callers can decide by code
// instead of matching the message text, which used to be all that survived.
type RPCError struct {
	Method  string
	Code    int
	Message string
	Data    json.RawMessage
}

func (e *RPCError) Error() string {
	message := strings.TrimSpace(e.Message)
	if message == "" {
		message = "officecli bridge request failed"
	}
	return types.TagFailure(e.Kind(), "bridge: "+message)
}

// Kind maps the bridge's error.data.type onto the renderer's failure kinds.
func (e *RPCError) Kind() types.FailureKind {
	switch e.dataType() {
	case "auth_error":
		return types.FailureAuth
	case "configuration_error":
		return types.FailureSetup
	case "llm_error", "validation_error", "assembly_error", "io_error":
		return types.FailureTask
	}
	if e.Code == jsonrpcMethodNotFound {
		// The bridge is too old (or too new) for this app: a setup problem.
		return types.FailureSetup
	}
	return types.FailureOther
}

func (e *RPCError) dataType() string {
	if e == nil || len(e.Data) == 0 {
		return ""
	}
	var data struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(e.Data, &data); err != nil {
		return ""
	}
	return data.Type
}

// DataCode returns the machine-readable code the bridge put in error.data,
// or "" when there is none.
func (e *RPCError) DataCode() string {
	if e == nil || len(e.Data) == 0 {
		return ""
	}
	var data struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(e.Data, &data); err != nil {
		return ""
	}
	return data.Code
}

// Error codes the bridge attaches in error.data.code. They are part of the
// protocol (see MinProtocolVersion) and mirror officecli's bridgeErrorCode*.
const (
	ErrorCodeTaskNotFound    = "task_not_found"
	ErrorCodeSessionNotFound = "session_not_found"
	ErrorCodeMethodNotFound  = "method_not_found"
)

// jsonrpcMethodNotFound is the JSON-RPC 2.0 code for an unknown method.
const jsonrpcMethodNotFound = -32601

// IsTaskNotFound reports whether the bridge answered that the task it was
// asked about does not exist in that process.
func IsTaskNotFound(err error) bool {
	var rpc *RPCError
	return errors.As(err, &rpc) && rpc.DataCode() == ErrorCodeTaskNotFound
}

// IsMethodNotFound reports whether the bridge does not implement the method.
func IsMethodNotFound(err error) bool {
	var rpc *RPCError
	return errors.As(err, &rpc) && (rpc.Code == jsonrpcMethodNotFound || rpc.DataCode() == ErrorCodeMethodNotFound)
}
