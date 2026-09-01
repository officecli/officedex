package xlsxeditor

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"
)

func TestWriteManagedSheetsToXlsx(t *testing.T) {
	path := filepath.Join(t.TempDir(), "workbook.xlsx")
	book := excelize.NewFile()
	if _, err := book.NewSheet("Jira Issues"); err != nil {
		t.Fatal(err)
	}
	if err := book.SetCellStr("Jira Issues", "A20", "stale issue"); err != nil {
		t.Fatal(err)
	}
	if err := book.SetCellFormula("Sheet1", "A1", "='Jira Issues'!A2"); err != nil {
		t.Fatal(err)
	}
	if err := book.SaveAs(path); err != nil {
		t.Fatal(err)
	}
	if err := book.Close(); err != nil {
		t.Fatal(err)
	}

	err := writeManagedSheetsToXlsx(path, []ManagedSheet{{
		SheetName: "Jira Issues",
		Rows:      [][]string{{"Issue Key", "Summary"}, {"OD-1", "Fix save"}},
	}})
	if err != nil {
		t.Fatalf("writeManagedSheetsToXlsx() error = %v", err)
	}

	saved, err := excelize.OpenFile(path)
	if err != nil {
		t.Fatal(err)
	}
	defer saved.Close()
	rows, err := saved.GetRows("Jira Issues")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 || len(rows[1]) != 2 || rows[1][0] != "OD-1" || rows[1][1] != "Fix save" {
		t.Fatalf("saved rows = %#v", rows)
	}
	if value, err := saved.GetCellValue("Jira Issues", "A20"); err != nil || value != "" {
		t.Fatalf("stale A20 = %q, error = %v", value, err)
	}
	if formula, err := saved.GetCellFormula("Sheet1", "A1"); err != nil || formula != "='Jira Issues'!A2" {
		t.Fatalf("referencing formula = %q, error = %v", formula, err)
	}
	width, err := saved.GetColWidth("Jira Issues", "A")
	if err != nil {
		t.Fatal(err)
	}
	if width < 12 {
		t.Fatalf("column width = %v, want readable managed-sheet width", width)
	}
	headerStyle, err := saved.GetCellStyle("Jira Issues", "A1")
	if err != nil {
		t.Fatal(err)
	}
	if headerStyle == 0 {
		t.Fatal("managed-sheet header style was not applied")
	}
}

func TestManagedSheetColumnWidthIsBounded(t *testing.T) {
	if got := managedSheetColumnWidth([][]string{{"ID"}, {"1"}}, 0); got != 12 {
		t.Fatalf("minimum width = %v", got)
	}
	if got := managedSheetColumnWidth([][]string{{strings.Repeat("x", 100)}}, 0); got != 40 {
		t.Fatalf("maximum width = %v", got)
	}
}
