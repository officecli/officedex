package opstelemetry

import (
	"log/slog"
	"strings"
	"time"
)

// This file holds the four event constructors. They own the "once per install"
// rules so the app layer only has to say what happened, not what may be sent.
//
// Every marker is written *after* the event is queued, never before. A crash in
// between re-queues the same deterministic id on the next launch, which the
// collector de-duplicates; the other order would silently lose the event.

func (r *Recorder) markers() markerState {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.state.value
}

func (r *Recorder) setMarker(apply func(*markerState)) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.enabled {
		return
	}
	apply(&r.state.value)
	if err := r.state.save(); err != nil {
		r.logger.Warn("persist ops telemetry markers", slog.Any("err", err))
	}
}

// RecordAppFirstOpen queues app_first_open for this install, at most once ever.
//
// `createdAt` is instance.json's creation stamp, i.e. the moment this install
// actually started for the first time — not the moment this build learned to
// report it. That is what makes the event correct for installs that predate the
// feature: the id is derived from the instance, so re-queuing it on an install
// that already reported is harmless.
//
// An install created longer ago than the collector's 90-day acceptance window
// is a different case: its real first open can no longer be stated truthfully,
// and back-dating it to the edge of the window would invent a date. Such an
// install is marked as out of window and never reported, which undercounts old
// installs rather than misdating them.
func (r *Recorder) RecordAppFirstOpen(instanceID, createdAt string) error {
	if !r.Enabled() {
		return nil
	}
	if r.markers().AppFirstOpen != "" {
		return nil
	}
	at := NormalizeAt(createdAt)
	parsed, err := time.Parse(time.RFC3339, at)
	if err == nil && parsed.Before(r.now().Add(-MaxBacklog)) {
		r.logger.Info("skipping app_first_open: this install predates the reporting window",
			slog.String("created_at", at))
		r.setMarker(func(state *markerState) { state.AppFirstOpen = markerOutOfWindow })
		return nil
	}
	if err := r.EnqueueAt(EventAppFirstOpen, AppFirstOpenID(instanceID), at); err != nil {
		return err
	}
	r.setMarker(func(state *markerState) { state.AppFirstOpen = markerEnqueued })
	return nil
}

// NoteHistoryBeforeTracking records that this install already had finished
// documents when usage reporting first ran. Its real first success happened
// unobserved, so a later one must not be reported as the first — the funnel
// would show a months-old install converting today.
//
// It is a no-op once either first_document_success marker is set.
func (r *Recorder) NoteHistoryBeforeTracking() {
	if !r.Enabled() {
		return
	}
	if r.markers().FirstDocumentSuccess != "" {
		return
	}
	r.setMarker(func(state *markerState) { state.FirstDocumentSuccess = markerBeforeTracking })
}

// FirstDocumentSuccessSettled reports whether the per-install first-success
// question has already been answered, either way.
func (r *Recorder) FirstDocumentSuccessSettled() bool {
	return r.markers().FirstDocumentSuccess != ""
}

// RecordDocumentSuccess queues document_success for a finished task, and
// first_document_success alongside it the first time (contract §5: the two are
// sent together as two rows with different ids).
//
// The caller is responsible for the preconditions the contract states: a
// genuine transition to completed, and an artifact that exists, is non-empty
// and opens. This method only owns the "first time" bookkeeping.
func (r *Recorder) RecordDocumentSuccess(instanceID, taskID string, at time.Time) error {
	if !r.Enabled() {
		return nil
	}
	if strings.TrimSpace(taskID) == "" {
		return nil
	}
	if err := r.Enqueue(EventDocumentSuccess, DocumentSuccessID(taskID), at); err != nil {
		return err
	}
	if r.markers().FirstDocumentSuccess != "" {
		return nil
	}
	if err := r.Enqueue(EventFirstDocumentSuccess, FirstDocumentSuccessID(instanceID), at); err != nil {
		return err
	}
	r.setMarker(func(state *markerState) { state.FirstDocumentSuccess = markerEnqueued })
	return nil
}

// RecordGenerationFailed queues generation_failed. The contract forbids error
// text, codes and messages, so the event carries nothing beyond the task's
// identity — which is also why a cancel must never reach here: a user who
// changed their mind is not a failed generation.
func (r *Recorder) RecordGenerationFailed(taskID string, at time.Time) error {
	if !r.Enabled() {
		return nil
	}
	if strings.TrimSpace(taskID) == "" {
		return nil
	}
	return r.Enqueue(EventGenerationFailed, GenerationFailedID(taskID), at)
}
