package mophttp

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const legacyPNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

func TestLegacyImageResources(t *testing.T) {
	root := t.TempDir()
	original := []byte(`{"blocks":[{"resourceUri":"data:image/png;base64,` + legacyPNG + `"},{"resourceUri":"data:image/png;base64,` + legacyPNG + `"}],"largeInteger":9007199254740993}`)
	converted, err := materializeImageResources(original, root)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(converted, []byte("data:image")) || !bytes.Contains(converted, []byte("9007199254740993")) {
		t.Fatal("bad normalized snapshot")
	}
	files, err := os.ReadDir(filepath.Join(root, "media"))
	if err != nil || len(files) != 1 {
		t.Fatalf("expected one deduplicated asset: %v %v", files, err)
	}
	data, err := os.ReadFile(filepath.Join(root, "media", files[0].Name()))
	expected, _ := base64.StdEncoding.DecodeString(legacyPNG)
	if err != nil || !bytes.Equal(data, expected) {
		t.Fatal("image bytes changed")
	}
	again, err := materializeImageResources(converted, root)
	if err != nil || !bytes.Equal(converted, again) {
		t.Fatal("not idempotent")
	}
	for _, uri := range []string{"data:image/png;base64,%%%", "data:text/html;base64,YQ==", "data:image/png;base64,"} {
		_, err := materializeImageResources([]byte(`{"resourceUri":"`+uri+`"}`), t.TempDir())
		if err == nil || !strings.Contains(err.(*apiError).detail, "root.resourceUri") {
			t.Fatalf("expected located error: %v", err)
		}
	}
	blocked := filepath.Join(t.TempDir(), "blocked")
	if err := os.WriteFile(blocked, []byte("file"), 0600); err != nil {
		t.Fatal(err)
	}
	if result, err := materializeImageResources(original, blocked); err == nil || result != nil {
		t.Fatal("storage failure must not return committed references")
	}
}

func TestLegacyImageExportWithRealConverter(t *testing.T) {
	binary := locateRealConverter(t)
	if binary == "" {
		t.Skip("real converter unavailable")
	}
	fixture := filepath.Join("..", "..", "..", "presentation", "tools", "fixtures", "blank-presentation", "content.json")
	content, err := os.ReadFile(fixture)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := decodeSnapshot(content)
	if err != nil {
		t.Fatal(err)
	}
	var addBackground func(any)
	addBackground = func(value any) {
		switch node := value.(type) {
		case map[string]any:
			if node["type"] == "slide" {
				page := node["data"].([]any)[0].(map[string]any)
				page["attrs"].(map[string]any)["background"] = map[string]any{"kind": "properties", "fill": map[string]any{"kind": "blip", "transparency": json.Number("0.5"), "resource": map[string]any{"resourceUri": "data:image/png;base64," + legacyPNG}, "fillMode": map[string]any{"kind": "stretch"}}}
			}
			for _, child := range node {
				addBackground(child)
			}
		case []any:
			for _, child := range node {
				addBackground(child)
			}
		}
	}
	addBackground(snapshot)
	legacy, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(t.TempDir())
	source := filepath.Join(store.packageRoot("legacy"), contentFileName)
	if err := writeFileAtomically(source, legacy); err != nil {
		t.Fatal(err)
	}
	// An empty filter reproduces slide export: newly materialized assets must
	// survive even though they were not in the original mop-asset reference set.
	staging := t.TempDir()
	if _, err := store.copyInto("legacy", staging, map[string]bool{}, nil); err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(t.TempDir(), "result.pptx")
	converter := NewCLIConverter(binary)
	if err := converter.Export(context.Background(), staging, output); err != nil {
		t.Fatalf("export: %v (%s)", err, err.(*apiError).detail)
	}
	reopened := t.TempDir()
	if err := converter.Import(context.Background(), output, reopened); err != nil {
		t.Fatal(err)
	}
	media, err := os.ReadDir(filepath.Join(reopened, "media"))
	if err != nil || len(media) != 1 {
		t.Fatalf("missing reimported image: %v %v", media, err)
	}
	actual, err := os.ReadFile(filepath.Join(reopened, "media", media[0].Name()))
	expected, _ := base64.StdEncoding.DecodeString(legacyPNG)
	if err != nil || !bytes.Equal(actual, expected) {
		t.Fatal("reimport changed image bytes")
	}
	unchanged, _ := os.ReadFile(source)
	if !bytes.Equal(unchanged, legacy) {
		t.Fatal("export changed source snapshot")
	}
}
