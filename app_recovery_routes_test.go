package main

import (
	"sync"
	"testing"
	"time"
)

// A task recovered twice leaves two routes; an answer for the first id has to
// reach the newest task, not stop at the middle one.
func TestRecoveryRoutesFollowTheWholeChain(t *testing.T) {
	var r recoveryRoutes
	r.record("task-1", "task-2")
	r.record("task-2", "task-3")

	if got := r.follow("task-1"); got != "task-3" {
		t.Fatalf("follow(task-1) = %q, want task-3", got)
	}
	if got := r.follow("task-3"); got != "task-3" {
		t.Fatalf("a task that was never replaced should come back unchanged, got %q", got)
	}
}

func TestRecoveryRoutesZeroValueRoutesNothing(t *testing.T) {
	var r recoveryRoutes
	if got := r.follow("task-1"); got != "task-1" {
		t.Fatalf("empty table changed the id to %q", got)
	}
}

// A self-route or a blank id is refused at record time so follow never has to
// rely on the hop bound to terminate.
func TestRecoveryRoutesIgnoreBlankAndSelfRoutes(t *testing.T) {
	var r recoveryRoutes
	r.record("task-1", "task-1")
	r.record("task-1", "  ")
	r.record("", "task-9")
	r.record(" task-1 ", " task-2 ")

	if got := r.follow("task-1"); got != "task-2" {
		t.Fatalf("follow(task-1) = %q, want task-2 (trimmed route kept, others ignored)", got)
	}
	if got := r.follow(""); got != "" {
		t.Fatalf("a blank id must not route anywhere, got %q", got)
	}
}

// A cycle written by two records that individually look fine must not hang the
// Respond path; follow gives up after the hop bound.
func TestRecoveryRoutesTerminateOnACycle(t *testing.T) {
	var r recoveryRoutes
	r.record("task-1", "task-2")
	r.record("task-2", "task-1")

	// A cycle would spin forever without the hop bound. Bound the call
	// ourselves so the failure is this test's own, not the package timeout.
	done := make(chan string, 1)
	go func() { done <- r.follow("task-1") }()
	select {
	case got := <-done:
		if got != "task-1" && got != "task-2" {
			t.Fatalf("follow left the cycle: %q", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("follow did not terminate on a two-node cycle")
	}
}

// follow runs on every Respond while recovery may be recording; the table has
// to hold its own lock.
func TestRecoveryRoutesAreSafeUnderConcurrentUse(t *testing.T) {
	var r recoveryRoutes
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(2)
		go func() { defer wg.Done(); r.record("task-1", "task-2") }()
		go func() { defer wg.Done(); r.follow("task-1") }()
	}
	wg.Wait()
	if got := r.follow("task-1"); got != "task-2" {
		t.Fatalf("follow(task-1) = %q after concurrent records", got)
	}
}
