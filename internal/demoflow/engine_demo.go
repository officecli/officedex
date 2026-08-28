//go:build officedex_demo

package demoflow

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"officedex/internal/types"
)

type demoImplementation struct {
	recorder        EventRecorder
	delay           func(context.Context) <-chan time.Time
	newID           func() string
	acceptAnyPrompt bool

	mu    sync.Mutex
	tasks map[string]*demoTask
}

type demoTask struct {
	ID              string
	Prompt          string
	DocumentType    types.DocumentType
	QuestionID      string
	ConfirmationIdx int
	Done            bool
	LastRaw         []byte
}

var demoQuestions = []struct {
	ID       string
	Question string
	StageID  string
	Label    string
}{
	{"demo-confirm-story", "Confirm the story beats", "outline_ready", "Story Beats"},
	{"demo-confirm-outline", "Confirm the per-slide outline", "refined_ready", "Slide Outlines"},
	{"demo-confirm-slides", "Confirm the generated slides", "slides_ready", "Generated Slides"},
}

func newImplementation(options Options) implementation {
	delay := options.Delay
	if delay == nil {
		delay = func(context.Context) <-chan time.Time {
			return time.After(750 * time.Millisecond)
		}
	}
	newID := options.NewID
	if newID == nil {
		newID = func() string { return "demo-" + uuid.NewString() }
	}
	return &demoImplementation{
		recorder:        options.Recorder,
		delay:           delay,
		newID:           newID,
		acceptAnyPrompt: os.Getenv("OFFICEDEX_DEMO_ACCEPT_ANY_PROMPT") == "1" && os.Getenv("OFFICEDEX_E2E_HOST") == "1",
		tasks:           map[string]*demoTask{},
	}
}

func (d *demoImplementation) TryGenerate(ctx context.Context, input types.GenerateInput) (GenerateResult, bool, error) {
	topic := strings.TrimSpace(input.Topic)
	prompt := strings.TrimSpace(input.Prompt)
	if prompt == "" {
		prompt = topic
	}
	magicMatch := input.DocumentType == types.DocPPTX && input.GenerationMode == "plan" && (topic == magicPrompt || prompt == magicPrompt)
	if !magicMatch && !d.acceptAnyPrompt {
		return GenerateResult{}, false, nil
	}
	if d.recorder == nil {
		return GenerateResult{}, true, errors.New("demo mode: recorder is required")
	}

	taskID := d.newID()
	if prompt == "" {
		prompt = topic
	}
	if prompt == "" {
		prompt = "Local OfficeDex demo"
	}
	task := &demoTask{ID: taskID, Prompt: prompt, DocumentType: input.DocumentType}
	d.mu.Lock()
	d.tasks[taskID] = task
	d.mu.Unlock()

	startedPayload := map[string]any{
		"document_type":   string(input.DocumentType),
		"topic":           prompt,
		"credit_mode":     "local_demo",
		"credits_charged": 0,
	}
	if magicMatch {
		startedPayload["stage_id"] = demoStages[0].ID
		startedPayload["stage_label"] = demoStages[0].Label
	}
	if err := d.emit(ctx, taskID, "task.started", startedPayload); err != nil {
		return GenerateResult{}, true, err
	}

	if magicMatch {
		go d.advanceToQuestion(context.Background(), taskID)
	} else {
		go d.completeLocalTask(context.Background(), taskID)
	}
	return GenerateResult{TaskID: taskID, SessionID: taskID, Status: "running"}, true, nil
}

func (d *demoImplementation) TryRespond(ctx context.Context, input RespondInput) ([]byte, bool, error) {
	d.mu.Lock()
	task, exists := d.tasks[input.TaskID]
	if !exists {
		d.mu.Unlock()
		return nil, true, errors.New("Demo Mode: unknown demo task")
	}
	if task.Done {
		raw := append([]byte(nil), task.LastRaw...)
		d.mu.Unlock()
		return raw, true, nil
	}
	expected := task.QuestionID
	if input.QuestionID != expected || input.OptionID != "confirm" {
		d.mu.Unlock()
		return nil, true, errors.New("Demo Mode: confirmation does not match the current prepared step")
	}
	idx := task.ConfirmationIdx
	task.ConfirmationIdx++
	task.QuestionID = ""
	raw := []byte(`{"ok":true}`)
	task.LastRaw = raw
	d.mu.Unlock()

	if err := d.emit(ctx, input.TaskID, "task.answers", map[string]any{
		"answers": []map[string]any{{
			"questionId": input.QuestionID,
			"answer":     "Approve",
			"optionId":   "confirm",
		}},
	}); err != nil {
		return nil, true, err
	}
	go d.advanceAfterConfirmation(context.Background(), input.TaskID, idx)
	return raw, true, nil
}

func (d *demoImplementation) TryModifyPptistDeck(_ context.Context, input ModifyPptistDeckInput) (ModifyPptistDeckResult, bool, error) {
	if strings.TrimSpace(input.Prompt) != timelineEditPrompt {
		return ModifyPptistDeckResult{
			Summary:              "Demo mode supports the prepared timeline edit.",
			Ops:                  nil,
			Confidence:           "high",
			RequiresConfirmation: false,
			Warnings:             []string{"Demo mode supports one prepared edit."},
		}, true, nil
	}
	if len(input.Snapshot.Slides) < 6 {
		return ModifyPptistDeckResult{}, true, errors.New("Demo Mode: prepared timeline edit requires slide 6")
	}
	targetIndex := input.Snapshot.SlideIndex
	if input.SelectedSlideID != "" {
		for i, slide := range input.Snapshot.Slides {
			if slide.ID == input.SelectedSlideID {
				targetIndex = i
				break
			}
		}
	}
	if targetIndex != 5 {
		return ModifyPptistDeckResult{}, true, errors.New("Demo Mode: prepared timeline edit only supports slide 6")
	}
	ops, err := demoTimelineEditOps(input.Snapshot.Slides[targetIndex], targetIndex)
	if err != nil {
		return ModifyPptistDeckResult{}, true, err
	}
	return ModifyPptistDeckResult{
		Summary:              "Converted the imported launch timeline into a vertical roadmap.",
		Confidence:           "high",
		RequiresConfirmation: true,
		Ops:                  ops,
		Confirmation: &PptistEditConfirmation{
			Title:     "Apply prepared timeline edit?",
			Message:   "Demo Mode prepared a vertical roadmap layout for the existing slide 6 timeline.",
			Target:    "Slide 6",
			Changes:   []string{"Turn the timeline vertical", "Stack phase content into aligned rows", "Clarify the timeline message"},
			Preserved: []string{"Original title", "Typography", "Color palette", "Footer", "Slide dimensions"},
		},
	}, true, nil
}

func demoTimelineEditOps(slide PptistSlide, slideIndex int) ([]map[string]any, error) {
	const originalCopy = "This slide is intentionally visual so the demo can show a precise timeline edit."
	const replacementCopy = "Validate demand. Build proof. Scale what converts."
	phases := []struct {
		day   string
		title string
		copy  string
	}{
		{"0–30", "Proof", "Website, video, download funnel"},
		{"31–60", "Signal", "X thread, community examples, onboarding data"},
		{"61–90", "Scale", "Templates, partner content, paid conversion tests"},
	}

	copyElementID := ""
	axisIndex := -1
	var axis map[string]any
	nodes := make([]map[string]any, 0, 3)
	dayIDs := make([]string, 3)
	titleIDs := make([]string, 3)
	copyIDs := make([]string, 3)
	for i, element := range slide.Elements {
		plainText := pptistElementPlainText(element)
		if plainText == originalCopy {
			copyElementID, _ = element["id"].(string)
		}
		for phaseIndex, phase := range phases {
			elementID, _ := element["id"].(string)
			switch plainText {
			case phase.day:
				dayIDs[phaseIndex] = elementID
			case phase.title:
				titleIDs[phaseIndex] = elementID
			case phase.copy:
				copyIDs[phaseIndex] = elementID
			}
		}
		if element["type"] != "shape" {
			continue
		}
		left, leftOK := pptistNumber(element["left"])
		top, topOK := pptistNumber(element["top"])
		width, widthOK := pptistNumber(element["width"])
		height, heightOK := pptistNumber(element["height"])
		fill, _ := element["fill"].(string)
		if !leftOK || !topOK || !widthOK || !heightOK || strings.TrimSpace(fill) == "" {
			continue
		}
		if width >= 700 && height <= 8 {
			if axis == nil || width > mustPptistNumber(axis["width"]) {
				axis = element
				axisIndex = i
			}
			continue
		}
		if width >= 48 && width <= 90 && height >= 48 && height <= 90 && math.Abs(width-height) <= 3 {
			nodeCenterY := top + height/2
			nodes = append(nodes, map[string]any{
				"element": element,
				"left":    left,
				"top":     top,
				"width":   width,
				"height":  height,
				"centerY": nodeCenterY,
			})
		}
	}
	if copyElementID == "" {
		return nil, errors.New("Demo Mode: prepared timeline edit could not find the source subtitle")
	}
	if axis == nil || axisIndex < 0 {
		return nil, errors.New("Demo Mode: prepared timeline edit could not find the source timeline axis")
	}
	axisTop := mustPptistNumber(axis["top"])
	alignedNodes := nodes[:0]
	for _, node := range nodes {
		if math.Abs(node["centerY"].(float64)-axisTop) <= 8 {
			alignedNodes = append(alignedNodes, node)
		}
	}
	nodes = alignedNodes
	if len(nodes) != 3 {
		return nil, fmt.Errorf("Demo Mode: prepared timeline edit found %d aligned milestone nodes, want 3", len(nodes))
	}
	sort.Slice(nodes, func(i, j int) bool { return nodes[i]["left"].(float64) < nodes[j]["left"].(float64) })
	for i := range phases {
		if dayIDs[i] == "" || titleIDs[i] == "" || copyIDs[i] == "" {
			return nil, fmt.Errorf("Demo Mode: prepared vertical timeline edit could not find all labels for phase %d", i+1)
		}
	}

	enhancedElements, err := clonePptistElements(slide.Elements)
	if err != nil {
		return nil, fmt.Errorf("Demo Mode: clone source timeline elements: %w", err)
	}
	byID := make(map[string]map[string]any, len(enhancedElements))
	for _, element := range enhancedElements {
		if id, _ := element["id"].(string); id != "" {
			byID[id] = element
		}
	}
	replacePptistElementText(byID[copyElementID], originalCopy, replacementCopy)

	axisElementID, _ := axis["id"].(string)
	verticalAxis := byID[axisElementID]
	setPptistElementBounds(verticalAxis, 203, 331, 4, 220)

	accents := make([]map[string]any, 0, 6)
	centers := []float64{331, 441, 551}
	boundaries := []float64{centers[0], (centers[0] + centers[1]) / 2, (centers[1] + centers[2]) / 2, centers[2]}
	for i := range nodes {
		nodeElement := nodes[i]["element"].(map[string]any)
		nodeID, _ := nodeElement["id"].(string)
		movedNode := byID[nodeID]
		nodeTop := 300.0 + float64(i*110)
		setPptistElementBounds(movedNode, 174, nodeTop, 62, 62)

		day := byID[dayIDs[i]]
		dayWidth := mustPptistNumber(day["width"])
		dayHeight := mustPptistNumber(day["height"])
		setPptistElementBounds(day, 205-dayWidth/2, nodeTop+(62-dayHeight)/2, dayWidth, dayHeight)
		setPptistTextAlignment(day, "center")

		title := byID[titleIDs[i]]
		setPptistElementBounds(title, 270, nodeTop-2, 260, 34)
		setPptistTextAlignment(title, "left")

		body := byID[copyIDs[i]]
		setPptistElementBounds(body, 270, nodeTop+34, 820, 54)
		setPptistTextAlignment(body, "left")

		segment := map[string]any{
			"id":         fmt.Sprintf("demo-timeline-segment-%d", i+1),
			"type":       "shape",
			"left":       203.0,
			"top":        boundaries[i],
			"width":      4.0,
			"height":     boundaries[i+1] - boundaries[i],
			"viewBox":    axis["viewBox"],
			"path":       axis["path"],
			"fill":       nodeElement["fill"],
			"fixedRatio": false,
		}
		if outline, ok := axis["outline"]; ok {
			segment["outline"] = outline
		}
		accents = append(accents, segment)
		ring := map[string]any{
			"id":         fmt.Sprintf("demo-timeline-ring-%d", i+1),
			"type":       "shape",
			"left":       168.0,
			"top":        nodeTop - 6,
			"width":      74.0,
			"height":     74.0,
			"viewBox":    nodeElement["viewBox"],
			"path":       nodeElement["path"],
			"fill":       "",
			"fixedRatio": nodeElement["fixedRatio"],
			"outline": map[string]any{
				"color": nodeElement["fill"],
				"width": 2,
				"style": "solid",
			},
		}
		accents = append(accents, ring)
	}
	nextElements := make([]map[string]any, 0, len(enhancedElements)+len(accents))
	nextElements = append(nextElements, enhancedElements[:axisIndex+1]...)
	nextElements = append(nextElements, accents...)
	nextElements = append(nextElements, enhancedElements[axisIndex+1:]...)
	return []map[string]any{{
		"type":       "slide:update",
		"slideId":    slide.ID,
		"slideIndex": slideIndex,
		"props":      map[string]any{"elements": nextElements},
	}}, nil
}

var pptistHTMLTagRE = regexp.MustCompile(`<[^>]+>`)

func pptistElementPlainText(element map[string]any) string {
	visible := pptistElementVisibleText(element)
	return strings.TrimSpace(html.UnescapeString(pptistHTMLTagRE.ReplaceAllString(visible, "")))
}

func setPptistElementBounds(element map[string]any, left, top, width, height float64) {
	element["left"] = left
	element["top"] = top
	element["width"] = width
	element["height"] = height
}

func replacePptistElementText(element map[string]any, oldText, newText string) {
	if content, ok := element["content"].(string); ok {
		element["content"] = strings.Replace(content, oldText, newText, 1)
	}
	if text, ok := element["text"].(map[string]any); ok {
		if content, ok := text["content"].(string); ok {
			text["content"] = strings.Replace(content, oldText, newText, 1)
		}
	}
}

func setPptistTextAlignment(element map[string]any, alignment string) {
	rewrite := func(content string) string {
		for _, current := range []string{"left", "center", "right", "justify"} {
			content = strings.ReplaceAll(content, "text-align: "+current, "text-align: "+alignment)
		}
		return content
	}
	if content, ok := element["content"].(string); ok {
		element["content"] = rewrite(content)
	}
	if text, ok := element["text"].(map[string]any); ok {
		if content, ok := text["content"].(string); ok {
			text["content"] = rewrite(content)
		}
	}
}

func clonePptistElements(elements []map[string]any) ([]map[string]any, error) {
	raw, err := json.Marshal(elements)
	if err != nil {
		return nil, err
	}
	var cloned []map[string]any
	if err := json.Unmarshal(raw, &cloned); err != nil {
		return nil, err
	}
	return cloned, nil
}

func pptistElementVisibleText(element map[string]any) string {
	if content, ok := element["content"].(string); ok {
		return content
	}
	if text, ok := element["text"].(map[string]any); ok {
		if content, ok := text["content"].(string); ok {
			return content
		}
	}
	return ""
}

func pptistNumber(value any) (float64, bool) {
	switch number := value.(type) {
	case float64:
		return number, true
	case float32:
		return float64(number), true
	case int:
		return float64(number), true
	case int64:
		return float64(number), true
	default:
		return 0, false
	}
}

func mustPptistNumber(value any) float64 {
	number, _ := pptistNumber(value)
	return number
}

func (d *demoImplementation) Shutdown() {}

func (d *demoImplementation) advanceToQuestion(ctx context.Context, taskID string) {
	<-d.delay(ctx)
	_ = d.emit(ctx, taskID, "task.vibe_tree", demoTreePayload(0))
	d.emitQuestion(ctx, taskID, 0)
}

func (d *demoImplementation) advanceAfterConfirmation(ctx context.Context, taskID string, answeredIdx int) {
	next := answeredIdx + 1
	if next < len(demoQuestions) {
		<-d.delay(ctx)
		_ = d.emit(ctx, taskID, "task.vibe_tree", demoTreePayload(next))
		d.emitQuestion(ctx, taskID, next)
		return
	}
	<-d.delay(ctx)
	_ = d.emit(ctx, taskID, "task.vibe_slide", map[string]any{"index": 0, "slide": demoSlides[0]})
	_ = d.emit(ctx, taskID, "task.vibe_tree", demoTreePayload(len(demoStages)-1))
	_ = d.completeTask(ctx, taskID)
}

func (d *demoImplementation) emitQuestion(ctx context.Context, taskID string, idx int) {
	<-d.delay(ctx)
	q := demoQuestions[idx]
	_ = d.emit(ctx, taskID, "task.question", map[string]any{
		"id":          q.ID,
		"question":    q.Question,
		"stage_id":    q.StageID,
		"stage_label": q.Label,
		"options":     []map[string]any{{"id": "confirm", "label": "Approve " + q.Label}},
	})
	d.mu.Lock()
	if task := d.tasks[taskID]; task != nil {
		task.QuestionID = q.ID
	}
	d.mu.Unlock()
}

func (d *demoImplementation) emit(ctx context.Context, taskID, typ string, payload map[string]any) error {
	return d.recorder.RecordAndEmitTaskEvent(ctx, types.BridgeEvent{
		EventID: "demo-" + uuid.NewString(),
		TaskID:  taskID,
		Type:    typ,
		TS:      time.Now().UTC().Format(time.RFC3339Nano),
		Payload: payload,
	})
}

func (d *demoImplementation) completeLocalTask(ctx context.Context, taskID string) {
	<-d.delay(ctx)
	d.mu.Lock()
	task := d.tasks[taskID]
	d.mu.Unlock()
	if task == nil {
		return
	}
	path, err := d.writeLocalDemoArtifact(taskID, task.DocumentType, task.Prompt)
	if err != nil {
		_ = d.emit(ctx, taskID, "task.failed", map[string]any{
			"message":         "Demo Mode: failed to write local artifact: " + err.Error(),
			"credit_mode":     "local_demo",
			"credits_charged": 0,
		})
		return
	}
	artifact := types.Artifact{
		TaskID:       taskID,
		FilePath:     path,
		FileName:     filepath.Base(path),
		DocumentType: string(task.DocumentType),
	}
	if err := d.recorder.AllowArtifact(artifact); err != nil {
		_ = d.emit(ctx, taskID, "task.failed", map[string]any{"message": err.Error(), "credit_mode": "local_demo", "credits_charged": 0})
		return
	}
	if err := d.recorder.RecordArtifact(artifact); err != nil {
		_ = d.emit(ctx, taskID, "task.failed", map[string]any{"message": err.Error(), "credit_mode": "local_demo", "credits_charged": 0})
		return
	}
	d.mu.Lock()
	if current := d.tasks[taskID]; current != nil {
		current.Done = true
	}
	d.mu.Unlock()
	_ = d.emit(ctx, taskID, "task.completed", map[string]any{
		"status":          "completed",
		"credit_mode":     "local_demo",
		"credits_charged": 0,
		"result": map[string]any{
			"file_path":     path,
			"file_name":     filepath.Base(path),
			"document_type": string(task.DocumentType),
		},
	})
}

func (d *demoImplementation) writeLocalDemoArtifact(taskID string, documentType types.DocumentType, prompt string) (string, error) {
	root := strings.TrimSpace(d.recorder.WorkspaceDir())
	if root == "" {
		root = d.recorder.UserDataDir()
	}
	dir := filepath.Join(root, "demo-flow", taskID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	fileName, err := writeLocalArtifact(dir, documentType, prompt)
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, fileName), nil
}

func (d *demoImplementation) completeTask(ctx context.Context, taskID string) error {
	d.mu.Lock()
	task := d.tasks[taskID]
	d.mu.Unlock()
	if task == nil {
		return errors.New("Demo Mode: unknown demo task")
	}
	path, err := d.writeDemoPptx(taskID, task.Prompt)
	if err != nil {
		_ = d.emit(ctx, taskID, "task.failed", map[string]any{"message": "Demo Mode: failed to write deterministic PPTX: " + err.Error()})
		return err
	}
	artifact := types.Artifact{
		TaskID:       taskID,
		FilePath:     path,
		FileName:     filepath.Base(path),
		DocumentType: "pptx",
	}
	if err := d.recorder.AllowArtifact(artifact); err != nil {
		return err
	}
	if err := d.recorder.RecordArtifact(artifact); err != nil {
		return err
	}
	d.mu.Lock()
	if task := d.tasks[taskID]; task != nil {
		task.Done = true
	}
	d.mu.Unlock()
	return d.emit(ctx, taskID, "task.completed", map[string]any{
		"stage_id":    "review",
		"stage_label": "Review",
		"result": map[string]any{
			"file_path":     path,
			"file_name":     filepath.Base(path),
			"document_type": "pptx",
		},
	})
}

func (d *demoImplementation) writeDemoPptx(taskID, prompt string) (string, error) {
	root := strings.TrimSpace(d.recorder.WorkspaceDir())
	if root == "" {
		root = d.recorder.UserDataDir()
	}
	dir := filepath.Join(root, "demo-flow", taskID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	path := filepath.Join(dir, promptPptxFileName(prompt))
	return path, writePromptPptx(path, prompt)
}

func MagicPromptForTests() string { return magicPrompt }
