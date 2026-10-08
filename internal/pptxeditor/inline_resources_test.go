package pptxeditor

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func dataURI(contentType string, data []byte) string {
	return "data:" + contentType + ";base64," + base64.StdEncoding.EncodeToString(data)
}

func documentWith(uris ...string) []byte {
	shapes := make([]any, 0, len(uris))
	for index, uri := range uris {
		shapes = append(shapes, map[string]any{
			"name": fmt.Sprintf("shape-%d", index+1),
			"fill": map[string]any{"kind": "blip", "resourceUri": uri, "alpha": 1},
		})
	}
	raw, err := json.Marshal(map[string]any{"slides": []any{map[string]any{"shapes": shapes}}})
	if err != nil {
		panic(err)
	}
	return raw
}

func resourceURIs(t *testing.T, content []byte) []string {
	t.Helper()
	var document any
	if err := json.Unmarshal(content, &document); err != nil {
		t.Fatal(err)
	}
	var found []string
	var walk func(any)
	walk = func(node any) {
		switch value := node.(type) {
		case []any:
			for _, item := range value {
				walk(item)
			}
		case map[string]any:
			if uri, ok := value["resourceUri"].(string); ok {
				found = append(found, uri)
			}
			for _, item := range value {
				walk(item)
			}
		}
	}
	walk(document)
	return found
}

func TestStageInlineResourcesMakesADrawnImageExportable(t *testing.T) {
	mop := t.TempDir()
	photo := []byte("jpeg-bytes-of-a-photo")
	digest := fmt.Sprintf("%x", sha256.Sum256(photo))

	staged, err := stageInlineResources(documentWith(dataURI("image/jpeg", photo)), mop)
	if err != nil {
		t.Fatal(err)
	}
	// mop-convert refuses any resource URI that is not mop-asset:/…
	uris := resourceURIs(t, staged)
	if len(uris) != 1 || uris[0] != "mop-asset:/media/"+digest+".jpg" {
		t.Fatalf("resource URIs = %v", uris)
	}
	pooled, err := os.ReadFile(filepath.Join(mop, "media", digest+".jpg"))
	if err != nil || string(pooled) != string(photo) {
		t.Fatalf("staged asset = %q (%v)", pooled, err)
	}
	// The descriptor the package expects alongside the URI travels with it.
	var document map[string]any
	if err := json.Unmarshal(staged, &document); err != nil {
		t.Fatal(err)
	}
	fill := document["slides"].([]any)[0].(map[string]any)["shapes"].([]any)[0].(map[string]any)["fill"].(map[string]any)
	if fill["digest"] != "sha256:"+digest || fill["contentType"] != "image/jpeg" ||
		fill["extension"] != "jpg" || fill["resourceSize"].(float64) != float64(len(photo)) {
		t.Fatalf("descriptor = %#v", fill)
	}
	// Unrelated fields survive the rewrite.
	if fill["alpha"].(float64) != 1 {
		t.Fatalf("alpha lost: %#v", fill)
	}
}

func TestStageInlineResourcesSharesOneAssetAcrossRepeatedImages(t *testing.T) {
	mop := t.TempDir()
	photo := []byte("same-bytes")
	uri := dataURI("image/png", photo)

	staged, err := stageInlineResources(documentWith(uri, uri), mop)
	if err != nil {
		t.Fatal(err)
	}
	uris := resourceURIs(t, staged)
	if len(uris) != 2 || uris[0] != uris[1] {
		t.Fatalf("resource URIs = %v, want one shared asset", uris)
	}
	entries, err := os.ReadDir(filepath.Join(mop, "media"))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("media = %v, want a single entry", entries)
	}
}

func TestStageInlineResourcesLeavesPackagedContentUntouched(t *testing.T) {
	mop := t.TempDir()
	content := documentWith("mop-asset:/media/abc.jpg")

	staged, err := stageInlineResources(content, mop)
	if err != nil {
		t.Fatal(err)
	}
	// Byte-for-byte identity: content that inlines nothing must not be
	// reserialized, so saves stay comparable and cheap.
	if string(staged) != string(content) {
		t.Fatalf("content was rewritten: %s", staged)
	}
	if _, err := os.Stat(filepath.Join(mop, "media")); !os.IsNotExist(err) {
		t.Fatal("no media directory should be created")
	}
}

func TestStageInlineResourcesKeepsUndecodableUrisAsTheyAre(t *testing.T) {
	mop := t.TempDir()
	// Not base64, and a bare data: URI with no payload: neither is something
	// this layer can stage, and neither may be silently dropped.
	content := documentWith("data:image/png,plain-text", "data:")

	staged, err := stageInlineResources(content, mop)
	if err != nil {
		t.Fatal(err)
	}
	if string(staged) != string(content) {
		t.Fatalf("content was rewritten: %s", staged)
	}
}

func TestStageInlineResourcesIgnoresNonJSONContent(t *testing.T) {
	staged, err := stageInlineResources([]byte("data: not json at all"), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if string(staged) != "data: not json at all" {
		t.Fatalf("content = %q", staged)
	}
}

func TestStageInlineResourcesRefusesAnOversizedInlineResource(t *testing.T) {
	huge := strings.Repeat("a", int(maxAssetBytes)+1)
	content := documentWith(dataURI("image/png", []byte(huge)))
	if _, err := stageInlineResources(content, t.TempDir()); err == nil {
		t.Fatal("an inline resource beyond the asset limit must be refused")
	}
}
