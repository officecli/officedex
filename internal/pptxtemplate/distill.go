package pptxtemplate

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Distilled is the LLM (or facts-fallback) template skill written to disk.
type Distilled struct {
	VisualProfile map[string]any   `json:"visualProfile"`
	Layouts       []map[string]any `json:"layouts"`
	SkillMarkdown string           `json:"skillMarkdown"`
	Handbook      Handbook         `json:"handbook"`
	SkillRules    map[string]any   `json:"skillRules"`
	Capabilities  map[string]any   `json:"capabilities"`
	Source        string           `json:"source"`
	Warnings      []string         `json:"warnings,omitempty"`
}

// ProfileFromFacts builds a usable visual-profile without a model.
func ProfileFromFacts(facts Facts) map[string]any {
	color := func(keys ...string) string {
		for _, key := range keys {
			if hex := facts.Theme.Colors[key]; hex != "" {
				return hex
			}
		}
		if len(facts.Palette) > 0 {
			return facts.Palette[0]
		}
		return ""
	}
	titleFont := facts.Theme.MajorFont
	if titleFont == "" && len(facts.Fonts) > 0 {
		titleFont = facts.Fonts[0]
	}
	bodyFont := facts.Theme.MinorFont
	if bodyFont == "" {
		bodyFont = titleFont
	}
	titleSize, bodySize := typicalSizes(facts)
	return map[string]any{
		"version":    1,
		"source":     "mop-facts",
		"confidence": "observed",
		"primary":    color("accent1", "dark1"),
		"secondary":  color("accent2", "accent3"),
		"text":       color("dark1", "dark2"),
		"background": color("light1", "light2"),
		"palette":    facts.Palette,
		"fonts": map[string]any{
			"title": map[string]any{"name": titleFont, "sizePt": titleSize},
			"body":  map[string]any{"name": bodyFont, "sizePt": bodySize},
		},
		"fontFamilies": facts.Fonts,
		"pageCount":    facts.PageCount,
		"canvas":       facts.Canvas,
	}
}

func typicalSizes(facts Facts) (title, body float64) {
	title, body = 28, 14
	var sizes []float64
	for _, slide := range facts.Slides {
		for _, text := range slide.Texts {
			if text.SizePt > 0 {
				sizes = append(sizes, text.SizePt)
			}
		}
	}
	if len(sizes) == 0 {
		return title, body
	}
	sortFloats(sizes)
	body = sizes[len(sizes)/2]
	title = sizes[len(sizes)-1]
	if title < body {
		title = body
	}
	return title, body
}

func sortFloats(values []float64) {
	for i := 1; i < len(values); i++ {
		for j := i; j > 0 && values[j] < values[j-1]; j-- {
			values[j], values[j-1] = values[j-1], values[j]
		}
	}
}

// LayoutsFromFacts infers a small layout library from per-slide geometry.
func LayoutsFromFacts(facts Facts) []map[string]any {
	type key struct {
		texts    int
		pictures int
	}
	groups := map[key][]int{}
	for _, slide := range facts.Slides {
		k := key{texts: bucket(len(slide.Texts)), pictures: bucket(len(slide.Pictures))}
		groups[k] = append(groups[k], slide.Index)
	}
	var layouts []map[string]any
	for k, slides := range groups {
		id, relation, roles := layoutGuess(k.texts, k.pictures)
		layouts = append(layouts, map[string]any{
			"layoutId":        id,
			"contentRelation": relation,
			"roles":           roles,
			"sourceSlides":    slides,
			"source":          "mop-facts",
			"status":          "inferred",
			"clonePlan":       "structured",
		})
	}
	if len(layouts) == 0 {
		layouts = []map[string]any{{
			"layoutId": "text-summary", "contentRelation": "single-conclusion",
			"roles": []string{"title", "body"}, "source": "mop-facts", "status": "inferred", "clonePlan": "structured",
		}}
	}
	return layouts
}

func bucket(n int) int {
	switch {
	case n <= 0:
		return 0
	case n == 1:
		return 1
	case n <= 3:
		return 2
	default:
		return 3
	}
}

func layoutGuess(textBucket, pictureBucket int) (id, relation string, roles []string) {
	switch {
	case pictureBucket > 0 && textBucket <= 1:
		return "image-with-callout", "single-conclusion", []string{"title", "image", "callout"}
	case textBucket >= 3:
		return "parallel-blocks", "parallel", []string{"title", "repeated-block", "body"}
	case textBucket <= 1:
		return "cover-statement", "single-conclusion", []string{"title", "subtitle"}
	default:
		return "text-summary", "single-conclusion", []string{"title", "body"}
	}
}

func SkillFromFacts(facts Facts, distilled Distilled) string {
	if len(distilled.Handbook.Pages) > 0 {
		return RenderHandbookMarkdown(distilled.Handbook)
	}
	return RenderHandbookMarkdown(HandbookFromFacts(facts))
}

func FallbackDistilled(facts Facts) Distilled {
	profile := ProfileFromFacts(facts)
	layouts := LayoutsFromFacts(facts)
	out := Distilled{
		VisualProfile: profile,
		Layouts:       layouts,
		SkillRules: map[string]any{
			"version": 1, "status": "inferred", "source": "mop-facts",
			"visualProfile": "../visual-profile.json",
			"layoutLibrary": "../layout-library.json",
			"assetCatalog":  "../asset-catalog.json",
			"facts":         "../template-facts.json",
		},
		Capabilities: map[string]any{
			"supported": []string{"text", "basic-shape", "image"},
			"fallback":  []string{"chart", "smartart"},
			"warnings":  facts.Warnings,
		},
		Source:   "mop-facts",
		Handbook: HandbookFromFacts(facts),
		Warnings: facts.Warnings,
	}
	out.SkillMarkdown = RenderHandbookMarkdown(out.Handbook)
	return out
}

func WriteDistilled(assetDir string, facts Facts, distilled Distilled) error {
	if err := os.MkdirAll(filepath.Join(assetDir, "skill"), 0o700); err != nil {
		return err
	}
	writes := []struct {
		name  string
		value any
	}{
		{"template-facts.json", facts},
		{"visual-profile.json", distilled.VisualProfile},
		{"layout-library.json", map[string]any{"version": 1, "status": distilled.Source, "pageCount": facts.PageCount, "layouts": distilled.Layouts}},
		{"capability-report.json", distilled.Capabilities},
		{"skill/handbook.json", distilled.Handbook},
		{"analysis.json", map[string]any{
			"version": 1, "pageCount": facts.PageCount, "textObjects": facts.TextCount,
			"colors": facts.Palette, "fontFamilies": facts.Fonts, "source": distilled.Source,
			"warnings": append(append([]string{}, facts.Warnings...), distilled.Warnings...),
		}},
	}
	for _, item := range writes {
		data, err := json.MarshalIndent(item.value, "", "  ")
		if err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(assetDir, item.name), append(data, '\n'), 0o600); err != nil {
			return err
		}
	}
	if err := WriteSlots(assetDir, facts); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(assetDir, "skill", "SKILL.md"), []byte(distilled.SkillMarkdown), 0o600); err != nil {
		return err
	}
	rules, err := json.MarshalIndent(distilled.SkillRules, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(assetDir, "skill", "rules.json"), append(rules, '\n'), 0o600)
}
