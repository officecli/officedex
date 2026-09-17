// Package pptxtemplate extracts compact, model-ready facts from an imported
// template MOP. The MOP uses blocks/attrs (latinFont, scheme colors, EMU
// transforms), not the type/text/fontFamily keys the first importer scanned.
package pptxtemplate

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const (
	emuPerPoint          = 12700.0
	fontSizeHundredthsPt = 100.0
	maxTextBoxesPerSlide = 12
	maxTextChars         = 80
	maxPicturesPerSlide  = 8
)

// Facts is the compact structure written as template-facts.json and sent to
// the distiller. It is the only MOP-derived payload generation should see.
type Facts struct {
	Version   int         `json:"version"`
	PageCount int         `json:"pageCount"`
	Canvas    Size        `json:"canvas"`
	Theme     Theme       `json:"theme"`
	Palette   []string    `json:"palette"`
	Fonts     []string    `json:"fonts"`
	TextCount int         `json:"textCount"`
	Slides    []SlideFact `json:"slides"`
	Warnings  []string    `json:"warnings,omitempty"`
}

type Size struct {
	WidthPt  float64 `json:"widthPt"`
	HeightPt float64 `json:"heightPt"`
}

type Theme struct {
	Colors    map[string]string `json:"colors"`
	MajorFont string            `json:"majorFont,omitempty"`
	MinorFont string            `json:"minorFont,omitempty"`
}

type SlideFact struct {
	Index     int           `json:"index"`
	ID        string        `json:"id,omitempty"`
	LayoutRef string        `json:"layoutRef,omitempty"`
	Texts     []TextFact    `json:"texts,omitempty"`
	Pictures  []PictureFact `json:"pictures,omitempty"`
}

type TextFact struct {
	Name        string  `json:"name,omitempty"`
	SlotID      string  `json:"slotId,omitempty"`
	Role        string  `json:"role,omitempty"`
	Replaceable bool    `json:"replaceable"`
	MaxChars    int     `json:"maxChars,omitempty"`
	Left        float64 `json:"left"`
	Top         float64 `json:"top"`
	Width       float64 `json:"width"`
	Height      float64 `json:"height"`
	SizePt      float64 `json:"sizePt,omitempty"`
	Font        string  `json:"font,omitempty"`
	Color       string  `json:"color,omitempty"`
	Align       string  `json:"align,omitempty"`
	Text        string  `json:"text"`
}

type PictureFact struct {
	Name   string  `json:"name,omitempty"`
	Digest string  `json:"digest,omitempty"`
	Left   float64 `json:"left"`
	Top    float64 `json:"top"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
	Logo   bool    `json:"logo,omitempty"`
}

type mopNode struct {
	Type  string          `json:"type"`
	Attrs json.RawMessage `json:"attrs"`
	Data  json.RawMessage `json:"data"`
}

// ExtractFacts reads source.mop/content.json and returns a compact fact sheet.
func ExtractFacts(mopDirectory string) (Facts, error) {
	raw, err := os.ReadFile(filepath.Join(mopDirectory, "content.json"))
	if err != nil {
		return Facts{}, fmt.Errorf("read template MOP: %w", err)
	}
	return ExtractFactsJSON(raw)
}

func ExtractFactsJSON(raw []byte) (Facts, error) {
	var root struct {
		Blocks []mopNode `json:"blocks"`
	}
	if err := json.Unmarshal(raw, &root); err != nil {
		return Facts{}, fmt.Errorf("parse template MOP: %w", err)
	}
	facts := Facts{Version: 1, Theme: Theme{Colors: map[string]string{}}}
	var slides []mopNode
	for _, block := range root.Blocks {
		switch block.Type {
		case "presentation":
			facts.Canvas = sizeFromAttrs(block.Attrs)
		case "themes":
			facts.Theme = themeFromBlock(block)
		case "slides":
			if err := json.Unmarshal(block.Data, &slides); err != nil {
				return Facts{}, fmt.Errorf("parse slides: %w", err)
			}
		}
	}
	for i, slide := range slides {
		if slide.Type != "" && slide.Type != "slide" {
			continue
		}
		facts.Slides = append(facts.Slides, slideFact(i+1, slide, facts.Theme))
	}
	facts.PageCount = len(facts.Slides)
	facts.Palette = palette(facts)
	facts.Fonts = fonts(facts)
	for _, slide := range facts.Slides {
		facts.TextCount += len(slide.Texts)
	}
	if facts.PageCount == 0 {
		facts.Warnings = append(facts.Warnings, "page-count-not-detected")
	}
	if len(facts.Palette) == 0 {
		facts.Warnings = append(facts.Warnings, "palette-empty")
	}
	if facts.TextCount == 0 {
		facts.Warnings = append(facts.Warnings, "no-text-extracted")
	}
	return facts, nil
}

func slideFact(index int, slide mopNode, theme Theme) SlideFact {
	attrs := asMap(slide.Attrs)
	fact := SlideFact{
		Index:     index,
		ID:        stringField(attrs, "logicalId"),
		LayoutRef: stringField(attrs, "layoutRef"),
	}
	var children []mopNode
	_ = json.Unmarshal(slide.Data, &children)
	walkNodes(children, transform{}, theme, &fact)
	classifySlideTexts(&fact)
	if len(fact.Pictures) > maxPicturesPerSlide {
		fact.Pictures = fact.Pictures[:maxPicturesPerSlide]
	}
	return fact
}

type transform struct {
	left, top, width, height float64
}

func walkNodes(nodes []mopNode, box transform, theme Theme, slide *SlideFact) {
	for _, node := range nodes {
		attrs := asMap(node.Attrs)
		next := box
		if xf := asMap(rawMap(attrs["transform"])); len(xf) > 0 {
			next = transformFrom(xf)
		}
		switch node.Type {
		case "picture":
			pic := PictureFact{
				Name:   stringField(attrs, "name"),
				Digest: digestFrom(attrs),
				Left:   next.left, Top: next.top, Width: next.width, Height: next.height,
			}
			pic.Logo = looksLikeLogo(pic)
			slide.Pictures = append(slide.Pictures, pic)
			continue
		case "shape":
			if text := collectText(node); text != "" {
				run := firstRunProps(node)
				idx := len(slide.Texts)
				slide.Texts = append(slide.Texts, TextFact{
					Name:   stringField(attrs, "name"),
					SlotID: fmt.Sprintf("s%d-t%d", slide.Index, idx),
					Left:   next.left, Top: next.top, Width: next.width, Height: next.height,
					SizePt: fontSizePt(run),
					Font:   fontFrom(run, theme),
					Color:  colorFrom(run, attrs, theme),
					Align:  alignFrom(node),
					Text:   clip(text, 200),
				})
			}
			continue
		}
		var children []mopNode
		if json.Unmarshal(node.Data, &children) == nil {
			walkNodes(children, next, theme, slide)
		}
	}
}

func collectText(node mopNode) string {
	var parts []string
	var walk func(mopNode)
	walk = func(n mopNode) {
		if n.Type == "text" {
			var s string
			if json.Unmarshal(n.Data, &s) == nil {
				s = strings.TrimSpace(s)
				if s != "" {
					parts = append(parts, s)
				}
			}
			return
		}
		var children []mopNode
		if json.Unmarshal(n.Data, &children) == nil {
			for _, child := range children {
				walk(child)
			}
		}
	}
	walk(node)
	return strings.TrimSpace(strings.Join(parts, " "))
}

func firstRunProps(node mopNode) map[string]any {
	var found map[string]any
	var walk func(mopNode)
	walk = func(n mopNode) {
		if found != nil {
			return
		}
		if n.Type == "run" {
			attrs := asMap(n.Attrs)
			if props := asMap(rawMap(attrs["runProperties"])); len(props) > 0 {
				found = props
				return
			}
		}
		var children []mopNode
		if json.Unmarshal(n.Data, &children) == nil {
			for _, child := range children {
				walk(child)
			}
		}
	}
	walk(node)
	if found == nil {
		return map[string]any{}
	}
	return found
}

func themeFromBlock(block mopNode) Theme {
	theme := Theme{Colors: map[string]string{}}
	var themes []mopNode
	if json.Unmarshal(block.Data, &themes) != nil {
		return theme
	}
	var walk func(mopNode)
	walk = func(n mopNode) {
		attrs := asMap(n.Attrs)
		switch n.Type {
		case "colorScheme":
			colors := asMap(rawMap(attrs["colors"]))
			for name, raw := range colors {
				if hex := colorValue(asMap(rawMap(raw)), nil); hex != "" {
					theme.Colors[name] = hex
				}
			}
		case "fontScheme":
			if theme.MajorFont == "" {
				theme.MajorFont = schemeTypeface(asMap(rawMap(attrs["majorFont"])))
			}
			if theme.MinorFont == "" {
				theme.MinorFont = schemeTypeface(asMap(rawMap(attrs["minorFont"])))
			}
		}
		var children []mopNode
		if json.Unmarshal(n.Data, &children) == nil {
			for _, child := range children {
				walk(child)
			}
		}
	}
	for _, item := range themes {
		walk(item)
	}
	return theme
}

func sizeFromAttrs(raw json.RawMessage) Size {
	attrs := asMap(raw)
	size := asMap(rawMap(attrs["slideSize"]))
	return Size{WidthPt: emuToPt(number(size["width"])), HeightPt: emuToPt(number(size["height"]))}
}

func transformFrom(xf map[string]any) transform {
	off := asMap(rawMap(xf["offset"]))
	ext := asMap(rawMap(xf["extent"]))
	return transform{
		left: emuToPt(number(off["x"])), top: emuToPt(number(off["y"])),
		width: emuToPt(number(ext["cx"])), height: emuToPt(number(ext["cy"])),
	}
}

func digestFrom(attrs map[string]any) string {
	resource := asMap(rawMap(attrs["resource"]))
	digest := stringField(resource, "digest")
	return strings.TrimPrefix(digest, "sha256:")
}

func fontSizePt(run map[string]any) float64 {
	size := number(run["fontSize"])
	if size <= 0 {
		return 0
	}
	if size > 200 {
		return size / fontSizeHundredthsPt
	}
	return size
}

func fontFrom(run map[string]any, theme Theme) string {
	for _, key := range []string{"eastAsianFont", "latinFont"} {
		if name := typeface(asMap(rawMap(run[key]))); name != "" {
			return name
		}
	}
	if theme.MinorFont != "" {
		return theme.MinorFont
	}
	return theme.MajorFont
}

func colorFrom(run map[string]any, shapeAttrs map[string]any, theme Theme) string {
	if hex := colorValue(asMap(rawMap(run["fill"])), theme.Colors); hex != "" {
		return hex
	}
	return colorValue(asMap(rawMap(shapeAttrs["fill"])), theme.Colors)
}

func colorValue(fill map[string]any, scheme map[string]string) string {
	if fill == nil {
		return ""
	}
	color := asMap(rawMap(fill["color"]))
	if len(color) == 0 {
		color = fill
	}
	kind := stringField(color, "colorKind")
	value := stringField(color, "value")
	if kind == "srgb" && value != "" {
		return "#" + strings.ToUpper(strings.TrimPrefix(value, "#"))
	}
	if (kind == "scheme" || kind == "") && value != "" && scheme != nil {
		if mapped := schemeColor(value, scheme); mapped != "" {
			return mapped
		}
	}
	return ""
}

func schemeColor(name string, scheme map[string]string) string {
	aliases := map[string]string{
		"tx1": "dark1", "tx2": "dark2", "bg1": "light1", "bg2": "light2",
		"dk1": "dark1", "dk2": "dark2", "lt1": "light1", "lt2": "light2",
	}
	if mapped, ok := aliases[strings.ToLower(name)]; ok {
		name = mapped
	}
	if hex, ok := scheme[name]; ok {
		return hex
	}
	return ""
}

func schemeTypeface(font map[string]any) string {
	for _, key := range []string{"eastAsianFont", "latinFont"} {
		if name := typeface(asMap(rawMap(font[key]))); name != "" {
			return name
		}
	}
	return typeface(font)
}

func typeface(font map[string]any) string {
	name := stringField(font, "typeface")
	if name == "" || strings.HasPrefix(name, "+") {
		return ""
	}
	return name
}

func alignFrom(node mopNode) string {
	var align string
	var walk func(mopNode)
	walk = func(n mopNode) {
		if align != "" {
			return
		}
		attrs := asMap(n.Attrs)
		body := asMap(rawMap(attrs["bodyProperties"]))
		if a := stringField(body, "anchor"); a != "" {
			align = normalizeAlign(a)
			return
		}
		if a := stringField(attrs, "paragraphAlignment"); a != "" {
			align = normalizeAlign(a)
			return
		}
		var children []mopNode
		if json.Unmarshal(n.Data, &children) == nil {
			for _, child := range children {
				walk(child)
			}
		}
	}
	walk(node)
	return align
}

func normalizeAlign(value string) string {
	switch strings.ToLower(value) {
	case "ctr", "center":
		return "center"
	case "r", "right":
		return "right"
	case "l", "left":
		return "left"
	default:
		return ""
	}
}

func looksLikeLogo(pic PictureFact) bool {
	if strings.Contains(strings.ToLower(pic.Name), "logo") {
		return true
	}
	return pic.Top < 80 && pic.Left < 120 && pic.Width > 0 && pic.Width < 220 && pic.Height > 0 && pic.Height < 80
}

func palette(facts Facts) []string {
	seen := map[string]struct{}{}
	var out []string
	add := func(hex string) {
		hex = strings.ToUpper(strings.TrimSpace(hex))
		if hex == "" {
			return
		}
		if !strings.HasPrefix(hex, "#") {
			hex = "#" + hex
		}
		if _, ok := seen[hex]; ok {
			return
		}
		seen[hex] = struct{}{}
		out = append(out, hex)
	}
	for _, key := range []string{"dark1", "accent1", "accent2", "light1", "hyperlink"} {
		add(facts.Theme.Colors[key])
	}
	for _, hex := range facts.Theme.Colors {
		add(hex)
	}
	for _, slide := range facts.Slides {
		for _, text := range slide.Texts {
			add(text.Color)
		}
	}
	sort.Strings(out)
	return out
}

func fonts(facts Facts) []string {
	seen := map[string]struct{}{}
	var out []string
	add := func(name string) {
		name = strings.TrimSpace(name)
		if name == "" {
			return
		}
		if _, ok := seen[name]; ok {
			return
		}
		seen[name] = struct{}{}
		out = append(out, name)
	}
	add(facts.Theme.MajorFont)
	add(facts.Theme.MinorFont)
	for _, slide := range facts.Slides {
		for _, text := range slide.Texts {
			add(text.Font)
		}
	}
	sort.Strings(out)
	return out
}

func emuToPt(value float64) float64 {
	if value == 0 {
		return 0
	}
	return value / emuPerPoint
}

func asMap(raw json.RawMessage) map[string]any {
	if len(raw) == 0 {
		return map[string]any{}
	}
	var value map[string]any
	if json.Unmarshal(raw, &value) != nil {
		return map[string]any{}
	}
	return value
}

func rawMap(value any) json.RawMessage {
	switch typed := value.(type) {
	case json.RawMessage:
		return typed
	case map[string]any:
		raw, _ := json.Marshal(typed)
		return raw
	default:
		return nil
	}
}

func stringField(m map[string]any, key string) string {
	value, _ := m[key].(string)
	return strings.TrimSpace(value)
}

func number(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case json.Number:
		n, _ := typed.Float64()
		return n
	case int:
		return float64(typed)
	default:
		return 0
	}
}

func clip(text string, limit int) string {
	runes := []rune(strings.Join(strings.Fields(text), " "))
	if len(runes) <= limit {
		return string(runes)
	}
	return string(runes[:limit]) + "…"
}
