package xlsxeditor

import (
	"archive/zip"
	"bytes"
	"fmt"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/xuri/excelize/v2"
)

// saveStagedImagesToXlsx writes marketing images as ordinary OOXML drawings.
// This deliberately bypasses office2modoc for the image-bearing save because
// office2modoc 0.1.34 can wait forever on Sheet SDK cell-image operators.
func saveStagedImagesToXlsx(sourcePath, outputPath string, images []stagedImage) error {
	normalizedSource, cleanup, err := normalizeWorksheetDrawingTargets(sourcePath)
	if err != nil {
		return err
	}
	defer cleanup()

	book, err := excelize.OpenFile(normalizedSource)
	if err != nil {
		return fmt.Errorf("open source workbook: %w", err)
	}
	defer book.Close()

	for _, image := range images {
		data, err := os.ReadFile(image.filePath)
		if err != nil {
			return fmt.Errorf("read staged image: %w", err)
		}
		cell, err := excelize.CoordinatesToCellName(image.column+1, image.row+1)
		if err != nil {
			return fmt.Errorf("resolve image cell: %w", err)
		}
		if err := book.DeletePicture(image.sheetName, cell); err != nil {
			return fmt.Errorf("replace existing image at %s: %w", cell, err)
		}
		if err := book.AddPictureFromBytes(image.sheetName, cell, &excelize.Picture{
			Extension: image.extension,
			File:      data,
			Format: &excelize.GraphicOptions{
				AltText:         "OfficeDex generated marketing image",
				LockAspectRatio: true,
				AutoFit:         true,
				Positioning:     "oneCell",
			},
		}); err != nil {
			return fmt.Errorf("add image at %s: %w", cell, err)
		}
		if image.statusCol >= 0 {
			statusCell, err := excelize.CoordinatesToCellName(image.statusCol+1, image.row+1)
			if err != nil {
				return fmt.Errorf("resolve status cell: %w", err)
			}
			if err := book.SetCellValue(image.sheetName, statusCell, "已完成"); err != nil {
				return fmt.Errorf("set completion status at %s: %w", statusCell, err)
			}
		}
	}
	if err := book.SaveAs(outputPath); err != nil {
		return fmt.Errorf("save workbook: %w", err)
	}
	return nil
}

// normalizeWorksheetDrawingTargets works around an Excelize save bug triggered
// by absolute worksheet drawing relationship targets. When a source workbook
// uses Target="/xl/drawings/...", Excelize can emit both the real drawing part
// and an invalid leading-slash ZIP entry. office2modoc rejects that package on
// the next open. OOXML relationship targets are normally relative to the
// worksheet part, so rewrite only these drawing targets before editing.
func normalizeWorksheetDrawingTargets(sourcePath string) (string, func(), error) {
	reader, err := zip.OpenReader(sourcePath)
	if err != nil {
		return "", func() {}, fmt.Errorf("open source workbook ZIP: %w", err)
	}
	defer reader.Close()
	needsNormalization := false
	canonicalNames := make(map[string]bool, len(reader.File))
	for _, entry := range reader.File {
		if !strings.HasPrefix(entry.Name, "/") {
			canonicalNames[entry.Name] = true
		} else {
			needsNormalization = true
		}
		if strings.HasPrefix(entry.Name, "xl/worksheets/_rels/") && strings.HasSuffix(entry.Name, ".rels") {
			content, err := readZipEntry(entry)
			if err != nil {
				return "", func() {}, err
			}
			if bytes.Contains(content, []byte(`Target="/xl/drawings/`)) {
				needsNormalization = true
			}
		}
	}
	if !needsNormalization {
		return sourcePath, func() {}, nil
	}

	temp, err := os.CreateTemp(filepath.Dir(sourcePath), ".officedex-normalized-*.xlsx")
	if err != nil {
		return "", func() {}, fmt.Errorf("create normalized workbook: %w", err)
	}
	tempPath := temp.Name()
	cleanup := func() { _ = os.Remove(tempPath) }
	wrote := false
	defer func() {
		if !wrote {
			_ = temp.Close()
			cleanup()
		}
	}()

	writer := zip.NewWriter(temp)
	for _, entry := range reader.File {
		canonicalName := strings.TrimPrefix(entry.Name, "/")
		if strings.HasPrefix(entry.Name, "/") && canonicalNames[canonicalName] {
			continue
		}
		content, err := readZipEntry(entry)
		if err != nil {
			_ = writer.Close()
			return "", func() {}, err
		}
		if strings.HasPrefix(entry.Name, "xl/worksheets/_rels/") && strings.HasSuffix(entry.Name, ".rels") {
			content = bytes.ReplaceAll(content, []byte(`Target="/xl/drawings/`), []byte(`Target="../drawings/`))
		}
		header := entry.FileHeader
		header.Name = canonicalName
		part, err := writer.CreateHeader(&header)
		if err != nil {
			_ = writer.Close()
			return "", func() {}, fmt.Errorf("create normalized workbook entry %q: %w", entry.Name, err)
		}
		if _, err := part.Write(content); err != nil {
			_ = writer.Close()
			return "", func() {}, fmt.Errorf("write normalized workbook entry %q: %w", entry.Name, err)
		}
	}
	if err := writer.Close(); err != nil {
		return "", func() {}, fmt.Errorf("finalize normalized workbook: %w", err)
	}
	if err := temp.Close(); err != nil {
		return "", func() {}, fmt.Errorf("close normalized workbook: %w", err)
	}
	wrote = true
	return tempPath, cleanup, nil
}

func readZipEntry(entry *zip.File) ([]byte, error) {
	reader, err := entry.Open()
	if err != nil {
		return nil, fmt.Errorf("open source workbook entry %q: %w", entry.Name, err)
	}
	defer reader.Close()
	content, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("read source workbook entry %q: %w", entry.Name, err)
	}
	return content, nil
}
