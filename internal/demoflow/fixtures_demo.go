//go:build officedex_demo

package demoflow

import "strconv"

const magicPrompt = "Create a launch strategy presentation for a new AI productivity app. Define the target audience, positioning, launch channels, a 90-day rollout plan, and success metrics. Make it clear, visual, and suitable for an executive review."
const timelineEditPrompt = "Turn this launch timeline into a vertical roadmap."

var demoStages = []struct {
	ID    string
	Label string
}{
	{"outline_ready", "Story Beats"},
	{"refined_ready", "Slide Outlines"},
	{"slides_ready", "Generated Slides"},
	{"completed", "Review"},
}

var demoSlides = []map[string]any{
	demoTitleSlide("demo-slide-01", "Launch Strategy", "New AI Productivity App"),
	demoBulletsSlide("demo-slide-02", "Executive Summary", []string{"Position around trusted execution", "Launch in focused professional channels", "Measure activation, retention, and team adoption"}),
	demoBulletsSlide("demo-slide-03", "Target Audience", []string{"Operators building recurring decks", "Founders preparing investor and launch materials", "Marketing teams turning briefs into presentations"}),
	demoBulletsSlide("demo-slide-04", "Positioning", []string{"From prompt to reviewable presentation workflow", "Visible planning before slide creation", "Editable output with AI-assisted refinement"}),
	demoBulletsSlide("demo-slide-05", "Launch Channels", []string{"Website launch page", "X product demo thread", "Creator and productivity communities", "Template-led onboarding campaigns"}),
	demoTimelineSlide("demo-slide-06"),
	demoBulletsSlide("demo-slide-07", "Success Metrics", []string{"Activation: first PPTX created", "Quality: preview opened and edited", "Growth: referral and social conversion", "Revenue: paid upgrade intent"}),
	demoBulletsSlide("demo-slide-08", "Risks and Mitigations", []string{"Slow generation: deterministic staged feedback", "Unclear output quality: preview-first review", "Trust gap: transparent confirmations"}),
	demoBulletsSlide("demo-slide-09", "Next Steps", []string{"Record launch video", "Ship demo build", "Prepare website and X assets", "Open download funnel"}),
}

var demoStageConfirmationNodeIDs = []string{"chapter-02", "outline-6", "slide-6"}

func demoTitleSlide(id, title, subtitle string) map[string]any {
	return map[string]any{
		"id":         id,
		"background": map[string]any{"type": "solid", "color": "#FCFAF2"},
		"elements": []map[string]any{
			{"id": "title", "type": "text", "left": 72, "top": 92, "width": 780, "height": 88, "content": "<p>" + title + "</p>", "defaultFontName": "Inter", "defaultColor": "#05101A"},
			{"id": "subtitle", "type": "text", "left": 76, "top": 205, "width": 720, "height": 52, "content": "<p>" + subtitle + "</p>", "defaultFontName": "Inter", "defaultColor": "#1A2530"},
		},
	}
}

func demoBulletsSlide(id, title string, bullets []string) map[string]any {
	elements := []map[string]any{{"id": "title", "type": "text", "left": 64, "top": 48, "width": 820, "height": 60, "content": "<p>" + title + "</p>", "defaultFontName": "Inter", "defaultColor": "#05101A"}}
	for i, bullet := range bullets {
		elements = append(elements, map[string]any{
			"id": "bullet-" + strconv.Itoa(i+1), "type": "text",
			"left": 92, "top": 150 + i*82, "width": 760, "height": 54,
			"content": bulletText(bullet), "defaultFontName": "Inter", "defaultColor": "#1A2530",
		})
	}
	return map[string]any{"id": id, "background": map[string]any{"type": "solid", "color": "#FCFAF2"}, "elements": elements}
}

func demoTimelineSlide(id string) map[string]any {
	elements := []map[string]any{{"id": "title", "type": "text", "left": 64, "top": 48, "width": 820, "height": 60, "content": "<p>90-Day Launch Timeline</p>", "defaultFontName": "Inter", "defaultColor": "#05101A", "defaultFontSize": 26}}
	labels := []string{"Days 1-30: Validate", "Days 31-60: Launch", "Days 61-90: Scale"}
	for i, label := range labels {
		elements = append(elements, map[string]any{
			"id": "phase-" + strconv.Itoa(i+1), "type": "text",
			"left": 80 + i*285, "top": 190, "width": 230, "height": 86,
			"content": bulletText(label), "defaultFontName": "Inter", "defaultColor": "#1A2530",
		})
	}
	return map[string]any{"id": id, "background": map[string]any{"type": "solid", "color": "#FCFAF2"}, "elements": elements}
}

func bulletText(text string) string {
	return "<p>" + text + "</p>"
}

func demoTreePayload(idx int) map[string]any {
	stage := demoStages[min(idx, len(demoStages)-1)]
	nodes := demoTreeNodesForStage(stage.ID)
	payload := map[string]any{
		"stage":       stage.ID,
		"stage_id":    stage.ID,
		"stage_label": stage.Label,
		"tree": map[string]any{
			"id":     "demo-tree",
			"rootId": "root",
			"title":  "Launch Strategy",
			"nodes":  nodes,
		},
	}
	if idx < len(demoQuestions) {
		payload["actions"] = []map[string]any{{"id": "confirm", "label": "Approve " + demoQuestions[idx].Label}}
		payload["confirmation"] = map[string]any{"nodeIds": []string{demoStageConfirmationNodeIDs[idx]}}
	}
	return payload
}

func demoTreeNodesForStage(stage string) []map[string]any {
	nodes := []map[string]any{demoTreeNode("root", "", "root", "Launch Strategy", "Executive-ready launch plan for an AI productivity app.")}
	nodes = append(nodes,
		demoTreeNode("branch-01", "root", "branch", "Audience + Positioning", "Clarify who the product is for and why it wins."),
		demoTreeNode("branch-02", "root", "branch", "Launch Motion", "Sequence website, X, communities, and onboarding."),
		demoTreeNode("branch-03", "root", "branch", "Measurement", "Define success metrics and risk controls."),
	)
	if stage == "outline_ready" {
		return append(nodes,
			demoTreeNode("chapter-01", "branch-01", "slide_group", "Market Narrative", "Audience, positioning, and executive summary."),
			demoTreeNode("chapter-02", "branch-02", "slide_group", "Launch Execution", "Channels and 90-day rollout."),
			demoTreeNode("chapter-03", "branch-03", "slide_group", "Operating Metrics", "KPIs, risks, and next steps."),
		)
	}
	nodes = append(nodes,
		demoTreeNode("chapter-01", "branch-01", "slide_group", "Market Narrative", "Audience, positioning, and executive summary."),
		demoTreeNode("chapter-02", "branch-02", "slide_group", "Launch Execution", "Channels and 90-day rollout."),
		demoTreeNode("chapter-03", "branch-03", "slide_group", "Operating Metrics", "KPIs, risks, and next steps."),
	)
	for _, outline := range demoOutlineNodes() {
		nodes = append(nodes, outline)
	}
	if stage == "refined_ready" {
		return nodes
	}
	for _, slide := range demoGeneratedSlideNodes() {
		nodes = append(nodes, slide)
	}
	if stage == "completed" {
		nodes = append(nodes, demoTreeNode("deck", "slide-09", "deck", "Launch Strategy Deck", "All 9 slides assembled into an editable PPTX."))
	}
	return nodes
}

func demoTreeNode(id, parentID, kind, title, summary string) map[string]any {
	node := map[string]any{
		"id":      id,
		"kind":    kind,
		"title":   title,
		"summary": summary,
		"status":  "done",
	}
	if parentID != "" {
		node["parentId"] = parentID
	}
	return node
}

func demoOutlineNodes() []map[string]any {
	titles := []string{
		"Title and Promise",
		"Executive Summary",
		"Target Audience",
		"Positioning",
		"Launch Channels",
		"90-Day Timeline",
		"Success Metrics",
		"Risks and Mitigations",
		"Download CTA",
	}
	parents := []string{"chapter-01", "chapter-01", "chapter-01", "chapter-01", "chapter-02", "chapter-02", "chapter-03", "chapter-03", "chapter-03"}
	out := make([]map[string]any, 0, len(titles))
	for i, title := range titles {
		node := demoTreeNode("outline-"+strconv.Itoa(i+1), parents[i], "outline", title, "Define the slide content, visual intent, and proof points.")
		node["slideNumber"] = i + 1
		node["outline"] = []string{"Message", "Visual structure", "Executive takeaway"}
		out = append(out, node)
	}
	return out
}

func demoGeneratedSlideNodes() []map[string]any {
	titles := []string{
		"Launch Strategy",
		"Executive Summary",
		"Target Audience",
		"Positioning",
		"Launch Channels",
		"90-Day Launch Timeline",
		"Success Metrics",
		"Risks and Mitigations",
		"Next Steps",
	}
	out := make([]map[string]any, 0, len(titles))
	for i, title := range titles {
		parentID := "outline-" + strconv.Itoa(i+1)
		node := demoTreeNode("slide-"+strconv.Itoa(i+1), parentID, "generated_slide", title, "Generated editable slide preview.")
		node["slideNumber"] = i + 1
		out = append(out, node)
	}
	return out
}
