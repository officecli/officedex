//go:build officedex_demo

package demoflow

import (
	"archive/zip"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unicode"
)

// writePromptPptx writes a small, deterministic, editable PPTX directly. The
// demo must remain self-contained: relying on a separately staged Node runtime
// made the Go demo build fail in clean worktrees.
func writePromptPptx(path, prompt string) error {
	qbr := strings.Contains(strings.ToUpper(prompt), "QBR") || strings.Contains(prompt, "季度业务回顾") || strings.Contains(prompt, "季度复盘")
	titles := []string{"封面", "管理摘要", "受众与定位", "渠道与动作", "验证指标", "行动清单"}
	if qbr {
		titles = []string{"QBR｜目标达成、关键指标、项目复盘与资源诉求", "管理摘要", "目标达成", "关键指标", "项目复盘", "资源诉求", "下一步"}
	} else if strings.Contains(prompt, "教育") || strings.Contains(prompt, "招生") {
		titles = append(titles, "招生推进")
	} else if strings.Contains(prompt, "产品") || strings.Contains(strings.ToLower(prompt), "product") {
		titles = append(titles, "迭代复盘")
	}
	if !qbr && (strings.Contains(prompt, "增长") || strings.Contains(prompt, "投资") || strings.Contains(prompt, "发布") || strings.Contains(strings.ToLower(prompt), "launch strategy")) {
		titles[0] = "新能源品牌｜增长与发布方案"
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	files := map[string]string{
		"[Content_Types].xml":                          contentTypes(len(titles)),
		"_rels/.rels":                                  relsXML,
		"ppt/presentation.xml":                         presentationXML(len(titles)),
		"ppt/_rels/presentation.xml.rels":              presentationRels(len(titles)),
		"ppt/theme/theme1.xml":                         themeXML,
		"ppt/slideMasters/slideMaster1.xml":            slideMasterXML,
		"ppt/slideMasters/_rels/slideMaster1.xml.rels": slideMasterRelsXML,
		"ppt/slideLayouts/slideLayout1.xml":            slideLayoutXML,
		"ppt/slideLayouts/_rels/slideLayout1.xml.rels": slideLayoutRelsXML,
	}
	for i, title := range titles {
		files[fmt.Sprintf("ppt/slides/slide%d.xml", i+1)] = slideXML(title, prompt)
	}
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	zw := zip.NewWriter(file)
	for name, body := range files {
		w, e := zw.Create(name)
		if e != nil {
			_ = zw.Close()
			_ = file.Close()
			return e
		}
		if _, e = w.Write([]byte(body)); e != nil {
			_ = zw.Close()
			_ = file.Close()
			return e
		}
	}
	if err = zw.Close(); err != nil {
		_ = file.Close()
		return err
	}
	return file.Close()
}

func promptPptxFileName(prompt string) string {
	if strings.Contains(strings.ToUpper(prompt), "QBR") || strings.Contains(prompt, "季度业务回顾") || strings.Contains(prompt, "季度复盘") {
		return "QBR-业务回顾.pptx"
	}
	topic := strings.TrimSpace(prompt)
	if i := strings.Index(topic, "为"); i >= 0 {
		rest := topic[i+len("为"):]
		if j := strings.Index(rest, "制作"); j >= 2 {
			topic = rest[:j]
		}
	}
	var b strings.Builder
	for _, r := range strings.ToLower(topic) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		} else if b.Len() > 0 && !strings.HasSuffix(b.String(), "-") {
			b.WriteByte('-')
		}
	}
	slug := strings.Trim(b.String(), "-")
	if slug == "" || slug == "local-demo" || slug == "demo" {
		slug = "prompt-deck"
	}
	rr := []rune(slug)
	if len(rr) > 56 {
		slug = string(rr[:56])
	}
	return slug + ".pptx"
}

func contentTypes(n int) string {
	s := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>`
	for i := 1; i <= n; i++ {
		s += fmt.Sprintf(`<Override PartName="/ppt/slides/slide%d.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`, i)
	}
	return s + `</Types>`
}
func presentationXML(n int) string {
	ids := ""
	for i := 1; i <= n; i++ {
		ids += fmt.Sprintf(`<p:sldId id="%d" r:id="rId%d"/>`, 255+i, i+1)
	}
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>` + ids + `</p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`
}
func presentationRels(n int) string {
	s := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>`
	for i := 1; i <= n; i++ {
		s += fmt.Sprintf(`<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide%d.xml"/>`, i+1, i)
	}
	return s + `</Relationships>`
}
func slideXML(title, prompt string) string {
	esc := xmlEscape(title)
	bodyText := strings.TrimSpace(prompt)
	if strings.Contains(title, "QBR") || title == "管理摘要" || title == "目标达成" || title == "关键指标" || title == "项目复盘" || title == "资源诉求" || title == "下一步" {
		bodyText += "｜可编辑字段｜待补充"
	}
	body := xmlEscape(bodyText)
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN"/><a:t>` + esc + `</a:t></a:r></a:p><a:p><a:r><a:rPr lang="zh-CN"/><a:t>` + body + `</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
}
func xmlEscape(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", "\"", "&quot;").Replace(s)
}

const relsXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`
const themeXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="OfficeDex"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:accent1><a:srgbClr val="007A55"/></a:accent1></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Aptos"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"/></a:themeElements></a:theme>`
const slideMasterXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles/></p:sldMaster>`
const slideMasterRelsXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`
const slideLayoutXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="title" preserve="1"><p:cSld name="Title Slide"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`
const slideLayoutRelsXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`
