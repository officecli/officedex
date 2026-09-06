package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWriteHtmlAppFiles(t *testing.T) {
	root := filepath.Join(t.TempDir(), "app")
	app := &App{}
	paths, err := app.WriteHtmlAppFiles(HtmlAppFileInput{Root: root, Files: map[string][]byte{"index.html": []byte("ok"), "src/data.json": []byte("{}")}})
	if err != nil || len(paths) != 2 {
		t.Fatalf("write files: %v %v", paths, err)
	}
	if data, err := os.ReadFile(filepath.Join(root, "src", "data.json")); err != nil || string(data) != "{}" {
		t.Fatalf("read data: %q %v", data, err)
	}
	if _, err := app.WriteHtmlAppFiles(HtmlAppFileInput{Root: root, Files: map[string][]byte{"../escape": []byte("bad")}}); err == nil {
		t.Fatal("path traversal was accepted")
	}
}
