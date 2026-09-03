//go:build officedex_demo

package demoflow

import (
	"context"
	"errors"
	"officedex/internal/config"
	"os"
	"path/filepath"
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
		acceptAnyPrompt: config.Enabled(config.DemoAcceptAnyPromptEnv) && config.Enabled(config.E2EHostEnv),
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
