package mophttp

import (
	"encoding/json"
	"testing"
)

func TestValidEnvelopeRejectsMalformedSnapshots(t *testing.T) {
	for _, testCase := range []struct {
		name    string
		content string
	}{
		{name: "wrong magic", content: `{"magic":"zip0","version":1,"blocks":[]}`},
		{name: "wrong version", content: `{"magic":"mop0","version":2,"blocks":[]}`},
		{name: "blocks not an array", content: `{"magic":"mop0","version":1,"blocks":{}}`},
		{name: "not an object", content: `[]`},
		{name: "not json", content: `nope`},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			if _, err := parseValidSnapshot([]byte(testCase.content)); err == nil {
				t.Error("accepted a snapshot the editor would reject")
			}
		})
	}
}

// Large integers must survive a round trip. Decoding through float64 would
// re-emit 9007199254740993 as 9007199254740992 and 1000000 as 1e+06, silently
// changing the bytes the editor digests.
func TestSnapshotRoundTripPreservesIntegerFormatting(t *testing.T) {
	content := []byte(`{"magic":"mop0","version":1,"blocks":[{"type":"slides","data":[` +
		`{"type":"chartStyle","data":[]},` +
		`{"type":"slide","attrs":{"logicalId":"s1","offset":1000000,"big":9007199254740993},"data":[]}]}]}`)

	normalized := normalizeExportContent(content)
	var decoded map[string]any
	if err := json.Unmarshal(normalized, &decoded); err != nil {
		t.Fatalf("decode normalized: %v", err)
	}
	if string(normalized) == string(content) {
		t.Fatal("expected the empty chartStyle to be removed")
	}
	for _, literal := range []string{"1000000", "9007199254740993"} {
		if !containsLiteral(normalized, literal) {
			t.Errorf("normalized snapshot lost the exact literal %s: %s", literal, normalized)
		}
	}
}

func containsLiteral(content []byte, literal string) bool {
	return len(literal) > 0 && string(content) != "" && indexOf(string(content), literal) >= 0
}

func indexOf(haystack, needle string) int {
	for index := 0; index+len(needle) <= len(haystack); index++ {
		if haystack[index:index+len(needle)] == needle {
			return index
		}
	}
	return -1
}

func TestNormalizeExportContentLeavesCleanSnapshotsUntouched(t *testing.T) {
	content := validSnapshot("slide-1")
	if got := normalizeExportContent(content); string(got) != string(content) {
		t.Errorf("clean snapshot was rewritten:\n got %s\nwant %s", got, content)
	}
}

func TestNormalizeExportContentPassesThroughUnparseableBytes(t *testing.T) {
	// The converter, not this server, should explain what is wrong with it.
	content := []byte("not json at all")
	if got := normalizeExportContent(content); string(got) != string(content) {
		t.Errorf("unparseable content was rewritten to %s", got)
	}
}

func TestSnapshotSlideCount(t *testing.T) {
	count, err := snapshotSlideCount(validSnapshot("a", "b", "c"))
	if err != nil {
		t.Fatalf("slide count: %v", err)
	}
	if count != 3 {
		t.Errorf("count = %d, want 3", count)
	}
	if _, err := snapshotSlideCount([]byte(`{"magic":"mop0","version":1,"blocks":[]}`)); err == nil {
		t.Error("a snapshot without a slides block should be unreadable, not zero slides")
	}
}

func TestCollectResourcePathsIgnoresUnsafeURIs(t *testing.T) {
	content := []byte(`{"magic":"mop0","version":1,"blocks":[{"type":"slides","data":[
		{"resourceUri":"mop-asset:/media/a.png"},
		{"resourceUri":"mop-asset:/embeddings/b.xlsx"},
		{"resourceUri":"mop-asset:/media/../escape.png"},
		{"resourceUri":"https://example.com/c.png"},
		{"resourceUri":"mop-asset:/other/d.png"}]}]}`)

	resources, err := collectResourcePaths(content)
	if err != nil {
		t.Fatalf("collect: %v", err)
	}
	if len(resources) != 2 || !resources["media/a.png"] || !resources["embeddings/b.xlsx"] {
		t.Errorf("resources = %v, want only the two well-formed package assets", resources)
	}
}

func TestCreateSingleSlideSnapshotPrunesSlideOwnedRegistries(t *testing.T) {
	snapshot := map[string]any{
		"magic":   "mop0",
		"version": 1,
		"blocks": []any{
			map[string]any{"type": "slides", "data": []any{
				map[string]any{"type": "slide", "attrs": map[string]any{"logicalId": "s1"}, "data": []any{
					map[string]any{"attrs": map[string]any{"logicalId": "shape-1"}},
				}},
				map[string]any{"type": "slide", "attrs": map[string]any{"logicalId": "s2"}, "data": []any{}},
			}},
			map[string]any{"type": "presentation", "data": []any{
				map[string]any{"type": "slideOrder", "data": []any{
					map[string]any{"type": "slideRef", "attrs": map[string]any{"targetRef": "s1"}},
					map[string]any{"type": "slideRef", "attrs": map[string]any{"targetRef": "s2"}},
				}},
			}},
			map[string]any{"type": "notesSlides", "data": []any{
				map[string]any{"attrs": map[string]any{"ownerSlideRef": "s1"}},
				map[string]any{"attrs": map[string]any{"ownerSlideRef": "s2"}},
			}},
			map[string]any{"type": "tagLists", "data": []any{
				map[string]any{"attrs": map[string]any{"ownerRef": "shape-1"}},
				map[string]any{"attrs": map[string]any{"ownerRef": "shape-9"}},
			}},
			// Shared registries are carried whole: pruning their transitive
			// references is riskier than copying them.
			map[string]any{"type": "themes", "data": []any{
				map[string]any{"attrs": map[string]any{"logicalId": "theme-1"}},
			}},
		},
	}
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	result, err := createSingleSlideSnapshot(encoded, "s1")
	if err != nil {
		t.Fatalf("single slide: %v", err)
	}
	var pruned map[string]any
	if err := json.Unmarshal(result, &pruned); err != nil {
		t.Fatalf("decode: %v", err)
	}
	blocks, _ := pruned["blocks"].([]any)
	byType := map[string][]any{}
	for _, entry := range blocks {
		block, _ := entry.(map[string]any)
		blockType, _ := block["type"].(string)
		data, _ := block["data"].([]any)
		byType[blockType] = data
	}

	if len(byType["slides"]) != 1 {
		t.Errorf("slides = %d, want 1", len(byType["slides"]))
	}
	if len(byType["notesSlides"]) != 1 {
		t.Errorf("notesSlides = %d, want only the kept slide's notes", len(byType["notesSlides"]))
	}
	if len(byType["tagLists"]) != 1 {
		t.Errorf("tagLists = %d, want only tags owned by the kept slide", len(byType["tagLists"]))
	}
	if len(byType["themes"]) != 1 {
		t.Errorf("themes = %d, shared registries must be carried whole", len(byType["themes"]))
	}
	presentation, _ := byType["presentation"][0].(map[string]any)
	order, _ := presentation["data"].([]any)
	if len(order) != 1 {
		t.Fatalf("slideOrder = %d, want 1", len(order))
	}
	entry, _ := order[0].(map[string]any)
	attrs, _ := entry["attrs"].(map[string]any)
	if attrs["targetRef"] != "s1" {
		t.Errorf("slideOrder target = %v, want s1", attrs["targetRef"])
	}
}

func TestCreateSingleSlideSnapshotRequiresSlideOrder(t *testing.T) {
	content := []byte(`{"magic":"mop0","version":1,"blocks":[
		{"type":"slides","data":[{"type":"slide","attrs":{"logicalId":"s1"},"data":[]}]}]}`)
	_, err := createSingleSlideSnapshot(content, "s1")
	var typed *apiError
	if !asAPIError(err, &typed) || typed.code != "INVALID_MOP_CONTENT" {
		t.Fatalf("error = %v, want INVALID_MOP_CONTENT", err)
	}
}

func asAPIError(err error, target **apiError) bool {
	typed, ok := err.(*apiError)
	if ok {
		*target = typed
	}
	return ok
}

func TestEncodeURIComponentMatchesJavaScript(t *testing.T) {
	// The editor round-trips these headers through decodeURIComponent, so the
	// escaping must agree with encodeURIComponent exactly.
	for input, want := range map[string]string{
		"Quarterly Review": "Quarterly%20Review",
		"a+b":              "a%2Bb",
		"season/2":         "season%2F2",
		"报告":               "%E6%8A%A5%E5%91%8A",
		"safe-_.!~*'()":    "safe-_.!~*'()",
		"100% done":        "100%25%20done",
	} {
		if got := encodeURIComponent(input); got != want {
			t.Errorf("encodeURIComponent(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestSafePptxSourceName(t *testing.T) {
	for input, want := range map[string]string{
		"deck.pptx":         "deck.pptx",
		"deck":              "deck.pptx",
		"../../etc/passwd":  "passwd.pptx",
		"a/b/c.pptx":        "c.pptx",
		`weird:"name*.pptx`: "weird_name_.pptx",
		"":                  "presentation.pptx",
	} {
		if got := safePptxSourceName(input); got != want {
			t.Errorf("safePptxSourceName(%q) = %q, want %q", input, got, want)
		}
	}
}
