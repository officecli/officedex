package opstelemetry

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"officedex/internal/atomicfile"
)

// DefaultMaxOutbox bounds the queue. The events are tiny (roughly 150 bytes
// each), so the cap is about keeping a machine that has been offline for months
// from accumulating an unbounded file, not about disk pressure.
const DefaultMaxOutbox = 5000

const (
	outboxFileName = "outbox.json"
	stateFileName  = "state.json"
)

// outboxFile is the on-disk shape. The version field exists so a later change
// to the queue can be recognised rather than guessed at; an unknown version is
// discarded, which costs at most a handful of counter events.
type outboxFile struct {
	Version int     `json:"version"`
	Events  []Event `json:"events"`
}

const outboxVersion = 1

// outbox is a durable FIFO of pending events, persisted by full rewrite through
// atomicfile. Rewriting the whole file on every change is the right trade here:
// the queue is capped at a few thousand short records, and an append-only log
// would need its own compaction and torn-tail handling to buy nothing.
//
// Not safe for concurrent use; the Recorder owns one and holds its mutex.
type outbox struct {
	path   string
	max    int
	events []Event
}

func newOutbox(dir string, max int) *outbox {
	if max <= 0 {
		max = DefaultMaxOutbox
	}
	return &outbox{path: filepath.Join(dir, outboxFileName), max: max}
}

// load reads the queue from disk. A missing file is an empty queue; a corrupt
// one is reported so the caller can log it, and leaves the queue empty rather
// than refusing to start.
func (o *outbox) load() error {
	raw, err := os.ReadFile(o.path)
	if errors.Is(err, os.ErrNotExist) {
		o.events = nil
		return nil
	}
	if err != nil {
		return fmt.Errorf("opstelemetry: read outbox: %w", err)
	}
	var file outboxFile
	if err := json.Unmarshal(raw, &file); err != nil {
		o.events = nil
		return fmt.Errorf("opstelemetry: decode outbox: %w", err)
	}
	if file.Version != outboxVersion {
		o.events = nil
		return fmt.Errorf("opstelemetry: outbox version %d is not %d", file.Version, outboxVersion)
	}
	o.events = file.Events
	return nil
}

func (o *outbox) save() error {
	if err := os.MkdirAll(filepath.Dir(o.path), 0o700); err != nil {
		return fmt.Errorf("opstelemetry: mkdir outbox dir: %w", err)
	}
	raw, err := json.Marshal(outboxFile{Version: outboxVersion, Events: o.events})
	if err != nil {
		return fmt.Errorf("opstelemetry: encode outbox: %w", err)
	}
	if err := atomicfile.WriteFile(o.path, raw, 0o600); err != nil {
		return fmt.Errorf("opstelemetry: write outbox: %w", err)
	}
	return nil
}

func (o *outbox) len() int { return len(o.events) }

func (o *outbox) has(id string) bool {
	for _, event := range o.events {
		if event.ID == id {
			return true
		}
	}
	return false
}

// append adds an event and enforces the cap. Over the cap it drops the oldest
// event that is not a once-in-a-lifetime one; app_first_open and
// first_document_success are never dropped, because unlike a document_success
// they have no successor to carry the same information.
func (o *outbox) append(event Event) {
	o.events = append(o.events, event)
	for len(o.events) > o.max {
		index := -1
		for i, candidate := range o.events {
			if !candidate.Durable() {
				index = i
				break
			}
		}
		if index < 0 {
			// Everything queued is a durable event, which can only happen if
			// the cap is smaller than the number of per-install events. Keep
			// them: overshooting a cap by a couple of rows beats losing the
			// two events the whole funnel is anchored on.
			return
		}
		o.events = append(o.events[:index], o.events[index+1:]...)
	}
}

// batch returns up to size oldest events, together with the ids the caller must
// hand back to remove(). Events that aged out of the collector's acceptance
// window are excluded and reported separately so the caller can drop and log
// them without a pointless round trip.
func (o *outbox) batch(size int, stale func(Event) bool) (send []Event, expired []Event) {
	for _, event := range o.events {
		if len(send) >= size {
			break
		}
		if stale(event) {
			expired = append(expired, event)
			continue
		}
		send = append(send, event)
	}
	return send, expired
}

func (o *outbox) remove(ids map[string]struct{}) {
	if len(ids) == 0 {
		return
	}
	kept := o.events[:0]
	for _, event := range o.events {
		if _, drop := ids[event.ID]; drop {
			continue
		}
		kept = append(kept, event)
	}
	o.events = kept
}

func (o *outbox) clear() error {
	o.events = nil
	if err := os.Remove(o.path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("opstelemetry: remove outbox: %w", err)
	}
	return nil
}

// markerState holds the once-per-install facts that decide whether the two
// lifetime events may still be sent. It lives beside the outbox and is written
// atomically, so a crash between "event enqueued" and "marker written" costs a
// duplicate id the collector already de-duplicates, never a lost event.
type markerState struct {
	Version int `json:"version"`
	// AppFirstOpen records that the first-open event was enqueued (or, for an
	// install whose creation date predates the collector's acceptance window,
	// that it can no longer be reported truthfully).
	AppFirstOpen string `json:"appFirstOpen,omitempty"`
	// FirstDocumentSuccess is either "enqueued" or "before_tracking" — the
	// latter for an install that already had finished documents when this
	// feature first ran, whose real first success happened unobserved.
	FirstDocumentSuccess string `json:"firstDocumentSuccess,omitempty"`
}

const (
	markerStateVersion = 1

	markerEnqueued       = "enqueued"
	markerBeforeTracking = "before_tracking"
	markerOutOfWindow    = "out_of_window"
)

type stateStore struct {
	path  string
	value markerState
}

func newStateStore(dir string) *stateStore {
	return &stateStore{path: filepath.Join(dir, stateFileName), value: markerState{Version: markerStateVersion}}
}

func (s *stateStore) load() error {
	raw, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("opstelemetry: read state: %w", err)
	}
	var value markerState
	if err := json.Unmarshal(raw, &value); err != nil {
		return fmt.Errorf("opstelemetry: decode state: %w", err)
	}
	value.Version = markerStateVersion
	s.value = value
	return nil
}

func (s *stateStore) save() error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return fmt.Errorf("opstelemetry: mkdir state dir: %w", err)
	}
	s.value.Version = markerStateVersion
	raw, err := json.Marshal(s.value)
	if err != nil {
		return fmt.Errorf("opstelemetry: encode state: %w", err)
	}
	if err := atomicfile.WriteFile(s.path, raw, 0o600); err != nil {
		return fmt.Errorf("opstelemetry: write state: %w", err)
	}
	return nil
}

func (s *stateStore) clear() error {
	s.value = markerState{Version: markerStateVersion}
	if err := os.Remove(s.path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("opstelemetry: remove state: %w", err)
	}
	return nil
}
