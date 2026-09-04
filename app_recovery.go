package main

import (
	"context"
	"encoding/json"
	"fmt"
	"officedex/internal/taskrecovery"
	"strings"
	"time"

	"github.com/google/uuid"

	"officedex/internal/bridge"
	"officedex/internal/demoflow"
	"officedex/internal/localstore"
	"officedex/internal/types"
)

// ─── Interrupted-task recovery ──────────────────────────────────────────────
//
// A task that was waiting on the user when the app died cannot be resumed in
// place: the bridge process and its ids are gone. Recovery starts a fresh
// task from the persisted input, replays the saved answer history so it
// reaches the same gate, and routes the old id to the new task.

// liveTaskID returns the task an answer for taskID should reach: the live
// replacement created by recovery, or taskID itself when it was never replaced.
func (a *App) liveTaskID(taskID string) string {
	return a.recovery.follow(taskID)
}

// registerRecoveredTask routes future answers for oldID to the live newID.
func (a *App) registerRecoveredTask(oldID, newID string) {
	a.recovery.record(oldID, newID)
}

func demoflowRespondAnswers(input []RespondAnswerInput) []demoflow.RespondAnswerInput {
	out := make([]demoflow.RespondAnswerInput, 0, len(input))
	for _, item := range input {
		out = append(out, demoflow.RespondAnswerInput{
			QuestionGroupID: item.QuestionGroupID,
			QuestionID:      item.QuestionID,
			OptionID:        item.OptionID,
			Answer:          item.Answer,
			QuestionIndex:   item.QuestionIndex,
		})
	}
	return out
}

func (a *App) recordRespondAnswers(input RespondInput) error {
	if a.localStore == nil || strings.TrimSpace(input.TaskID) == "" {
		return nil
	}
	answers := make([]localstore.TaskAnswer, 0, len(input.Answers)+1)
	if len(input.Answers) > 0 {
		for _, item := range input.Answers {
			if strings.TrimSpace(item.QuestionID) == "" {
				continue
			}
			groupID := strings.TrimSpace(item.QuestionGroupID)
			if groupID == "" {
				groupID = strings.TrimSpace(input.QuestionID)
			}
			answers = append(answers, localstore.TaskAnswer{
				QuestionGroupID: groupID,
				QuestionID:      strings.TrimSpace(item.QuestionID),
				OptionID:        strings.TrimSpace(item.OptionID),
				Answer:          strings.TrimSpace(item.Answer),
				QuestionIndex:   item.QuestionIndex,
			})
		}
	} else if strings.TrimSpace(input.QuestionID) != "" && (strings.TrimSpace(input.OptionID) != "" || strings.TrimSpace(input.Answer) != "") {
		answers = append(answers, localstore.TaskAnswer{
			QuestionID:    strings.TrimSpace(input.QuestionID),
			OptionID:      strings.TrimSpace(input.OptionID),
			Answer:        strings.TrimSpace(input.Answer),
			QuestionIndex: -1,
		})
	}
	if len(answers) == 0 {
		return nil
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	return a.localStore.RecordTaskAnswers(ctx, strings.TrimSpace(input.TaskID), answers)
}

func (a *App) recoverStaleInteractiveRespond(input RespondInput, originalErr error) ([]byte, error) {
	if a.localStore == nil {
		return nil, originalErr
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	events, err := a.localStore.QueryEventsByTask(ctx, input.TaskID)
	if err != nil {
		return nil, err
	}
	if !taskrecovery.LatestStateRecoverable(events) {
		return nil, fmt.Errorf("task was interrupted and cannot be resumed; please restart this plan")
	}
	taskCtx, ok, err := a.localStore.TaskContext(ctx, input.TaskID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, fmt.Errorf("task was interrupted and cannot be resumed; missing task context")
	}
	generateInput, err := taskrecovery.DecodeGenerateInput(events, taskCtx)
	if err != nil {
		return nil, err
	}
	client, err := a.ensureBridgeForTask(input.TaskID)
	if err != nil {
		return nil, err
	}
	result, err := client.InvokeGenerate(ctx, generateInput)
	if err != nil {
		return nil, err
	}
	if result.TaskID == "" {
		return nil, fmt.Errorf("task recovery failed: replacement task id is empty")
	}
	if err := a.recordTaskWorkspaceContext(result.TaskID, taskCtx.WorkspaceID, taskCtx.ConversationID, input.TaskID, generateInput.Topic, generateInput.NoProject); err != nil {
		return nil, err
	}
	recoveredInputEvent := types.BridgeEvent{
		EventID: "local-recovered-input-" + uuid.NewString(),
		TaskID:  result.TaskID,
		Type:    types.EventLocalUserInput,
		TS:      time.Now().UTC().Format(time.RFC3339Nano),
		Payload: taskrecovery.EncodeGenerateInput(generateInput, taskCtx),
	}
	a.recordTaskEventBestEffort(recoveredInputEvent)
	if canEmitWailsEvent(ctx) {
		emit(ctx, bridgeEventChannel, recoveredInputEvent)
	}
	answers, err := a.localStore.QueryTaskAnswers(ctx, input.TaskID)
	if err != nil {
		return nil, err
	}
	answers, err = a.inheritRecoveredMultiQuestionAnswers(ctx, taskCtx, events, answers)
	if err != nil {
		return nil, err
	}
	// A replacement task can itself be interrupted by another app restart. Keep
	// the replayable answer history on the live replacement as well as its
	// predecessor so a recovery chain never loses the earlier question steps.
	if len(answers) > 0 {
		if err := a.localStore.RecordTaskAnswers(ctx, result.TaskID, answers); err != nil {
			return nil, err
		}
	}
	// The fresh bridge run always restarts at the first interactive gate (for
	// the vibe flow, idea confirmation). Replaying only the current answer works
	// when the user was interrupted at that first gate, but breaks when they had
	// already advanced — the current step's answer (often an action with an
	// empty answer body) would be delivered to the idea gate and rejected with
	// "idea confirmation is required". Replay the full saved-answer history in
	// order so the re-created task fast-forwards to the user's real position.
	groups, skippedRevisions := taskrecovery.BuildReplayGroups(answers, taskrecovery.LiveAnswer{OptionID: input.OptionID, Answer: input.Answer})
	if len(groups) == 0 && !skippedRevisions {
		return nil, fmt.Errorf("task was interrupted and cannot be resumed; missing saved answers")
	}
	// When every saved answer was an unreplayable per-node revision, the
	// recovered task is already at its first gate with nothing to fast-forward;
	// fall through to register the mapping and report success.
	for _, group := range groups {
		// Each replayed answer targets the live question/plan the re-created task
		// is currently waiting on. IDs are re-minted per bridge process, so we
		// must use the live pending ID rather than any ID persisted from the
		// previous run; otherwise the bridge rejects it with "question mismatch".
		pendingID, err := waitForRecoverablePendingInput(ctx, client, result.TaskID)
		if err != nil {
			return nil, err
		}
		params := bridge.RespondParams{
			TaskID:     result.TaskID,
			QuestionID: pendingID,
			OptionID:   strings.TrimSpace(group.OptionID),
			Answer:     strings.TrimSpace(group.Answer),
			Answers:    group.Answers,
		}
		if len(params.Answers) == 0 && params.OptionID == "" && params.Answer == "" {
			return nil, fmt.Errorf("task was interrupted and cannot be resumed; missing saved answers")
		}
		if _, err := client.RespondTask(ctx, params); err != nil {
			return nil, err
		}
	}
	// Route future answers for the interrupted id to this live task so the
	// renderer (which keeps using the original id) no longer re-triggers a
	// from-scratch recovery on every subsequent step.
	a.registerRecoveredTask(input.TaskID, result.TaskID)
	a.recordLocalTaskCancelled(input.TaskID, "Task was recovered after the application restarted", types.CancelReasonRecoveredAfterRestart)
	payload, err := json.Marshal(map[string]any{
		"accepted":      true,
		"task_id":       result.TaskID,
		"taskId":        result.TaskID,
		"recoveredFrom": input.TaskID,
	})
	if err != nil {
		return nil, err
	}
	return payload, nil
}

func (a *App) inheritRecoveredMultiQuestionAnswers(ctx context.Context, taskCtx localstore.TaskContext, events []types.BridgeEvent, current []localstore.TaskAnswer) ([]localstore.TaskAnswer, error) {
	parentTaskID := strings.TrimSpace(taskCtx.ParentTaskID)
	questionIDs := taskrecovery.LatestMultiQuestionIDs(events)
	if parentTaskID == "" || len(questionIDs) == 0 {
		return current, nil
	}
	parentEvents, err := a.localStore.QueryEventsByTask(ctx, parentTaskID)
	if err != nil {
		return nil, err
	}
	if !taskrecovery.WasRecoverySourceTask(parentEvents) {
		return current, nil
	}
	parentAnswers, err := a.localStore.QueryTaskAnswers(ctx, parentTaskID)
	if err != nil {
		return nil, err
	}
	merged := make([]localstore.TaskAnswer, 0, len(parentAnswers)+len(current))
	indexByQuestionID := make(map[string]int)
	for _, item := range parentAnswers {
		questionID := strings.TrimSpace(item.QuestionID)
		if _, ok := questionIDs[questionID]; !ok {
			continue
		}
		indexByQuestionID[questionID] = len(merged)
		merged = append(merged, item)
	}
	for _, item := range current {
		questionID := strings.TrimSpace(item.QuestionID)
		if index, ok := indexByQuestionID[questionID]; ok {
			// Preserve the ancestor's group id so all sub-answers remain one
			// atomic multi-question response, while preferring the latest value.
			if strings.TrimSpace(merged[index].QuestionGroupID) != "" {
				item.QuestionGroupID = merged[index].QuestionGroupID
			}
			merged[index] = item
			continue
		}
		indexByQuestionID[questionID] = len(merged)
		merged = append(merged, item)
	}
	if len(merged) == 0 {
		return current, nil
	}
	return merged, nil
}

// waitForRecoverablePendingInput blocks until the recovered task is waiting on
// fresh input, returning the ID the bridge expects the answer to reference. The
// ID is re-minted per bridge process, so callers must use this value rather than
// any ID replayed from persisted events.
func waitForRecoverablePendingInput(ctx context.Context, client *bridge.Client, taskID string) (string, error) {
	// Recovery replays answers stage by stage; between responds the re-created
	// task runs a generation step (often an LLM call), so allow well beyond the
	// few seconds a single idle gate would need. The loop still returns early
	// once the task reaches a pending question or a terminal state.
	waitCtx, cancel := context.WithTimeout(ctx, recoveryPendingInputTimeout)
	defer cancel()
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	for {
		status, err := client.TaskStatus(waitCtx, taskID)
		if err != nil {
			return "", err
		}
		if len(status.CurrentQuestion) > 0 {
			return pendingInputID(status.CurrentQuestion), nil
		}
		if len(status.CurrentPlan) > 0 {
			return pendingInputID(status.CurrentPlan), nil
		}
		if status.Status == "failed" || status.Status == "completed" || status.Status == "cancelled" {
			return "", fmt.Errorf("task recovery failed before input was requested: %s", status.Status)
		}
		select {
		case <-waitCtx.Done():
			return "", fmt.Errorf("task recovery timed out waiting for pending input")
		case <-ticker.C:
		}
	}
}

// pendingInputID extracts the question/plan identifier from a bridge
// current_question or current_plan payload. The bridge accepts either the "id"
// or, for plans, the "plan_id" field; "id" is preferred when present.
func pendingInputID(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var fields struct {
		ID     string `json:"id"`
		PlanID string `json:"plan_id"`
	}
	if err := json.Unmarshal(raw, &fields); err != nil {
		return ""
	}
	if fields.ID != "" {
		return fields.ID
	}
	return fields.PlanID
}

// recordLocalTaskCancelled writes a task.cancelled the desktop decided on
// itself. reason, when given, is a machine-readable marker (see
// types.CancelReason*) so later code does not have to recognise the message.
func (a *App) recordLocalTaskCancelled(taskID, message string, reason ...string) {
	if a.localStore == nil || strings.TrimSpace(taskID) == "" {
		return
	}
	if strings.TrimSpace(message) == "" {
		message = "Task cancelled"
	}
	payload := map[string]any{"message": message}
	if len(reason) > 0 && strings.TrimSpace(reason[0]) != "" {
		payload["reason"] = reason[0]
	}
	a.recordTaskEventBestEffort(types.BridgeEvent{
		EventID: "local-cancel-" + uuid.NewString(),
		TaskID:  strings.TrimSpace(taskID),
		Type:    types.EventTaskCancelled,
		TS:      time.Now().UTC().Format(time.RFC3339Nano),
		Payload: payload,
	})
}

// isBridgeTaskNotFoundError reports the bridge's structured "task not found"
// answer. It used to match "not found" in the message text, which also caught
// unrelated errors (a missing file, an unknown method).
func isBridgeTaskNotFoundError(err error) bool {
	return bridge.IsTaskNotFound(err)
}
