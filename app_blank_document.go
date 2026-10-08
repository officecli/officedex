package main

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/xuri/excelize/v2"
	"officedex/internal/atomicfile"
	"officedex/internal/types"
)

// CreateBlankDocument creates a real Office package, registers it in the
// document projection, and returns the same record used by OpenLocalFile.
// Keeping creation here means shell's "Blank document" controls never need a
// sample file or a fake document row.
func (a *App) CreateBlankDocument(documentType, workspaceID string) (types.DocumentRecord, error) {
	documentType = strings.ToLower(strings.TrimPrefix(strings.TrimSpace(documentType), "."))
	if !isOpenableDocumentType(documentType) {
		return types.DocumentRecord{}, fmt.Errorf("unsupported blank document type: %s", documentType)
	}
	directory, err := a.FolderPath(workspaceID)
	if err != nil {
		return types.DocumentRecord{}, err
	}
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return types.DocumentRecord{}, fmt.Errorf("create blank document: mkdir: %w", err)
	}
	base := map[string]string{"docx": "Untitled document", "xlsx": "Untitled workbook", "pptx": "Untitled presentation"}[documentType]
	destination, err := uniqueDestination(directory, base, "."+documentType)
	if err != nil {
		return types.DocumentRecord{}, err
	}
	if err := writeBlankOfficeFile(destination, documentType); err != nil {
		return types.DocumentRecord{}, err
	}

	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	if a.localStore == nil {
		_ = os.Remove(destination)
		return types.DocumentRecord{}, errors.New("document store is unavailable")
	}
	record, err := a.localStore.RegisterLocalDocument(ctx, destination, filepath.Base(destination), documentType, workspaceID)
	if err != nil {
		_ = os.Remove(destination)
		return types.DocumentRecord{}, err
	}
	if a.previewReg != nil {
		if err := a.previewReg.AllowArtifact(types.Artifact{FilePath: destination, FileName: record.FileName, DocumentType: documentType}); err != nil {
			return types.DocumentRecord{}, err
		}
	}
	return record, nil
}

func writeBlankOfficeFile(path, documentType string) error {
	switch documentType {
	case "pptx":
		if err := atomicfile.WriteFile(path, blankPptxDraft, 0o644); err != nil {
			return fmt.Errorf("create blank presentation: %w", err)
		}
		return nil
	case "xlsx":
		book := excelize.NewFile()
		defer book.Close()
		if err := book.SaveAs(path); err != nil {
			return fmt.Errorf("create blank workbook: %w", err)
		}
		return nil
	case "docx":
		if err := atomicfile.WriteFile(path, blankDocxPackage(), 0o644); err != nil {
			return fmt.Errorf("create blank document: %w", err)
		}
		return nil
	default:
		return fmt.Errorf("unsupported blank document type: %s", documentType)
	}
}

// blankDocxPackage is the smallest WordprocessingML package accepted by the
// existing DOCX preview path. It contains one empty paragraph and no sample
// content.
func blankDocxPackage() []byte {
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	files := map[string]string{
		"[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
		"_rels/.rels":         `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
		"word/document.xml":   `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t></w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`,
	}
	for name, content := range files {
		entry, err := writer.Create(name)
		if err != nil {
			return nil
		}
		_, _ = entry.Write([]byte(content))
	}
	if err := writer.Close(); err != nil {
		return nil
	}
	return buffer.Bytes()
}
