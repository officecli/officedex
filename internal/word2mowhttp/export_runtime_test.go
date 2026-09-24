package word2mowhttp

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// The export OfficeDex serves must accept a table the editor stamped with
// nodeId, using the convert binary this checkout actually stages. The decoder
// is not stubbed: a second case still has to fail on a real unknown key.
func TestExportDropsNodeIDAndKeepsTableText(t *testing.T) {
	binary := stagedConvertBinary(t)
	handler := New(Options{Converter: NewCLIConverter(binary)})
	cellText := "Ready for release"

	packageDir := importTableDocx(t, binary, cellText)
	contentPath := filepath.Join(packageDir, contentFileName)
	stampNodeID(t, contentPath)

	recorder := post(t, handler, ExportRoute, directoryZip(t, packageDir))
	if recorder.Code != http.StatusOK {
		t.Fatalf("export status = %d, body %s", recorder.Code, recorder.Body)
	}
	documentXML := docxPart(t, recorder.Body.Bytes(), "word/document.xml")
	if !strings.Contains(documentXML, cellText) {
		t.Fatalf("exported document.xml missing %q:\n%s", cellText, documentXML)
	}
}

func TestExportStillRejectsUnknownTableAttr(t *testing.T) {
	binary := stagedConvertBinary(t)
	handler := New(Options{Converter: NewCLIConverter(binary)})

	packageDir := importTableDocx(t, binary, "Ready for release")
	contentPath := filepath.Join(packageDir, contentFileName)
	stampNodeID(t, contentPath)
	stampUnknownTableAttr(t, contentPath)

	recorder := post(t, handler, ExportRoute, directoryZip(t, packageDir))
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("export status = %d, want 400, body %s", recorder.Code, recorder.Body)
	}
	if !strings.Contains(recorder.Body.String(), "unknown tbl attr key") {
		t.Fatalf("export error = %s, want unknown tbl attr key", recorder.Body)
	}
}

func stagedConvertBinary(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	binary := filepath.Join(filepath.Dir(file), "..", "..", "build", "writer-convert", "convert")
	info, err := os.Stat(binary)
	if err != nil || info.IsDir() {
		t.Fatalf("staged convert binary missing at %s: %v", binary, err)
	}
	return binary
}

func importTableDocx(t *testing.T, binary, cellText string) string {
	t.Helper()
	root := t.TempDir()
	input := filepath.Join(root, "table.docx")
	if err := os.WriteFile(input, tableDocx(t, cellText), 0o644); err != nil {
		t.Fatal(err)
	}
	packageDir := filepath.Join(root, "document.mow.dir")
	if err := os.MkdirAll(packageDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := NewCLIConverter(binary).Import(context.Background(), input, packageDir); err != nil {
		t.Fatalf("import table docx: %v", err)
	}
	return packageDir
}

func stampNodeID(t *testing.T, contentPath string) {
	t.Helper()
	mutateContent(t, contentPath, func(value any) {
		if !stampNodeIDOn(value, map[string]string{
			"tbl": "table", "tableGrid": "grid", "row": "row", "cell": "cell", "p": "paragraph", "run": "run",
		}) {
			t.Fatal("imported snapshot has no table topology to stamp")
		}
	})
}

func stampUnknownTableAttr(t *testing.T, contentPath string) {
	t.Helper()
	mutateContent(t, contentPath, func(value any) {
		block := findBlock(value, "tbl")
		if block == nil {
			t.Fatal("imported snapshot has no tbl block")
		}
		attrs, _ := block["attrs"].(map[string]any)
		if attrs == nil {
			attrs = map[string]any{}
			block["attrs"] = attrs
		}
		attrs["notARealKey"] = "x"
	})
}

func stampNodeIDOn(value any, ids map[string]string) bool {
	stamped := false
	switch node := value.(type) {
	case map[string]any:
		if id, ok := ids[stringField(node, "type")]; ok {
			attrs, _ := node["attrs"].(map[string]any)
			if attrs == nil {
				attrs = map[string]any{}
				node["attrs"] = attrs
			}
			attrs["nodeId"] = id
			stamped = true
		}
		for _, child := range node {
			if stampNodeIDOn(child, ids) {
				stamped = true
			}
		}
	case []any:
		for _, child := range node {
			if stampNodeIDOn(child, ids) {
				stamped = true
			}
		}
	}
	return stamped
}

func findBlock(value any, blockType string) map[string]any {
	switch node := value.(type) {
	case map[string]any:
		if stringField(node, "type") == blockType {
			return node
		}
		for _, child := range node {
			if found := findBlock(child, blockType); found != nil {
				return found
			}
		}
	case []any:
		for _, child := range node {
			if found := findBlock(child, blockType); found != nil {
				return found
			}
		}
	}
	return nil
}

func stringField(object map[string]any, key string) string {
	value, _ := object[key].(string)
	return value
}

func mutateContent(t *testing.T, path string, mutate func(any)) {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	mutate(value)
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, encoded, 0o644); err != nil {
		t.Fatal(err)
	}
}

func directoryZip(t *testing.T, root string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return err
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		entry, err := writer.Create(filepath.ToSlash(rel))
		if err != nil {
			return err
		}
		file, err := os.Open(path)
		if err != nil {
			return err
		}
		defer file.Close()
		_, err = io.Copy(entry, file)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func docxPart(t *testing.T, docx []byte, name string) string {
	t.Helper()
	reader, err := zip.NewReader(bytes.NewReader(docx), int64(len(docx)))
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range reader.File {
		if entry.Name != name {
			continue
		}
		file, err := entry.Open()
		if err != nil {
			t.Fatal(err)
		}
		defer file.Close()
		body, err := io.ReadAll(file)
		if err != nil {
			t.Fatal(err)
		}
		return string(body)
	}
	t.Fatalf("docx is missing %s", name)
	return ""
}

func tableDocx(t *testing.T, cellText string) []byte {
	t.Helper()
	document := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:tbl>
      <w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>
      <w:tr>
        <w:tc>
          <w:p><w:r><w:t>` + cellText + `</w:t></w:r></w:p>
        </w:tc>
      </w:tr>
    </w:tbl>
    <w:sectPr/>
  </w:body>
</w:document>`
	return zipBytes(t, map[string]string{
		"[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
		"_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
		"word/document.xml": document,
	})
}

