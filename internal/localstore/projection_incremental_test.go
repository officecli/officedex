package localstore

import (
	"context"
	"fmt"
	"testing"
	"time"

	"officedex/internal/types"
)

// dumpStreamActivities reads the projection back in full so two ways of
// producing it can be compared row for row.
func dumpStreamActivities(t *testing.T, store *Store, conversationID string) []string {
	t.Helper()
	rows, err := store.db.QueryContext(context.Background(),
		`SELECT id, ordinal, task_id, kind, COALESCE(event_id, ''), event_type, payload_json, created_at
		 FROM activities WHERE activity_stream_id = ? ORDER BY ordinal`, "activity:"+conversationID)
	if err != nil {
		t.Fatalf("read projection: %v", err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id, taskID, kind, eventID, eventType, payload, createdAt string
		var ordinal int
		if err := rows.Scan(&id, &ordinal, &taskID, &kind, &eventID, &eventType, &payload, &createdAt); err != nil {
			t.Fatalf("scan projection: %v", err)
		}
		out = append(out, fmt.Sprintf("%d|%s|%s|%s|%s|%s|%s|%s", ordinal, id, taskID, kind, eventID, eventType, payload, createdAt))
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate projection: %v", err)
	}
	return out
}

func forceRebuild(t *testing.T, store *Store, conversationID string) []string {
	t.Helper()
	ctx := context.Background()
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin rebuild: %v", err)
	}
	if err := rebuildStreamActivitiesTx(ctx, tx, conversationID); err != nil {
		_ = tx.Rollback()
		t.Fatalf("rebuild: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit rebuild: %v", err)
	}
	return dumpStreamActivities(t, store, conversationID)
}

// requireMatchesRebuild compares the live projection against the one a full
// rebuild would produce, at this exact moment.
//
// Checking only at the end of a sequence is not enough: a mis-projected write
// leaves the row count wrong, and the next write notices that and rebuilds. The
// damage would heal itself before a final assertion ever saw it, while the UI
// had already been served the broken intermediate state. So this runs after
// every event.
func requireMatchesRebuild(t *testing.T, store *Store, conversationID, step string, wantRows int) {
	t.Helper()
	live := dumpStreamActivities(t, store, conversationID)
	rebuilt := forceRebuild(t, store, conversationID)
	if len(live) != wantRows {
		t.Fatalf("%s: projected %d activities, want %d", step, len(live), wantRows)
	}
	if len(live) != len(rebuilt) {
		t.Fatalf("%s: append produced %d rows, rebuild produced %d", step, len(live), len(rebuilt))
	}
	for i := range live {
		if live[i] != rebuilt[i] {
			t.Errorf("%s: row %d differs\n append:  %s\n rebuild: %s", step, i, live[i], rebuilt[i])
		}
	}
}

// The append fast path only earns its keep if it is indistinguishable from the
// rebuild it replaces. Activity IDs are positional for events the bridge gave
// no ID, so "close enough" would mean the UI's row identities silently depend
// on how the events happened to arrive.
func TestAppendedProjectionMatchesAFullRebuild(t *testing.T) {
	store := newTempStore(t)

	at := func(sec int) string {
		return time.Date(2026, 3, 1, 12, 0, sec, 0, time.UTC).Format(time.RFC3339Nano)
	}
	events := []types.BridgeEvent{
		{EventID: "e1", TaskID: "task-a", Type: types.EventLocalUserInput, TS: at(1), Payload: map[string]any{"text": "make a deck"}},
		{EventID: "", TaskID: "task-a", Type: "task.progress", TS: at(2), Payload: map[string]any{"n": 1}},
		{EventID: "e3", TaskID: "task-a", Type: "task.progress", TS: at(3)},
		{EventID: "", TaskID: "task-a", Type: "task.progress", TS: at(4), Payload: map[string]any{"n": 2}},
		{EventID: "e5", TaskID: "task-a", Type: "task.completed", TS: at(5)},
	}
	for i, event := range events {
		if err := store.RecordEvent(event); err != nil {
			t.Fatalf("RecordEvent(%s): %v", event.Type, err)
		}
		requireMatchesRebuild(t, store, "task-a", fmt.Sprintf("after event %d (%s)", i+1, event.Type), i+1)
	}
}

// An event that lands before the frontier shifts every ordinal after it. The
// append path must recognise that it cannot explain the difference and hand
// over to the rebuild, or the projection would keep a stale ordering forever.
func TestOutOfOrderEventFallsBackToRebuild(t *testing.T) {
	store := newTempStore(t)

	at := func(sec int) string {
		return time.Date(2026, 3, 1, 12, 0, sec, 0, time.UTC).Format(time.RFC3339Nano)
	}
	for _, event := range []types.BridgeEvent{
		{EventID: "e1", TaskID: "task-b", Type: "task.started", TS: at(1)},
		{EventID: "e3", TaskID: "task-b", Type: "task.progress", TS: at(3)},
		{EventID: "e4", TaskID: "task-b", Type: "task.completed", TS: at(4)},
	} {
		if err := store.RecordEvent(event); err != nil {
			t.Fatalf("RecordEvent: %v", err)
		}
	}

	// Arrives late, but belongs in the middle.
	if err := store.RecordEvent(types.BridgeEvent{EventID: "e2", TaskID: "task-b", Type: "task.progress", TS: at(2)}); err != nil {
		t.Fatalf("RecordEvent(late): %v", err)
	}

	got := dumpStreamActivities(t, store, "task-b")
	want := forceRebuild(t, store, "task-b")
	if len(got) != 4 {
		t.Fatalf("projected %d activities, want 4", len(got))
	}
	for i := range got {
		if got[i] != want[i] {
			t.Errorf("row %d was not reprojected after the late event\n got:  %s\n want: %s", i, got[i], want[i])
		}
	}
}

// Two tasks in one conversation interleave in time. The fallback activity ID
// counts per task, not per stream, so appending has to continue each task's own
// count rather than the stream's.
func TestAppendKeepsPerTaskFallbackIdentitiesAcrossTasks(t *testing.T) {
	store := newTempStore(t)
	ctx := context.Background()

	if err := store.RecordTaskContext(ctx, "task-child", TaskContext{ConversationID: "conv-multi"}); err != nil {
		t.Fatalf("RecordTaskContext(child): %v", err)
	}
	if err := store.RecordTaskContext(ctx, "task-root", TaskContext{ConversationID: "conv-multi"}); err != nil {
		t.Fatalf("RecordTaskContext(root): %v", err)
	}

	at := func(sec int) string {
		return time.Date(2026, 3, 1, 12, 0, sec, 0, time.UTC).Format(time.RFC3339Nano)
	}
	for i, event := range []types.BridgeEvent{
		{TaskID: "task-root", Type: "task.progress", TS: at(1), Payload: map[string]any{"n": 1}},
		{TaskID: "task-child", Type: "task.progress", TS: at(2), Payload: map[string]any{"n": 2}},
		{TaskID: "task-root", Type: "task.progress", TS: at(3), Payload: map[string]any{"n": 3}},
		{TaskID: "task-child", Type: "task.progress", TS: at(4), Payload: map[string]any{"n": 4}},
	} {
		if err := store.RecordEvent(event); err != nil {
			t.Fatalf("RecordEvent: %v", err)
		}
		requireMatchesRebuild(t, store, "conv-multi", fmt.Sprintf("after event %d on %s", i+1, event.TaskID), i+1)
	}
}

// The point of the fast path is that a long conversation does not get slower to
// write to. Asserting on a row count rather than a duration keeps this a
// correctness test: appending must touch the arriving event only.
func TestAppendingDoesNotRewriteTheWholeStream(t *testing.T) {
	store := newTempStore(t)
	ctx := context.Background()

	at := func(sec int) string {
		return time.Date(2026, 3, 1, 12, 0, sec, 0, time.UTC).Format(time.RFC3339Nano)
	}
	for i := 0; i < 20; i++ {
		if err := store.RecordEvent(types.BridgeEvent{
			EventID: fmt.Sprintf("e%02d", i),
			TaskID:  "task-long",
			Type:    "task.progress",
			TS:      at(i),
			Payload: map[string]any{"n": i},
		}); err != nil {
			t.Fatalf("RecordEvent(%d): %v", i, err)
		}
	}

	// A second stream keeps the table's rowid high water mark above this
	// stream's rows. Without it, deleting every row of the stream under test
	// lets SQLite hand the same rowids straight back on reinsert, and a full
	// rebuild would be indistinguishable from an append.
	if err := store.RecordEvent(types.BridgeEvent{
		EventID: "other", TaskID: "task-other", Type: "task.started", TS: at(99),
	}); err != nil {
		t.Fatalf("RecordEvent(other stream): %v", err)
	}

	// Stamp every projected row so a rewrite is visible. rowid is stable across
	// updates but changes on delete+insert, which is exactly what the old
	// projection did on every write.
	before := map[string]int64{}
	readRowIDs := func(into map[string]int64) {
		rows, err := store.db.QueryContext(ctx, `SELECT id, rowid FROM activities WHERE activity_stream_id = ?`, "activity:task-long")
		if err != nil {
			t.Fatalf("read rowids: %v", err)
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			var rowID int64
			if err := rows.Scan(&id, &rowID); err != nil {
				t.Fatalf("scan rowid: %v", err)
			}
			into[id] = rowID
		}
		if err := rows.Err(); err != nil {
			t.Fatalf("iterate rowids: %v", err)
		}
	}
	readRowIDs(before)
	if len(before) != 20 {
		t.Fatalf("expected 20 projected activities, got %d", len(before))
	}

	if err := store.RecordEvent(types.BridgeEvent{
		EventID: "e20", TaskID: "task-long", Type: "task.completed", TS: at(20),
	}); err != nil {
		t.Fatalf("RecordEvent(append): %v", err)
	}

	after := map[string]int64{}
	readRowIDs(after)
	if len(after) != 21 {
		t.Fatalf("expected 21 projected activities, got %d", len(after))
	}
	for id, rowID := range before {
		got, ok := after[id]
		if !ok {
			t.Errorf("activity %s disappeared when a later event was appended", id)
			continue
		}
		if got != rowID {
			t.Errorf("activity %s was rewritten (rowid %d -> %d); appending must not touch existing rows", id, rowID, got)
		}
	}
}

// Reconciliation and migration paths write through the same helper. A stream
// with no projection at all must still be built, not silently treated as
// already up to date.
func TestEmptyStreamIsProjectedFromScratch(t *testing.T) {
	store := newTempStore(t)
	ctx := context.Background()

	if err := store.RecordEvent(types.BridgeEvent{
		EventID: "e1", TaskID: "task-fresh", Type: "task.started",
		TS: time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC).Format(time.RFC3339Nano),
	}); err != nil {
		t.Fatalf("RecordEvent: %v", err)
	}
	if _, err := store.db.ExecContext(ctx, `DELETE FROM activities WHERE activity_stream_id = ?`, "activity:task-fresh"); err != nil {
		t.Fatalf("clear projection: %v", err)
	}

	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if err := projectStreamActivitiesTx(ctx, tx, "task-fresh"); err != nil {
		_ = tx.Rollback()
		t.Fatalf("project: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}

	var count int
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM activities WHERE activity_stream_id = ?`, "activity:task-fresh").Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 1 {
		t.Fatalf("projected %d activities from an empty stream, want 1", count)
	}
}
