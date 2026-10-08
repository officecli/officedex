package taskrecovery

import (
	"encoding/json"
	"fmt"
	"strings"

	"officedex/internal/bridge"
	"officedex/internal/localstore"
	"officedex/internal/types"
)

// ReplayGroup is one answer to replay against one pending question of a
// recovered task. A multi-question group (shared question_group_id) collapses
// into a single respond carrying every sub-answer; a standalone answer is its
// own group.
type ReplayGroup struct {
	OptionID string
	Answer   string
	Answers  []bridge.RespondAnswer
}

// LiveAnswer is the answer the user is submitting right now, which becomes
// the representative of the final replay group.
type LiveAnswer struct {
	OptionID string
	Answer   string
}

// IsUnreplayableVibeRevision reports whether a saved answer is a per-node vibe
// revision (feedback on a specific node, or an undo) that cannot be safely
// replayed against a recovered task. Recovery re-runs generation from scratch,
// producing a fresh tree with new node IDs, so these answers reference nodes
// that no longer exist and RewriteNode would fail the whole task. They only
// ever trigger a same-stage re-ask (never a stage advance), so dropping them
// during replay preserves stage alignment.
func IsUnreplayableVibeRevision(answer string) bool {
	trimmed := strings.TrimSpace(answer)
	if !strings.HasPrefix(trimmed, "{") {
		return false
	}
	var probe struct {
		Kind string `json:"kind"`
	}
	if err := json.Unmarshal([]byte(trimmed), &probe); err != nil {
		return false
	}
	switch probe.Kind {
	case "vibe_node_feedback", "vibe_undo_last_revision":
		return true
	}
	return false
}

// BuildReplayGroups turns the chronological saved answers into the ordered
// sequence of responds needed to fast-forward a recovered task to the user's
// current position. Answers sharing a non-empty question_group_id are merged
// into one group (preserving first-seen order); answers without a group id
// each become their own group. The final group represents the in-flight
// answer, so its representative option/answer is taken from the live input
// when present and replayable.
//
// skipped reports whether any per-node revision was dropped; the caller uses
// it to distinguish "nothing to replay because nothing was answered" from
// "all answers were unreplayable revisions, leaving the task correctly at its
// current gate".
func BuildReplayGroups(answers []localstore.TaskAnswer, live LiveAnswer) (groups []ReplayGroup, skipped bool) {
	groups = make([]ReplayGroup, 0, len(answers))
	indexByGroupID := make(map[string]int)
	for _, item := range answers {
		if IsUnreplayableVibeRevision(item.Answer) {
			skipped = true
			continue
		}
		groupID := strings.TrimSpace(item.QuestionGroupID)
		sub := bridge.RespondAnswer{
			QuestionID: strings.TrimSpace(item.QuestionID),
			OptionID:   strings.TrimSpace(item.OptionID),
			Answer:     strings.TrimSpace(item.Answer),
		}
		if groupID != "" {
			if idx, ok := indexByGroupID[groupID]; ok {
				groups[idx].Answers = append(groups[idx].Answers, sub)
				groups[idx].OptionID = sub.OptionID
				groups[idx].Answer = sub.Answer
				continue
			}
			indexByGroupID[groupID] = len(groups)
		}
		groups = append(groups, ReplayGroup{
			OptionID: sub.OptionID,
			Answer:   sub.Answer,
			Answers:  []bridge.RespondAnswer{sub},
		})
	}
	inputHasContent := strings.TrimSpace(live.OptionID) != "" || strings.TrimSpace(live.Answer) != ""
	inputReplayable := inputHasContent && !IsUnreplayableVibeRevision(live.Answer)
	if len(groups) == 0 {
		if inputReplayable {
			return []ReplayGroup{{OptionID: live.OptionID, Answer: live.Answer}}, skipped
		}
		return nil, skipped
	}
	if inputReplayable {
		last := &groups[len(groups)-1]
		last.OptionID = live.OptionID
		last.Answer = live.Answer
	}
	return groups, skipped
}

// LatestMultiQuestionIDs returns the question ids of the most recent
// task.question event, or nil when the task never asked one.
func LatestMultiQuestionIDs(events []types.BridgeEvent) map[string]struct{} {
	for index := len(events) - 1; index >= 0; index-- {
		event := events[index]
		if event.Type != types.EventTaskQuestion || event.Payload == nil {
			continue
		}
		rawQuestions, ok := event.Payload["questions"].([]any)
		if !ok {
			// In-process events may retain their concrete slice type.
			if typed, typedOK := event.Payload["questions"].([]map[string]any); typedOK {
				rawQuestions = make([]any, len(typed))
				for i := range typed {
					rawQuestions[i] = typed[i]
				}
			}
		}
		ids := make(map[string]struct{})
		for _, raw := range rawQuestions {
			question, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			id := strings.TrimSpace(fmt.Sprint(question["id"]))
			if id != "" {
				ids[id] = struct{}{}
			}
		}
		return ids
	}
	return nil
}

// WasRecoverySourceTask reports whether the task's last cancellation was the
// one recovery itself records when it hands over to a replacement task.
func WasRecoverySourceTask(events []types.BridgeEvent) bool {
	for index := len(events) - 1; index >= 0; index-- {
		event := events[index]
		if event.Type != types.EventTaskCancelled || event.Payload == nil {
			continue
		}
		reason, _ := event.Payload["reason"].(string)
		return reason == types.CancelReasonRecoveredAfterRestart
	}
	return false
}

// LatestStateRecoverable reports whether the task's last terminal-or-waiting
// event left it waiting on the user (a question or a plan), the only states
// a fresh task can be fast-forwarded to.
func LatestStateRecoverable(events []types.BridgeEvent) bool {
	state := ""
	for _, event := range events {
		switch event.Type {
		case types.EventTaskQuestion, types.EventTaskPlan, types.EventTaskCompleted, types.EventTaskFailed, types.EventTaskCancelled:
			state = event.Type
		}
	}
	return state == types.EventTaskQuestion || state == types.EventTaskPlan
}
