package taskrecovery

import (
	"reflect"
	"testing"

	"officedex/internal/bridge"
	"officedex/internal/localstore"
	"officedex/internal/types"
)

func TestBuildReplayGroupsMergesAGroupAndKeepsStandalonesInOrder(t *testing.T) {
	answers := []localstore.TaskAnswer{
		{QuestionID: "idea", OptionID: "confirm"},
		{QuestionID: "q1", QuestionGroupID: "g1", Answer: " alpha "},
		{QuestionID: "q2", QuestionGroupID: "g1", Answer: "beta"},
		{QuestionID: "outline", OptionID: "approve"},
	}
	groups, skipped := BuildReplayGroups(answers, LiveAnswer{})
	if skipped {
		t.Fatal("nothing was skipped")
	}
	want := []ReplayGroup{
		{OptionID: "confirm", Answers: []bridge.RespondAnswer{{QuestionID: "idea", OptionID: "confirm"}}},
		{Answer: "beta", Answers: []bridge.RespondAnswer{{QuestionID: "q1", Answer: "alpha"}, {QuestionID: "q2", Answer: "beta"}}},
		{OptionID: "approve", Answers: []bridge.RespondAnswer{{QuestionID: "outline", OptionID: "approve"}}},
	}
	if !reflect.DeepEqual(groups, want) {
		t.Fatalf("groups =\n%+v\nwant\n%+v", groups, want)
	}
}

// The user's in-flight answer is the last thing to replay; it replaces the
// representative of the final group, or stands alone when nothing was saved.
func TestBuildReplayGroupsLetsTheLiveAnswerRepresentTheFinalGroup(t *testing.T) {
	answers := []localstore.TaskAnswer{{QuestionID: "idea", OptionID: "confirm"}, {QuestionID: "outline", OptionID: "stale"}}
	groups, _ := BuildReplayGroups(answers, LiveAnswer{OptionID: "approve", Answer: "looks good"})
	if last := groups[len(groups)-1]; last.OptionID != "approve" || last.Answer != "looks good" {
		t.Fatalf("final group = %+v, want the live answer", last)
	}
	if first := groups[0]; first.OptionID != "confirm" {
		t.Fatalf("earlier group changed: %+v", first)
	}
	groups, skipped := BuildReplayGroups(nil, LiveAnswer{OptionID: "approve"})
	if skipped || len(groups) != 1 || groups[0].OptionID != "approve" || groups[0].Answers != nil {
		t.Fatalf("live-only replay = %+v (skipped=%v)", groups, skipped)
	}
	if groups, _ := BuildReplayGroups(nil, LiveAnswer{}); groups != nil {
		t.Fatalf("nothing saved and nothing live must yield no groups, got %+v", groups)
	}
}

func TestBuildReplayGroupsDropsPerNodeRevisions(t *testing.T) {
	feedback := `{"kind":"vibe_node_feedback","node_id":"n-1","feedback":"shorter"}`
	undo := `{"kind":"vibe_undo_last_revision"}`
	answers := []localstore.TaskAnswer{{QuestionID: "idea", OptionID: "confirm"}, {QuestionID: "tree", Answer: feedback}, {QuestionID: "tree", Answer: undo}}
	groups, skipped := BuildReplayGroups(answers, LiveAnswer{Answer: feedback})
	if !skipped {
		t.Fatal("skipped must report the dropped revisions")
	}
	if len(groups) != 1 || groups[0].OptionID != "confirm" {
		t.Fatalf("groups = %+v, want only the idea confirmation", groups)
	}
	groups, skipped = BuildReplayGroups([]localstore.TaskAnswer{{QuestionID: "tree", Answer: undo}}, LiveAnswer{})
	if groups != nil || !skipped {
		t.Fatalf("all-revision history: groups=%+v skipped=%v, want none and skipped", groups, skipped)
	}
}

func TestIsUnreplayableVibeRevision(t *testing.T) {
	cases := map[string]bool{
		`{"kind":"vibe_node_feedback"}`:        true,
		`  {"kind":"vibe_undo_last_revision"}`: true,
		`{"kind":"vibe_confirm"}`:              false,
		`{"kind":`:                             false,
		`plain answer`:                         false,
		``:                                     false,
	}
	for answer, want := range cases {
		if got := IsUnreplayableVibeRevision(answer); got != want {
			t.Errorf("%q: got %v want %v", answer, got, want)
		}
	}
}

func TestLatestMultiQuestionIDsReadsTheMostRecentQuestionInEitherSliceShape(t *testing.T) {
	events := []types.BridgeEvent{
		{Type: types.EventTaskQuestion, Payload: map[string]any{"questions": []any{map[string]any{"id": "old"}}}},
		{Type: types.EventTaskPlan},
		{Type: types.EventTaskQuestion, Payload: map[string]any{"questions": []map[string]any{{"id": " a "}, {"id": "b"}, {"id": ""}}}},
	}
	got := LatestMultiQuestionIDs(events)
	if want := map[string]struct{}{"a": {}, "b": {}}; !reflect.DeepEqual(got, want) {
		t.Fatalf("ids = %v, want %v", got, want)
	}
	if got := LatestMultiQuestionIDs([]types.BridgeEvent{{Type: types.EventTaskPlan}}); got != nil {
		t.Fatalf("no question asked, got %v", got)
	}
}

// Recovery recognises its own cancellations by a machine-readable reason, not
// by the English sentence it once wrote.
func TestRecoverySourceTaskIsDecidedByReason(t *testing.T) {
	withReason := []types.BridgeEvent{{Type: types.EventTaskCancelled, Payload: map[string]any{"message": "anything", "reason": types.CancelReasonRecoveredAfterRestart}}}
	if !WasRecoverySourceTask(withReason) {
		t.Fatal("reason marker not recognised")
	}
	textOnly := []types.BridgeEvent{{Type: types.EventTaskCancelled, Payload: map[string]any{"message": "Task was recovered after the application restarted"}}}
	if WasRecoverySourceTask(textOnly) {
		t.Fatal("the message text alone must not decide recovery provenance")
	}
	if WasRecoverySourceTask([]types.BridgeEvent{{Type: types.EventTaskCompleted}}) {
		t.Fatal("a task that was never cancelled is not a recovery source")
	}
}

func TestLatestStateRecoverableOnlyWhenWaitingOnTheUser(t *testing.T) {
	waiting := []types.BridgeEvent{{Type: types.EventTaskStarted}, {Type: types.EventTaskQuestion}, {Type: types.EventTaskProgress}}
	if !LatestStateRecoverable(waiting) {
		t.Fatal("a task parked on a question is recoverable")
	}
	planned := []types.BridgeEvent{{Type: types.EventTaskQuestion}, {Type: types.EventTaskPlan}}
	if !LatestStateRecoverable(planned) {
		t.Fatal("a task parked on a plan is recoverable")
	}
	for _, terminal := range []string{types.EventTaskCompleted, types.EventTaskFailed, types.EventTaskCancelled} {
		if LatestStateRecoverable([]types.BridgeEvent{{Type: types.EventTaskQuestion}, {Type: terminal}}) {
			t.Fatalf("%s after a question must not be recoverable", terminal)
		}
	}
	if LatestStateRecoverable([]types.BridgeEvent{{Type: types.EventTaskStarted}}) {
		t.Fatal("a task that never reached a gate has nothing to fast-forward to")
	}
}
