package opstelemetry

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// Contract v1.1: app_open, login, update_installed and the device fields.

func withDevice(version string) func(*Options) {
	return func(o *Options) { o.Device = NewDevice(version, "1.0", "darwin", "arm64") }
}

// sent flushes and returns every event the collector received, in order.
func (h *harness) sent(t *testing.T) []Event {
	t.Helper()
	h.recorder.Flush(context.Background())
	var all []Event
	for i := 0; i < h.collector.calls(); i++ {
		all = append(all, h.collector.batch(i)...)
	}
	return all
}

func names(events []Event) []string {
	out := make([]string, 0, len(events))
	for _, event := range events {
		out = append(out, event.Name)
	}
	return out
}

func reopen(t *testing.T, h *harness, mutate ...func(*Options)) *harness {
	t.Helper()
	options := append([]func(*Options){func(o *Options) { o.Dir = h.dir; o.Endpoint = h.server.URL; o.Now = h.clock.Now }}, mutate...)
	next := newHarness(t, options...)
	next.collector, next.clock, next.server, next.dir = h.collector, h.clock, h.server, h.dir
	return next
}

func TestNewDeviceMapsGoNamesOntoTheContract(t *testing.T) {
	cases := []struct {
		version, channel, goos, goarch string
		want                           Device
	}{
		{"1.0.9", "1.0", "darwin", "arm64", Device{"1.0.9", "1.0", "macos", "arm64"}},
		{"v0.5.43", "stable", "windows", "amd64", Device{"0.5.43", "stable", "windows", "x64"}},
		// A development build has no version to report, and says so by omission.
		{"dev", "1.0", "darwin", "arm64", Device{"", "1.0", "macos", "arm64"}},
		{"1.0.0-beta.2", "", "freebsd", "riscv64", Device{}},
	}
	for _, tc := range cases {
		if got := NewDevice(tc.version, tc.channel, tc.goos, tc.goarch); got != tc.want {
			t.Errorf("NewDevice(%q,%q,%q,%q) = %+v, want %+v", tc.version, tc.channel, tc.goos, tc.goarch, got, tc.want)
		}
	}
}

func TestDocTypeIsAClosedSet(t *testing.T) {
	for input, want := range map[string]string{
		"pptx": "pptx", "DOCX": "docx", "xlsx": "xlsx", "image": "image", "png": "image",
		"report": "report", "": "", "Q3 board deck.pptx": "other", "../../etc/passwd": "other",
	} {
		if got := DocType(input); got != want {
			t.Errorf("DocType(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestEveryEventCarriesTheDevice(t *testing.T) {
	h := newHarness(t, withDevice("1.0.9"))
	if err := h.recorder.RecordDocumentSuccess(testInstance, "task-1", "pptx", h.clock.Now()); err != nil {
		t.Fatal(err)
	}
	events := h.sent(t)
	if len(events) != 2 {
		t.Fatalf("events = %v, want document_success and first_document_success", names(events))
	}
	for _, event := range events {
		if event.AppVersion != "1.0.9" || event.AppChannel != "1.0" || event.OS != "macos" || event.Arch != "arm64" || event.DocType != "pptx" {
			t.Errorf("%s = %+v, want the device and the doc type", event.Name, event)
		}
	}
}

func TestDocTypeNeverReachesAnEventThatIsNotAboutADocument(t *testing.T) {
	err := Event{ID: "ao_abcdefgh", Subject: Subject(testInstance), Name: EventAppOpen,
		At: FormatAt(time.Now()), DocType: "pptx"}.Validate(time.Now())
	if err == nil || !strings.Contains(err.Error(), "docType is not accepted") {
		t.Fatalf("Validate = %v, want a docType refusal", err)
	}
}

func TestNoEventHasAFieldOutsideTheContract(t *testing.T) {
	h := newHarness(t, withDevice("1.0.9"))
	_ = h.recorder.ObserveIdentity(testInstance, "", h.clock.Now())
	_ = h.recorder.ObserveIdentity(testInstance, "42", h.clock.Now())
	_ = h.recorder.RecordAppOpen(testInstance, h.clock.Now())
	_ = h.recorder.RecordDocumentSuccess(testInstance, "task-1", "docx", h.clock.Now())
	allowed := map[string]bool{"id": true, "subject": true, "name": true, "at": true, "userId": true,
		"appVersion": true, "appChannel": true, "os": true, "arch": true, "docType": true}
	for _, event := range h.sent(t) {
		raw, _ := json.Marshal(event)
		var fields map[string]any
		_ = json.Unmarshal(raw, &fields)
		for field := range fields {
			if !allowed[field] {
				t.Errorf("%s carries %q, which the contract does not define", event.Name, field)
			}
		}
	}
}

func TestAppOpenIsOncePerUTCDay(t *testing.T) {
	h := newHarness(t)
	for range 3 {
		if err := h.recorder.RecordAppOpen(testInstance, h.clock.Now()); err != nil {
			t.Fatal(err)
		}
	}
	h.clock.advance(24 * time.Hour)
	if err := h.recorder.RecordAppOpen(testInstance, h.clock.Now()); err != nil {
		t.Fatal(err)
	}
	events := h.sent(t)
	if len(events) != 2 {
		t.Fatalf("events = %d, want one per day", len(events))
	}
	if events[0].ID != "ao_6f1b2c3d4e5f60718293a4b5c6d7e8f9_20260924" || events[1].ID != "ao_6f1b2c3d4e5f60718293a4b5c6d7e8f9_20260925" {
		t.Errorf("ids = %q, %q", events[0].ID, events[1].ID)
	}
}

func TestAppOpenOnTheSameDayAfterARestartIsNotQueuedAgain(t *testing.T) {
	h := newHarness(t)
	_ = h.recorder.RecordAppOpen(testInstance, h.clock.Now())
	h.sent(t)
	again := reopen(t, h)
	_ = again.recorder.RecordAppOpen(testInstance, h.clock.Now())
	if again.recorder.Pending() != 0 {
		t.Fatalf("pending = %d, want 0", again.recorder.Pending())
	}
}

func TestLoginIsAWitnessedChangeOfAccount(t *testing.T) {
	h := newHarness(t)
	observe := func(id string) {
		t.Helper()
		if err := h.recorder.ObserveIdentity(testInstance, id, h.clock.Now()); err != nil {
			t.Fatal(err)
		}
	}
	observe("")   // first look: signed out. A baseline.
	observe("42") // signs in.
	observe("42") // the shell asks again. Same account, nothing happened.
	observe("")   // signs out.
	observe("77") // somebody else signs in.

	events := h.sent(t)
	if got := names(events); len(got) != 2 || got[0] != EventLogin || got[1] != EventLogin {
		t.Fatalf("events = %v, want two logins", got)
	}
	if events[0].UserID != "u:42" || events[1].UserID != "u:77" {
		t.Errorf("userIds = %q, %q", events[0].UserID, events[1].UserID)
	}
	if events[0].ID != "li_6f1b2c3d4e5f60718293a4b5c6d7e8f9_42_20260924" {
		t.Errorf("id = %q", events[0].ID)
	}
}

func TestAnAccountAlreadySignedInIsNotALogin(t *testing.T) {
	h := newHarness(t)
	// The build that learned to report logins starts on a machine whose user
	// signed in weeks ago.
	_ = h.recorder.ObserveIdentity(testInstance, "42", h.clock.Now())
	// And every launch after that finds the same account.
	again := reopen(t, h)
	_ = again.recorder.ObserveIdentity(testInstance, "42", h.clock.Now())

	if events := again.sent(t); len(events) != 0 {
		t.Fatalf("events = %v, want none", names(events))
	}
	// The account is still attached to what happens next.
	_ = again.recorder.RecordAppOpen(testInstance, h.clock.Now())
	if events := again.sent(t); len(events) != 1 || events[0].UserID != "u:42" {
		t.Fatalf("events = %+v, want app_open from u:42", events)
	}
}

func TestSomethingThatIsNotAPlatformIDIsSignedOut(t *testing.T) {
	h := newHarness(t)
	_ = h.recorder.ObserveIdentity(testInstance, "", h.clock.Now())
	for _, id := range []string{"someone@example.com", "sk-live-abc", "u:42"} {
		if err := h.recorder.ObserveIdentity(testInstance, id, h.clock.Now()); err != nil {
			t.Fatal(err)
		}
	}
	_ = h.recorder.RecordAppOpen(testInstance, h.clock.Now())
	events := h.sent(t)
	if len(events) != 1 || events[0].Name != EventAppOpen || events[0].UserID != "" {
		t.Fatalf("events = %+v, want one anonymous app_open", events)
	}
}

func TestUpdateInstalledNeedsANewerVersionThanLastTime(t *testing.T) {
	h := newHarness(t, withDevice("1.0.8"))
	record := func(h *harness) {
		t.Helper()
		if err := h.recorder.RecordVersion(testInstance, h.clock.Now()); err != nil {
			t.Fatal(err)
		}
	}
	record(h) // first sighting: a baseline, not an update.
	same := reopen(t, h, withDevice("1.0.8"))
	record(same)
	newer := reopen(t, h, withDevice("1.0.10"))
	record(newer)
	record(newer)
	if events := newer.sent(t); len(events) != 1 {
		t.Fatalf("events = %v, want one update_installed", names(events))
	}
	older := reopen(t, h, withDevice("1.0.9"))
	record(older) // a downgrade moves the baseline silently.
	back := reopen(t, h, withDevice("1.0.10"))
	record(back) // and coming back up is reported again, under the same id,
	// which is what lets the collector count it once.

	events := back.sent(t)
	if len(events) != 2 {
		t.Fatalf("events = %v, want the update sent twice", names(events))
	}
	for _, event := range events {
		if event.Name != EventUpdateInstalled || event.ID != "ui_6f1b2c3d4e5f60718293a4b5c6d7e8f9_1-0-10" {
			t.Errorf("event = %+v", event)
		}
	}
}

func TestADevelopmentBuildReportsNoUpdate(t *testing.T) {
	h := newHarness(t, withDevice("1.0.8"))
	_ = h.recorder.RecordVersion(testInstance, h.clock.Now())
	dev := reopen(t, h, withDevice("dev"))
	_ = dev.recorder.RecordVersion(testInstance, h.clock.Now())
	release := reopen(t, h, withDevice("1.0.8"))
	_ = release.recorder.RecordVersion(testInstance, h.clock.Now())
	if events := release.sent(t); len(events) != 0 {
		t.Fatalf("events = %v, want none", names(events))
	}
}

func TestCompareVersionsIsNumeric(t *testing.T) {
	cases := []struct {
		a, b  string
		order int
		ok    bool
	}{
		{"1.0.10", "1.0.9", 1, true}, {"1.0.9", "1.0.10", -1, true}, {"1.0.9", "1.0.9", 0, true},
		{"1.1.0", "1.0.99", 1, true}, {"dev", "1.0.9", 0, false}, {"1.0.9", "", 0, false},
	}
	for _, tc := range cases {
		order, ok := CompareVersions(tc.a, tc.b)
		if order != tc.order || ok != tc.ok {
			t.Errorf("CompareVersions(%q,%q) = %d,%v want %d,%v", tc.a, tc.b, order, ok, tc.order, tc.ok)
		}
	}
}

func TestTurningReportingOffStopsTheNewEventsToo(t *testing.T) {
	h := newHarness(t, withDevice("1.0.9"))
	h.recorder.SetEnabled(false)
	_ = h.recorder.RecordAppOpen(testInstance, h.clock.Now())
	_ = h.recorder.RecordVersion(testInstance, h.clock.Now())
	_ = h.recorder.ObserveIdentity(testInstance, "", h.clock.Now())
	_ = h.recorder.ObserveIdentity(testInstance, "42", h.clock.Now())
	if h.recorder.Pending() != 0 {
		t.Fatalf("pending = %d, want 0", h.recorder.Pending())
	}
	if events := h.sent(t); len(events) != 0 {
		t.Fatalf("events = %v, want none", names(events))
	}
}
