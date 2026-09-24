package opstelemetry

import (
	"archive/zip"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

const testInstance = "6f1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9"

// collector is a stand-in for platform.officecli.io/api/ops/v1/collect. It
// records every batch it was handed, with the headers, so tests can assert on
// retry identity and on the test-traffic marking.
type collector struct {
	mu      sync.Mutex
	batches [][]Event
	headers []http.Header
	// respond, when set, decides the status and body per request (1-based call
	// number). Returning 0 means "200 with an all-accepted body".
	respond func(call int, events []Event) (int, any)
}

func (c *collector) handler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Events []Event `json:"events"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		c.mu.Lock()
		c.batches = append(c.batches, body.Events)
		c.headers = append(c.headers, r.Header.Clone())
		call := len(c.batches)
		respond := c.respond
		c.mu.Unlock()

		status, payload := http.StatusOK, any(collectResponse{Accepted: len(body.Events)})
		if respond != nil {
			if s, p := respond(call, body.Events); s != 0 {
				status, payload = s, p
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		if payload != nil {
			_ = json.NewEncoder(w).Encode(payload)
		}
	}
}

func (c *collector) calls() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.batches)
}

func (c *collector) batch(i int) []Event {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.batches[i]
}

// fixedClock lets a test advance time without sleeping, which is how the
// backoff assertions stay fast and deterministic.
type fixedClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *fixedClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fixedClock) advance(d time.Duration) {
	c.mu.Lock()
	c.now = c.now.Add(d)
	c.mu.Unlock()
}

type harness struct {
	recorder  *Recorder
	collector *collector
	clock     *fixedClock
	dir       string
	server    *httptest.Server
}

func newHarness(t *testing.T, mutate ...func(*Options)) *harness {
	t.Helper()
	coll := &collector{}
	server := httptest.NewServer(coll.handler())
	t.Cleanup(server.Close)
	clock := &fixedClock{now: time.Date(2026, 9, 24, 10, 0, 0, 0, time.UTC)}
	dir := t.TempDir()
	options := Options{
		Dir:      dir,
		Subject:  Subject(testInstance),
		Endpoint: server.URL,
		Enabled:  true,
		Now:      clock.Now,
		// No randomness: a test asserting on the retry schedule should assert
		// on the schedule, not on a sample from it.
		Jitter: func(d time.Duration) time.Duration { return d },
	}
	for _, fn := range mutate {
		fn(&options)
	}
	recorder, err := New(options)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return &harness{recorder: recorder, collector: coll, clock: clock, dir: dir, server: server}
}

func (h *harness) enqueueSuccess(t *testing.T, taskID string) {
	t.Helper()
	if err := h.recorder.Enqueue(EventDocumentSuccess, DocumentSuccessID(taskID), h.clock.Now()); err != nil {
		t.Fatalf("Enqueue(%s): %v", taskID, err)
	}
}

// ─── Durability ─────────────────────────────────────────────────────────────

// The whole point of the outbox: a machine that is offline when a document
// finishes still reports it, after a restart, under the same id.
func TestOutboxSurvivesRestartAndRetriesTheSameID(t *testing.T) {
	h := newHarness(t)
	h.collector.respond = func(call int, _ []Event) (int, any) {
		if call == 1 {
			return http.StatusServiceUnavailable, nil
		}
		return 0, nil
	}
	h.enqueueSuccess(t, "task-offline")
	h.recorder.Flush(context.Background())

	if h.collector.calls() != 1 {
		t.Fatalf("collector calls = %d, want 1", h.collector.calls())
	}
	if h.recorder.Pending() != 1 {
		t.Fatalf("Pending after 503 = %d, want 1 (the event must be kept)", h.recorder.Pending())
	}
	firstID := h.collector.batch(0)[0].ID

	// A new process over the same directory, as the next launch would be.
	restarted, err := New(Options{
		Dir:      h.dir,
		Subject:  Subject(testInstance),
		Endpoint: h.server.URL,
		Enabled:  true,
		Now:      h.clock.Now,
		Jitter:   func(d time.Duration) time.Duration { return d },
	})
	if err != nil {
		t.Fatalf("New(restart): %v", err)
	}
	if restarted.Pending() != 1 {
		t.Fatalf("Pending after restart = %d, want 1", restarted.Pending())
	}
	restarted.Flush(context.Background())

	if h.collector.calls() != 2 {
		t.Fatalf("collector calls = %d, want 2", h.collector.calls())
	}
	if got := h.collector.batch(1)[0].ID; got != firstID {
		t.Fatalf("retry id = %q, want the original %q; a changed id would double-count", got, firstID)
	}
	if restarted.Pending() != 0 {
		t.Fatalf("Pending after success = %d, want 0", restarted.Pending())
	}
}

// A backoff that is not honoured is a retry storm. The recorder must refuse to
// send again before its own deadline, and must send once it passes.
func TestBackoffDefersTheNextAttempt(t *testing.T) {
	h := newHarness(t)
	h.collector.respond = func(call int, _ []Event) (int, any) {
		if call <= 2 {
			return http.StatusInternalServerError, nil
		}
		return 0, nil
	}
	h.enqueueSuccess(t, "task-backoff")

	h.recorder.Flush(context.Background())
	if h.collector.calls() != 1 {
		t.Fatalf("calls after first flush = %d, want 1", h.collector.calls())
	}

	// Still inside the first 30s window: no request.
	h.clock.advance(29 * time.Second)
	h.recorder.Flush(context.Background())
	if h.collector.calls() != 1 {
		t.Fatalf("calls while backing off = %d, want 1", h.collector.calls())
	}

	h.clock.advance(2 * time.Second)
	h.recorder.Flush(context.Background())
	if h.collector.calls() != 2 {
		t.Fatalf("calls after the first backoff expired = %d, want 2", h.collector.calls())
	}

	// Second failure doubles the wait to 60s.
	h.clock.advance(31 * time.Second)
	h.recorder.Flush(context.Background())
	if h.collector.calls() != 2 {
		t.Fatalf("calls at 31s into a 60s backoff = %d, want 2", h.collector.calls())
	}
	h.clock.advance(30 * time.Second)
	h.recorder.Flush(context.Background())
	if h.collector.calls() != 3 {
		t.Fatalf("calls after the second backoff expired = %d, want 3", h.collector.calls())
	}
	if h.recorder.Pending() != 0 {
		t.Fatalf("Pending after eventual success = %d, want 0", h.recorder.Pending())
	}
}

func TestBackoffSchedule(t *testing.T) {
	for _, tc := range []struct {
		attempt int
		want    time.Duration
	}{
		{1, 30 * time.Second},
		{2, time.Minute},
		{3, 2 * time.Minute},
		{7, 32 * time.Minute},
		{8, time.Hour},
		{20, time.Hour},
	} {
		if got := backoffFor(tc.attempt); got != tc.want {
			t.Errorf("backoffFor(%d) = %s, want %s", tc.attempt, got, tc.want)
		}
	}
}

// ─── Response handling ──────────────────────────────────────────────────────

// A rejected event is the collector saying "this one is malformed". Retrying
// cannot fix it, so it is dropped — but it must not take the batch's valid
// events with it.
func TestRejectedEventsAreDroppedWithoutLosingTheRest(t *testing.T) {
	h := newHarness(t)
	h.collector.respond = func(_ int, events []Event) (int, any) {
		return http.StatusOK, collectResponse{
			Accepted: len(events) - 1,
			Rejected: []rejection{{Index: 1, Reason: "at is outside the acceptance window"}},
		}
	}
	h.enqueueSuccess(t, "task-ok")
	h.enqueueSuccess(t, "task-bad")
	h.recorder.Flush(context.Background())

	if h.recorder.Pending() != 0 {
		t.Fatalf("Pending = %d, want 0: neither accepted nor rejected events are retried", h.recorder.Pending())
	}
	if h.collector.calls() != 1 {
		t.Fatalf("calls = %d, want 1: a rejection must not trigger a retry", h.collector.calls())
	}
}

// A duplicate is the normal outcome of an at-least-once retry, and is as
// terminal as an acceptance.
func TestDuplicatesAreTreatedAsDelivered(t *testing.T) {
	h := newHarness(t)
	h.collector.respond = func(_ int, events []Event) (int, any) {
		return http.StatusOK, collectResponse{Duplicates: len(events)}
	}
	h.enqueueSuccess(t, "task-dupe")
	h.recorder.Flush(context.Background())
	if h.recorder.Pending() != 0 {
		t.Fatalf("Pending = %d, want 0", h.recorder.Pending())
	}
}

// 400 means this client built something the collector will never take. Keeping
// it would wedge the queue behind one bad row forever.
func TestBadRequestDropsTheBatch(t *testing.T) {
	h := newHarness(t)
	h.collector.respond = func(_ int, _ []Event) (int, any) {
		return http.StatusBadRequest, nil
	}
	h.enqueueSuccess(t, "task-400")
	h.recorder.Flush(context.Background())
	if h.recorder.Pending() != 0 {
		t.Fatalf("Pending after 400 = %d, want 0", h.recorder.Pending())
	}
}

func TestRateLimitIsRetried(t *testing.T) {
	h := newHarness(t)
	h.collector.respond = func(call int, _ []Event) (int, any) {
		if call == 1 {
			return http.StatusTooManyRequests, nil
		}
		return 0, nil
	}
	h.enqueueSuccess(t, "task-429")
	h.recorder.Flush(context.Background())
	if h.recorder.Pending() != 1 {
		t.Fatalf("Pending after 429 = %d, want 1", h.recorder.Pending())
	}
	h.clock.advance(31 * time.Second)
	h.recorder.Flush(context.Background())
	if h.recorder.Pending() != 0 {
		t.Fatalf("Pending after retry = %d, want 0", h.recorder.Pending())
	}
}

func TestBatchesAreCappedAtTheContractLimit(t *testing.T) {
	h := newHarness(t)
	for i := 0; i < MaxBatch+20; i++ {
		h.enqueueSuccess(t, "task-"+strings.Repeat("x", i%7)+itoa(i))
	}
	h.recorder.Flush(context.Background())
	if h.collector.calls() != 2 {
		t.Fatalf("calls = %d, want 2 (120 events in batches of %d)", h.collector.calls(), MaxBatch)
	}
	if got := len(h.collector.batch(0)); got != MaxBatch {
		t.Fatalf("first batch = %d events, want %d", got, MaxBatch)
	}
	if got := len(h.collector.batch(1)); got != 20 {
		t.Fatalf("second batch = %d events, want 20", got)
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	digits := ""
	for n > 0 {
		digits = string(rune('0'+n%10)) + digits
		n /= 10
	}
	return digits
}

// ─── Headers ────────────────────────────────────────────────────────────────

func TestNonReleaseBuildsMarkTheirTrafficAsTest(t *testing.T) {
	h := newHarness(t, func(o *Options) {
		o.TestTraffic = true
		o.ClientHeader = "desktop/1.0.6"
	})
	h.enqueueSuccess(t, "task-headers")
	h.recorder.Flush(context.Background())

	h.collector.mu.Lock()
	headers := h.collector.headers[0]
	h.collector.mu.Unlock()
	if got := headers.Get("X-Ops-Test"); got != "1" {
		t.Errorf("X-Ops-Test = %q, want \"1\"", got)
	}
	if got := headers.Get("X-OfficeDex-Client"); got != "desktop/1.0.6" {
		t.Errorf("X-OfficeDex-Client = %q", got)
	}
}

func TestReleaseBuildsSendNoTestHeader(t *testing.T) {
	h := newHarness(t, func(o *Options) { o.TestTraffic = false })
	h.enqueueSuccess(t, "task-release")
	h.recorder.Flush(context.Background())
	h.collector.mu.Lock()
	headers := h.collector.headers[0]
	h.collector.mu.Unlock()
	if headers.Get("X-Ops-Test") != "" {
		t.Errorf("X-Ops-Test = %q, want it absent on a release build", headers.Get("X-Ops-Test"))
	}
}

// ─── Privacy switch ─────────────────────────────────────────────────────────

// §7: turning the setting off clears the pending queue and stops enqueuing.
func TestDisablingClearsTheQueueAndStopsEnqueuing(t *testing.T) {
	h := newHarness(t)
	h.enqueueSuccess(t, "task-before")
	if h.recorder.Pending() != 1 {
		t.Fatalf("Pending = %d, want 1", h.recorder.Pending())
	}

	h.recorder.SetEnabled(false)
	if h.recorder.Pending() != 0 {
		t.Fatalf("Pending after opt-out = %d, want 0", h.recorder.Pending())
	}
	if _, err := os.Stat(filepath.Join(h.dir, outboxFileName)); !os.IsNotExist(err) {
		t.Fatalf("outbox file still on disk after opt-out (err=%v)", err)
	}

	h.enqueueSuccess(t, "task-after")
	if h.recorder.Pending() != 0 {
		t.Fatalf("Pending while disabled = %d, want 0", h.recorder.Pending())
	}
	h.recorder.Flush(context.Background())
	if h.collector.calls() != 0 {
		t.Fatalf("collector calls while disabled = %d, want 0", h.collector.calls())
	}
}

// A recorder constructed with the setting already off must not send what a
// previous session left behind — the session that was told to stop may have
// been killed before it could clear the queue.
func TestStartingDisabledClearsALeftoverQueue(t *testing.T) {
	h := newHarness(t)
	h.enqueueSuccess(t, "task-leftover")

	restarted, err := New(Options{
		Dir:      h.dir,
		Subject:  Subject(testInstance),
		Endpoint: h.server.URL,
		Enabled:  false,
		Now:      h.clock.Now,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if restarted.Pending() != 0 {
		t.Fatalf("Pending = %d, want 0", restarted.Pending())
	}
}

// ─── Validation ─────────────────────────────────────────────────────────────

func TestValidateMirrorsTheContract(t *testing.T) {
	now := time.Date(2026, 9, 24, 10, 0, 0, 0, time.UTC)
	valid := Event{
		ID:      "ds_task-1234",
		Subject: Subject(testInstance),
		Name:    EventDocumentSuccess,
		At:      FormatAt(now),
	}
	if err := valid.Validate(now); err != nil {
		t.Fatalf("a well-formed event was rejected: %v", err)
	}

	for name, mutate := range map[string]func(*Event){
		"id too short":       func(e *Event) { e.ID = "ds_1" },
		"id has a space":     func(e *Event) { e.ID = "ds_task 1234" },
		"id has a colon":     func(e *Event) { e.ID = "ds_task:1234" },
		"subject too short":  func(e *Event) { e.Subject = "a" },
		"subject has an at":  func(e *Event) { e.Subject = "inst:a@b" },
		"unknown event name": func(e *Event) { e.Name = "page_view" },
		"at is not UTC":      func(e *Event) { e.At = "2026-09-24T10:00:00+08:00" },
		"at is unparseable":  func(e *Event) { e.At = "yesterdayZ" },
		"at is in the future": func(e *Event) {
			e.At = FormatAt(now.Add(10 * time.Minute))
		},
		"at is older than the window": func(e *Event) {
			e.At = FormatAt(now.Add(-91 * 24 * time.Hour))
		},
		"userId is an email": func(e *Event) { e.UserID = "person@example.com" },
	} {
		t.Run(name, func(t *testing.T) {
			event := valid
			mutate(&event)
			if err := event.Validate(now); err == nil {
				t.Fatalf("Validate accepted %+v", event)
			}
		})
	}
}

// An invalid event must never enter the outbox: the queue retries forever, and
// a row the collector will always refuse would be retried forever too.
func TestInvalidEventsAreNeverEnqueued(t *testing.T) {
	h := newHarness(t)
	if err := h.recorder.Enqueue("page_view", "ds_task-1234", h.clock.Now()); err == nil {
		t.Fatal("Enqueue accepted a website event name")
	}
	if err := h.recorder.Enqueue(EventDocumentSuccess, "ds_x", h.clock.Now()); err == nil {
		t.Fatal("Enqueue accepted a too-short id")
	}
	if h.recorder.Pending() != 0 {
		t.Fatalf("Pending = %d, want 0", h.recorder.Pending())
	}
}

func TestEnqueueDeduplicatesWithinTheQueue(t *testing.T) {
	h := newHarness(t)
	h.enqueueSuccess(t, "task-same")
	h.enqueueSuccess(t, "task-same")
	if h.recorder.Pending() != 1 {
		t.Fatalf("Pending = %d, want 1", h.recorder.Pending())
	}
}

// ─── Deterministic ids ──────────────────────────────────────────────────────

func TestAppFirstOpenIDIsDeterministic(t *testing.T) {
	want := "afo_6f1b2c3d4e5f60718293a4b5c6d7e8f9"
	if got := AppFirstOpenID(testInstance); got != want {
		t.Fatalf("AppFirstOpenID = %q, want %q", got, want)
	}
	if AppFirstOpenID(testInstance) != AppFirstOpenID(testInstance) {
		t.Fatal("AppFirstOpenID is not stable")
	}
	if got := FirstDocumentSuccessID(testInstance); got != "fds_6f1b2c3d4e5f60718293a4b5c6d7e8f9" {
		t.Fatalf("FirstDocumentSuccessID = %q", got)
	}
	// Both must survive the id pattern, which is the reason the dashes go.
	for _, id := range []string{AppFirstOpenID(testInstance), FirstDocumentSuccessID(testInstance)} {
		if !idPattern.MatchString(id) {
			t.Errorf("id %q does not match the contract pattern", id)
		}
	}
}

// §4: a task id outside the id character class is replaced by a hash, not
// sanitised in place — two tasks differing only in illegal characters must not
// collapse into one id.
func TestTaskIDsOutsideTheCharacterClassAreHashed(t *testing.T) {
	a := DocumentSuccessID("task/one")
	b := DocumentSuccessID("task:one")
	if a == b {
		t.Fatal("two different task ids produced the same event id")
	}
	for _, id := range []string{a, b} {
		if !idPattern.MatchString(id) {
			t.Errorf("hashed id %q does not match the contract pattern", id)
		}
		if !strings.HasPrefix(id, "ds_") || len(id) != len("ds_")+32 {
			t.Errorf("hashed id %q is not ds_ + 32 hex characters", id)
		}
	}
	if DocumentSuccessID("task/one") != a {
		t.Fatal("hashed ids are not stable across calls")
	}
	// A very long task id would overflow the 100-character limit.
	long := DocumentSuccessID(strings.Repeat("t", 200))
	if !idPattern.MatchString(long) {
		t.Errorf("id for a very long task %q does not match the contract pattern", long)
	}
}

func TestUserIDOnlyAcceptsANumericPlatformID(t *testing.T) {
	if got, ok := UserID("42"); !ok || got != "u:42" {
		t.Fatalf("UserID(42) = %q, %v", got, ok)
	}
	for _, input := range []string{"", "  ", "person@example.com", "usr-1", "u:42"} {
		if got, ok := UserID(input); ok {
			t.Errorf("UserID(%q) = %q, want it refused", input, got)
		}
	}
}

func TestUserIDIsAttachedToLaterEvents(t *testing.T) {
	h := newHarness(t)
	h.recorder.SetPlatformUserID("42")
	h.enqueueSuccess(t, "task-identified")
	h.recorder.Flush(context.Background())
	if got := h.collector.batch(0)[0].UserID; got != "u:42" {
		t.Fatalf("userId = %q, want u:42", got)
	}

	h.recorder.SetPlatformUserID("")
	h.enqueueSuccess(t, "task-anonymous")
	h.recorder.Flush(context.Background())
	if got := h.collector.batch(1)[0].UserID; got != "" {
		t.Fatalf("userId after logout = %q, want empty", got)
	}
}

// ─── Per-install events ─────────────────────────────────────────────────────

func TestAppFirstOpenIsQueuedOnceWithTheInstallsRealDate(t *testing.T) {
	h := newHarness(t)
	created := h.clock.Now().Add(-20 * 24 * time.Hour)
	createdRaw := created.Format(time.RFC3339Nano)

	if err := h.recorder.RecordAppFirstOpen(testInstance, createdRaw); err != nil {
		t.Fatalf("RecordAppFirstOpen: %v", err)
	}
	if err := h.recorder.RecordAppFirstOpen(testInstance, createdRaw); err != nil {
		t.Fatalf("RecordAppFirstOpen (second): %v", err)
	}
	if h.recorder.Pending() != 1 {
		t.Fatalf("Pending = %d, want 1: app_first_open is a once-per-install event", h.recorder.Pending())
	}
	h.recorder.Flush(context.Background())
	event := h.collector.batch(0)[0]
	if event.Name != EventAppFirstOpen {
		t.Fatalf("name = %q", event.Name)
	}
	if event.At != FormatAt(created) {
		t.Fatalf("at = %q, want the install's creation time %q", event.At, FormatAt(created))
	}
	if event.Subject != "inst:"+testInstance {
		t.Fatalf("subject = %q", event.Subject)
	}

	// A restart must not queue it again: the marker is durable.
	restarted, err := New(Options{Dir: h.dir, Subject: Subject(testInstance), Endpoint: h.server.URL, Enabled: true, Now: h.clock.Now})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if err := restarted.RecordAppFirstOpen(testInstance, createdRaw); err != nil {
		t.Fatalf("RecordAppFirstOpen after restart: %v", err)
	}
	if restarted.Pending() != 0 {
		t.Fatalf("Pending after restart = %d, want 0", restarted.Pending())
	}
}

// An install older than the collector's acceptance window cannot have its first
// open stated truthfully, and back-dating it to the window's edge would invent
// a date. It is skipped and marked, not retried every launch.
func TestAppFirstOpenIsSkippedForAnInstallOlderThanTheWindow(t *testing.T) {
	h := newHarness(t)
	created := h.clock.Now().Add(-100 * 24 * time.Hour).Format(time.RFC3339Nano)
	if err := h.recorder.RecordAppFirstOpen(testInstance, created); err != nil {
		t.Fatalf("RecordAppFirstOpen: %v", err)
	}
	if h.recorder.Pending() != 0 {
		t.Fatalf("Pending = %d, want 0", h.recorder.Pending())
	}
	if got := h.recorder.markers().AppFirstOpen; got != markerOutOfWindow {
		t.Fatalf("marker = %q, want %q so it is not retried every launch", got, markerOutOfWindow)
	}
}

// §5: the two events are sent together, as two rows with different ids, and
// first_document_success only ever once.
func TestFirstDocumentSuccessAccompaniesTheFirstSuccessOnly(t *testing.T) {
	h := newHarness(t)
	if err := h.recorder.RecordDocumentSuccess(testInstance, "task-1", h.clock.Now()); err != nil {
		t.Fatalf("RecordDocumentSuccess: %v", err)
	}
	if err := h.recorder.RecordDocumentSuccess(testInstance, "task-2", h.clock.Now()); err != nil {
		t.Fatalf("RecordDocumentSuccess: %v", err)
	}
	h.recorder.Flush(context.Background())

	names := map[string]int{}
	for _, event := range h.collector.batch(0) {
		names[event.Name]++
	}
	if names[EventDocumentSuccess] != 2 {
		t.Fatalf("document_success count = %d, want 2", names[EventDocumentSuccess])
	}
	if names[EventFirstDocumentSuccess] != 1 {
		t.Fatalf("first_document_success count = %d, want 1", names[EventFirstDocumentSuccess])
	}
}

// An install that already had finished documents when reporting started must
// not report a later run as its first success.
func TestHistoryBeforeTrackingSuppressesFirstDocumentSuccess(t *testing.T) {
	h := newHarness(t)
	h.recorder.NoteHistoryBeforeTracking()
	if !h.recorder.FirstDocumentSuccessSettled() {
		t.Fatal("FirstDocumentSuccessSettled = false after NoteHistoryBeforeTracking")
	}
	if err := h.recorder.RecordDocumentSuccess(testInstance, "task-later", h.clock.Now()); err != nil {
		t.Fatalf("RecordDocumentSuccess: %v", err)
	}
	h.recorder.Flush(context.Background())
	for _, event := range h.collector.batch(0) {
		if event.Name == EventFirstDocumentSuccess {
			t.Fatal("first_document_success was sent for an install whose real first success predates tracking")
		}
	}
	if len(h.collector.batch(0)) != 1 {
		t.Fatalf("batch = %d events, want just the document_success", len(h.collector.batch(0)))
	}
}

// NoteHistoryBeforeTracking is called on every launch; once the first success
// has actually been reported it must not rewrite the marker.
func TestHistoryNoteDoesNotOverwriteAnAlreadyReportedFirstSuccess(t *testing.T) {
	h := newHarness(t)
	if err := h.recorder.RecordDocumentSuccess(testInstance, "task-1", h.clock.Now()); err != nil {
		t.Fatalf("RecordDocumentSuccess: %v", err)
	}
	h.recorder.NoteHistoryBeforeTracking()
	if got := h.recorder.markers().FirstDocumentSuccess; got != markerEnqueued {
		t.Fatalf("marker = %q, want %q", got, markerEnqueued)
	}
}

func TestGenerationFailedCarriesNoDetail(t *testing.T) {
	h := newHarness(t)
	if err := h.recorder.RecordGenerationFailed("task-failed", h.clock.Now()); err != nil {
		t.Fatalf("RecordGenerationFailed: %v", err)
	}
	h.recorder.Flush(context.Background())
	event := h.collector.batch(0)[0]
	if event.Name != EventGenerationFailed || event.ID != "gf_task-failed" {
		t.Fatalf("event = %+v", event)
	}
	// Marshalled shape, so a field added later without thinking shows up here.
	raw, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	var fields map[string]any
	if err := json.Unmarshal(raw, &fields); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	for key := range fields {
		switch key {
		case "id", "subject", "name", "at", "userId":
		default:
			t.Errorf("event carries an unexpected field %q; the contract forbids error text and paths", key)
		}
	}
}

// ─── Outbox cap ─────────────────────────────────────────────────────────────

// The cap drops the oldest ordinary event, never one of the two that happen
// once in an install's lifetime.
func TestOutboxCapNeverDropsAPerInstallEvent(t *testing.T) {
	h := newHarness(t, func(o *Options) { o.MaxOutbox = 5 })
	if err := h.recorder.RecordAppFirstOpen(testInstance, h.clock.Now().Format(time.RFC3339)); err != nil {
		t.Fatalf("RecordAppFirstOpen: %v", err)
	}
	for i := 0; i < 20; i++ {
		h.enqueueSuccess(t, "task-cap-"+itoa(i))
	}
	if got := h.recorder.Pending(); got != 5 {
		t.Fatalf("Pending = %d, want the cap of 5", got)
	}
	h.recorder.Flush(context.Background())
	found := false
	for _, event := range h.collector.batch(0) {
		if event.Name == EventAppFirstOpen {
			found = true
		}
	}
	if !found {
		t.Fatal("app_first_open was evicted by the outbox cap")
	}
}

// An event that aged out while the machine was offline can only be rejected,
// so it is dropped locally rather than retried forever.
func TestStaleEventsAreDroppedWithoutASend(t *testing.T) {
	h := newHarness(t)
	h.enqueueSuccess(t, "task-stale")
	h.clock.advance(91 * 24 * time.Hour)
	h.recorder.Flush(context.Background())
	if h.collector.calls() != 0 {
		t.Fatalf("collector calls = %d, want 0", h.collector.calls())
	}
	if h.recorder.Pending() != 0 {
		t.Fatalf("Pending = %d, want 0", h.recorder.Pending())
	}
}

// ─── Loop and shutdown ──────────────────────────────────────────────────────

func TestStartFlushesWhatThePreviousSessionLeft(t *testing.T) {
	h := newHarness(t, func(o *Options) { o.FlushDebounce = time.Millisecond })
	h.enqueueSuccess(t, "task-loop")
	h.recorder.Start()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) && h.recorder.Pending() > 0 {
		time.Sleep(5 * time.Millisecond)
	}
	if h.recorder.Pending() != 0 {
		t.Fatalf("Pending = %d, want the loop to have drained it", h.recorder.Pending())
	}
	h.recorder.Stop(time.Second)
}

// Quitting must not hang on an unreachable collector.
func TestStopIsBoundedByItsTimeout(t *testing.T) {
	blocked := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		<-blocked
	}))
	// Cleanups run last-registered-first, so the handler is released before
	// Close waits on it. Registering these the other way round deadlocks the
	// whole package: Close blocks on a request that is waiting for Close.
	t.Cleanup(server.Close)
	t.Cleanup(func() { close(blocked) })

	recorder, err := New(Options{
		Dir:            t.TempDir(),
		Subject:        Subject(testInstance),
		Endpoint:       server.URL,
		Enabled:        true,
		RequestTimeout: 2 * time.Second,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if err := recorder.Enqueue(EventDocumentSuccess, DocumentSuccessID("task-hang"), time.Now()); err != nil {
		t.Fatalf("Enqueue: %v", err)
	}
	started := time.Now()
	recorder.Stop(150 * time.Millisecond)
	if elapsed := time.Since(started); elapsed > 2*time.Second {
		t.Fatalf("Stop took %s; it must not block the quit path", elapsed)
	}
}

// ─── Artifact validity ──────────────────────────────────────────────────────

func TestArtifactUsable(t *testing.T) {
	dir := t.TempDir()

	missing := filepath.Join(dir, "gone.pptx")
	if err := ArtifactUsable(missing); err == nil {
		t.Error("a missing file was accepted")
	}

	empty := filepath.Join(dir, "empty.pptx")
	if err := os.WriteFile(empty, nil, 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := ArtifactUsable(empty); err == nil {
		t.Error("an empty file was accepted")
	}

	corrupt := filepath.Join(dir, "corrupt.pptx")
	if err := os.WriteFile(corrupt, []byte("this is not a deck"), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := ArtifactUsable(corrupt); err == nil {
		t.Error("a file that is not a zip container was accepted as a .pptx")
	}

	truncated := filepath.Join(dir, "truncated.docx")
	whole := buildOOXML(t, filepath.Join(dir, "whole.docx"))
	if err := os.WriteFile(truncated, whole[:len(whole)/2], 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := ArtifactUsable(truncated); err == nil {
		t.Error("a truncated zip was accepted: its central directory is gone")
	}

	if err := ArtifactUsable(filepath.Join(dir, "whole.docx")); err != nil {
		t.Errorf("a real OOXML package was rejected: %v", err)
	}

	// A non-OOXML output only has to exist and be non-empty.
	image := filepath.Join(dir, "chart.png")
	if err := os.WriteFile(image, []byte{0x89, 'P', 'N', 'G'}, 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := ArtifactUsable(image); err != nil {
		t.Errorf("a non-empty image was rejected: %v", err)
	}
	if err := ArtifactUsable(dir); err == nil {
		t.Error("a directory was accepted")
	}
	if err := ArtifactUsable("  "); err == nil {
		t.Error("an empty path was accepted")
	}
}

func buildOOXML(t *testing.T, path string) []byte {
	t.Helper()
	file, err := os.Create(path)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	writer := zip.NewWriter(file)
	entry, err := writer.Create("[Content_Types].xml")
	if err != nil {
		t.Fatalf("zip create: %v", err)
	}
	if _, err := entry.Write([]byte(strings.Repeat("<Types/>", 200))); err != nil {
		t.Fatalf("zip write: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("zip close: %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	return raw
}
