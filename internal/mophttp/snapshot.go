package mophttp

import (
	"bytes"
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
)

// A MOP snapshot is a JSON envelope: {magic:"mop0", version:1, blocks:[...]}.
// Blocks are `{type, attrs, data}` nodes nested arbitrarily deep. Everything
// here walks that generic tree rather than modelling it, because the schema is
// owned by the Rust converter and changes independently of this server.

// decodeSnapshot parses a snapshot with numbers preserved as json.Number.
// Without UseNumber a re-serialized snapshot would rewrite integers through
// float64 and could emit `1e+06` where the converter wrote `1000000`, which
// changes bytes the editor digests for revision tracking.
func decodeSnapshot(content []byte) (map[string]any, error) {
	decoder := json.NewDecoder(bytes.NewReader(content))
	decoder.UseNumber()
	var snapshot any
	if err := decoder.Decode(&snapshot); err != nil {
		return nil, err
	}
	object, ok := snapshot.(map[string]any)
	if !ok {
		return nil, errNotAnEnvelope
	}
	return object, nil
}

type snapshotError string

func (e snapshotError) Error() string { return string(e) }

const errNotAnEnvelope = snapshotError("invalid MOP snapshot envelope")

// validEnvelope is the check the dev server repeats at every entry point that
// accepts a snapshot from the editor or the converter.
func validEnvelope(snapshot map[string]any) bool {
	if magic, _ := snapshot["magic"].(string); magic != "mop0" {
		return false
	}
	version, ok := snapshot["version"].(json.Number)
	if !ok || version.String() != "1" {
		return false
	}
	_, hasBlocks := snapshot["blocks"].([]any)
	return hasBlocks
}

// parseValidSnapshot decodes and validates in one step, which is what every
// caller actually wants.
func parseValidSnapshot(content []byte) (map[string]any, error) {
	snapshot, err := decodeSnapshot(content)
	if err != nil {
		return nil, err
	}
	if !validEnvelope(snapshot) {
		return nil, errNotAnEnvelope
	}
	return snapshot, nil
}

func blocksOf(snapshot map[string]any) []any {
	blocks, _ := snapshot["blocks"].([]any)
	return blocks
}

// findBlock returns the first top-level block of the given type. The schema
// allows at most one of each of the types this server cares about.
func findBlock(snapshot map[string]any, blockType string) map[string]any {
	for _, entry := range blocksOf(snapshot) {
		block, ok := entry.(map[string]any)
		if !ok {
			continue
		}
		if actual, _ := block["type"].(string); actual == blockType {
			return block
		}
	}
	return nil
}

func blockData(block map[string]any) []any {
	if block == nil {
		return nil
	}
	data, _ := block["data"].([]any)
	return data
}

// snapshotSlideCount powers the `slideCount` field of the examples listing. A
// package whose snapshot has no slides block is treated as unreadable by the
// caller, matching the dev server, which skips such an entry rather than
// reporting zero slides.
func snapshotSlideCount(content []byte) (int, error) {
	snapshot, err := decodeSnapshot(content)
	if err != nil {
		return 0, err
	}
	slides := findBlock(snapshot, "slides")
	if slides == nil {
		return 0, errNotAnEnvelope
	}
	data, ok := slides["data"].([]any)
	if !ok {
		return 0, errNotAnEnvelope
	}
	return len(data), nil
}

var resourceURIPattern = regexp.MustCompile(`^mop-asset:/(?:media|embeddings)/[A-Za-z0-9._-]+$`)

// collectResourcePaths finds every asset a snapshot references, so an export
// copies only the media that the exported content actually uses. Returning a
// set of `media/<name>` paths matches the keys copyInto compares against.
func collectResourcePaths(content []byte) (map[string]bool, error) {
	var root any
	decoder := json.NewDecoder(bytes.NewReader(content))
	decoder.UseNumber()
	if err := decoder.Decode(&root); err != nil {
		return nil, err
	}
	resources := make(map[string]bool)
	var visit func(value any)
	visit = func(value any) {
		switch typed := value.(type) {
		case []any:
			for _, item := range typed {
				visit(item)
			}
		case map[string]any:
			if uri, ok := typed["resourceUri"].(string); ok && resourceURIPattern.MatchString(uri) {
				resources[strings.TrimPrefix(uri, "mop-asset:/")] = true
			}
			for _, nested := range typed {
				visit(nested)
			}
		}
	}
	visit(root)
	return resources, nil
}

// collectLogicalIds gathers every `attrs.logicalId` under a subtree. Slide
// export uses it to decide which slide-owned registry entries to keep.
func collectLogicalIds(value any, result map[string]bool) {
	switch typed := value.(type) {
	case []any:
		for _, item := range typed {
			collectLogicalIds(item, result)
		}
	case map[string]any:
		if attrs, ok := typed["attrs"].(map[string]any); ok {
			if id, ok := attrs["logicalId"].(string); ok {
				result[id] = true
			}
		}
		for _, nested := range typed {
			collectLogicalIds(nested, result)
		}
	}
}

func attrString(node any, key string) (string, bool) {
	object, ok := node.(map[string]any)
	if !ok {
		return "", false
	}
	attrs, ok := object["attrs"].(map[string]any)
	if !ok {
		return "", false
	}
	value, ok := attrs[key].(string)
	return value, ok
}

// createSingleSlideSnapshot builds the one-slide package behind the editor's
// Slide.exportAsBase64(). Shared theme/master/layout registries are copied
// whole because pruning their transitive references is riskier than carrying
// them, while slide-owned registries are filtered so the resulting PPTX
// contains exactly one slide.
func createSingleSlideSnapshot(content []byte, slideID string) ([]byte, error) {
	snapshot, err := decodeSnapshot(content)
	if err != nil || !validEnvelope(snapshot) || slideID == "" {
		return nil, newAPIError(http.StatusBadRequest, "INVALID_MOP_CONTENT", "The editor snapshot is not a MOP package.")
	}

	slides := findBlock(snapshot, "slides")
	var targetSlide any
	for _, entry := range blockData(slides) {
		if id, ok := attrString(entry, "logicalId"); ok && id == slideID {
			targetSlide = entry
			break
		}
	}
	if targetSlide == nil {
		return nil, newAPIError(http.StatusNotFound, "SLIDE_NOT_FOUND", "The requested slide does not exist.")
	}
	slides["data"] = []any{targetSlide}

	slideOrder := findNestedBlock(findBlock(snapshot, "presentation"), "slideOrder")
	if slideOrder == nil {
		return nil, newAPIError(422, "INVALID_MOP_CONTENT", "The MOP package is missing slide order.")
	}
	slideOrder["data"] = []any{map[string]any{
		"type":  "slideRef",
		"attrs": map[string]any{"targetRef": slideID},
		"data":  nil,
	}}

	ownedLogicalIDs := map[string]bool{slideID: true}
	collectLogicalIds(targetSlide, ownedLogicalIDs)
	for _, entry := range blocksOf(snapshot) {
		block, ok := entry.(map[string]any)
		if !ok {
			continue
		}
		data, ok := block["data"].([]any)
		if !ok {
			continue
		}
		blockType, _ := block["type"].(string)
		switch blockType {
		case "notesSlides", "commentLists":
			block["data"] = filterNodes(data, func(item any) bool {
				owner, ok := attrString(item, "ownerSlideRef")
				return ok && owner == slideID
			})
		case "tagLists":
			block["data"] = filterNodes(data, func(item any) bool {
				owner, ok := attrString(item, "ownerRef")
				return ok && ownedLogicalIDs[owner]
			})
		}
	}
	return json.Marshal(snapshot)
}

// findNestedBlock looks one level into a block's data, which is where the
// presentation block keeps slideOrder.
func findNestedBlock(parent map[string]any, blockType string) map[string]any {
	for _, entry := range blockData(parent) {
		block, ok := entry.(map[string]any)
		if !ok {
			continue
		}
		if actual, _ := block["type"].(string); actual == blockType {
			return block
		}
	}
	return nil
}

func filterNodes(items []any, keep func(any) bool) []any {
	filtered := make([]any, 0, len(items))
	for _, item := range items {
		if keep(item) {
			filtered = append(filtered, item)
		}
	}
	return filtered
}

// removeEmptyChartStyles drops `chartStyle` nodes with an empty data array.
// The converter rejects them on export, so the dev server strips them from the
// snapshot on its way out; returning `changed` lets the caller keep the
// original bytes untouched when there is nothing to strip.
func removeEmptyChartStyles(value any) (any, bool) {
	switch typed := value.(type) {
	case []any:
		changed := false
		filtered := make([]any, 0, len(typed))
		for _, item := range typed {
			if isEmptyChartStyle(item) {
				changed = true
				continue
			}
			cleaned, childChanged := removeEmptyChartStyles(item)
			if childChanged {
				changed = true
			}
			filtered = append(filtered, cleaned)
		}
		if !changed {
			return typed, false
		}
		return filtered, true
	case map[string]any:
		changed := false
		for key, nested := range typed {
			cleaned, childChanged := removeEmptyChartStyles(nested)
			if childChanged {
				typed[key] = cleaned
				changed = true
			}
		}
		return typed, changed
	default:
		return value, false
	}
}

func isEmptyChartStyle(value any) bool {
	node, ok := value.(map[string]any)
	if !ok {
		return false
	}
	if nodeType, _ := node["type"].(string); nodeType != "chartStyle" {
		return false
	}
	data, ok := node["data"].([]any)
	return ok && len(data) == 0
}

// normalizeExportContent is the last transform applied to content.json before
// it reaches the converter. Unparseable content is passed through untouched so
// the converter, not this server, reports what is wrong with it.
func normalizeExportContent(content []byte) []byte {
	snapshot, err := decodeSnapshot(content)
	if err != nil {
		return content
	}
	cleaned, changed := removeEmptyChartStyles(snapshot)
	if !changed {
		return content
	}
	encoded, err := json.Marshal(cleaned)
	if err != nil {
		return content
	}
	return encoded
}
