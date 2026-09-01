package xlsxeditor

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"
)

func TestSaveStagedImagesUsesExistingCellsWithoutChangingTemplateGeometry(t *testing.T) {
	dir := t.TempDir()
	input := filepath.Join(dir, "template.xlsx")
	output := filepath.Join(dir, "saved.xlsx")
	imagePath := filepath.Join(dir, "generated.png")

	book := excelize.NewFile()
	const sheet = "电商营销素材"
	defaultSheet := book.GetSheetName(0)
	if err := book.SetSheetName(defaultSheet, sheet); err != nil {
		t.Fatal(err)
	}
	if err := book.SetCellValue(sheet, "M4", "主图结果"); err != nil {
		t.Fatal(err)
	}
	if err := book.SetCellValue(sheet, "AI4", "状态"); err != nil {
		t.Fatal(err)
	}
	if err := book.SetCellValue(sheet, "AK16", "模板边界"); err != nil {
		t.Fatal(err)
	}
	if err := book.SetRowHeight(sheet, 5, 88); err != nil {
		t.Fatal(err)
	}
	if err := book.SaveAs(input); err != nil {
		t.Fatal(err)
	}
	if err := book.Close(); err != nil {
		t.Fatal(err)
	}

	png, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(imagePath, png, 0o600); err != nil {
		t.Fatal(err)
	}

	if err := saveStagedImagesToXlsx(input, output, []stagedImage{{
		filePath:  imagePath,
		extension: ".png",
		sheetName: sheet,
		row:       4,
		column:    12,
		statusCol: 34,
	}}); err != nil {
		t.Fatalf("saveStagedImagesToXlsx() error = %v", err)
	}

	saved, err := excelize.OpenFile(output)
	if err != nil {
		t.Fatal(err)
	}
	defer saved.Close()
	rows, err := saved.GetRows(sheet)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 16 || len(rows[15]) != 37 {
		t.Fatalf("used rows/columns = %d/%d, want 16/37", len(rows), len(rows[15]))
	}
	if got, err := saved.GetRowHeight(sheet, 5); err != nil || got != 88 {
		t.Fatalf("row 5 height = %v, %v; want 88", got, err)
	}
	if got, err := saved.GetCellValue(sheet, "AI5"); err != nil || got != "已完成" {
		t.Fatalf("AI5 = %q, %v; want 已完成", got, err)
	}
	pictures, err := saved.GetPictures(sheet, "M5")
	if err != nil {
		t.Fatal(err)
	}
	if len(pictures) != 1 {
		t.Fatalf("pictures at M5 = %d, want 1", len(pictures))
	}
}

func TestSaveStagedImagesNormalizesAbsoluteDrawingRelationship(t *testing.T) {
	dir := t.TempDir()
	input := filepath.Join(dir, "absolute-drawing-target.xlsx")
	output := filepath.Join(dir, "saved.xlsx")
	imagePath := filepath.Join(dir, "generated.png")

	book := excelize.NewFile()
	const sheet = "Catalog"
	if err := book.SetSheetName(book.GetSheetName(0), sheet); err != nil {
		t.Fatal(err)
	}
	png, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
	if err != nil {
		t.Fatal(err)
	}
	if err := book.AddPictureFromBytes(sheet, "A2", &excelize.Picture{Extension: ".png", File: png}); err != nil {
		t.Fatal(err)
	}
	if err := book.SaveAs(input); err != nil {
		t.Fatal(err)
	}
	if err := book.Close(); err != nil {
		t.Fatal(err)
	}
	rewriteZipEntry(t, input, "xl/worksheets/_rels/sheet1.xml.rels", func(content []byte) []byte {
		return bytes.ReplaceAll(content, []byte(`Target="../drawings/`), []byte(`Target="/xl/drawings/`))
	})
	if err := os.WriteFile(imagePath, png, 0o600); err != nil {
		t.Fatal(err)
	}

	if err := saveStagedImagesToXlsx(input, output, []stagedImage{{
		filePath: imagePath, extension: ".png", sheetName: sheet, row: 2, column: 2, statusCol: 3,
	}}); err != nil {
		t.Fatalf("saveStagedImagesToXlsx() error = %v", err)
	}

	reader, err := zip.OpenReader(output)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	for _, entry := range reader.File {
		if strings.HasPrefix(entry.Name, "/") {
			t.Fatalf("saved XLSX contains invalid absolute ZIP entry %q", entry.Name)
		}
		if entry.Name == "xl/worksheets/_rels/sheet1.xml.rels" {
			content, err := readZipEntry(entry)
			if err != nil {
				t.Fatal(err)
			}
			if bytes.Contains(content, []byte(`Target="/xl/drawings/`)) {
				t.Fatalf("drawing relationship remains absolute: %s", content)
			}
		}
	}
	saved, err := excelize.OpenFile(output)
	if err != nil {
		t.Fatal(err)
	}
	defer saved.Close()
	for _, cell := range []string{"A2", "C3"} {
		pictures, err := saved.GetPictures(sheet, cell)
		if err != nil {
			t.Fatal(err)
		}
		if len(pictures) != 1 {
			t.Fatalf("pictures at %s = %d, want 1", cell, len(pictures))
		}
	}
}

func TestNormalizeWorksheetDrawingTargetsDropsInvalidDuplicate(t *testing.T) {
	dir := t.TempDir()
	input := filepath.Join(dir, "duplicate.xlsx")
	writeZipEntries(t, input, []zipTestEntry{
		{name: "xl/worksheets/_rels/sheet1.xml.rels", content: []byte(`<Relationships><Relationship Target="/xl/drawings/drawing1.xml"/></Relationships>`)},
		{name: "xl/drawings/drawing1.xml", content: []byte("real drawing")},
		{name: "/xl/drawings/drawing1.xml", content: []byte("invalid duplicate")},
	})

	normalized, cleanup, err := normalizeWorksheetDrawingTargets(input)
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	if normalized == input {
		t.Fatal("normalizeWorksheetDrawingTargets() returned the unmodified input")
	}
	reader, err := zip.OpenReader(normalized)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	seenDrawing := 0
	for _, entry := range reader.File {
		if strings.HasPrefix(entry.Name, "/") {
			t.Fatalf("normalized XLSX contains invalid entry %q", entry.Name)
		}
		content, err := readZipEntry(entry)
		if err != nil {
			t.Fatal(err)
		}
		if entry.Name == "xl/drawings/drawing1.xml" {
			seenDrawing++
			if string(content) != "real drawing" {
				t.Fatalf("drawing content = %q", content)
			}
		}
		if bytes.Contains(content, []byte(`Target="/xl/drawings/`)) {
			t.Fatalf("absolute drawing target remains in %q", entry.Name)
		}
	}
	if seenDrawing != 1 {
		t.Fatalf("drawing entries = %d, want 1", seenDrawing)
	}
}

type zipTestEntry struct {
	name    string
	content []byte
}

func writeZipEntries(t *testing.T, path string, entries []zipTestEntry) {
	t.Helper()
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	for _, entry := range entries {
		part, err := writer.Create(entry.name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write(entry.content); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
}

func rewriteZipEntry(t *testing.T, path, target string, rewrite func([]byte) []byte) {
	t.Helper()
	reader, err := zip.OpenReader(path)
	if err != nil {
		t.Fatal(err)
	}
	tempPath := path + ".rewrite"
	temp, err := os.Create(tempPath)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(temp)
	for _, entry := range reader.File {
		content, err := readZipEntry(entry)
		if err != nil {
			t.Fatal(err)
		}
		if entry.Name == target {
			content = rewrite(content)
		}
		header := entry.FileHeader
		part, err := writer.CreateHeader(&header)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := io.Copy(part, bytes.NewReader(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := temp.Close(); err != nil {
		t.Fatal(err)
	}
	if err := reader.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(tempPath, path); err != nil {
		t.Fatal(err)
	}
}
