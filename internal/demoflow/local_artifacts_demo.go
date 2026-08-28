//go:build officedex_demo

package demoflow

import (
	"archive/zip"
	"fmt"
	"html"
	"image"
	"image/color"
	"image/gif"
	"image/png"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"officedex/internal/types"
)

func writeLocalArtifact(dir string, documentType types.DocumentType, prompt string) (string, error) {
	switch documentType {
	case types.DocPPTX:
		name := promptPptxFileName(prompt)
		return name, writePromptPptx(filepath.Join(dir, name), prompt)
	case types.DocDOCX:
		name := "local-demo.docx"
		return name, writeDemoDocx(filepath.Join(dir, name), prompt)
	case types.DocXLSX:
		name := "local-demo.xlsx"
		return name, writeDemoXlsx(filepath.Join(dir, name), prompt)
	case types.DocReport:
		name := "local-demo-report.html"
		body := fmt.Sprintf(`<!doctype html><meta charset="utf-8"><title>OfficeDex Local Demo</title><h1>OfficeDex Local Demo</h1><p>%s</p>`, html.EscapeString(prompt))
		return name, os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644)
	case types.DocIMG:
		name := "local-demo.png"
		return name, writeDemoPNG(filepath.Join(dir, name))
	case types.DocGIF:
		name := "local-demo.gif"
		return name, writeDemoGIF(filepath.Join(dir, name))
	default:
		return "", fmt.Errorf("unsupported local demo document type %q", documentType)
	}
}

func writeDemoDocx(path, prompt string) error {
	text := xmlText(prompt)
	parts := map[string]string{
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
		"word/document.xml": fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:rPr><w:b/><w:sz w:val="36"/></w:rPr><w:t>OfficeDex Local Demo</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">%s</w:t></w:r></w:p>
<w:p><w:r><w:t>This file was generated locally without login or hosted Credit usage.</w:t></w:r></w:p>
<w:sectPr/></w:body></w:document>`, text),
	}
	return writeZip(path, parts)
}

func writeDemoXlsx(path, prompt string) error {
	text := xmlText(prompt)
	parts := map[string]string{
		"[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
		"_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
		"xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Local Demo" sheetId="1" r:id="rId1"/></sheets></workbook>`,
		"xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
		"xl/worksheets/sheet1.xml": fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>OfficeDex Local Demo</t></is></c><c r="B1" t="inlineStr"><is><t>Status</t></is></c></row>
<row r="2"><c r="A2" t="inlineStr"><is><t>%s</t></is></c><c r="B2" t="inlineStr"><is><t>Completed locally</t></is></c></row>
<row r="3"><c r="A3" t="inlineStr"><is><t>Hosted credits</t></is></c><c r="B3"><v>0</v></c></row>
</sheetData></worksheet>`, text),
	}
	return writeZip(path, parts)
}

func writeZip(path string, parts map[string]string) error {
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	zw := zip.NewWriter(file)
	names := make([]string, 0, len(parts))
	for name := range parts {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		part, createErr := zw.Create(name)
		if createErr != nil {
			_ = zw.Close()
			_ = file.Close()
			return createErr
		}
		if _, writeErr := part.Write([]byte(parts[name])); writeErr != nil {
			_ = zw.Close()
			_ = file.Close()
			return writeErr
		}
	}
	if err := zw.Close(); err != nil {
		_ = file.Close()
		return err
	}
	return file.Close()
}

func writeDemoPNG(path string) error {
	canvas := image.NewRGBA(image.Rect(0, 0, 640, 360))
	fillRect(canvas, canvas.Bounds(), color.RGBA{R: 246, G: 248, B: 247, A: 255})
	fillRect(canvas, image.Rect(64, 64, 576, 296), color.RGBA{R: 255, G: 255, B: 255, A: 255})
	fillRect(canvas, image.Rect(96, 96, 390, 116), color.RGBA{R: 17, G: 21, B: 19, A: 255})
	fillRect(canvas, image.Rect(96, 154, 236, 254), color.RGBA{R: 0, G: 122, B: 85, A: 255})
	fillRect(canvas, image.Rect(256, 186, 396, 254), color.RGBA{R: 54, G: 164, B: 125, A: 255})
	fillRect(canvas, image.Rect(416, 132, 544, 254), color.RGBA{R: 148, G: 211, B: 188, A: 255})
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	if err := png.Encode(file, canvas); err != nil {
		_ = file.Close()
		return err
	}
	return file.Close()
}

func writeDemoGIF(path string) error {
	palette := color.Palette{
		color.RGBA{R: 246, G: 248, B: 247, A: 255},
		color.RGBA{R: 0, G: 122, B: 85, A: 255},
		color.RGBA{R: 17, G: 21, B: 19, A: 255},
	}
	frames := []*image.Paletted{
		image.NewPaletted(image.Rect(0, 0, 320, 180), palette),
		image.NewPaletted(image.Rect(0, 0, 320, 180), palette),
	}
	fillPaletted(frames[0], image.Rect(54, 54, 150, 126), 1)
	fillPaletted(frames[1], image.Rect(170, 54, 266, 126), 1)
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	if err := gif.EncodeAll(file, &gif.GIF{Image: frames, Delay: []int{25, 25}, LoopCount: 0}); err != nil {
		_ = file.Close()
		return err
	}
	return file.Close()
}

func fillRect(img *image.RGBA, rect image.Rectangle, fill color.RGBA) {
	for y := rect.Min.Y; y < rect.Max.Y; y++ {
		for x := rect.Min.X; x < rect.Max.X; x++ {
			img.SetRGBA(x, y, fill)
		}
	}
}

func fillPaletted(img *image.Paletted, rect image.Rectangle, index uint8) {
	for y := rect.Min.Y; y < rect.Max.Y; y++ {
		for x := rect.Min.X; x < rect.Max.X; x++ {
			img.SetColorIndex(x, y, index)
		}
	}
}

func xmlText(value string) string {
	return html.EscapeString(strings.TrimSpace(value))
}
