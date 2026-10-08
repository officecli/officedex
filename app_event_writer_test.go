package main

import (
	"sync"
	"sync/atomic"
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

// Shutdown drains the writer, but retired bridge processes can still deliver a
// last event while the app is closing. Sending on the closed channel used to
// panic the app on exit; a late write now runs inline instead.
func TestQueueEventWriteAfterDrainRunsInline(t *testing.T) {
	app := &App{}
	app.startEventWriter()
	app.drainEventWrites()

	ran := false
	app.queueEventWrite(func() { ran = true })
	if !ran {
		t.Fatal("a write queued after drain was dropped instead of running inline")
	}
	// Draining twice must be a no-op rather than a double close.
	app.drainEventWrites()
}

// Writers racing the drain must never hit a closed channel, and none of their
// writes may be lost: each either lands before the close or runs inline.
func TestQueueEventWriteRacingDrainNeverPanicsOrDrops(t *testing.T) {
	app := &App{}
	app.startEventWriter()

	const writers = 64
	var executed atomic.Int32
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < writers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			app.queueEventWrite(func() { executed.Add(1) })
		}()
	}
	close(start)
	app.drainEventWrites()
	wg.Wait()
	// Inline writes complete before queueEventWrite returns; queued ones were
	// flushed by drain. Either way every write has run by now.
	if got := executed.Load(); got != writers {
		t.Fatalf("executed %d writes, want %d", got, writers)
	}
}
