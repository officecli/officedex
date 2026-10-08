package pptxtemplate

import (
	"fmt"
	"strings"
)

type Handbook struct {
	Version int            `json:"version"`
	Source  string         `json:"source"`
	Pages   []HandbookPage `json:"pages"`
}

type HandbookPage struct {
	Index    int            `json:"index"`
	PageKind string         `json:"pageKind"`
	Purpose  string         `json:"purpose"`
	Slots    []HandbookSlot `json:"slots"`
	Keep     []string       `json:"keep,omitempty"`
}

type HandbookSlot struct {
	SlotID   string `json:"slotId"`
	Role     string `json:"role"`
	FillWith string `json:"fillWith"`
	DataKind string `json:"dataKind"`
	MaxChars int    `json:"maxChars"`
	Sample   string `json:"sample"`
}

func HandbookFromFacts(facts Facts) Handbook {
	out := Handbook{Version: 1, Source: "mop-slots"}
	for _, slide := range facts.Slides {
		page := HandbookPage{Index: slide.Index}
		for _, box := range slide.Texts {
			if !box.Replaceable {
				if box.SlotID != "" {
					page.Keep = append(page.Keep, box.SlotID+" 固定文本")
				}
				continue
			}
			fill, kind := inferFill(box)
			page.Slots = append(page.Slots, HandbookSlot{
				SlotID: box.SlotID, Role: box.Role, FillWith: fill, DataKind: kind,
				MaxChars: box.MaxChars, Sample: box.Text,
			})
		}
		for _, pic := range slide.Pictures {
			if pic.Logo {
				page.Keep = append(page.Keep, "logo 图片")
			}
		}
		page.PageKind = inferPageKind(slide, len(page.Slots))
		page.Purpose = fmt.Sprintf("Fill %d replaceable text slots on this slide. Do not add shapes.", len(page.Slots))
		out.Pages = append(out.Pages, page)
	}
	return out
}

func RenderHandbookMarkdown(h Handbook) string {
	var b strings.Builder
	b.WriteString("# Template MOP fill handbook\n\n")
	b.WriteString("Fill new data into existing text slots only. Do not add slides or shapes, and do not change geometry. Sample strings are placeholders — never copy them.\n\n")
	for _, page := range h.Pages {
		fmt.Fprintf(&b, "## Slide %d · %s\n\n", page.Index, emptyDefault(page.PageKind, "content"))
		if page.Purpose != "" {
			b.WriteString(page.Purpose + "\n\n")
		}
		b.WriteString("| slotId | role | fillWith | maxChars | sample |\n|---|---|---|---|---|\n")
		for _, slot := range page.Slots {
			fmt.Fprintf(&b, "| `%s` | %s | %s | %d | %s |\n", slot.SlotID, slot.Role, slot.FillWith, slot.MaxChars, strings.ReplaceAll(slot.Sample, "|", "\\|"))
		}
		if len(page.Keep) > 0 {
			fmt.Fprintf(&b, "\nKeep unchanged: %s\n", strings.Join(page.Keep, "; "))
		}
		b.WriteString("\n")
	}
	return b.String()
}

func MergeHandbook(base Handbook, incoming Handbook) Handbook {
	if len(incoming.Pages) == 0 {
		return base
	}
	byIndex := map[int]HandbookPage{}
	for _, page := range incoming.Pages {
		byIndex[page.Index] = page
	}
	out := base
	out.Source = "llm"
	for i, page := range out.Pages {
		overlay, ok := byIndex[page.Index]
		if !ok {
			continue
		}
		if overlay.PageKind != "" {
			page.PageKind = overlay.PageKind
		}
		if overlay.Purpose != "" {
			page.Purpose = overlay.Purpose
		}
		byID := map[string]HandbookSlot{}
		for _, slot := range overlay.Slots {
			byID[slot.SlotID] = slot
		}
		for j, slot := range page.Slots {
			if next, ok := byID[slot.SlotID]; ok {
				if next.FillWith != "" {
					slot.FillWith = next.FillWith
				}
				if next.Role != "" {
					slot.Role = next.Role
				}
				if next.DataKind != "" {
					slot.DataKind = next.DataKind
				}
				page.Slots[j] = slot
			}
		}
		out.Pages[i] = page
	}
	return out
}

func inferFill(box TextFact) (fill, kind string) {
	text := box.Text
	switch {
	case strings.Contains(text, "汇报人") || strings.Contains(text, "姓名"):
		return "Presenter full name", "person-name"
	case strings.Contains(text, "公司名字") || strings.Contains(text, "公司名称"):
		return "Company / organization name (global)", "org-name"
	case strings.Contains(text, "电话"):
		return "Contact phone", "phone"
	case strings.Contains(text, "地址"):
		return "Contact address", "address"
	case box.Role == "title":
		return "Slide title", "title"
	case box.Role == "subtitle":
		return "Slide subtitle or one-line claim", "subtitle"
	default:
		return "Replacement copy for this existing text box", "body"
	}
}

func inferPageKind(slide SlideFact, slotCount int) string {
	pics := len(slide.Pictures)
	switch {
	case slide.Index == 1:
		return "cover"
	case slotCount <= 2 && pics >= 1:
		return "section-divider"
	case slotCount >= 8:
		return "parallel-4"
	case slotCount >= 5:
		return "parallel-3"
	case pics >= 1:
		return "split-image"
	default:
		return "content"
	}
}

func emptyDefault(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}
