package bridge

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestLogfileWritesAndRotates(t *testing.T) {
	dir := t.TempDir()
	var nowVal atomic.Int64
	nowVal.Store(time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC).UnixNano())
	clock := func() time.Time { return time.Unix(0, nowVal.Load()) }

	lf, err := NewLogfile(dir, clock)
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	lf.Write([]byte("day1-line\n"))
	// Force the writer goroutine to process the first chunk before advancing.
	flushSync(t, lf)

	// Advance one day; next Write should rotate.
	nowVal.Store(time.Date(2026, 1, 2, 0, 30, 0, 0, time.UTC).UnixNano())
	lf.Write([]byte("day2-line\n"))
	if err := lf.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	got1, err := os.ReadFile(filepath.Join(dir, "bridge-20260101.log"))
	if err != nil {
		t.Fatalf("read day1: %v", err)
	}
	if !strings.Contains(string(got1), "day1-line") {
		t.Errorf("day1 file = %q, want day1-line", got1)
	}
	got2, err := os.ReadFile(filepath.Join(dir, "bridge-20260102.log"))
	if err != nil {
		t.Fatalf("read day2: %v", err)
	}
	if !strings.Contains(string(got2), "day2-line") {
		t.Errorf("day2 file = %q, want day2-line", got2)
	}
}

func TestLogfileCleansUpOldFiles(t *testing.T) {
	dir := t.TempDir()
	clock := func() time.Time { return time.Date(2026, 5, 24, 12, 0, 0, 0, time.UTC) }

	// Seed: one 8-day-old file (should be removed) and one 2-day-old file
	// (should survive).
	old := filepath.Join(dir, "bridge-20260516.log")
	young := filepath.Join(dir, "bridge-20260522.log")
	unrelated := filepath.Join(dir, "other.log") // must not be touched
	for _, p := range []string{old, young, unrelated} {
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatalf("seed %s: %v", p, err)
		}
	}
	// Make old file 8 days old, young file 2 days old.
	mustChtimes(t, old, clock().Add(-8*24*time.Hour))
	mustChtimes(t, young, clock().Add(-2*24*time.Hour))
	mustChtimes(t, unrelated, clock().Add(-30*24*time.Hour))

	lf, err := NewLogfile(dir, clock)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer lf.Close()

	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Errorf("old file should have been removed: err=%v", err)
	}
	if _, err := os.Stat(young); err != nil {
		t.Errorf("young file should still exist: %v", err)
	}
	if _, err := os.Stat(unrelated); err != nil {
		t.Errorf("unrelated file should not have been touched: %v", err)
	}
}

func TestLogfileCloseIsIdempotent(t *testing.T) {
	dir := t.TempDir()
	lf, err := NewLogfile(dir, nil)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if err := lf.Close(); err != nil {
		t.Fatalf("first Close: %v", err)
	}
	// Subsequent Close should not panic / block.
	if err := lf.Close(); err != nil {
		t.Fatalf("second Close: %v", err)
	}
	// Write after Close is a no-op.
	lf.Write([]byte("post-close"))
}

func TestLogfileDropAccountingAndMarker(t *testing.T) {
	var buf threadSafeBuffer
	releaseGate := make(chan struct{})
	gatekeeper := &gatedWriter{
		under:   &buf,
		release: releaseGate,
	}
	lf := newWithSink(gatekeeper)

	// First chunk takes the writer goroutine slot (it now sits in
	// gatekeeper.Write waiting). The next logfileChanCap chunks fill the
	// channel. The remainder must be dropped without blocking.
	lf.Write([]byte("trigger"))
	// Give the goroutine a moment to actually call Write and block.
	time.Sleep(5 * time.Millisecond)

	const burst = 10000
	maxDur := time.Duration(0)
	for i := 0; i < burst; i++ {
		start := time.Now()
		lf.Write([]byte("xxxx"))
		if d := time.Since(start); d > maxDur {
			maxDur = d
		}
	}
	if maxDur > 5*time.Millisecond {
		t.Errorf("max Write latency = %v, want <5ms (target <10μs but tolerate scheduler)", maxDur)
	}

	// Release the writer and close.
	close(releaseGate)
	if err := lf.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	out := buf.String()
	if !strings.Contains(out, "[DROPPED ") {
		t.Errorf("expected [DROPPED ...] marker in output, got %q", out)
	}
	if lf.DroppedBytes() == 0 {
		t.Errorf("DroppedBytes should be > 0, got 0 (burst=%d)", burst)
	}
}

func TestLogfileWriteNonBlockingTargetLatency(t *testing.T) {
	// With an unblocked sink and headroom in the channel, individual writes
	// should comfortably finish in <10μs (allocations dominate).
	var buf threadSafeBuffer
	lf := newWithSink(&buf)
	defer lf.Close()

	const samples = 5000
	var worst time.Duration
	for i := 0; i < samples; i++ {
		start := time.Now()
		lf.Write([]byte("ping"))
		if d := time.Since(start); d > worst {
			worst = d
		}
	}
	if worst > 1*time.Millisecond {
		t.Errorf("worst-case Write latency = %v, want <1ms on unblocked path", worst)
	}
}

// helpers ---------------------------------------------------------------

func flushSync(t *testing.T, lf *Logfile) {
	t.Helper()
	// Send a sentinel and busy-wait until the channel drains; the channel is
	// drained synchronously in FIFO order so this guarantees the previous
	// chunk has been written.
	for i := 0; i < 100; i++ {
		if len(lf.ch) == 0 {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatal("logfile channel never drained")
}

func mustChtimes(t *testing.T, path string, when time.Time) {
	t.Helper()
	if err := os.Chtimes(path, when, when); err != nil {
		t.Fatalf("chtimes %s: %v", path, err)
	}
}

type threadSafeBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *threadSafeBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *threadSafeBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

type gatedWriter struct {
	under   *threadSafeBuffer
	release chan struct{}
	once    bool
	mu      sync.Mutex
}

func (g *gatedWriter) Write(p []byte) (int, error) {
	g.mu.Lock()
	first := !g.once
	g.once = true
	g.mu.Unlock()
	if first {
		<-g.release
	}
	return g.under.Write(p)
}
