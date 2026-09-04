// Package payloadfield reads loosely typed event payloads (map[string]any as
// decoded from JSON or built in-process). Every reader takes a list of keys
// and returns the first one that is present with a usable value, so callers
// can accept both the canonical snake_case key and a legacy camelCase spelling
// that older rows in the local store may still carry.
package payloadfield

import (
	"encoding/json"
	"strings"
)

// String returns the first non-empty string under any of keys.
func String(payload map[string]any, keys ...string) string {
	if payload == nil {
		return ""
	}
	for _, k := range keys {
		if v, ok := payload[k]; ok {
			if s, ok := v.(string); ok && s != "" {
				return s
			}
		}
	}
	return ""
}

// Map returns the first nested object under any of keys.
func Map(payload map[string]any, keys ...string) map[string]any {
	if payload == nil {
		return nil
	}
	for _, k := range keys {
		v, ok := payload[k]
		if !ok {
			continue
		}
		if item, ok := v.(map[string]any); ok {
			return item
		}
	}
	return nil
}

// NestedString looks for fieldKeys at the top level first, then inside each
// of the containerKeys objects, in order.
func NestedString(payload map[string]any, fieldKeys []string, containerKeys ...string) string {
	if v := String(payload, fieldKeys...); v != "" {
		return v
	}
	for _, key := range containerKeys {
		if v := String(Map(payload, key), fieldKeys...); v != "" {
			return v
		}
	}
	return ""
}

// Int returns the first numeric value under any of keys; JSON decoding
// yields float64 or json.Number, in-process payloads carry int.
func Int(payload map[string]any, keys ...string) int {
	if payload == nil {
		return 0
	}
	for _, k := range keys {
		v, ok := payload[k]
		if !ok {
			continue
		}
		switch n := v.(type) {
		case int:
			return n
		case int64:
			return int(n)
		case float64:
			return int(n)
		case json.Number:
			if i, err := n.Int64(); err == nil {
				return int(i)
			}
		}
	}
	return 0
}

// Bool is OptionalBool without the presence flag.
func Bool(payload map[string]any, keys ...string) bool {
	v, _ := OptionalBool(payload, keys...)
	return v
}

// OptionalBool returns the value and whether any key carried a boolean (or
// the strings "true"/"false", which some CLI-side encoders emit).
func OptionalBool(payload map[string]any, keys ...string) (bool, bool) {
	if payload == nil {
		return false, false
	}
	for _, k := range keys {
		v, ok := payload[k]
		if !ok {
			continue
		}
		switch b := v.(type) {
		case bool:
			return b, true
		case string:
			if strings.EqualFold(b, "true") {
				return true, true
			}
			if strings.EqualFold(b, "false") {
				return false, true
			}
		}
	}
	return false, false
}

// StringSlice returns the first list under any of keys, dropping non-string
// and blank items. The result is always a fresh slice.
func StringSlice(payload map[string]any, keys ...string) []string {
	if payload == nil {
		return nil
	}
	for _, k := range keys {
		v, ok := payload[k]
		if !ok {
			continue
		}
		switch items := v.(type) {
		case []string:
			return append([]string(nil), items...)
		case []any:
			out := make([]string, 0, len(items))
			for _, item := range items {
				if s, ok := item.(string); ok && strings.TrimSpace(s) != "" {
					out = append(out, s)
				}
			}
			return out
		}
	}
	return nil
}
