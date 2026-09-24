// Package opstelemetry reports the four desktop product-usage events defined
// by ops-bridge/docs/event-contract.md — app_first_open, document_success,
// first_document_success and generation_failed — to the platform collector.
//
// What it is not: this is not diagnostics, not crash reporting and not an
// analytics SDK. It sends four counters keyed by an anonymous install id and
// nothing else. The contract forbids file names, paths, prompts, document
// content and error text, so no event carries a free-form field at all — the
// event object has room for exactly id/subject/name/at/userId and this package
// never populates more than those.
//
// Delivery is at-least-once with server-side de-duplication: every event id is
// deterministic (§4 of the contract), so a retry, a replayed task event or a
// second install of the same machine all collapse to one row. That is what lets
// the outbox retry forever without bookkeeping about what the server already
// holds.
package opstelemetry

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"regexp"
	"strings"
	"time"
)

// Event names this client is allowed to send. The collector keeps its own
// per-channel allowlist; this one exists so a typo cannot reach the network.
const (
	EventAppFirstOpen         = "app_first_open"
	EventFirstDocumentSuccess = "first_document_success"
	EventDocumentSuccess      = "document_success"
	EventGenerationFailed     = "generation_failed"
)

// Deterministic id prefixes (contract §4).
const (
	idPrefixAppFirstOpen         = "afo_"
	idPrefixFirstDocumentSuccess = "fds_"
	idPrefixDocumentSuccess      = "ds_"
	idPrefixGenerationFailed     = "gf_"
)

const (
	idMinLen      = 8
	idMaxLen      = 100
	subjectMinLen = 3
	subjectMaxLen = 128
	userIDMaxLen  = 128
)

var (
	idPattern      = regexp.MustCompile(`^[A-Za-z0-9_-]{8,100}$`)
	subjectPattern = regexp.MustCompile(`^[A-Za-z0-9_:-]{3,128}$`)
	userIDPattern  = regexp.MustCompile(`^[A-Za-z0-9_:-]{1,128}$`)
	// taskIDSafe is the character class an id may carry verbatim. A task id
	// outside it is replaced by a hash rather than sanitised in place, because
	// stripping characters can make two different tasks share one id.
	taskIDSafe = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)
	// platformUserID is deliberately digits-only. The contract says userId is
	// the platform's internal numeric id and explicitly not an email, so an
	// id that is not a number is treated as "no id available" rather than
	// forwarded and hoped for.
	platformUserID = regexp.MustCompile(`^[0-9]{1,120}$`)
)

// Clock skew and staleness bounds the collector enforces (contract §2). They
// are applied here too so an event that would certainly be rejected is never
// enqueued, and one that went stale while the machine was offline is dropped
// rather than retried forever.
const (
	MaxFuture  = 5 * time.Minute
	MaxBacklog = 90 * 24 * time.Hour
)

// Event is the wire object. Field set is the whole of what the desktop channel
// may send: the optional attribution fields (source/medium/campaign/content/
// actionId) belong to the website channel, and `path` has no meaning for a
// desktop app.
type Event struct {
	ID      string `json:"id"`
	Subject string `json:"subject"`
	Name    string `json:"name"`
	At      string `json:"at"`
	UserID  string `json:"userId,omitempty"`
}

// Subject returns the `inst:<desktop_instance_id>` subject for this install.
func Subject(instanceID string) string {
	return "inst:" + strings.TrimSpace(instanceID)
}

// UserID converts a platform user id into the contract's `u:<id>` form. The
// second result is false when the value is absent or is not a numeric platform
// id — an email, a session token or an opaque string all fail here, and the
// caller must then send no userId at all.
func UserID(platformID string) (string, bool) {
	trimmed := strings.TrimSpace(platformID)
	if !platformUserID.MatchString(trimmed) {
		return "", false
	}
	return "u:" + trimmed, true
}

// InstanceEventID builds the per-install deterministic id: the instance uuid
// with its dashes removed, so `afo_`/`fds_` land inside the id character class.
func InstanceEventID(prefix, instanceID string) string {
	compact := strings.ReplaceAll(strings.TrimSpace(instanceID), "-", "")
	return prefix + compact
}

// TaskEventID builds `ds_<task_id>` / `gf_<task_id>`, falling back to the
// contract's sha256 substitution when the task id carries characters the id
// pattern does not allow, or when the result would not fit the length window.
func TaskEventID(prefix, taskID string) string {
	trimmed := strings.TrimSpace(taskID)
	candidate := prefix + trimmed
	if taskIDSafe.MatchString(trimmed) && len(candidate) >= idMinLen && len(candidate) <= idMaxLen {
		return candidate
	}
	sum := sha256.Sum256([]byte(trimmed))
	return prefix + hex.EncodeToString(sum[:])[:32]
}

// AppFirstOpenID / FirstDocumentSuccessID / DocumentSuccessID /
// GenerationFailedID are the four id constructors, named so call sites read as
// the contract table does.
func AppFirstOpenID(instanceID string) string {
	return InstanceEventID(idPrefixAppFirstOpen, instanceID)
}

func FirstDocumentSuccessID(instanceID string) string {
	return InstanceEventID(idPrefixFirstDocumentSuccess, instanceID)
}

func DocumentSuccessID(taskID string) string {
	return TaskEventID(idPrefixDocumentSuccess, taskID)
}

func GenerationFailedID(taskID string) string {
	return TaskEventID(idPrefixGenerationFailed, taskID)
}

// FormatAt renders a timestamp the way the contract requires: ISO 8601 in UTC,
// second precision, `Z` suffix.
func FormatAt(at time.Time) string {
	return at.UTC().Format("2006-01-02T15:04:05Z")
}

// NormalizeAt re-renders an already-formatted timestamp (instance.json stores
// RFC3339 with nanoseconds, which the collector accepts but which carries more
// precision than an event needs). An unparseable value is returned unchanged so
// Validate rejects it with a message about the actual content.
func NormalizeAt(raw string) string {
	parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(raw))
	if err != nil {
		return strings.TrimSpace(raw)
	}
	return FormatAt(parsed)
}

func isAllowedName(name string) bool {
	switch name {
	case EventAppFirstOpen, EventFirstDocumentSuccess, EventDocumentSuccess, EventGenerationFailed:
		return true
	default:
		return false
	}
}

// Validate mirrors the collector's own checks (contract §2) so an event that
// would be rejected never enters the outbox. `now` is the reference for the
// clock-skew and staleness windows.
func (e Event) Validate(now time.Time) error {
	if !idPattern.MatchString(e.ID) {
		return fmt.Errorf("opstelemetry: id %q does not match ^[A-Za-z0-9_-]{%d,%d}$", e.ID, idMinLen, idMaxLen)
	}
	if !subjectPattern.MatchString(e.Subject) {
		return fmt.Errorf("opstelemetry: subject %q does not match ^[A-Za-z0-9_:-]{%d,%d}$", e.Subject, subjectMinLen, subjectMaxLen)
	}
	if !isAllowedName(e.Name) {
		return fmt.Errorf("opstelemetry: event name %q is not a desktop event", e.Name)
	}
	if !strings.HasSuffix(e.At, "Z") {
		return fmt.Errorf("opstelemetry: at %q must be UTC and end with Z", e.At)
	}
	at, err := time.Parse(time.RFC3339, e.At)
	if err != nil {
		return fmt.Errorf("opstelemetry: at %q is not ISO 8601: %w", e.At, err)
	}
	if at.After(now.Add(MaxFuture)) {
		return fmt.Errorf("opstelemetry: at %q is more than %s ahead of the local clock", e.At, MaxFuture)
	}
	if at.Before(now.Add(-MaxBacklog)) {
		return fmt.Errorf("opstelemetry: at %q is older than the %s acceptance window", e.At, MaxBacklog)
	}
	if e.UserID != "" && !userIDPattern.MatchString(e.UserID) {
		return fmt.Errorf("opstelemetry: userId %q does not match ^[A-Za-z0-9_:-]{1,%d}$", e.UserID, userIDMaxLen)
	}
	if strings.Contains(e.UserID, "@") {
		return fmt.Errorf("opstelemetry: userId must be a platform id, not an email")
	}
	return nil
}

// Stale reports whether an event has aged out of the collector's acceptance
// window while it sat in the outbox. Such an event can only ever be rejected,
// so the flush drops it instead of retrying it forever.
func (e Event) Stale(now time.Time) bool {
	at, err := time.Parse(time.RFC3339, e.At)
	if err != nil {
		return true
	}
	return at.Before(now.Add(-MaxBacklog))
}

// Durable reports whether an event must survive the outbox cap. The two
// per-install events happen once in the lifetime of a machine; a
// document_success can be reconstructed from the next one, a first open cannot.
func (e Event) Durable() bool {
	return e.Name == EventAppFirstOpen || e.Name == EventFirstDocumentSuccess
}
