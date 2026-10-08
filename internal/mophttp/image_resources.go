package mophttp

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"path/filepath"
	"strings"
)

// materializeImageResources upgrades legacy Data URLs in an export staging
// directory. It leaves the live snapshot/revision digest unchanged. Assets are
// written before any reference is committed to content.json.
func materializeImageResources(content []byte, packageRoot string) ([]byte, error) {
	snapshot, err := decodeSnapshot(content)
	if err != nil {
		return content, nil
	}
	extensions := map[string]string{"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/bmp": "bmp", "image/webp": "webp", "image/svg+xml": "svg"}
	changed := false
	var visit func(any, string) error
	visit = func(value any, location string) error {
		switch node := value.(type) {
		case []any:
			for i, child := range node {
				if err := visit(child, fmt.Sprintf("%s[%d]", location, i)); err != nil {
					return err
				}
			}
		case map[string]any:
			if legacy, ok := node["transparency"]; ok && node["kind"] == "blip" {
				number, ok := legacy.(json.Number)
				transparency, parseErr := number.Float64()
				if !ok || parseErr != nil || math.IsNaN(transparency) || transparency < 0 || transparency > 1 {
					return &apiError{status: 400, code: "MOP_INVALID_IMAGE_RESOURCE", message: "An embedded image could not be saved.", detail: fmt.Sprintf("Invalid image transparency at %s.transparency", location)}
				}
				effects := []any{}
				if existing, ok := node["blipEffects"].([]any); ok {
					for _, effect := range existing {
						if attrs, ok := effect.(map[string]any); !ok || attrs["kind"] != "alphaModFix" {
							effects = append(effects, effect)
						}
					}
				}
				node["blipEffects"] = append(effects, map[string]any{"kind": "alphaModFix", "amount": int(math.Round((1 - transparency) * 100000))})
				delete(node, "transparency")
				changed = true
			}
			if uri, ok := node["resourceUri"].(string); ok && strings.HasPrefix(uri, "data:") {
				header, encoded, found := strings.Cut(uri, ",")
				contentType := strings.TrimSuffix(strings.TrimPrefix(header, "data:"), ";base64")
				extension := extensions[contentType]
				encoded = strings.Join(strings.Fields(encoded), "")
				bytes, decodeErr := base64.StdEncoding.Strict().DecodeString(encoded)
				if !found || !strings.HasSuffix(header, ";base64") || extension == "" || decodeErr != nil || len(bytes) == 0 || len(bytes) > 20*1024*1024 {
					return &apiError{status: 400, code: "MOP_INVALID_IMAGE_RESOURCE", message: "An embedded image could not be saved.", detail: fmt.Sprintf("Invalid embedded image at %s.resourceUri", location)}
				}
				digest := fmt.Sprintf("%x", sha256.Sum256(bytes))
				relative := "media/" + digest + "." + extension
				if err := writeFileAtomically(filepath.Join(packageRoot, filepath.FromSlash(relative)), bytes); err != nil {
					return err
				}
				node["resourceUri"] = "mop-asset:/" + relative
				node["contentType"] = contentType
				node["extension"] = extension
				node["digest"] = "sha256:" + digest
				node["resourceSize"] = len(bytes)
				changed = true
			}
			for key, child := range node {
				if err := visit(child, location+"."+key); err != nil {
					return err
				}
			}
		}
		return nil
	}
	if err := visit(snapshot, "root"); err != nil {
		return nil, err
	}
	if !changed {
		return content, nil
	}
	return json.Marshal(snapshot)
}
