package pptxtemplate

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"
)

var pageNumberRE = regexp.MustCompile(`^(page\s*)?\d+(\s*/\s*\d+)?$`)

type SlotCatalog struct {
	Version int         `json:"version"`
	Slides  []SlideSlot `json:"slides"`
}

type SlideSlot struct {
	Index int        `json:"index"`
	Slots []TextFact `json:"slots"`
}

func classifySlideTexts(slide *SlideFact) {
	if slide == nil {
		return
	}
	pageH := 540.0
	for i := range slide.Texts {
		box := &slide.Texts[i]
		if box.SlotID == "" {
			box.SlotID = fmt.Sprintf("s%d-t%d", slide.Index, i)
		}
		box.MaxChars = maxChars(*box)
		sample := strings.TrimSpace(box.Text)
		switch {
		case pageNumberRE.MatchString(strings.ToLower(sample)):
			box.Role, box.Replaceable = "page-number", false
		case box.Top > pageH*0.9 && box.SizePt > 0 && box.SizePt < 12:
			box.Role, box.Replaceable = "footer", false
		case sample == "公司名字" || (box.Top < 50 && box.Left < 90 && box.Width < 90 && box.SizePt <= 18 && utf8.RuneCountInString(sample) <= 8):
			box.Role, box.Replaceable = "brand", true
		default:
			box.Role, box.Replaceable = "body", utf8.RuneCountInString(sample) >= 2
		}
	}
	var candidates []int
	for i, box := range slide.Texts {
		if box.Replaceable && box.Role != "brand" {
			candidates = append(candidates, i)
		}
	}
	best := -1
	bestSize := 0.0
	for _, i := range candidates {
		if slide.Texts[i].SizePt > bestSize {
			best, bestSize = i, slide.Texts[i].SizePt
		}
	}
	if best >= 0 && bestSize >= 24 {
		slide.Texts[best].Role = "title"
	}
}

func maxChars(box TextFact) int {
	size := box.SizePt
	if size < 10 {
		size = 12
	}
	if box.Width <= 0 {
		return 40
	}
	cjk := false
	for _, r := range box.Text {
		if r >= 0x3400 && r <= 0x9fff {
			cjk = true
			break
		}
	}
	perLine := box.Width / size * 1.6
	if cjk {
		perLine = box.Width / size * 1.15
	}
	n := int(perLine)
	if box.Height > 0 {
		lines := int(box.Height / (size * 1.35))
		if lines < 1 {
			lines = 1
		}
		n *= lines
	}
	if n < 8 {
		return 8
	}
	if n > 160 {
		return 160
	}
	return n
}

func SlotCatalogFromFacts(facts Facts) SlotCatalog {
	out := SlotCatalog{Version: 1}
	for _, slide := range facts.Slides {
		item := SlideSlot{Index: slide.Index}
		for _, box := range slide.Texts {
			item.Slots = append(item.Slots, box)
		}
		out.Slides = append(out.Slides, item)
	}
	return out
}

func WriteSlots(assetDir string, facts Facts) error {
	data, err := json.MarshalIndent(SlotCatalogFromFacts(facts), "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(assetDir, "slots.json"), append(data, '\n'), 0o600)
}

func ReplaceableSlots(facts Facts) []TextFact {
	var out []TextFact
	for _, slide := range facts.Slides {
		for _, box := range slide.Texts {
			if box.Replaceable {
				out = append(out, box)
			}
		}
	}
	return out
}
