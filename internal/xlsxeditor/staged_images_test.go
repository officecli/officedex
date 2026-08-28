package xlsxeditor

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"

	"github.com/xuri/excelize/v2"
)

func TestSaveStagedImagesWritesDrawingAndStatus(t *testing.T) {
	dir := t.TempDir()
	input := filepath.Join(dir, "input.xlsx")
	output := filepath.Join(dir, "output.xlsx")
	imagePath := filepath.Join(dir, "image.png")
	book := excelize.NewFile()
	const sheet = "Catalog"
	if err := book.SetSheetName(book.GetSheetName(0), sheet); err != nil {
		t.Fatal(err)
	}
	if err := book.SetCellValue(sheet, "A1", "image"); err != nil {
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
	if err := saveStagedImagesToXlsx(input, output, []stagedImage{{filePath: imagePath, extension: ".png", sheetName: sheet, row: 1, column: 1, statusCol: 2}}); err != nil {
		t.Fatalf("saveStagedImagesToXlsx: %v", err)
	}
	saved, err := excelize.OpenFile(output)
	if err != nil {
		t.Fatal(err)
	}
	defer saved.Close()
	if got, err := saved.GetCellValue(sheet, "C2"); err != nil || got != "已完成" {
		t.Fatalf("status = %q, err=%v; want 已完成", got, err)
	}
	pictures, err := saved.GetPictures(sheet, "B2")
	if err != nil {
		t.Fatal(err)
	}
	if len(pictures) != 1 {
		t.Fatalf("pictures at B2 = %d, want 1", len(pictures))
	}
}
