package main

import (
	"sync"
	"testing"
	"time"
)

// Task events used to be written to SQLite on the bridge's stdout reader, so a
// dense op stream stalled the reader behind the store's single lock. The writer
// goroutine takes that work; what it must not do is reorder events, because
// recovery replays a task's history in order.
func TestEventWriterKeepsQueuedWritesInOrder(t *testing.T) {
	app := &App{}
	app.startEventWriter()

	var mu sync.Mutex
	var seen []int
	for i := 0; i < 100; i++ {
		index := i
		app.queueEventWrite(func() {
			mu.Lock()
			seen = append(seen, index)
			mu.Unlock()
		})
	}
	app.drainEventWrites()

	if len(seen) != 100 {
		t.Fatalf("recorded %d writes, want 100", len(seen))
	}
	for i, got := range seen {
		if got != i {
			t.Fatalf("write %d ran at position %d; queued writes must stay in order", got, i)
		}
	}
}

// Shutdown drains before the store closes. A dropped event is an input the
// recovery path can no longer replay, so the queue must be flushed, not
// abandoned.
func TestDrainEventWritesFlushesEverythingQueued(t *testing.T) {
	app := &App{}
	app.startEventWriter()

	done := make(chan struct{})
	var mu sync.Mutex
	count := 0
	for i := 0; i < 32; i++ {
		app.queueEventWrite(func() {
			time.Sleep(time.Millisecond)
			mu.Lock()
			count++
			mu.Unlock()
		})
	}
	go func() { app.drainEventWrites(); close(done) }()

	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("drain did not finish")
	}
	mu.Lock()
	defer mu.Unlock()
	if count != 32 {
		t.Fatalf("flushed %d writes, want 32", count)
	}
}

// A caller that never started the writer still has to persist, so the queue
// helper falls back to running inline rather than dropping the write.
func TestQueueEventWriteRunsInlineWithoutAWriter(t *testing.T) {
	app := &App{}
	ran := false
	app.queueEventWrite(func() { ran = true })
	if !ran {
		t.Fatal("write was dropped when no writer goroutine was running")
	}
}
