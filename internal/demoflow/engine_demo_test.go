//go:build officedex_demo

package demoflow

import (
	"archive/zip"
	"context"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"officedex/internal/types"
)

func TestDemoBuildMatchesOnlyExactMagicPrompt(t *testing.T) {
	t.Setenv("OFFICEDEX_DEMO_ACCEPT_ANY_PROMPT", "")
	recorder := newMemoryRecorder(t)
	engine := New(Options{Recorder: recorder, Delay: instantDelay, NewID: fixedID("demo-task-1")})
	input := types.GenerateInput{
		DocumentType:   types.DocPPTX,
		GenerationMode: "plan",
		Topic:          "  " + magicPrompt + "\n",
	}
	result, ok, err := engine.TryGenerate(context.Background(), input)
	if err != nil {
		t.Fatalf("TryGenerate returned error: %v", err)
	}
	if !ok {
		t.Fatal("expected demo flow to match")
	}
	if result.TaskID != "demo-task-1" || result.Status != "running" {
		t.Fatalf("result = %#v, want demo task running", result)
	}
	events := recorder.snapshot()
	if len(events) == 0 || events[0].Type != "task.started" {
		t.Fatalf("events = %#v, want first event task.started", events)
	}

	mismatches := []types.GenerateInput{
		{DocumentType: types.DocDOCX, GenerationMode: "plan", Topic: magicPrompt},
		{DocumentType: types.DocPPTX, GenerationMode: "fast", Topic: magicPrompt},
		{DocumentType: types.DocPPTX, GenerationMode: "plan", Topic: magicPrompt + " Please."},
		{DocumentType: types.DocPPTX, GenerationMode: "plan", Topic: "Create a launch strategy presentation for a new AI productivity app."},
	}
	for _, mismatch := range mismatches {
		if _, ok, err := New(Options{Recorder: newMemoryRecorder(t), Delay: instantDelay}).TryGenerate(context.Background(), mismatch); err != nil || ok {
			t.Fatalf("mismatch %#v returned ok %v err %v", mismatch, ok, err)
		}
	}
}

func TestDemoAcceptAnyPromptWritesLocalArtifactsWithoutCredits(t *testing.T) {
	t.Setenv("OFFICEDEX_DEMO_ACCEPT_ANY_PROMPT", "1")
	t.Setenv("OFFICEDEX_E2E_HOST", "1")
	cases := []struct {
		documentType types.DocumentType
		extension    string
	}{
		{types.DocPPTX, ".pptx"},
		{types.DocDOCX, ".docx"},
		{types.DocXLSX, ".xlsx"},
		{types.DocReport, ".html"},
		{types.DocIMG, ".png"},
		{types.DocGIF, ".gif"},
	}
	for _, tc := range cases {
		t.Run(string(tc.documentType), func(t *testing.T) {
			recorder := newMemoryRecorder(t)
			taskID := "local-" + string(tc.documentType)
			engine := New(Options{Recorder: recorder, Delay: instantDelay, NewID: fixedID(taskID)})
			result, ok, err := engine.TryGenerate(context.Background(), types.GenerateInput{
				DocumentType: tc.documentType,
				Prompt:       "Ordinary local prompt for " + string(tc.documentType),
			})
			if err != nil || !ok {
				t.Fatalf("TryGenerate ok=%v err=%v", ok, err)
			}
			if result.TaskID != taskID || result.Status != "running" {
				t.Fatalf("result = %#v", result)
			}
			completed := waitForEventPayload(t, recorder, "task.completed")
			if completed["credit_mode"] != "local_demo" || completed["credits_charged"] != 0 {
				t.Fatalf("completed credit fields = %#v", completed)
			}
			artifact := recorder.lastArtifact()
			if artifact == nil {
				t.Fatal("expected local artifact")
			}
			if artifact.DocumentType != string(tc.documentType) || filepath.Ext(artifact.FilePath) != tc.extension {
				t.Fatalf("artifact = %#v", artifact)
			}
			if !strings.HasPrefix(artifact.FilePath, recorder.WorkspaceDir()+string(os.PathSeparator)) {
				t.Fatalf("artifact path = %q, want workspace path", artifact.FilePath)
			}
			assertLocalArtifactReadable(t, artifact.FilePath, tc.documentType)
		})
	}
}

func TestDemoAcceptAnyPromptRequiresE2EHost(t *testing.T) {
	t.Setenv("OFFICEDEX_DEMO_ACCEPT_ANY_PROMPT", "1")
	t.Setenv("OFFICEDEX_E2E_HOST", "")
	_, ok, err := New(Options{Recorder: newMemoryRecorder(t), Delay: instantDelay}).TryGenerate(context.Background(), types.GenerateInput{
		DocumentType: types.DocPPTX,
		Prompt:       "Ordinary prompt must not bypass a non-E2E demo build",
	})
	if err != nil || ok {
		t.Fatalf("TryGenerate ok=%v err=%v, want normal bridge fallback", ok, err)
	}
}

func TestDemoBuildMatchesMagicPromptFromRendererPromptField(t *testing.T) {
	recorder := newMemoryRecorder(t)
	engine := New(Options{Recorder: recorder, Delay: instantDelay, NewID: fixedID("demo-task-prompt")})
	result, ok, err := engine.TryGenerate(context.Background(), types.GenerateInput{
		DocumentType:   types.DocPPTX,
		GenerationMode: "plan",
		Prompt:         magicPrompt,
	})
	if err != nil {
		t.Fatalf("TryGenerate returned error: %v", err)
	}
	if !ok {
		t.Fatal("expected demo flow to match renderer prompt field")
	}
	if result.TaskID != "demo-task-prompt" || result.Status != "running" {
		t.Fatalf("result = %#v, want demo task running", result)
	}
}

func TestDemoBuildMatchesMagicPromptWhenRendererTopicIsSummary(t *testing.T) {
	recorder := newMemoryRecorder(t)
	engine := New(Options{Recorder: recorder, Delay: instantDelay, NewID: fixedID("demo-task-summary")})
	result, ok, err := engine.TryGenerate(context.Background(), types.GenerateInput{
		DocumentType:   types.DocPPTX,
		GenerationMode: "plan",
		Topic:          "Create a launch strategy presentation",
		Prompt:         magicPrompt,
	})
	if err != nil {
		t.Fatalf("TryGenerate returned error: %v", err)
	}
	if !ok {
		t.Fatal("expected demo flow to match exact magic prompt even when renderer topic is a summary")
	}
	if result.TaskID != "demo-task-summary" || result.Status != "running" {
		t.Fatalf("result = %#v, want demo task running", result)
	}
}

func TestDemoFlowStageOrderingAndConfirmations(t *testing.T) {
	recorder := newMemoryRecorder(t)
	engine := New(Options{Recorder: recorder, Delay: instantDelay, NewID: fixedID("demo-task")})
	_, ok, err := engine.TryGenerate(context.Background(), types.GenerateInput{
		DocumentType:   types.DocPPTX,
		GenerationMode: "plan",
		Topic:          magicPrompt,
	})
	if err != nil || !ok {
		t.Fatalf("TryGenerate ok=%v err=%v", ok, err)
	}
	waitForEvent(t, recorder, "task.question")

	confirmations := demoConfirmationIDs()
	for _, questionID := range confirmations {
		waitForQuestion(t, recorder, questionID)
		raw, ok, err := engine.TryRespond(context.Background(), RespondInput{
			TaskID:     "demo-task",
			QuestionID: questionID,
			OptionID:   "confirm",
		})
		if err != nil || !ok || len(raw) == 0 {
			t.Fatalf("TryRespond(%s) ok=%v err=%v raw=%q", questionID, ok, err, string(raw))
		}
	}
	waitForEvent(t, recorder, "task.completed")

	got := eventTypes(recorder.snapshot())
	wantContainsInOrder := []string{
		"task.started",
		"task.vibe_tree",
		"task.question",
		"task.answers",
		"task.vibe_tree",
		"task.question",
		"task.answers",
		"task.vibe_tree",
		"task.question",
		"task.answers",
		"task.vibe_slide",
		"task.vibe_tree",
		"task.completed",
	}
	assertContainsInOrder(t, got, wantContainsInOrder)
}

func TestDemoFlowWritesPptxUnderWorkspaceDir(t *testing.T) {
	recorder := newMemoryRecorder(t)
	engine := New(Options{Recorder: recorder, Delay: instantDelay, NewID: fixedID("demo-task")})
	_, ok, err := engine.TryGenerate(context.Background(), types.GenerateInput{DocumentType: types.DocPPTX, GenerationMode: "plan", Topic: magicPrompt})
	if err != nil || !ok {
		t.Fatalf("TryGenerate ok=%v err=%v", ok, err)
	}
	for _, questionID := range demoConfirmationIDs() {
		waitForQuestion(t, recorder, questionID)
		if _, ok, err := engine.TryRespond(context.Background(), RespondInput{TaskID: "demo-task", QuestionID: questionID, OptionID: "confirm"}); err != nil || !ok {
			t.Fatalf("TryRespond(%s) ok=%v err=%v", questionID, ok, err)
		}
	}
	waitForEvent(t, recorder, "task.completed")
	artifact := recorder.lastArtifact()
	if artifact == nil {
		t.Fatal("expected recorded artifact")
	}
	if !strings.HasPrefix(artifact.FilePath, recorder.WorkspaceDir()+string(os.PathSeparator)) {
		t.Fatalf("artifact path = %q, want under workspace %q", artifact.FilePath, recorder.WorkspaceDir())
	}
}

func TestDemoVibeTreeStagesMatchRendererAcceptedStages(t *testing.T) {
	accepted := map[string]bool{
		"story_ready":   true,
		"outline_ready": true,
		"refined_ready": true,
		"slides_ready":  true,
		"rendering":     true,
		"completed":     true,
	}
	for idx := range demoQuestions {
		payload := demoTreePayload(idx)
		stage, _ := payload["stage"].(string)
		if stage == "story_ready" {
			t.Fatalf("demoTreePayload(%d) stage = story_ready, promo demo must avoid the renderer idea gate", idx)
		}
		if !accepted[stage] {
			t.Fatalf("demoTreePayload(%d) stage = %q, want renderer-accepted stage", idx, stage)
		}
	}
}

func TestDemoVibeTreeExpandsAcrossVisibleNodeTypes(t *testing.T) {
	cases := []struct {
		idx      int
		stage    string
		wantKind string
	}{
		{0, "outline_ready", "slide_group"},
		{1, "refined_ready", "outline"},
		{2, "slides_ready", "generated_slide"},
		{3, "completed", "deck"},
	}
	for _, tc := range cases {
		payload := demoTreePayload(tc.idx)
		if payload["stage"] != tc.stage {
			t.Fatalf("demoTreePayload(%d) stage = %v, want %s", tc.idx, payload["stage"], tc.stage)
		}
		kinds := demoPayloadNodeKinds(t, payload)
		if kinds[tc.wantKind] == 0 {
			t.Fatalf("demoTreePayload(%d) node kinds = %#v, want at least one %s", tc.idx, kinds, tc.wantKind)
		}
		if tc.idx < len(demoQuestions) {
			actions, _ := payload["actions"].([]map[string]any)
			if len(actions) != 1 || actions[0]["id"] != "confirm" || actions[0]["label"] != "Approve "+demoQuestions[tc.idx].Label {
				t.Fatalf("demoTreePayload(%d) actions = %#v, want one explicit stage approval action", tc.idx, actions)
			}
		}
	}
	slideKinds := demoPayloadNodeKinds(t, demoTreePayload(2))
	if slideKinds["generated_slide"] != len(demoSlides) {
		t.Fatalf("slides_ready generated slides = %d, want %d", slideKinds["generated_slide"], len(demoSlides))
	}
}

func TestDemoVibeTreeUsesOneRepresentativeConfirmationPerStage(t *testing.T) {
	want := [][]string{
		{"chapter-02"},
		{"outline-6"},
		{"slide-6"},
	}
	for idx, wantNodeIDs := range want {
		payload := demoTreePayload(idx)
		confirmation, _ := payload["confirmation"].(map[string]any)
		nodeIDs, _ := confirmation["nodeIds"].([]string)
		if !reflect.DeepEqual(nodeIDs, wantNodeIDs) {
			t.Fatalf("demoTreePayload(%d) confirmation nodeIds = %#v, want %#v", idx, nodeIDs, wantNodeIDs)
		}
		tree, _ := payload["tree"].(map[string]any)
		nodes, _ := tree["nodes"].([]map[string]any)
		for _, nodeID := range nodeIDs {
			found := false
			for _, node := range nodes {
				if node["id"] == nodeID {
					found = true
					break
				}
			}
			if !found {
				t.Fatalf("demoTreePayload(%d) confirmation node %q is not present in the tree", idx, nodeID)
			}
		}
	}
}

func TestDemoFlowRejectsWrongOrStaleConfirmation(t *testing.T) {
	recorder := newMemoryRecorder(t)
	engine := New(Options{Recorder: recorder, Delay: instantDelay, NewID: fixedID("demo-task")})
	_, ok, err := engine.TryGenerate(context.Background(), types.GenerateInput{DocumentType: types.DocPPTX, GenerationMode: "plan", Topic: magicPrompt})
	if err != nil || !ok {
		t.Fatalf("TryGenerate ok=%v err=%v", ok, err)
	}
	waitForEvent(t, recorder, "task.question")
	if _, ok, err := engine.TryRespond(context.Background(), RespondInput{TaskID: "other-task", QuestionID: "demo-confirm-story", OptionID: "confirm"}); !ok || err == nil || !strings.Contains(err.Error(), "Demo Mode") {
		t.Fatalf("wrong task ok=%v err=%v, want Demo Mode error", ok, err)
	}
	if _, ok, err := engine.TryRespond(context.Background(), RespondInput{TaskID: "demo-task", QuestionID: "demo-confirm-outline", OptionID: "confirm"}); !ok || err == nil || !strings.Contains(err.Error(), "Demo Mode") {
		t.Fatalf("stale question ok=%v err=%v, want Demo Mode error", ok, err)
	}
}

func TestDemoFlowCompletesWithPromptDrivenPptxArtifact(t *testing.T) {
	recorder := newMemoryRecorder(t)
	engine := New(Options{Recorder: recorder, Delay: instantDelay, NewID: fixedID("demo-task")})
	_, ok, err := engine.TryGenerate(context.Background(), types.GenerateInput{DocumentType: types.DocPPTX, GenerationMode: "plan", Topic: magicPrompt})
	if err != nil || !ok {
		t.Fatalf("TryGenerate ok=%v err=%v", ok, err)
	}
	for _, questionID := range demoConfirmationIDs() {
		waitForQuestion(t, recorder, questionID)
		if _, _, err := engine.TryRespond(context.Background(), RespondInput{TaskID: "demo-task", QuestionID: questionID, OptionID: "confirm"}); err != nil {
			t.Fatalf("TryRespond(%s): %v", questionID, err)
		}
	}
	completed := waitForEventPayload(t, recorder, "task.completed")
	result := completed["result"].(map[string]any)
	if result["document_type"] != "pptx" {
		t.Fatalf("document_type = %#v, want pptx", result["document_type"])
	}
	if _, err := os.Stat(result["file_path"].(string)); err != nil {
		t.Fatalf("artifact missing: %v", err)
	}
	reader, err := zip.OpenReader(result["file_path"].(string))
	if err != nil {
		t.Fatalf("open pptx zip: %v", err)
	}
	defer reader.Close()
	names := map[string]bool{}
	slideCount := 0
	for _, file := range reader.File {
		names[file.Name] = true
		if strings.HasPrefix(file.Name, "ppt/slides/slide") && strings.HasSuffix(file.Name, ".xml") {
			slideCount++
		}
	}
	for _, name := range []string{"[Content_Types].xml", "ppt/presentation.xml", "ppt/slides/slide6.xml"} {
		if !names[name] {
			t.Fatalf("pptx missing %s", name)
		}
	}
	if slideCount < 4 {
		t.Fatalf("demo artifact slide count = %d; want a dynamic deck with at least 4 slides", slideCount)
	}
	slide1XML := readZipFile(t, &reader.Reader, "ppt/slides/slide1.xml")
	if !strings.Contains(slide1XML, "增长与发布方案") {
		t.Fatalf("cover slide missing topic-derived title")
	}
	if strings.Contains(slide1XML, "需求拆解") || strings.Contains(slide1XML, "内容结构") || strings.Contains(slide1XML, "推进节奏") || strings.Contains(slide1XML, "需求原文") {
		t.Fatalf("cover slide contains legacy fixed-template title")
	}
	if len(demoSlides) != 9 {
		t.Fatalf("len(demoSlides) = %d, want 9 staged UI slides", len(demoSlides))
	}
}

func TestPromptDrivenPptxChangesWithPromptAndDoesNotUseFixture(t *testing.T) {
	firstPath := filepath.Join(t.TempDir(), "first.pptx")
	secondPath := filepath.Join(t.TempDir(), "second.pptx")
	firstPrompt := "为新能源品牌制作一份面向投资人的增长计划。"
	secondPrompt := "为教育产品制作一份面向校长的年度招生方案。"
	if err := writePromptPptx(firstPath, firstPrompt); err != nil {
		t.Fatalf("write first prompt PPTX: %v", err)
	}
	if err := writePromptPptx(secondPath, secondPrompt); err != nil {
		t.Fatalf("write second prompt PPTX: %v", err)
	}
	first, err := os.ReadFile(firstPath)
	if err != nil {
		t.Fatalf("read first PPTX: %v", err)
	}
	second, err := os.ReadFile(secondPath)
	if err != nil {
		t.Fatalf("read second PPTX: %v", err)
	}
	if reflect.DeepEqual(first, second) {
		t.Fatal("different prompts produced byte-identical PPTX artifacts")
	}
	firstReader, err := zip.OpenReader(firstPath)
	if err != nil {
		t.Fatalf("open first PPTX: %v", err)
	}
	defer firstReader.Close()
	if promptPptxFileName(firstPrompt) == "local-demo.pptx" || promptPptxFileName(secondPrompt) == "local-demo.pptx" {
		t.Fatal("prompt-driven PPTX must not use the local-demo filename")
	}
}

func TestQBRPromptBuildsDynamicQBRSectionsAndEditableMetrics(t *testing.T) {
	path := filepath.Join(t.TempDir(), "qbr.pptx")
	qbrPrompt := "生成 QBR 框架，涵盖目标达成、关键指标、项目复盘与资源诉求。"
	if got := promptPptxFileName(qbrPrompt); got != "QBR-业务回顾.pptx" {
		t.Fatalf("QBR filename = %q, want topic-specific filename", got)
	}
	if err := writePromptPptx(path, qbrPrompt); err != nil {
		t.Fatalf("write QBR PPTX: %v", err)
	}
	reader, err := zip.OpenReader(path)
	if err != nil {
		t.Fatalf("open QBR PPTX: %v", err)
	}
	defer reader.Close()
	if len(reader.File) == 0 {
		t.Fatal("QBR PPTX is empty")
	}
	sections := []string{"QBR", "管理摘要", "目标达成", "关键指标", "项目复盘", "资源诉求", "下一步"}
	allXML := ""
	slideCount := 0
	for _, file := range reader.File {
		if strings.HasPrefix(file.Name, "ppt/slides/slide") && strings.HasSuffix(file.Name, ".xml") {
			slideCount++
			allXML += readZipFile(t, &reader.Reader, file.Name)
		}
	}
	if slideCount != 7 {
		t.Fatalf("QBR slide count = %d, want 7 sections", slideCount)
	}
	for _, section := range sections {
		if !strings.Contains(allXML, section) {
			t.Fatalf("QBR deck missing section %q", section)
		}
	}
	if !strings.Contains(allXML, "QBR｜目标达成、关键指标、项目复盘与资源诉求") {
		t.Fatal("QBR cover does not reflect the requested focus areas")
	}
	for _, legacy := range []string{"需求拆解", "内容结构", "推进节奏", "需求原文"} {
		if strings.Contains(allXML, legacy) {
			t.Fatalf("QBR deck contains legacy fixed title %q", legacy)
		}
	}
	if !strings.Contains(allXML, "可编辑字段") || !strings.Contains(allXML, "待补充") {
		t.Fatal("QBR deck must use explicit editable placeholders for missing metrics")
	}
	for _, fabricated := range []string{"90%", "100%", "1,000", "1000"} {
		if strings.Contains(allXML, "<a:t>"+fabricated+"</a:t>") {
			t.Fatalf("QBR deck contains fabricated metric %q", fabricated)
		}
	}
}

func TestPromptStructuresAndFilenamesVaryByRequest(t *testing.T) {
	firstPath := filepath.Join(t.TempDir(), "growth.pptx")
	secondPath := filepath.Join(t.TempDir(), "education.pptx")
	if err := writePromptPptx(firstPath, "为新能源品牌制作一份面向投资人的增长计划。"); err != nil {
		t.Fatalf("write growth PPTX: %v", err)
	}
	if err := writePromptPptx(secondPath, "为教育产品制作一份面向校长的年度招生方案。"); err != nil {
		t.Fatalf("write education PPTX: %v", err)
	}
	firstReader, err := zip.OpenReader(firstPath)
	if err != nil {
		t.Fatalf("open growth PPTX: %v", err)
	}
	defer firstReader.Close()
	secondReader, err := zip.OpenReader(secondPath)
	if err != nil {
		t.Fatalf("open education PPTX: %v", err)
	}
	defer secondReader.Close()
	if countSlideXML(&firstReader.Reader) == countSlideXML(&secondReader.Reader) {
		t.Fatalf("different prompts unexpectedly produced the same slide count")
	}
	if promptPptxFileName("为新能源品牌制作一份面向投资人的增长计划。") == promptPptxFileName("为教育产品制作一份面向校长的年度招生方案。") {
		t.Fatal("different prompt topics unexpectedly produced the same filename")
	}
}

func countSlideXML(reader *zip.Reader) int {
	count := 0
	for _, file := range reader.File {
		if strings.HasPrefix(file.Name, "ppt/slides/slide") && strings.HasSuffix(file.Name, ".xml") {
			count++
		}
	}
	return count
}

func assertLocalArtifactReadable(t *testing.T, path string, documentType types.DocumentType) {
	t.Helper()
	switch documentType {
	case types.DocPPTX, types.DocDOCX, types.DocXLSX:
		reader, err := zip.OpenReader(path)
		if err != nil {
			t.Fatalf("open local OOXML artifact: %v", err)
		}
		defer reader.Close()
		if len(reader.File) == 0 {
			t.Fatal("local OOXML artifact is empty")
		}
	case types.DocReport:
		data, err := os.ReadFile(path)
		if err != nil || !strings.Contains(string(data), "OfficeDex Local Demo") {
			t.Fatalf("local report data=%q err=%v", string(data), err)
		}
	case types.DocIMG:
		data, err := os.ReadFile(path)
		if err != nil || len(data) < 8 || string(data[:8]) != "\x89PNG\r\n\x1a\n" {
			t.Fatalf("local PNG signature=%q err=%v", data, err)
		}
	case types.DocGIF:
		data, err := os.ReadFile(path)
		if err != nil || len(data) < 6 || !strings.HasPrefix(string(data[:6]), "GIF8") {
			t.Fatalf("local GIF signature=%q err=%v", data, err)
		}
	}
}

type memoryRecorder struct {
	t            *testing.T
	mu           sync.Mutex
	events       []types.BridgeEvent
	artifacts    []types.Artifact
	userDataDir  string
	workspaceDir string
}

func newMemoryRecorder(t *testing.T) *memoryRecorder {
	t.Helper()
	root := t.TempDir()
	userDataDir := filepath.Join(root, "user-data")
	workspaceDir := filepath.Join(root, "workspace")
	if err := os.MkdirAll(userDataDir, 0o755); err != nil {
		t.Fatalf("mkdir user data dir: %v", err)
	}
	if err := os.MkdirAll(workspaceDir, 0o755); err != nil {
		t.Fatalf("mkdir workspace dir: %v", err)
	}
	return &memoryRecorder{t: t, userDataDir: userDataDir, workspaceDir: workspaceDir}
}

func (r *memoryRecorder) RecordAndEmitTaskEvent(_ context.Context, event types.BridgeEvent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, event)
	return nil
}

func (r *memoryRecorder) snapshot() []types.BridgeEvent {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]types.BridgeEvent(nil), r.events...)
}

func (r *memoryRecorder) RecordTaskWorkspaceContext(taskID, workspaceID, conversationID, parentTaskID, title string, noProject bool) error {
	return nil
}

func (r *memoryRecorder) AllowArtifact(types.Artifact) error { return nil }
func (r *memoryRecorder) RecordArtifact(artifact types.Artifact) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.artifacts = append(r.artifacts, artifact)
	return nil
}
func (r *memoryRecorder) lastArtifact() *types.Artifact {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.artifacts) == 0 {
		return nil
	}
	artifact := r.artifacts[len(r.artifacts)-1]
	return &artifact
}
func (r *memoryRecorder) UserDataDir() string  { return r.userDataDir }
func (r *memoryRecorder) WorkspaceDir() string { return r.workspaceDir }

func instantDelay(context.Context) <-chan time.Time {
	ch := make(chan time.Time, 1)
	ch <- time.Now()
	return ch
}

func fixedID(id string) func() string {
	return func() string { return id }
}

func waitForEvent(t *testing.T, recorder *memoryRecorder, typ string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		events := recorder.snapshot()
		for _, event := range events {
			if event.Type == typ {
				return
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for event %s; got %v", typ, eventTypes(recorder.snapshot()))
}

func waitForQuestion(t *testing.T, recorder *memoryRecorder, id string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		for _, event := range recorder.snapshot() {
			if event.Type == "task.question" && event.Payload["id"] == id {
				return
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for question %s", id)
}

func waitForEventPayload(t *testing.T, recorder *memoryRecorder, typ string) map[string]any {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		for _, event := range recorder.snapshot() {
			if event.Type == typ {
				return event.Payload
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for event %s", typ)
	return nil
}

func demoPayloadNodeKinds(t *testing.T, payload map[string]any) map[string]int {
	t.Helper()
	tree, ok := payload["tree"].(map[string]any)
	if !ok {
		t.Fatalf("payload tree = %#v, want map", payload["tree"])
	}
	rawNodes, ok := tree["nodes"].([]map[string]any)
	if !ok {
		t.Fatalf("tree nodes = %#v, want []map[string]any", tree["nodes"])
	}
	kinds := map[string]int{}
	for _, node := range rawNodes {
		kind, _ := node["kind"].(string)
		kinds[kind]++
	}
	return kinds
}

func demoConfirmationIDs() []string {
	return []string{"demo-confirm-story", "demo-confirm-outline", "demo-confirm-slides"}
}

func eventTypes(events []types.BridgeEvent) []string {
	out := make([]string, 0, len(events))
	for _, event := range events {
		out = append(out, event.Type)
	}
	return out
}

func assertContainsInOrder(t *testing.T, got []string, want []string) {
	t.Helper()
	pos := 0
	for _, item := range got {
		if pos < len(want) && item == want[pos] {
			pos++
		}
	}
	if pos != len(want) {
		t.Fatalf("events %v did not contain %v in order", got, want)
	}
}

func readZipFile(t *testing.T, reader *zip.Reader, name string) string {
	t.Helper()
	for _, file := range reader.File {
		if file.Name != name {
			continue
		}
		rc, err := file.Open()
		if err != nil {
			t.Fatalf("open %s: %v", name, err)
		}
		defer rc.Close()
		body, err := io.ReadAll(rc)
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		return string(body)
	}
	t.Fatalf("zip missing %s", name)
	return ""
}

func slideTitle(slide map[string]any) string {
	for _, raw := range slide["elements"].([]map[string]any) {
		if raw["id"] == "title" {
			content := raw["content"].(string)
			content = strings.TrimPrefix(content, "<p>")
			content = strings.TrimSuffix(content, "</p>")
			return content
		}
	}
	return ""
}
