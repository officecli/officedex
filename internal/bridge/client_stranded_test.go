package bridge

import (
	"testing"
	"time"

	"officedex/internal/types"
)

// waitForActiveWork polls HasActiveWork until it matches want, because events
// reach the tracker on the client's own reader goroutine.
func waitForActiveWork(t *testing.T, client *Client, want bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if client.HasActiveWork() == want {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("HasActiveWork() never became %v", want)
}

func writeTaskEvent(t *testing.T, fake *fakeTransport, taskID, eventType string) {
	t.Helper()
	fake.writeNotification(t, eventType, map[string]any{
		"task_id": taskID,
		"type":    eventType,
		"payload": map[string]any{},
	})
}

func TestStartedTaskCountsAsActiveWorkUntilTerminal(t *testing.T) {
	client, fake := newClientWithFake(t)
	defer client.Stop()

	if client.HasActiveWork() {
		t.Fatal("a fresh client should have no active work")
	}

	writeTaskEvent(t, fake, "task-1", "task.started")
	waitForActiveWork(t, client, true)
	if ids := client.ActiveTaskIDs(); len(ids) != 1 || ids[0] != "task-1" {
		t.Fatalf("ActiveTaskIDs() = %v, want [task-1]", ids)
	}

	writeTaskEvent(t, fake, "task-1", "task.completed")
	waitForActiveWork(t, client, false)
}

// A task parked on a question is recoverable against a fresh process, so it
// must not pin the current one alive.
func TestInteractiveWaitReleasesActiveWork(t *testing.T) {
	client, fake := newClientWithFake(t)
	defer client.Stop()

	writeTaskEvent(t, fake, "task-1", "task.started")
	waitForActiveWork(t, client, true)

	writeTaskEvent(t, fake, "task-1", "task.question")
	waitForActiveWork(t, client, false)
}

// Regression: killing the child while a task was mid-flight used to leave the
// task with no terminal event at all, so the renderer span forever.
func TestStopReportsStrandedTasksAsFailed(t *testing.T) {
	client, fake := newClientWithFake(t)

	failed := make(chan types.BridgeEvent, 4)
	client.OnEvent(func(event types.BridgeEvent) {
		if event.Type == "task.failed" {
			failed <- event
		}
	})

	writeTaskEvent(t, fake, "task-1", "task.started")
	waitForActiveWork(t, client, true)

	client.Stop()

	select {
	case event := <-failed:
		if event.TaskID != "task-1" {
			t.Errorf("task_id = %q, want task-1", event.TaskID)
		}
		if got, _ := event.Payload["code"].(string); got != StrandedTaskCode {
			t.Errorf("payload.code = %v, want %s", event.Payload["code"], StrandedTaskCode)
		}
		if got, _ := event.Payload["message"].(string); got == "" {
			t.Error("payload.message should explain why the task failed")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Stop did not report the stranded task as failed")
	}

	if client.HasActiveWork() {
		t.Error("stranded tasks should be cleared once reported")
	}
}

// Close detaches listeners as soon as Stop returns, so the stranded-task
// notification has to be emitted synchronously inside Stop rather than left to
// the asynchronous exit handler.
func TestCloseReportsStrandedTasksAsFailed(t *testing.T) {
	client, fake := newClientWithFake(t)

	failed := make(chan types.BridgeEvent, 4)
	client.OnEvent(func(event types.BridgeEvent) {
		if event.Type == "task.failed" {
			failed <- event
		}
	})

	writeTaskEvent(t, fake, "task-1", "task.started")
	waitForActiveWork(t, client, true)

	client.Close()

	select {
	case event := <-failed:
		if event.TaskID != "task-1" {
			t.Errorf("task_id = %q, want task-1", event.TaskID)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Close did not report the stranded task as failed")
	}
}

func TestUnexpectedExitReportsStrandedTasksAsFailed(t *testing.T) {
	client, fake := newClientWithFake(t)
	defer client.Stop()

	failed := make(chan types.BridgeEvent, 4)
	client.OnEvent(func(event types.BridgeEvent) {
		if event.Type == "task.failed" {
			failed <- event
		}
	})

	writeTaskEvent(t, fake, "task-1", "task.started")
	waitForActiveWork(t, client, true)

	code := 1
	fake.exit(&code, "")

	select {
	case event := <-failed:
		if event.TaskID != "task-1" {
			t.Errorf("task_id = %q, want task-1", event.TaskID)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("an unexpected exit did not report the stranded task as failed")
	}
}

// A completed task must not be reported twice when the process is torn down.
func TestStopDoesNotReportFinishedTasks(t *testing.T) {
	client, fake := newClientWithFake(t)

	failed := make(chan types.BridgeEvent, 4)
	client.OnEvent(func(event types.BridgeEvent) {
		if event.Type == "task.failed" {
			failed <- event
		}
	})

	writeTaskEvent(t, fake, "task-1", "task.started")
	waitForActiveWork(t, client, true)
	writeTaskEvent(t, fake, "task-1", "task.completed")
	waitForActiveWork(t, client, false)

	client.Stop()

	select {
	case event := <-failed:
		t.Fatalf("unexpected task.failed for %s", event.TaskID)
	case <-time.After(200 * time.Millisecond):
	}
}
