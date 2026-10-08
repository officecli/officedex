package xlsxeditor

import (
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/xuri/excelize/v2"
)

func writeManagedSheetsToXlsx(path string, sheets []ManagedSheet) error {
	book, err := excelize.OpenFile(path)
	if err != nil {
		return fmt.Errorf("open exported workbook: %w", err)
	}
	defer book.Close()
	headerStyle, err := book.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Bold: true, Color: "#FFFFFF"},
		Fill:      excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{"#3451B2"}},
		Alignment: &excelize.Alignment{Vertical: "center"},
	})
	if err != nil {
		return fmt.Errorf("create managed sheet header style: %w", err)
	}
	for _, sheet := range sheets {
		name := strings.TrimSpace(sheet.SheetName)
		if name == "" {
			return fmt.Errorf("managed sheet name is empty")
		}
		index, err := book.GetSheetIndex(name)
		if err != nil {
			return fmt.Errorf("find sheet %q: %w", name, err)
		}
		if index < 0 {
			if _, err := book.NewSheet(name); err != nil {
				return fmt.Errorf("create sheet %q: %w", name, err)
			}
		} else {
			existingRows, err := book.GetRows(name)
			if err != nil {
				return fmt.Errorf("read existing sheet %q: %w", name, err)
			}
			for rowIndex, row := range existingRows {
				for columnIndex := range row {
					cell, err := excelize.CoordinatesToCellName(columnIndex+1, rowIndex+1)
					if err != nil {
						return fmt.Errorf("resolve existing cell in sheet %q: %w", name, err)
					}
					if err := book.SetCellStr(name, cell, ""); err != nil {
						return fmt.Errorf("clear %s!%s: %w", name, cell, err)
					}
				}
			}
		}
		for rowIndex, row := range sheet.Rows {
			for columnIndex, value := range row {
				cell, err := excelize.CoordinatesToCellName(columnIndex+1, rowIndex+1)
				if err != nil {
					return fmt.Errorf("resolve cell in sheet %q: %w", name, err)
				}
				if err := book.SetCellStr(name, cell, value); err != nil {
					return fmt.Errorf("write %s!%s: %w", name, cell, err)
				}
			}
		}
		if len(sheet.Rows) > 0 && len(sheet.Rows[0]) > 0 {
			lastColumn, err := excelize.ColumnNumberToName(len(sheet.Rows[0]))
			if err != nil {
				return fmt.Errorf("resolve last column in sheet %q: %w", name, err)
			}
			if err := book.SetCellStyle(name, "A1", lastColumn+"1", headerStyle); err != nil {
				return fmt.Errorf("style header in sheet %q: %w", name, err)
			}
			if err := book.SetRowHeight(name, 1, 22); err != nil {
				return fmt.Errorf("size header in sheet %q: %w", name, err)
			}
			for columnIndex := range sheet.Rows[0] {
				column, err := excelize.ColumnNumberToName(columnIndex + 1)
				if err != nil {
					return fmt.Errorf("resolve column in sheet %q: %w", name, err)
				}
				if err := book.SetColWidth(name, column, column, managedSheetColumnWidth(sheet.Rows, columnIndex)); err != nil {
					return fmt.Errorf("size column %s in sheet %q: %w", column, name, err)
				}
			}
		}
	}
	if err := book.Save(); err != nil {
		return fmt.Errorf("save managed sheets: %w", err)
	}
	return nil
}

func managedSheetColumnWidth(rows [][]string, columnIndex int) float64 {
	maxLength := 0
	for _, row := range rows {
		if columnIndex >= len(row) {
			continue
		}
		length := utf8.RuneCountInString(strings.TrimSpace(row[columnIndex]))
		if length > maxLength {
			maxLength = length
		}
	}
	width := float64(maxLength + 2)
	if width < 12 {
		width = 12
	}
	if width > 40 {
		width = 40
	}
	return width
}
