package taskrecovery

import (
	"errors"
	"reflect"
	"strings"
	"testing"

	"officedex/internal/localstore"
	"officedex/internal/types"
)

func userInputEvent(payload map[string]any) []types.BridgeEvent {
	return []types.BridgeEvent{
		{EventID: "event-user-input", TaskID: "task", Type: types.EventLocalUserInput, Payload: payload},
		{EventID: "event-question", TaskID: "task", Type: types.EventTaskQuestion, Payload: map[string]any{"id": "question-group"}},
	}
}

// The payload has exactly one spelling per field. Rows written before this
// schema carried camelCase duplicates; new rows must not.
func TestEncodeGenerateInputEmitsSnakeCaseOnly(t *testing.T) {
	enable := true
	payload := EncodeGenerateInput(types.GenerateInput{
		DocumentType: types.DocPPTX, Topic: "T", Prompt: "P", NoProject: true,
		RuntimeMode: "custom", GenerationMode: "plan", PromptTemplateID: "tpl", SourceFile: "/a.pptx",
		ReferenceImages: []string{"/r.png"}, ImageRatio: " landscape ", FPS: 12, OutputDir: "/out",
		Publish: true, EnableImages: &enable, ImageQuality: "high", LocalPreview: true,
	}, localstore.TaskContext{WorkspaceID: "ws", ConversationID: "conv", ParentTaskID: "parent"})
	for key := range payload {
		if strings.ToLower(key) != key {
			t.Errorf("payload key %q is not snake_case", key)
		}
	}
	want := []string{"document_type", "topic", "prompt", "no_project", "local_preview", "conversation_id", "parent_task_id", "workspace_id",
		"runtime_mode", "generation_mode", "prompt_template_id", "source_file", "reference_images", "image_ratio", "fps", "output_dir",
		"publish", "enable_images", "image_quality"}
	for _, key := range want {
		if _, ok := payload[key]; !ok {
			t.Errorf("payload lacks %q: %#v", key, payload)
		}
	}
	if len(payload) != len(want) {
		t.Fatalf("payload has %d keys, want %d: %#v", len(payload), len(want), payload)
	}
	if payload["image_ratio"] != "landscape" {
		t.Fatalf("image_ratio = %#v, want trimmed", payload["image_ratio"])
	}
}

func TestEncodeGenerateInputOmitsUnsetOptionalFields(t *testing.T) {
	payload := EncodeGenerateInput(types.GenerateInput{DocumentType: types.DocDOCX, Prompt: "P"}, localstore.TaskContext{})
	for _, key := range []string{"conversation_id", "parent_task_id", "workspace_id", "runtime_mode", "generation_mode", "source_file", "reference_images", "image_ratio", "fps", "output_dir", "publish", "enable_images", "image_quality"} {
		if _, ok := payload[key]; ok {
			t.Errorf("unset field %q was emitted as %#v", key, payload[key])
		}
	}
}

// The recorded task context is authoritative for conversation and parent;
// the workspace id prefers the input (the caller may have re-targeted it).
func TestEncodeGenerateInputPrefersTaskContextIdentity(t *testing.T) {
	payload := EncodeGenerateInput(types.GenerateInput{
		DocumentType: types.DocPPTX, Prompt: "P", WorkspaceID: "ws-input", ConversationID: "conv-input", ParentTaskID: "parent-input",
	}, localstore.TaskContext{WorkspaceID: "ws-ctx", ConversationID: "conv-ctx", ParentTaskID: "parent-ctx"})
	if payload["conversation_id"] != "conv-ctx" || payload["parent_task_id"] != "parent-ctx" {
		t.Fatalf("identity from context lost: %#v", payload)
	}
	if payload["workspace_id"] != "ws-input" {
		t.Fatalf("workspace_id = %#v, want the input's", payload["workspace_id"])
	}
	payload = EncodeGenerateInput(types.GenerateInput{DocumentType: types.DocPPTX, Prompt: "P", ConversationID: "conv-input"}, localstore.TaskContext{})
	if payload["conversation_id"] != "conv-input" {
		t.Fatalf("input identity must fill a gap in the context: %#v", payload)
	}
}

func TestEncodeGenerateInputBackfillsTopicFromPrompt(t *testing.T) {
	payload := EncodeGenerateInput(types.GenerateInput{DocumentType: types.DocPPTX, Prompt: "Generate a recovery-safe deck"}, localstore.TaskContext{})
	if payload["topic"] != "Generate a recovery-safe deck" || payload["prompt"] != "Generate a recovery-safe deck" {
		t.Fatalf("payload = %#v, want topic backfilled from prompt", payload)
	}
}

func TestDecodeGenerateInputRoundTripsEveryField(t *testing.T) {
	enable := false
	in := types.GenerateInput{
		DocumentType: types.DocGIF, Topic: "T", Prompt: "P",
		RuntimeMode: "custom", GenerationMode: "plan", PromptTemplateID: "tpl", SourceFile: "/a.pptx",
		ReferenceImages: []string{"/r.png"}, ImageRatio: "square", FPS: 12, OutputDir: "/out",
		Publish: true, EnableImages: &enable, ImageQuality: "high", LocalPreview: true,
	}
	taskCtx := localstore.TaskContext{WorkspaceID: "ws", ConversationID: "conv", ParentTaskID: "parent"}
	got, err := DecodeGenerateInput(userInputEvent(EncodeGenerateInput(in, taskCtx)), taskCtx)
	if err != nil {
		t.Fatal(err)
	}
	want := in
	want.WorkspaceID, want.ConversationID, want.ParentTaskID = "ws", "conv", "parent"
	if got.EnableImages == nil || *got.EnableImages != false {
		t.Fatalf("EnableImages = %v, want explicit false", got.EnableImages)
	}
	got.EnableImages, want.EnableImages = nil, nil
	if strings.Join(got.ReferenceImages, ",") != "/r.png" {
		t.Fatalf("ReferenceImages = %v", got.ReferenceImages)
	}
	got.ReferenceImages, want.ReferenceImages = nil, nil
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("round trip\n got %+v\nwant %+v", got, want)
	}
}

// Rows persisted by earlier builds carry camelCase keys; they must still resume.
func TestDecodeGenerateInputAcceptsLegacyCamelCaseRows(t *testing.T) {
	got, err := DecodeGenerateInput(userInputEvent(map[string]any{
		"documentType": "docx", "prompt": "P", "generationMode": "plan", "sourceFile": "/s.docx",
		"referenceImages": []any{"/r.png"}, "imageRatio": "portrait", "localPreview": "true", "enableImages": true,
	}), localstore.TaskContext{})
	if err != nil {
		t.Fatal(err)
	}
	if got.DocumentType != types.DocDOCX || got.GenerationMode != "plan" || got.SourceFile != "/s.docx" || got.ImageRatio != "portrait" || !got.LocalPreview {
		t.Fatalf("legacy row decoded as %+v", got)
	}
	if got.EnableImages == nil || !*got.EnableImages {
		t.Fatalf("EnableImages = %v", got.EnableImages)
	}
	if !got.NoProject {
		t.Fatal("an empty workspace id in the task context means no project")
	}
}

func TestDecodeGenerateInputFillsMissingTopicFromPrompt(t *testing.T) {
	got, err := DecodeGenerateInput(userInputEvent(map[string]any{"document_type": "pptx", "prompt": "Generate a reloaded deck"}),
		localstore.TaskContext{WorkspaceID: "ws-1", ConversationID: "conversation-1"})
	if err != nil {
		t.Fatal(err)
	}
	if got.Topic != "Generate a reloaded deck" || got.Prompt != "Generate a reloaded deck" {
		t.Fatalf("got %+v", got)
	}
}

func TestDecodeGenerateInputReadsNestedTextInputTopic(t *testing.T) {
	got, err := DecodeGenerateInput(userInputEvent(map[string]any{
		"documentType": "docx",
		"text_input":   map[string]any{"topic": "Quarterly impact report", "prompt": "Write a concise quarterly impact report"},
	}), localstore.TaskContext{WorkspaceID: "ws-1"})
	if err != nil {
		t.Fatal(err)
	}
	if got.Topic != "Quarterly impact report" || got.Prompt != "Write a concise quarterly impact report" {
		t.Fatalf("got %+v", got)
	}
}

func TestDecodeGenerateInputFallsBackToTaskStarted(t *testing.T) {
	got, err := DecodeGenerateInput([]types.BridgeEvent{
		{Type: types.EventLocalUserInput, Payload: map[string]any{"generation_mode": "plan"}},
		{Type: types.EventTaskStarted, Payload: map[string]any{"document_type": "xlsx", "prompt": "Started prompt", "topic": "Started topic"}},
	}, localstore.TaskContext{})
	if err != nil {
		t.Fatal(err)
	}
	if got.DocumentType != types.DocXLSX || got.Prompt != "Started prompt" || got.Topic != "Started topic" || got.GenerationMode != "plan" {
		t.Fatalf("got %+v", got)
	}
}

func TestDecodeGenerateInputErrors(t *testing.T) {
	if _, err := DecodeGenerateInput([]types.BridgeEvent{{Type: types.EventTaskStarted, Payload: map[string]any{"prompt": "P"}}}, localstore.TaskContext{}); !errors.Is(err, ErrMissingInput) {
		t.Fatalf("no user_input event: err = %v", err)
	}
	if _, err := DecodeGenerateInput(userInputEvent(map[string]any{"document_type": "pptx"}), localstore.TaskContext{}); !errors.Is(err, ErrMissingPrompt) {
		t.Fatalf("no prompt anywhere: err = %v", err)
	}
	if _, err := DecodeGenerateInput(userInputEvent(map[string]any{"prompt": "P"}), localstore.TaskContext{}); !errors.Is(err, ErrMissingPrompt) {
		t.Fatalf("no document type anywhere: err = %v", err)
	}
}

func TestEncodeAndDecodePreserveGenerationModeSeparatelyFromRuntimeMode(t *testing.T) {
	payload := EncodeGenerateInput(types.GenerateInput{DocumentType: types.DocDOCX, Topic: "Plan mode recovery", Prompt: "Write a plan-mode document", GenerationMode: "plan"}, localstore.TaskContext{})
	if payload["generation_mode"] != "plan" {
		t.Fatalf("generation mode payload = %#v", payload)
	}
	if _, ok := payload["runtime_mode"]; ok {
		t.Fatalf("runtime_mode should not carry generation mode: %#v", payload["runtime_mode"])
	}
	got, err := DecodeGenerateInput(userInputEvent(payload), localstore.TaskContext{})
	if err != nil {
		t.Fatal(err)
	}
	if got.GenerationMode != "plan" || got.RuntimeMode != "" {
		t.Fatalf("got %+v", got)
	}
}
