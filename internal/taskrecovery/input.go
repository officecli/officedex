// Package taskrecovery holds the pure parts of resuming a task after the
// application restarted: the codec for the original generate input that is
// persisted as a task.user_input event, and the replay planner that turns the
// saved answer history into the responds needed to fast-forward a fresh task.
package taskrecovery

import (
	"errors"
	"strings"

	"officedex/internal/localstore"
	"officedex/internal/payloadfield"
	"officedex/internal/types"
)

var (
	ErrMissingInput  = errors.New("task was interrupted and cannot be resumed; missing original input")
	ErrMissingPrompt = errors.New("task was interrupted and cannot be resumed; missing original prompt")
)

// textContainers are the nested objects older renderers wrapped prompt/topic in.
var textContainers = []string{"text_input", "textInput", "content_input", "contentInput"}

// PromptFromPayload reads the prompt of a task.user_input payload, at the top
// level or inside a legacy text container.
func PromptFromPayload(payload map[string]any) string {
	return payloadfield.NestedString(payload, []string{"prompt"}, textContainers...)
}

// TopicFromPayload is PromptFromPayload for the topic.
func TopicFromPayload(payload map[string]any) string {
	return payloadfield.NestedString(payload, []string{"topic"}, textContainers...)
}

// NormalizeText fills topic from prompt and prompt from topic so neither is
// blank when the other is present.
func NormalizeText(input types.GenerateInput) types.GenerateInput {
	out := input
	if strings.TrimSpace(out.Topic) == "" {
		out.Topic = strings.TrimSpace(out.Prompt)
	}
	if strings.TrimSpace(out.Prompt) == "" {
		out.Prompt = strings.TrimSpace(out.Topic)
	}
	return out
}

// EncodeGenerateInput is the single schema of the task.user_input payload:
// snake_case keys only. DecodeGenerateInput still accepts the camelCase
// duplicates that rows written before this schema carry.
func EncodeGenerateInput(input types.GenerateInput, taskCtx localstore.TaskContext) map[string]any {
	input = NormalizeText(input)
	payload := map[string]any{
		"document_type": string(input.DocumentType),
		"topic":         input.Topic,
		"prompt":        input.Prompt,
		"no_project":    input.NoProject,
		"local_preview": input.LocalPreview,
	}
	set := func(key, value string) {
		if value != "" {
			payload[key] = value
		}
	}
	// The recorded task context wins over whatever the input carried; the
	// input's own ids only fill gaps.
	set("conversation_id", firstNonEmpty(taskCtx.ConversationID, input.ConversationID))
	set("parent_task_id", firstNonEmpty(taskCtx.ParentTaskID, input.ParentTaskID))
	set("workspace_id", firstNonEmpty(input.WorkspaceID, taskCtx.WorkspaceID))
	set("runtime_mode", input.RuntimeMode)
	set("generation_mode", input.GenerationMode)
	set("prompt_template_id", input.PromptTemplateID)
	set("source_file", input.SourceFile)
	set("image_ratio", strings.TrimSpace(input.ImageRatio))
	set("output_dir", input.OutputDir)
	set("image_quality", input.ImageQuality)
	if len(input.ReferenceImages) > 0 {
		payload["reference_images"] = input.ReferenceImages
	}
	if input.FPS > 0 {
		payload["fps"] = input.FPS
	}
	if input.Publish {
		payload["publish"] = true
	}
	if input.EnableImages != nil {
		payload["enable_images"] = *input.EnableImages
	}
	return payload
}

// DecodeGenerateInput rebuilds the generate input of an interrupted task from
// its event history: the task.user_input payload carries the request, and
// task.started fills document type / prompt / topic when the input lacks them.
func DecodeGenerateInput(events []types.BridgeEvent, taskCtx localstore.TaskContext) (types.GenerateInput, error) {
	var userInput map[string]any
	var started map[string]any
	for _, event := range events {
		if event.Type == types.EventTaskStarted {
			started = event.Payload
		}
		if event.Type == types.EventLocalUserInput {
			userInput = event.Payload
		}
	}
	if userInput == nil {
		return types.GenerateInput{}, ErrMissingInput
	}
	documentType := payloadfield.String(userInput, "document_type", "documentType")
	if documentType == "" {
		documentType = payloadfield.String(started, "document_type", "documentType")
	}
	prompt := PromptFromPayload(userInput)
	if prompt == "" {
		prompt = payloadfield.String(started, "prompt")
	}
	topic := TopicFromPayload(userInput)
	if topic == "" {
		topic = payloadfield.String(started, "topic")
	}
	if topic == "" {
		topic = prompt
	}
	if prompt == "" {
		prompt = topic
	}
	if documentType == "" || prompt == "" {
		return types.GenerateInput{}, ErrMissingPrompt
	}
	input := types.GenerateInput{
		DocumentType:     types.DocumentType(documentType),
		Topic:            topic,
		Prompt:           prompt,
		WorkspaceID:      taskCtx.WorkspaceID,
		NoProject:        strings.TrimSpace(taskCtx.WorkspaceID) == "",
		ConversationID:   taskCtx.ConversationID,
		ParentTaskID:     taskCtx.ParentTaskID,
		RuntimeMode:      payloadfield.String(userInput, "runtime_mode", "runtimeMode"),
		GenerationMode:   payloadfield.String(userInput, "generation_mode", "generationMode"),
		PromptTemplateID: payloadfield.String(userInput, "prompt_template_id", "promptTemplateId"),
		SourceFile:       payloadfield.String(userInput, "source_file", "sourceFile"),
		ReferenceImages:  payloadfield.StringSlice(userInput, "reference_images", "referenceImages"),
		ImageRatio:       payloadfield.String(userInput, "image_ratio", "imageRatio"),
		FPS:              payloadfield.Int(userInput, "fps"),
		OutputDir:        payloadfield.String(userInput, "output_dir", "outputDir"),
		Publish:          payloadfield.Bool(userInput, "publish"),
		ImageQuality:     payloadfield.String(userInput, "image_quality", "imageQuality"),
		LocalPreview:     payloadfield.Bool(userInput, "local_preview", "localPreview"),
	}
	if v, ok := payloadfield.OptionalBool(userInput, "enable_images", "enableImages"); ok {
		input.EnableImages = &v
	}
	return input, nil
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
