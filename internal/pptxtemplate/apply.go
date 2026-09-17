package pptxtemplate

import (
	"encoding/json"
	"strings"
)

// MergeLLM overlays a model distillation onto the facts fallback. Invalid
// colors, fonts, or slide indexes are dropped rather than trusted.
func MergeLLM(facts Facts, raw []byte) (Distilled, error) {
	base := FallbackDistilled(facts)
	var parsed struct {
		VisualProfile map[string]any   `json:"visualProfile"`
		Layouts       []map[string]any `json:"layouts"`
		Handbook      Handbook         `json:"handbook"`
		Skill         map[string]any   `json:"skill"`
		Capabilities  map[string]any   `json:"capabilities"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return base, err
	}
	warnings := append([]string{}, base.Warnings...)
	if parsed.VisualProfile != nil {
		base.VisualProfile = mergeProfile(facts, base.VisualProfile, parsed.VisualProfile, &warnings)
	}
	if len(parsed.Layouts) > 0 {
		base.Layouts = filterLayouts(facts, parsed.Layouts, &warnings)
	}
	if parsed.Capabilities != nil {
		base.Capabilities = parsed.Capabilities
	}
	if len(parsed.Handbook.Pages) > 0 {
		base.Handbook = MergeHandbook(base.Handbook, parsed.Handbook)
	}
	base.Source = "llm"
	base.Warnings = warnings
	base.SkillRules["source"] = "llm"
	base.SkillRules["status"] = "distilled"
	base.SkillMarkdown = RenderHandbookMarkdown(base.Handbook)
	return base, nil
}

func mergeProfile(facts Facts, fallback, incoming map[string]any, warnings *[]string) map[string]any {
	out := map[string]any{}
	for k, v := range fallback {
		out[k] = v
	}
	allowed := map[string]struct{}{}
	for _, hex := range facts.Palette {
		allowed[strings.ToUpper(hex)] = struct{}{}
	}
	for _, key := range []string{"primary", "secondary", "text", "background"} {
		hex, _ := incoming[key].(string)
		if hex == "" {
			continue
		}
		norm := strings.ToUpper(hex)
		if !strings.HasPrefix(norm, "#") {
			norm = "#" + norm
		}
		if _, ok := allowed[norm]; ok || len(allowed) == 0 {
			out[key] = norm
		} else {
			*warnings = append(*warnings, "dropped-color:"+key)
		}
	}
	out["source"] = "llm"
	out["confidence"] = "distilled"
	return out
}

func filterLayouts(facts Facts, incoming []map[string]any, warnings *[]string) []map[string]any {
	max := facts.PageCount
	var out []map[string]any
	for _, layout := range incoming {
		id, _ := layout["layoutId"].(string)
		if strings.TrimSpace(id) == "" {
			*warnings = append(*warnings, "dropped-layout-missing-id")
			continue
		}
		rawSlides, _ := layout["sourceSlides"].([]any)
		var slides []int
		for _, item := range rawSlides {
			n := int(number(item))
			if n >= 1 && n <= max {
				slides = append(slides, n)
			}
		}
		if len(rawSlides) > 0 && len(slides) == 0 {
			*warnings = append(*warnings, "dropped-layout:"+id)
			continue
		}
		layout["sourceSlides"] = slides
		layout["status"] = "distilled"
		out = append(out, layout)
	}
	if len(out) == 0 {
		return LayoutsFromFacts(facts)
	}
	return out
}
