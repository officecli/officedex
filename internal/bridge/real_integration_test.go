// Real-officecli integration smoke test.
//
// Gated by OFFICEDEX_E2E_REAL=1. When unset, this file declares no test
// functions that fail; the build tag keeps it out of routine `go test ./...`
// runs. Run with:
//
//   OFFICEDEX_E2E_REAL=1 OFFICECLI_DESKTOP_BINARY=$(pwd)/officecli-bin/officecli \
//     go test ./internal/bridge -run TestRealOfficeCli -count=1 -timeout 30m -v
//
// To also exercise a real generate (which calls a real LLM), additionally set
// OFFICEDEX_E2E_REAL_GENERATE=1.

//go:build real_e2e

package bridge

import (
	"context"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"officedex/internal/types"
)

func realBinary(t *testing.T) string {
	t.Helper()
	if os.Getenv("OFFICEDEX_E2E_REAL") != "1" {
		t.Skip("OFFICEDEX_E2E_REAL not set; skipping real officecli smoke")
	}
	binary := os.Getenv("OFFICECLI_DESKTOP_BINARY")
	if binary == "" {
		t.Fatal("OFFICECLI_DESKTOP_BINARY is required for real officecli smoke")
	}
	if _, err := os.Stat(binary); err != nil {
		t.Fatalf("officecli binary not accessible: %v", err)
	}
	return binary
}

func TestRealOfficeCliInitializeAndCapabilities(t *testing.T) {
	binary := realBinary(t)

	client := New(Options{
		BinaryPath:           binary,
		DisableAutoReconnect: true,
		RequestTimeout:       60 * time.Second,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	if err := client.Start(ctx); err != nil {
		t.Fatalf("client.Start: %v", err)
	}
	defer client.Stop()

	if _, err := client.Initialize(ctx); err != nil {
		t.Fatalf("client.Initialize: %v", err)
	}
	caps, err := client.GetCapabilities(ctx)
	if err != nil {
		t.Fatalf("client.GetCapabilities: %v", err)
	}
	if len(caps) == 0 {
		t.Fatal("GetCapabilities returned empty payload")
	}
	t.Logf("capabilities (%d bytes): %s", len(caps), truncate(caps, 256))
}

func TestRealOfficeCliGenerateSmoke(t *testing.T) {
	if os.Getenv("OFFICEDEX_E2E_REAL_GENERATE") != "1" {
		t.Skip("OFFICEDEX_E2E_REAL_GENERATE not set; skipping real LLM-backed generate smoke")
	}
	binary := realBinary(t)

	tempOut, err := os.MkdirTemp("", "officedex-e2e-")
	if err != nil {
		t.Fatalf("mkdir temp: %v", err)
	}
	defer os.RemoveAll(tempOut)

	client := New(Options{
		BinaryPath:           binary,
		DisableAutoReconnect: true,
		RequestTimeout:       30 * time.Minute,
	})

	var (
		mu        sync.Mutex
		gotDone   bool
		gotFailed bool
		failedMsg string
		completed = make(chan struct{})
	)
	client.OnEvent(func(ev types.BridgeEvent) {
		mu.Lock()
		defer mu.Unlock()
		switch ev.Type {
		case "task.completed":
			if !gotDone {
				gotDone = true
				close(completed)
			}
		case "task.failed":
			if !gotFailed {
				gotFailed = true
				if msg, ok := ev.Payload["message"].(string); ok {
					failedMsg = msg
				}
				close(completed)
			}
		}
	})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	if err := client.Start(ctx); err != nil {
		t.Fatalf("client.Start: %v", err)
	}
	defer client.Stop()

	if _, err := client.Initialize(ctx); err != nil {
		t.Fatalf("client.Initialize: %v", err)
	}

	input := types.GenerateInput{
		DocumentType: "pptx",
		Topic:        "E2E test deck",
		Prompt:       "Create a 3-slide test deck about OfficeDex e2e testing. Keep it short.",
		Mode:         "fast",
		OutputDir:    tempOut,
		LocalPreview: false,
	}
	result, err := client.InvokeGenerate(ctx, input)
	if err != nil {
		// Treat as skipped rather than failed — real LLM smoke is best-effort.
		t.Skipf("InvokeGenerate failed (treated as skip per US-007): %v", err)
	}
	t.Logf("invoke result: taskId=%s status=%s sessionId=%s", result.TaskID, result.Status, result.SessionID)

	select {
	case <-completed:
		// fallthrough
	case <-ctx.Done():
		t.Skipf("real generate timed out after 30m (treated as skip): %v", ctx.Err())
	}

	mu.Lock()
	defer mu.Unlock()
	if gotFailed {
		t.Skipf("real generate failed (treated as skip per US-007): %s", failedMsg)
	}
	if !gotDone {
		t.Skip("real generate did not emit task.completed (treated as skip)")
	}

	entries, err := os.ReadDir(tempOut)
	if err != nil {
		t.Fatalf("read tempOut: %v", err)
	}
	if len(entries) == 0 {
		t.Fatalf("no artifacts produced in %s", tempOut)
	}
	t.Logf("artifacts produced in %s: %d files", tempOut, len(entries))
}

func truncate(b []byte, n int) string {
	s := string(b)
	if len(s) <= n {
		return s
	}
	return strings.ReplaceAll(s[:n], "\n", " ") + "…"
}
