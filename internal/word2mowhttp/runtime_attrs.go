package word2mowhttp

import (
	"encoding/json"
	"fmt"
	"os"
)

// dropWriterRuntimeAttrs removes Writer's runtime `nodeId` from a MOW
// content.json before word2mow export. The identity is not an OOXML field;
// the pinned converter rejects it on any table. Other unknown keys are left
// in place so the converter still fails closed on a real mapping drift.
//
// The file is rewritten only when a key was removed, so a package that never
// carried nodeId keeps the bytes the editor sent.
func dropWriterRuntimeAttrs(path string) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return fmt.Errorf("content.json is not a JSON snapshot: %w", err)
	}
	if !stripRuntimeNodeID(value) {
		return nil
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return os.WriteFile(path, encoded, 0o644)
}

func stripRuntimeNodeID(value any) bool {
	switch node := value.(type) {
	case map[string]any:
		_, removed := node["nodeId"]
		delete(node, "nodeId")
		for _, child := range node {
			if stripRuntimeNodeID(child) {
				removed = true
			}
		}
		return removed
	case []any:
		removed := false
		for _, child := range node {
			if stripRuntimeNodeID(child) {
				removed = true
			}
		}
		return removed
	default:
		return false
	}
}
