// Package applog is OfficeDex's single logging sink.
//
// The app used to log through five unrelated mechanisms: log.Printf for the MOP
// HTTP handler, log.Fatalf in main, fmt.Fprintf(os.Stderr) inside the bridge
// package, wailsruntime.Log*f in the app package, and nothing at all in the
// packages that could not import Wails. They had no common format and, more to
// the point, no common fields: a warning about a task event named neither the
// task nor the request the bridge had already attached to it, so a user
// reporting "generation failed" left nothing in the log that could be tied back
// to their request_id.
//
// This package is slog with two constraints. Records carry attributes rather
// than pre-formatted strings, so task_id and request_id survive as fields. And
// the destination is chosen once, here, rather than at each call site: packages
// that cannot import Wails (bridge, mophttp, localstore) log the same way the
// app package does, and the Wails runtime is wired in at startup through
// SetForwarder.
package applog

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"
	"sync"
)

// Forwarder receives a formatted line and its level. The app installs one at
// startup that hands the line to the Wails runtime logger, which is where a
// packaged build's log actually goes; without one, lines go to stderr.
type Forwarder func(level slog.Level, line string)

var (
	sinkMu    sync.RWMutex
	forwarder Forwarder
	fallback  io.Writer = os.Stderr
)

// SetForwarder installs the destination for every subsequent record, replacing
// stderr. Passing nil restores stderr, which is what shutdown does: the Wails
// runtime logger stops accepting records once the window is gone, and a log line
// written during teardown should still land somewhere.
func SetForwarder(fn Forwarder) {
	sinkMu.Lock()
	defer sinkMu.Unlock()
	forwarder = fn
}

// SetFallbackWriter redirects the pre-startup / post-shutdown destination.
// Tests use it to capture output; nothing else should need it.
func SetFallbackWriter(w io.Writer) {
	sinkMu.Lock()
	defer sinkMu.Unlock()
	if w == nil {
		w = os.Stderr
	}
	fallback = w
}

// Logger returns the shared logger. It is safe for concurrent use and is valid
// before SetForwarder runs, so packages may hold onto it at construction time.
func Logger() *slog.Logger { return shared }

var shared = slog.New(&handler{})

// With returns a logger that stamps attrs onto every record, for a component
// that would otherwise repeat them: applog.With(slog.String("component",
// "mophttp")).
func With(attrs ...any) *slog.Logger { return shared.With(attrs...) }

// Err is the conventional way to attach a failure. Every call site used to
// interpolate the error into the message, which made two failures of the same
// operation two distinct messages.
func Err(err error) slog.Attr { return slog.Any("err", err) }

// Task and Request attach the identifiers that make a line traceable. Both drop
// out of the record when empty rather than logging `task_id=""`, because most
// records genuinely have no task behind them.
func Task(taskID string) slog.Attr { return omitEmpty("task_id", taskID) }

// Request attaches the platform request_id — the identifier a user reports and
// support searches for. The bridge puts it on every event; before this, nothing
// in the desktop log carried it.
func Request(requestID string) slog.Attr { return omitEmpty("request_id", requestID) }

func omitEmpty(key, value string) slog.Attr {
	if strings.TrimSpace(value) == "" {
		// A zero Attr is elided by slog rather than logged as an empty field.
		return slog.Attr{}
	}
	return slog.String(key, value)
}

// handler formats a record as one line: "LEVEL message key=value ...".
//
// The format is deliberately the one the Wails logger already produced, because
// these lines are read in the same dev console as before and a wholesale change
// in shape would make the existing ones harder to scan, not easier.
type handler struct {
	attrs []slog.Attr
}

func (h *handler) Enabled(_ context.Context, level slog.Level) bool {
	return level >= slog.LevelInfo
}

func (h *handler) Handle(_ context.Context, record slog.Record) error {
	var b strings.Builder
	b.WriteString(record.Message)
	for _, attr := range h.attrs {
		appendAttr(&b, attr)
	}
	record.Attrs(func(attr slog.Attr) bool {
		appendAttr(&b, attr)
		return true
	})
	emit(record.Level, b.String())
	return nil
}

func (h *handler) WithAttrs(attrs []slog.Attr) slog.Handler {
	if len(attrs) == 0 {
		return h
	}
	merged := make([]slog.Attr, 0, len(h.attrs)+len(attrs))
	merged = append(merged, h.attrs...)
	merged = append(merged, attrs...)
	return &handler{attrs: merged}
}

// WithGroup returns the handler unchanged: nothing in OfficeDex groups
// attributes, and a handler that silently accepted groups it does not render
// would lose fields.
func (h *handler) WithGroup(string) slog.Handler { return h }

func appendAttr(b *strings.Builder, attr slog.Attr) {
	if attr.Equal(slog.Attr{}) {
		return
	}
	b.WriteByte(' ')
	b.WriteString(attr.Key)
	b.WriteByte('=')
	value := attr.Value.Resolve()
	text := value.String()
	if err, ok := value.Any().(error); ok && err != nil {
		text = err.Error()
	}
	if strings.ContainsAny(text, " \t\"") {
		fmt.Fprintf(b, "%q", text)
		return
	}
	b.WriteString(text)
}

func emit(level slog.Level, line string) {
	sinkMu.RLock()
	fn, w := forwarder, fallback
	sinkMu.RUnlock()
	if fn != nil {
		fn(level, line)
		return
	}
	fmt.Fprintf(w, "%s %s\n", levelLabel(level), line)
}

func levelLabel(level slog.Level) string {
	switch {
	case level >= slog.LevelError:
		return "ERR "
	case level >= slog.LevelWarn:
		return "WARN"
	default:
		return "INFO"
	}
}
