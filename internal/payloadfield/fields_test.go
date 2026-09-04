package payloadfield

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestStringPrefersTheFirstKeyThatHasAValue(t *testing.T) {
	payload := map[string]any{"document_type": "", "documentType": "pptx"}
	if got := String(payload, "document_type", "documentType"); got != "pptx" {
		t.Fatalf("String = %q, want the legacy camelCase fallback when the canonical key is empty", got)
	}
	if got := String(nil, "prompt"); got != "" {
		t.Fatalf("String(nil) = %q", got)
	}
	if got := String(map[string]any{"prompt": 42}, "prompt"); got != "" {
		t.Fatalf("a non-string value must not be coerced, got %q", got)
	}
}

func TestNestedStringFallsBackIntoContainers(t *testing.T) {
	payload := map[string]any{"text_input": map[string]any{"topic": "Quarterly report"}}
	if got := NestedString(payload, []string{"topic"}, "content_input", "text_input"); got != "Quarterly report" {
		t.Fatalf("NestedString = %q", got)
	}
	payload["topic"] = "Top level wins"
	if got := NestedString(payload, []string{"topic"}, "text_input"); got != "Top level wins" {
		t.Fatalf("NestedString = %q, want the top-level value", got)
	}
}

func TestIntAcceptsEveryNumericEncoding(t *testing.T) {
	cases := map[string]any{"int": 12, "int64": int64(12), "float64": 12.0, "json.Number": json.Number("12")}
	for name, value := range cases {
		if got := Int(map[string]any{"fps": value}, "fps"); got != 12 {
			t.Errorf("%s: Int = %d, want 12", name, got)
		}
	}
	if got := Int(map[string]any{"fps": "12"}, "fps"); got != 0 {
		t.Fatalf("a numeric string is not a number, got %d", got)
	}
}

func TestOptionalBoolReportsPresence(t *testing.T) {
	if v, ok := OptionalBool(map[string]any{"publish": "TRUE"}, "publish"); !ok || !v {
		t.Fatalf("string true: (%v,%v)", v, ok)
	}
	if v, ok := OptionalBool(map[string]any{"publish": false}, "publish"); !ok || v {
		t.Fatalf("bool false must still count as present: (%v,%v)", v, ok)
	}
	if _, ok := OptionalBool(map[string]any{"publish": "yes"}, "publish"); ok {
		t.Fatal("\"yes\" is not a boolean")
	}
	if _, ok := OptionalBool(map[string]any{}, "publish"); ok {
		t.Fatal("absent key reported as present")
	}
}

func TestStringSliceDropsBlanksAndCopies(t *testing.T) {
	src := []string{"a.png", "b.png"}
	got := StringSlice(map[string]any{"reference_images": src}, "reference_images")
	got[0] = "mutated"
	if src[0] != "a.png" {
		t.Fatal("StringSlice must copy a []string, not alias it")
	}
	got = StringSlice(map[string]any{"reference_images": []any{"a.png", "  ", 3, "c.png"}}, "reference_images")
	if want := []string{"a.png", "c.png"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("StringSlice = %v, want %v", got, want)
	}
}
