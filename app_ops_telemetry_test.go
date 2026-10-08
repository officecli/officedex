package main

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

	"officedex/internal/localstore"
	"officedex/internal/netproxy"
	"officedex/internal/opstelemetry"
	"officedex/internal/types"
)

const opsTestInstance = "11112222-3333-4444-5555-666677778888"

// opsCollector stands in for the platform collector. The app-level tests care
// about which events were produced, so it indexes them by name.
type opsCollector struct {
	mu     sync.Mutex
	events []opstelemetry.Event
}

func (c *opsCollector) server(t *testing.T) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Events []opstelemetry.Event `json:"events"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		c.mu.Lock()
		c.events = append(c.events, body.Events...)
		c.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"accepted":` + itoaOps(len(body.Events)) + `,"duplicates":0,"rejected":[]}`))
	}))
	t.Cleanup(server.Close)
	return server
}

func itoaOps(n int) string {
	if n == 0 {
		return "0"
	}
	out := ""
	for n > 0 {
		out = string(rune('0'+n%10)) + out
		n /= 10
	}
	return out
}

func (c *opsCollector) names() map[string]int {
	c.mu.Lock()
	defer c.mu.Unlock()
	counts := map[string]int{}
	for _, event := range c.events {
		counts[event.Name]++
	}
	return counts
}

func (c *opsCollector) ids(name string) []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	var ids []string
	for _, event := range c.events {
		if event.Name == name {
			ids = append(ids, event.ID)
		}
	}
	return ids
}

// opsHarness is the smallest App that can record a task event: a real local
// store (the transition is computed inside its write transaction, so a fake
// would test nothing) and a real recorder pointed at a test collector.
type opsHarness struct {
	app       *App
	store     *localstore.Store
	collector *opsCollector
	userData  string
}

func newOpsHarness(t *testing.T) *opsHarness {
	t.Helper()
	userData := t.TempDir()
	store := localstore.New(filepath.Join(userData, "officedex.sqlite"))
	if err := store.Open(context.Background()); err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	collector := &opsCollector{}
	server := collector.server(t)
	recorder, err := opstelemetry.New(opstelemetry.Options{
		Dir:      filepath.Join(userData, "ops-telemetry"),
		Subject:  opstelemetry.Subject(opsTestInstance),
		Endpoint: server.URL,
		Enabled:  true,
	})
	if err != nil {
		t.Fatalf("opstelemetry.New: %v", err)
	}
	app := &App{
		userDataDir:       userData,
		desktopInstanceID: opsTestInstance,
		localStore:        store,
		opsTelemetry:      recorder,
		proxyPool:         netproxy.NewPool(),
	}
	return &opsHarness{app: app, store: store, collector: collector, userData: userData}
}

func (h *opsHarness) flush(t *testing.T) {
	t.Helper()
	h.app.opsTelemetry.Flush(context.Background())
}

// record drives the same path the bridge listener does: persist, then let the
// hook read the transition the store computed.
func (h *opsHarness) record(t *testing.T, event types.BridgeEvent) {
	t.Helper()
	if err := h.app.recordTaskEvent(event); err != nil {
		t.Fatalf("recordTaskEvent(%s): %v", event.Type, err)
	}
}

func writeDeck(t *testing.T, path string) {
	t.Helper()
	file, err := os.Create(path)
	if err != nil {
		t.Fatalf("create deck: %v", err)
	}
	writer := zip.NewWriter(file)
	entry, err := writer.Create("[Content_Types].xml")
	if err != nil {
		t.Fatalf("zip create: %v", err)
	}
	if _, err := entry.Write([]byte(strings.Repeat("<Types/>", 50))); err != nil {
		t.Fatalf("zip write: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("zip close: %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
}

func completedEvent(taskID, filePath string) types.BridgeEvent {
	return types.BridgeEvent{
		EventID: taskID + "-done",
		TaskID:  taskID,
		Type:    types.EventTaskCompleted,
		TS:      time.Now().UTC().Format(time.RFC3339),
		Payload: map[string]any{
			"result": map[string]any{
				"file_path":     filePath,
				"document_type": "pptx",
			},
		},
	}
}

// The central guarantee: one document_success per finished run, however many
// times the event is recorded. The bridge replays events on resume and recovery
// re-records history, so counting events rather than transitions would inflate
// the only number this funnel is built on.
func TestCompletedTaskReportsOneDocumentSuccessEvenWhenReplayed(t *testing.T) {
	h := newOpsHarness(t)
	deck := filepath.Join(t.TempDir(), "deck.pptx")
	writeDeck(t, deck)

	h.record(t, types.BridgeEvent{TaskID: "task-deck", Type: types.EventTaskStarted, TS: time.Now().UTC().Format(time.RFC3339)})
	h.record(t, completedEvent("task-deck", deck))
	// The same completion again, as a resume replay would deliver it.
	h.record(t, completedEvent("task-deck", deck))
	h.flush(t)

	counts := h.collector.names()
	if counts[opstelemetry.EventDocumentSuccess] != 1 {
		t.Fatalf("document_success = %d, want 1", counts[opstelemetry.EventDocumentSuccess])
	}
	if counts[opstelemetry.EventFirstDocumentSuccess] != 1 {
		t.Fatalf("first_document_success = %d, want 1", counts[opstelemetry.EventFirstDocumentSuccess])
	}
	if got := h.collector.ids(opstelemetry.EventDocumentSuccess); got[0] != "ds_task-deck" {
		t.Fatalf("document_success id = %q", got[0])
	}
	if got := h.collector.ids(opstelemetry.EventFirstDocumentSuccess); got[0] != opstelemetry.FirstDocumentSuccessID(opsTestInstance) {
		t.Fatalf("first_document_success id = %q", got[0])
	}
}

// The second finished document is a success but not a first one.
func TestSecondDocumentSendsNoFirstSuccess(t *testing.T) {
	h := newOpsHarness(t)
	dir := t.TempDir()
	for _, taskID := range []string{"task-one", "task-two"} {
		deck := filepath.Join(dir, taskID+".pptx")
		writeDeck(t, deck)
		h.record(t, completedEvent(taskID, deck))
	}
	h.flush(t)

	counts := h.collector.names()
	if counts[opstelemetry.EventDocumentSuccess] != 2 {
		t.Fatalf("document_success = %d, want 2", counts[opstelemetry.EventDocumentSuccess])
	}
	if counts[opstelemetry.EventFirstDocumentSuccess] != 1 {
		t.Fatalf("first_document_success = %d, want 1", counts[opstelemetry.EventFirstDocumentSuccess])
	}
}

// §5 lists cancel under 不得触发. A user who changed their mind is neither a
// success nor a failure.
func TestCancelledTaskReportsNothing(t *testing.T) {
	h := newOpsHarness(t)
	h.record(t, types.BridgeEvent{TaskID: "task-cancel", Type: types.EventTaskStarted, TS: time.Now().UTC().Format(time.RFC3339)})
	h.record(t, types.BridgeEvent{TaskID: "task-cancel", Type: types.EventTaskCancelled, TS: time.Now().UTC().Format(time.RFC3339)})
	h.flush(t)

	if counts := h.collector.names(); len(counts) != 0 {
		t.Fatalf("a cancelled task produced %v", counts)
	}
}

func TestFailedTaskReportsGenerationFailedOnce(t *testing.T) {
	h := newOpsHarness(t)
	failed := types.BridgeEvent{
		TaskID:  "task-failed",
		Type:    types.EventTaskFailed,
		TS:      time.Now().UTC().Format(time.RFC3339),
		Payload: map[string]any{"message": "the model refused", "code": "provider_error"},
	}
	h.record(t, types.BridgeEvent{TaskID: "task-failed", Type: types.EventTaskStarted, TS: time.Now().UTC().Format(time.RFC3339)})
	h.record(t, failed)
	h.record(t, failed)
	h.flush(t)

	counts := h.collector.names()
	if counts[opstelemetry.EventGenerationFailed] != 1 {
		t.Fatalf("generation_failed = %d, want 1", counts[opstelemetry.EventGenerationFailed])
	}
	if counts[opstelemetry.EventDocumentSuccess] != 0 {
		t.Fatalf("a failed task produced a document_success")
	}
	h.collector.mu.Lock()
	event := h.collector.events[0]
	h.collector.mu.Unlock()
	if event.ID != "gf_task-failed" {
		t.Fatalf("id = %q", event.ID)
	}
	// Nothing from the payload may travel: the contract forbids error text.
	raw, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	for _, forbidden := range []string{"refused", "provider_error", "message", "code"} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatalf("event %s leaked %q from the failure payload", raw, forbidden)
		}
	}
}

// The bridge names a file in its result without ever checking it wrote one, so
// a run that failed to produce output reports exactly like one that succeeded.
// Counting it would inflate the funnel's only number.
func TestCompletedTaskWithAnUnusableArtifactIsNotASuccess(t *testing.T) {
	dir := t.TempDir()

	empty := filepath.Join(dir, "empty.pptx")
	if err := os.WriteFile(empty, nil, 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	corrupt := filepath.Join(dir, "corrupt.pptx")
	if err := os.WriteFile(corrupt, []byte("not a deck at all"), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}

	for name, path := range map[string]string{
		"missing": filepath.Join(dir, "never-written.pptx"),
		"empty":   empty,
		"corrupt": corrupt,
	} {
		t.Run(name, func(t *testing.T) {
			h := newOpsHarness(t)
			h.record(t, completedEvent("task-"+name, path))
			h.flush(t)
			if counts := h.collector.names(); len(counts) != 0 {
				t.Fatalf("a completed task with a %s artifact produced %v", name, counts)
			}
			// And the first-success question stays open for a later, real one.
			if h.app.opsTelemetry.FirstDocumentSuccessSettled() {
				t.Fatal("first_document_success was consumed by an unusable artifact")
			}
		})
	}
}

// A task that completes without producing a file at all (a question answered,
// an analysis) is not a document success.
func TestCompletedTaskWithoutAnArtifactIsNotASuccess(t *testing.T) {
	h := newOpsHarness(t)
	h.record(t, types.BridgeEvent{
		TaskID:  "task-no-file",
		Type:    types.EventTaskCompleted,
		TS:      time.Now().UTC().Format(time.RFC3339),
		Payload: map[string]any{"result": map[string]any{"summary": "done"}},
	})
	h.flush(t)
	if counts := h.collector.names(); len(counts) != 0 {
		t.Fatalf("a fileless completion produced %v", counts)
	}
}

// An install that upgrades into this feature already has finished documents.
// Reporting the next one as its first would show every existing install
// converting on the day they updated.
func TestPreExistingHistorySuppressesFirstDocumentSuccess(t *testing.T) {
	h := newOpsHarness(t)
	ctx := context.Background()

	// History from before usage reporting existed.
	if err := h.store.RecordEvent(types.BridgeEvent{TaskID: "old-task", Type: types.EventTaskCompleted}); err != nil {
		t.Fatalf("seed history: %v", err)
	}
	hasHistory, err := h.store.HasCompletedDocumentHistory(ctx)
	if err != nil {
		t.Fatalf("HasCompletedDocumentHistory: %v", err)
	}
	if !hasHistory {
		t.Fatal("HasCompletedDocumentHistory = false after a completed task")
	}
	h.app.seedOpsHistoryMarker(ctx)

	deck := filepath.Join(t.TempDir(), "deck.pptx")
	writeDeck(t, deck)
	h.record(t, completedEvent("task-after-upgrade", deck))
	h.flush(t)

	counts := h.collector.names()
	if counts[opstelemetry.EventDocumentSuccess] != 1 {
		t.Fatalf("document_success = %d, want 1", counts[opstelemetry.EventDocumentSuccess])
	}
	if counts[opstelemetry.EventFirstDocumentSuccess] != 0 {
		t.Fatalf("first_document_success = %d, want 0 for an install with prior history", counts[opstelemetry.EventFirstDocumentSuccess])
	}
}

// A fresh install has no history, so its first finished document really is the
// first one.
func TestFreshInstallKeepsItsFirstDocumentSuccess(t *testing.T) {
	h := newOpsHarness(t)
	h.app.seedOpsHistoryMarker(context.Background())

	deck := filepath.Join(t.TempDir(), "deck.pptx")
	writeDeck(t, deck)
	h.record(t, completedEvent("task-first-ever", deck))
	h.flush(t)

	if counts := h.collector.names(); counts[opstelemetry.EventFirstDocumentSuccess] != 1 {
		t.Fatalf("first_document_success = %d, want 1 on a fresh install", counts[opstelemetry.EventFirstDocumentSuccess])
	}
}

// A task the previous process left running is a real failure (contract §5
// counts crashes and timeouts), and the startup recovery pass is the only place
// that learns about it.
func TestInterruptedTasksReportAsGenerationFailed(t *testing.T) {
	h := newOpsHarness(t)
	ctx := context.Background()
	if err := h.store.RecordEvent(types.BridgeEvent{TaskID: "task-stranded", Type: types.EventTaskStarted}); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if err := h.app.failInterruptedTasks(ctx); err != nil {
		t.Fatalf("failInterruptedTasks: %v", err)
	}
	h.flush(t)

	if counts := h.collector.names(); counts[opstelemetry.EventGenerationFailed] != 1 {
		t.Fatalf("generation_failed = %d, want 1", counts[opstelemetry.EventGenerationFailed])
	}
	if got := h.collector.ids(opstelemetry.EventGenerationFailed)[0]; got != "gf_task-stranded" {
		t.Fatalf("id = %q", got)
	}
}

// A locally decided cancel takes the best-effort write path, not the bridge
// listener's. It has to be silent there too, or the hook would only cover half
// the outcomes.
func TestLocallyRecordedCancelReportsNothing(t *testing.T) {
	h := newOpsHarness(t)
	h.app.startEventWriter()
	t.Cleanup(h.app.drainEventWrites)

	if err := h.store.RecordEvent(types.BridgeEvent{TaskID: "task-user-cancel", Type: types.EventTaskStarted}); err != nil {
		t.Fatalf("seed: %v", err)
	}
	h.app.recordLocalTaskCancelled("task-user-cancel", "Task cancelled by user")
	h.app.flushEventWrites()
	h.flush(t)

	if counts := h.collector.names(); len(counts) != 0 {
		t.Fatalf("a locally recorded cancel produced %v", counts)
	}
}

// The opt-out must reach the recorder, and turning it back on must not resurrect
// what was queued while it was off.
func TestDisablingUsageAnalyticsStopsReporting(t *testing.T) {
	h := newOpsHarness(t)
	h.app.setOpsTelemetryEnabled(false)

	deck := filepath.Join(t.TempDir(), "deck.pptx")
	writeDeck(t, deck)
	h.record(t, completedEvent("task-opted-out", deck))
	h.flush(t)

	if counts := h.collector.names(); len(counts) != 0 {
		t.Fatalf("events were sent while usage reporting was off: %v", counts)
	}

	h.app.setOpsTelemetryEnabled(true)
	h.flush(t)
	if counts := h.collector.names(); len(counts) != 0 {
		t.Fatalf("turning reporting back on resurrected %v", counts)
	}
}

// A nil recorder is the state of a demo build and of any session where the
// recorder failed to start. Every hook has to tolerate it.
func TestHooksTolerateAMissingRecorder(t *testing.T) {
	userData := t.TempDir()
	store := localstore.New(filepath.Join(userData, "officedex.sqlite"))
	if err := store.Open(context.Background()); err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	app := &App{userDataDir: userData, localStore: store, desktopInstanceID: opsTestInstance}

	app.startOpsTelemetry(context.Background())
	app.seedOpsHistoryMarker(context.Background())
	app.setOpsTelemetryEnabled(false)
	app.noteOpsTelemetryIdentity(types.WhoAmIResult{Mode: types.WhoAmILoggedIn, UserID: "42"})
	app.stopOpsTelemetry()
	if err := app.recordTaskEvent(types.BridgeEvent{TaskID: "task-nil", Type: types.EventTaskFailed}); err != nil {
		t.Fatalf("recordTaskEvent with no recorder: %v", err)
	}
}

// Only a numeric platform id may be attached; an email never may (§2).
func TestIdentityHookOnlyAcceptsANumericPlatformID(t *testing.T) {
	h := newOpsHarness(t)
	h.app.noteOpsTelemetryIdentity(types.WhoAmIResult{
		Mode:   types.WhoAmILoggedIn,
		UserID: "42",
		Email:  "person@example.com",
	})
	if err := h.app.opsTelemetry.RecordGenerationFailed("task-identified", time.Now()); err != nil {
		t.Fatalf("RecordGenerationFailed: %v", err)
	}
	h.flush(t)
	h.collector.mu.Lock()
	event := h.collector.events[0]
	h.collector.mu.Unlock()
	if event.UserID != "u:42" {
		t.Fatalf("userId = %q, want u:42", event.UserID)
	}

	// Anonymous and API-key sessions have no platform user record.
	h.app.noteOpsTelemetryIdentity(types.WhoAmIResult{Mode: types.WhoAmIAnonymous, UserID: "42"})
	if err := h.app.opsTelemetry.RecordGenerationFailed("task-anonymous", time.Now()); err != nil {
		t.Fatalf("RecordGenerationFailed: %v", err)
	}
	h.flush(t)
	h.collector.mu.Lock()
	second := h.collector.events[1]
	h.collector.mu.Unlock()
	if second.UserID != "" {
		t.Fatalf("userId for an anonymous session = %q, want empty", second.UserID)
	}
}

// A dev or demo build must never look like production traffic.
func TestTestTrafficFlagFollowsTheBuild(t *testing.T) {
	original := appVersion
	t.Cleanup(func() { appVersion = original })

	appVersion = "dev"
	if !opsTelemetryTestTraffic() {
		t.Error("a build with no injected version reported as production traffic")
	}
	appVersion = "1.0.6"
	if got := opsTelemetryTestTraffic(); got != opsTelemetryDevBuild {
		t.Errorf("opsTelemetryTestTraffic() = %v on a versioned build, want %v", got, opsTelemetryDevBuild)
	}
	t.Setenv("OFFICEDEX_OPS_TEST", "1")
	if !opsTelemetryTestTraffic() {
		t.Error("OFFICEDEX_OPS_TEST=1 did not force test traffic")
	}
}
