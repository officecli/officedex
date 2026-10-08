package main

import (
	"sync"
	"testing"
	"time"
)

// The path, env and timestamp were three App fields cleared by hand at every
// call site that changed the binary. invalidate has to clear all three, or a
// newly installed binary keeps running with the old provider's environment.
func TestBinaryCacheInvalidateClearsEverything(t *testing.T) {
	var c binaryCache
	c.seed("/usr/local/bin/officecli", []string{"OFFICECLI_LLM_PROVIDER=anthropic"}, time.Now())

	c.invalidate()

	path, env, at := c.load()
	if path != "" || len(env) != 0 || !at.IsZero() {
		t.Fatalf("after invalidate: path=%q env=%#v at=%v, want all empty", path, env, at)
	}
}

// A resolution costs a filesystem stat and runs on every RPC, so it must happen
// once per settings change and not once per caller.
func TestBinaryCacheResolvesOnceUntilInvalidated(t *testing.T) {
	var c binaryCache
	var calls int
	resolve := func() (string, []string) {
		calls++
		return "/usr/local/bin/officecli", []string{"OFFICE_CLI_RUNTIME_MODE=hosted"}
	}

	for i := 0; i < 5; i++ {
		if path, _ := c.ensure(resolve); path != "/usr/local/bin/officecli" {
			t.Fatalf("ensure returned %q", path)
		}
	}
	if calls != 1 {
		t.Fatalf("resolved %d times, want 1", calls)
	}

	c.invalidate()
	c.ensure(resolve)
	if calls != 2 {
		t.Fatalf("resolved %d times after invalidate, want 2", calls)
	}
}

// Concurrent callers should stat the filesystem once between them, not once
// each -- ensureBridge and runCommandOptions can both arrive on a cold cache.
func TestBinaryCacheResolvesOnceUnderConcurrentCallers(t *testing.T) {
	var c binaryCache
	var mu sync.Mutex
	calls := 0
	resolve := func() (string, []string) {
		mu.Lock()
		calls++
		mu.Unlock()
		return "/usr/local/bin/officecli", nil
	}

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); c.ensure(resolve) }()
	}
	wg.Wait()

	if calls != 1 {
		t.Fatalf("resolved %d times concurrently, want 1", calls)
	}
}

// EnvApplied in the runtime snapshot distinguishes "resolved with no env" from
// "never resolved", which is what the timestamp is for.
func TestBinaryCacheZeroTimestampMeansNeverResolved(t *testing.T) {
	var c binaryCache
	if _, _, at := c.load(); !at.IsZero() {
		t.Fatal("a fresh cache should report a zero resolved-at")
	}
	c.store("/usr/local/bin/officecli", nil)
	if _, _, at := c.load(); at.IsZero() {
		t.Fatal("storing a resolution with an empty env should still stamp the time")
	}
}

// Handing out the stored slice let a caller mutate another caller's env.
func TestBinaryCacheDoesNotShareItsEnvSlice(t *testing.T) {
	var c binaryCache
	original := []string{"OFFICECLI_LLM_MODEL=claude-sonnet-4-6"}
	c.store("/usr/local/bin/officecli", original)

	_, env, _ := c.load()
	env[0] = "OFFICECLI_LLM_API_KEY=leaked"
	original[0] = "OFFICECLI_LLM_MODEL=tampered"

	if _, env, _ := c.load(); env[0] != "OFFICECLI_LLM_MODEL=claude-sonnet-4-6" {
		t.Fatalf("cached env was mutated through a shared slice: %q", env[0])
	}
}
