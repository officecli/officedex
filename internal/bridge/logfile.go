package bridge

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Logfile is a non-blocking async writer for bridge stdout/stderr chunks.
//
// Design contract:
//   - Write returns in <10μs and NEVER blocks. When the bounded channel is
//     full, the new chunk is dropped (drop-newest) and accumulated into
//     droppedBytes; the count is flushed as `[DROPPED N bytes since last
//     marker]` periodically (every dropMarkerInterval bytes written) and on
//     Close.
//   - Daily rotation by local date: file path is `<dir>/bridge-YYYYMMDD.log`.
//     The writer goroutine reopens the file when the date changes.
//   - At construction, files matching `bridge-*.log` older than retentionDays
//     (by mtime) are deleted from dir.
//
// The injected clock allows tests to drive rotation and cleanup deterministically.
type Logfile struct {
	dir   string
	clock func() time.Time

	ch     chan []byte
	sink   io.Writer // optional override for tests; nil means use real file
	closed atomic.Bool
	doneCh chan struct{}

	mu             sync.Mutex
	droppedBytes   int64
	totalDropped   int64
	bytesSinceMark int64
}

const (
	logfileChanCap     = 256
	retentionDays      = 7
	dropMarkerInterval = 1 << 20 // 1MB
)

// NewLogfile constructs a Logfile rooted at dir. clock may be nil, in which
// case time.Now is used. The directory is created if missing. Stale files
// (`bridge-*.log` with mtime > retentionDays old) are deleted up-front.
func NewLogfile(dir string, clock func() time.Time) (*Logfile, error) {
	if clock == nil {
		clock = time.Now
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("bridge logfile: mkdir: %w", err)
	}
	l := &Logfile{
		dir:    dir,
		clock:  clock,
		ch:     make(chan []byte, logfileChanCap),
		doneCh: make(chan struct{}),
	}
	l.cleanupOld()
	go l.run()
	return l, nil
}

// newWithSink is a test helper that bypasses real file rotation and writes
// every chunk to the provided sink. Cleanup and rotation behavior are
// disabled; this is only useful for RTT / non-blocking probes.
func newWithSink(sink io.Writer) *Logfile {
	l := &Logfile{
		clock:  time.Now,
		ch:     make(chan []byte, logfileChanCap),
		sink:   sink,
		doneCh: make(chan struct{}),
	}
	go l.run()
	return l
}

// Write hands chunk off to the writer goroutine. Never blocks; returns
// immediately. On a full channel, len(chunk) is added to droppedBytes.
// After Close, Write is a no-op.
func (l *Logfile) Write(chunk []byte) {
	if l == nil || l.closed.Load() || len(chunk) == 0 {
		return
	}
	// Copy: callers reuse their buffer slice.
	dup := make([]byte, len(chunk))
	copy(dup, chunk)
	select {
	case l.ch <- dup:
	default:
		l.mu.Lock()
		l.droppedBytes += int64(len(chunk))
		l.totalDropped += int64(len(chunk))
		l.mu.Unlock()
	}
}

// Close flushes pending chunks, writes any final dropped-bytes marker, and
// stops the writer goroutine. Safe to call multiple times.
func (l *Logfile) Close() error {
	if l == nil {
		return nil
	}
	if !l.closed.CompareAndSwap(false, true) {
		return nil
	}
	close(l.ch)
	<-l.doneCh
	return nil
}

// DroppedBytes returns the cumulative bytes dropped due to channel pressure
// over the lifetime of the Logfile. Safe for concurrent calls.
func (l *Logfile) DroppedBytes() int64 {
	if l == nil {
		return 0
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.totalDropped
}

func (l *Logfile) run() {
	defer close(l.doneCh)

	var (
		file       *os.File
		currentDay string
	)
	openFor := func(now time.Time) {
		if l.sink != nil {
			return
		}
		day := now.Format("20060102")
		if file != nil && day == currentDay {
			return
		}
		if file != nil {
			_ = file.Close()
			file = nil
		}
		path := filepath.Join(l.dir, fmt.Sprintf("bridge-%s.log", day))
		f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
		if err != nil {
			// Surface to stderr but keep draining the channel so writers don't pile up.
			fmt.Fprintf(os.Stderr, "bridge logfile: open %s: %v\n", path, err)
			return
		}
		file = f
		currentDay = day
	}
	writeTo := func(p []byte) {
		if l.sink != nil {
			_, _ = l.sink.Write(p)
			return
		}
		if file == nil {
			return
		}
		_, _ = file.Write(p)
	}
	flushDropMarker := func() {
		l.mu.Lock()
		n := l.droppedBytes
		l.droppedBytes = 0
		l.mu.Unlock()
		if n == 0 {
			return
		}
		marker := fmt.Sprintf("[DROPPED %d bytes since last marker]\n", n)
		writeTo([]byte(marker))
	}

	openFor(l.clock())

	for chunk := range l.ch {
		openFor(l.clock())
		writeTo(chunk)
		l.bytesSinceMark += int64(len(chunk))
		if l.bytesSinceMark >= dropMarkerInterval {
			l.bytesSinceMark = 0
			flushDropMarker()
		}
	}

	// Final flush.
	flushDropMarker()
	if file != nil {
		_ = file.Close()
	}
}

// cleanupOld removes bridge-*.log files older than retentionDays based on
// modification time. Failures are ignored: cleanup is best-effort and must
// not block startup.
func (l *Logfile) cleanupOld() {
	if l.dir == "" {
		return
	}
	entries, err := os.ReadDir(l.dir)
	if err != nil {
		return
	}
	cutoff := l.clock().Add(-retentionDays * 24 * time.Hour)
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() {
			continue
		}
		if !strings.HasPrefix(name, "bridge-") || !strings.HasSuffix(name, ".log") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		if info.ModTime().Before(cutoff) {
			_ = os.Remove(filepath.Join(l.dir, name))
		}
	}
}
