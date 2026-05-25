package bridge

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"

	"officedex/internal/types"
)

// jsonrpcRequest is the outbound JSON-RPC 2.0 request envelope.
type jsonrpcRequest struct {
	JSONRPC string `json:"jsonrpc"`
	ID      int    `json:"id"`
	Method  string `json:"method"`
	Params  any    `json:"params,omitempty"`
}

// jsonrpcMessage is the parsed shape of an inbound message; either a response
// (ID + Result/Error) or a notification (Method + Params).
type jsonrpcMessage struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *jsonrpcError   `json:"error,omitempty"`
}

type jsonrpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (m *jsonrpcMessage) hasID() bool {
	if len(m.ID) == 0 {
		return false
	}
	return string(m.ID) != "null"
}

// idString decodes the ID field which may be a number or a string in JSON.
func (m *jsonrpcMessage) idString() string {
	if len(m.ID) == 0 {
		return ""
	}
	raw := string(m.ID)
	if len(raw) >= 2 && raw[0] == '"' && raw[len(raw)-1] == '"' {
		return raw[1 : len(raw)-1]
	}
	return raw
}

func parseJSONRPCMessage(body []byte) (*jsonrpcMessage, bool) {
	var msg jsonrpcMessage
	if err := json.Unmarshal(body, &msg); err != nil {
		return nil, false
	}
	return &msg, true
}

func writeJSONRPC(transport Transport, req jsonrpcRequest) error {
	body, err := json.Marshal(req)
	if err != nil {
		return fmt.Errorf("bridge: marshal request: %w", err)
	}
	header := []byte(fmt.Sprintf("Content-Length: %d\r\n\r\n", len(body)))
	if _, err := transport.Stdin().Write(header); err != nil {
		return fmt.Errorf("bridge: write header: %w", err)
	}
	if _, err := transport.Stdin().Write(body); err != nil {
		return fmt.Errorf("bridge: write body: %w", err)
	}
	return nil
}

var contentLengthPattern = regexp.MustCompile(`(?im)^content-length:\s*(\d+)$`)

// nextFrame consumes one complete LSP frame from buf in place. Returns the
// body bytes and true when a frame is ready; false when more data is needed.
// On a malformed header (no Content-Length match) the header section is
// discarded and the loop retries on the remaining bytes.
func nextFrame(buf *[]byte) ([]byte, bool) {
	for {
		separator := bytes.Index(*buf, []byte("\r\n\r\n"))
		if separator < 0 {
			return nil, false
		}
		header := (*buf)[:separator]
		match := contentLengthPattern.FindSubmatch(header)
		if match == nil {
			*buf = (*buf)[separator+4:]
			continue
		}
		length, err := strconv.Atoi(string(match[1]))
		if err != nil {
			*buf = (*buf)[separator+4:]
			continue
		}
		bodyStart := separator + 4
		messageEnd := bodyStart + length
		if len(*buf) < messageEnd {
			return nil, false
		}
		body := append([]byte(nil), (*buf)[bodyStart:messageEnd]...)
		*buf = (*buf)[messageEnd:]
		return body, true
	}
}

// normalizeBridgeEvent projects a server-initiated notification (method +
// params) into the BridgeEvent shape the renderer expects. If params already
// looks like a BridgeEvent (object with `type` field) it is preserved.
func normalizeBridgeEvent(method string, params json.RawMessage) types.BridgeEvent {
	if len(params) > 0 {
		var probe map[string]any
		if err := json.Unmarshal(params, &probe); err == nil {
			if _, ok := probe["type"].(string); ok {
				var event types.BridgeEvent
				if err := json.Unmarshal(params, &event); err == nil {
					return event
				}
			}
		}
	}
	var payload map[string]any
	if len(params) > 0 {
		_ = json.Unmarshal(params, &payload)
	}
	return types.BridgeEvent{Type: method, Payload: payload}
}

func decodeJSON(raw []byte, dest any) error {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	return json.Unmarshal(raw, dest)
}

func decodeStringField(raw []byte, field string) string {
	if len(raw) == 0 {
		return ""
	}
	var obj map[string]any
	if err := json.Unmarshal(raw, &obj); err != nil {
		return ""
	}
	if v, ok := obj[field].(string); ok {
		return v
	}
	return ""
}
