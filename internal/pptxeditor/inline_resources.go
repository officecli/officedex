package pptxeditor

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"mime"
	"os"
	"path/filepath"
	"strings"
)

// A .mop package addresses its media by mop-asset:/media/<digest>.<ext>, and
// mop-convert refuses anything else. The editor, though, writes a fill set from
// raw bytes straight into the document as a data: URI — that is how the live
// drawing puts a picture on a slide — so a saved deck could reference an image
// no package asset backs, and the export failed with "resource URI must start
// with mop-asset:/". Staging those bytes as real assets on save keeps the
// package's contract true no matter which client wrote the content.

// stageInlineResources moves every inline data: resource into the package's
// media directory and rewrites the document to reference it. Content that
// inlines nothing is returned untouched, byte for byte.
func stageInlineResources(content []byte, mopDirectory string) ([]byte, error) {
	if !strings.Contains(string(content), "data:") {
		return content, nil
	}
	var document any
	if err := json.Unmarshal(content, &document); err != nil {
		// Not a JSON document: nothing to stage, and not this layer's business.
		return content, nil
	}
	staged := map[string]stagedResource{}
	if err := visitInlineResources(document, func(uri string) (stagedResource, bool, error) {
		if existing, ok := staged[uri]; ok {
			return existing, true, nil
		}
		resource, ok, err := stageDataURI(uri, mopDirectory)
		if err != nil || !ok {
			return stagedResource{}, false, err
		}
		staged[uri] = resource
		return resource, true, nil
	}); err != nil {
		return nil, err
	}
	if len(staged) == 0 {
		return content, nil
	}
	rewritten, err := json.Marshal(document)
	if err != nil {
		return nil, fmt.Errorf("pptx editor: rewrite inline resources: %w", err)
	}
	return rewritten, nil
}

// stagedResource is the descriptor a MOP document carries alongside a resource
// URI. The worker writes the same fields when it stages an authored image.
type stagedResource struct {
	ResourceURI  string
	ContentType  string
	Extension    string
	Digest       string
	ResourceSize int
}

func visitInlineResources(node any, stage func(string) (stagedResource, bool, error)) error {
	switch value := node.(type) {
	case []any:
		for _, item := range value {
			if err := visitInlineResources(item, stage); err != nil {
				return err
			}
		}
	case map[string]any:
		if uri, ok := value["resourceUri"].(string); ok && strings.HasPrefix(uri, "data:") {
			resource, staged, err := stage(uri)
			if err != nil {
				return err
			}
			if staged {
				value["resourceUri"] = resource.ResourceURI
				value["contentType"] = resource.ContentType
				value["extension"] = resource.Extension
				value["digest"] = resource.Digest
				value["resourceSize"] = resource.ResourceSize
			}
		}
		for _, item := range value {
			if err := visitInlineResources(item, stage); err != nil {
				return err
			}
		}
	}
	return nil
}

// stageDataURI writes one data: URI into the package. It reports false for a
// URI it cannot decode, leaving the document to fail later on its own terms
// rather than losing the reference here.
func stageDataURI(uri, mopDirectory string) (stagedResource, bool, error) {
	header, payload, found := strings.Cut(strings.TrimPrefix(uri, "data:"), ",")
	if !found || !strings.Contains(header, "base64") {
		return stagedResource{}, false, nil
	}
	contentType := strings.TrimSpace(strings.Split(header, ";")[0])
	data, err := base64.StdEncoding.DecodeString(payload)
	if err != nil || len(data) == 0 {
		return stagedResource{}, false, nil
	}
	if int64(len(data)) > maxAssetBytes {
		return stagedResource{}, false, fmt.Errorf("pptx editor: inline resource exceeds %d bytes", maxAssetBytes)
	}
	digest := fmt.Sprintf("%x", sha256.Sum256(data))
	name := digest + inlineResourceExtension(contentType)
	target := filepath.Join(mopDirectory, "media", name)
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		return stagedResource{}, false, fmt.Errorf("pptx editor: create media directory: %w", err)
	}
	// Content addressing makes the write idempotent: a file of the right size
	// under a digest name already holds these bytes.
	if info, err := os.Stat(target); err != nil || info.Size() != int64(len(data)) {
		if err := os.WriteFile(target, data, 0o600); err != nil {
			return stagedResource{}, false, fmt.Errorf("pptx editor: stage inline resource: %w", err)
		}
	}
	return stagedResource{
		ResourceURI:  "mop-asset:/media/" + name,
		ContentType:  contentType,
		Extension:    strings.TrimPrefix(inlineResourceExtension(contentType), "."),
		Digest:       "sha256:" + digest,
		ResourceSize: len(data),
	}, true, nil
}

func inlineResourceExtension(contentType string) string {
	switch strings.ToLower(strings.TrimSpace(contentType)) {
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	case "image/svg+xml":
		return ".svg"
	}
	if extensions, err := mime.ExtensionsByType(contentType); err == nil && len(extensions) > 0 {
		return extensions[0]
	}
	return ".bin"
}
