package demoflow

import (
	"context"
	"time"

	"officedex/internal/types"
)

type GenerateResult struct {
	TaskID    string
	SessionID string
	Status    string
}

type RespondInput struct {
	TaskID     string
	QuestionID string
	OptionID   string
	Answer     string
	Answers    []RespondAnswerInput
}

type RespondAnswerInput struct {
	QuestionGroupID string
	QuestionID      string
	OptionID        string
	Answer          string
	QuestionIndex   int
}

type ModifyPptistDeckInput struct {
	Prompt             string
	Snapshot           PptistDeckSnapshot
	SelectedSlideID    string
	SelectedElementIDs []string
}

type PptistDeckSnapshot struct {
	Slides     []PptistSlide
	SlideIndex int
}

type PptistSlide struct {
	ID         string
	Elements   []map[string]any
	Background map[string]any
}

type ModifyPptistDeckResult struct {
	Summary              string
	Ops                  []map[string]any
	Confidence           string
	RequiresConfirmation bool
	Confirmation         *PptistEditConfirmation
	Warnings             []string
}

type PptistEditConfirmation struct {
	Title     string
	Message   string
	Target    string
	Changes   []string
	Preserved []string
}

type EventRecorder interface {
	RecordAndEmitTaskEvent(context.Context, types.BridgeEvent) error
	RecordTaskWorkspaceContext(taskID, workspaceID, conversationID, parentTaskID, title string, noProject bool) error
	AllowArtifact(types.Artifact) error
	RecordArtifact(types.Artifact) error
	UserDataDir() string
	WorkspaceDir() string
}

type Options struct {
	Recorder EventRecorder
	Delay    func(context.Context) <-chan time.Time
	NewID    func() string
}

type Engine struct {
	impl implementation
}

type implementation interface {
	TryGenerate(context.Context, types.GenerateInput) (GenerateResult, bool, error)
	TryRespond(context.Context, RespondInput) ([]byte, bool, error)
	TryModifyPptistDeck(context.Context, ModifyPptistDeckInput) (ModifyPptistDeckResult, bool, error)
	Shutdown()
}

func New(options Options) *Engine {
	return &Engine{impl: newImplementation(options)}
}

func (e *Engine) TryGenerate(ctx context.Context, input types.GenerateInput) (GenerateResult, bool, error) {
	return e.impl.TryGenerate(ctx, input)
}

func (e *Engine) TryRespond(ctx context.Context, input RespondInput) ([]byte, bool, error) {
	return e.impl.TryRespond(ctx, input)
}

func (e *Engine) TryModifyPptistDeck(ctx context.Context, input ModifyPptistDeckInput) (ModifyPptistDeckResult, bool, error) {
	return e.impl.TryModifyPptistDeck(ctx, input)
}

func (e *Engine) Shutdown() {
	e.impl.Shutdown()
}
