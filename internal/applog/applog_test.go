package applog

import (
	"bytes"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"testing"
)

// captureFallback redirects the pre-startup destination for one test.
func captureFallback(t *testing.T) *bytes.Buffer {
	t.Helper()
	buf := &bytes.Buffer{}
	SetFallbackWriter(buf)
	t.Cleanup(func() { SetFallbackWriter(nil) })
	return buf
}

func TestRecordsCarryTheirIdentifiersAsFields(t *testing.T) {
	// The point of the whole package: a warning about a task names the task and
	// the request behind it, so a user's request_id finds the line.
	buf := captureFallback(t)
	Logger().Warn("record task event",
		Task("task-7"), Request("req-42"), Err(errors.New("disk full")))

	line := buf.String()
	for _, want := range []string{"WARN", "record task event", "task_id=task-7", "request_id=req-42", `err="disk full"`} {
		if !strings.Contains(line, want) {
			t.Fatalf("line %q is missing %q", line, want)
		}
	}
}

func TestEmptyIdentifiersAreOmittedRatherThanLoggedBlank(t *testing.T) {
	// Most records have no task behind them, and `task_id=` on every line would
	// train the reader to ignore the field that matters on the lines that do.
	buf := captureFallback(t)
	Logger().Info("init notifications", Task(""), Request("  "))

	line := buf.String()
	if strings.Contains(line, "task_id") || strings.Contains(line, "request_id") {
		t.Fatalf("expected no identifier fields, got %q", line)
	}
}

func TestForwarderReceivesTheLevelAndTheFormattedLine(t *testing.T) {
	// This is how records reach the Wails logger from packages that cannot
	// import it.
	var mu sync.Mutex
	type record struct {
		level slog.Level
		line  string
	}
	var got []record
	SetForwarder(func(level slog.Level, line string) {
		mu.Lock()
		defer mu.Unlock()
		got = append(got, record{level: level, line: line})
	})
	t.Cleanup(func() { SetForwarder(nil) })

	Logger().Error("open local store", Err(errors.New("locked")))
	Logger().Warn("fail interrupted tasks")

	mu.Lock()
	defer mu.Unlock()
	if len(got) != 2 {
		t.Fatalf("expected two forwarded records, got %d", len(got))
	}
	if got[0].level != slog.LevelError || !strings.Contains(got[0].line, "open local store") {
		t.Fatalf("first record = %+v", got[0])
	}
	if !strings.Contains(got[0].line, "err=locked") {
		t.Fatalf("error attribute lost: %q", got[0].line)
	}
	if got[1].level != slog.LevelWarn {
		t.Fatalf("second record level = %v", got[1].level)
	}
}

func TestClearingTheForwarderReturnsToStderr(t *testing.T) {
	// Shutdown does this: the Wails logger stops accepting records, and a line
	// written during teardown still has to land somewhere.
	buf := captureFallback(t)
	forwarded := 0
	SetForwarder(func(slog.Level, string) { forwarded++ })
	Logger().Warn("while the window is up")
	SetForwarder(nil)
	Logger().Warn("after teardown")

	if forwarded != 1 {
		t.Fatalf("expected one forwarded record, got %d", forwarded)
	}
	line := buf.String()
	if strings.Contains(line, "while the window is up") {
		t.Fatalf("a forwarded record should not also hit stderr: %q", line)
	}
	if !strings.Contains(line, "after teardown") {
		t.Fatalf("post-teardown record did not reach stderr: %q", line)
	}
}

func TestWithStampsAttributesOnEveryRecord(t *testing.T) {
	buf := captureFallback(t)
	component := With(slog.String("component", "mophttp"))
	component.Warn("convert failed", Err(errors.New("no converter")))
	component.Warn("second line")

	lines := strings.Split(strings.TrimSpace(buf.String()), "\n")
	if len(lines) != 2 {
		t.Fatalf("expected two lines, got %d: %q", len(lines), buf.String())
	}
	for _, line := range lines {
		if !strings.Contains(line, "component=mophttp") {
			t.Fatalf("line lost the component attribute: %q", line)
		}
	}
}

func TestChainedWithKeepsBothLevelsOfAttributes(t *testing.T) {
	// One With is all any caller does today, so a handler that dropped its
	// parent's attrs on the second With would look correct everywhere. Pin it
	// anyway: the next caller to narrow a component logger down to a session
	// would silently lose the component.
	buf := captureFallback(t)
	With(slog.String("component", "mophttp")).
		With(slog.String("route", "/convert")).
		Warn("convert failed")

	line := buf.String()
	for _, want := range []string{"component=mophttp", "route=/convert"} {
		if !strings.Contains(line, want) {
			t.Fatalf("line %q is missing %q", line, want)
		}
	}
}

func TestValuesWithSpacesAreQuoted(t *testing.T) {
	// Otherwise a message with a space in an attribute reads as two attributes.
	buf := captureFallback(t)
	Logger().Warn("cleanup stale editor sessions", slog.String("editor", "PPTX editor"))

	if !strings.Contains(buf.String(), `editor="PPTX editor"`) {
		t.Fatalf("expected the value to be quoted, got %q", buf.String())
	}
}

func TestDebugRecordsAreDropped(t *testing.T) {
	buf := captureFallback(t)
	Logger().Debug("noisy")
	if buf.Len() != 0 {
		t.Fatalf("expected debug records to be dropped, got %q", buf.String())
	}
}
