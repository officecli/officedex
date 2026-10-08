package xlsxeditor

import (
	"fmt"
	"strings"

	"github.com/xuri/excelize/v2"
)

// CreateWorkbook writes a new single-sheet workbook at path. Connector syncs
// (Jira, Liquipedia) use it to turn fetched rows into a real file the
// spreadsheet stage can open, so the header styling matches what
// writeManagedSheetsToXlsx applies to sheets it manages in place.
func CreateWorkbook(path string, sheet ManagedSheet) error {
	name := strings.TrimSpace(sheet.SheetName)
	if name == "" {
		return fmt.Errorf("create workbook: sheet name is empty")
	}
	if len(sheet.Rows) == 0 {
		return fmt.Errorf("create workbook: sheet %q has no rows", name)
	}

	book := excelize.NewFile()
	defer book.Close()

	index, err := book.NewSheet(name)
	if err != nil {
		return fmt.Errorf("create sheet %q: %w", name, err)
	}
	book.SetActiveSheet(index)
	// NewFile seeds a default "Sheet1"; drop it unless it is the sheet we want.
	if name != "Sheet1" {
		if err := book.DeleteSheet("Sheet1"); err != nil {
			return fmt.Errorf("drop default sheet: %w", err)
		}
	}

	headerStyle, err := book.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Bold: true, Color: "#FFFFFF"},
		Fill:      excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{"#3451B2"}},
		Alignment: &excelize.Alignment{Vertical: "center"},
	})
	if err != nil {
		return fmt.Errorf("create header style: %w", err)
	}

	for rowIndex, row := range sheet.Rows {
		for columnIndex, value := range row {
			cell, err := excelize.CoordinatesToCellName(columnIndex+1, rowIndex+1)
			if err != nil {
				return fmt.Errorf("resolve cell %d,%d: %w", columnIndex+1, rowIndex+1, err)
			}
			if err := book.SetCellStr(name, cell, value); err != nil {
				return fmt.Errorf("write cell %s: %w", cell, err)
			}
		}
	}

	if columns := len(sheet.Rows[0]); columns > 0 {
		last, err := excelize.ColumnNumberToName(columns)
		if err != nil {
			return fmt.Errorf("resolve header range: %w", err)
		}
		if err := book.SetCellStyle(name, "A1", last+"1", headerStyle); err != nil {
			return fmt.Errorf("style header row: %w", err)
		}
		for columnIndex := range sheet.Rows[0] {
			column, err := excelize.ColumnNumberToName(columnIndex + 1)
			if err != nil {
				return fmt.Errorf("resolve column %d: %w", columnIndex+1, err)
			}
			if err := book.SetColWidth(name, column, column, managedSheetColumnWidth(sheet.Rows, columnIndex)); err != nil {
				return fmt.Errorf("set width for column %s: %w", column, err)
			}
		}
	}

	if err := book.SaveAs(path); err != nil {
		return fmt.Errorf("save workbook: %w", err)
	}
	return nil
}
