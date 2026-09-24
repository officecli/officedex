package opstelemetry

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"math/rand"
	"net/http"
	"sync"
	"time"
)

// DefaultEndpoint is the platform collector. OFFICEDEX_OPS_COLLECT_URL
// overrides it for development; the app resolves that variable and passes the
// result in Options, so this package never reads the environment itself.
const DefaultEndpoint = "https://platform.officecli.io/api/ops/v1/collect"

const (
	// MaxBatch is the collector's per-request limit (contract §2).
	MaxBatch = 100
	// maxBodyBytes keeps a batch under the collector's 64KB body limit with
	// room to spare. A batch that would exceed it is split rather than sent
	// and refused with 413.
	maxBodyBytes = 56 * 1024

	minBackoff = 30 * time.Second
	maxBackoff = time.Hour

	// DefaultFlushDebounce is how long an enqueue waits for company before the
	// queue is sent. Generating a document produces one event, so this mostly
	// matters on startup, where first_open and a backlog arrive together.
	DefaultFlushDebounce = 5 * time.Second
	// DefaultFlushInterval is the idle sweep, for a queue left behind by a
	// failed send whose backoff has since expired.
	DefaultFlushInterval = 15 * time.Minute
	// DefaultRequestTimeout bounds one collect request.
	DefaultRequestTimeout = 20 * time.Second
)

// Options configures a Recorder. Only Dir and Subject are required; every other
// field has a working default, and the function-shaped fields are test seams.
type Options struct {
	// Dir is where outbox.json and state.json live, normally
	// <userData>/ops-telemetry.
	Dir string
	// Subject is the `inst:<id>` subject every event from this install carries.
	Subject string
	// Endpoint defaults to DefaultEndpoint.
	Endpoint string
	// HTTPClient should come from netproxy.Pool so the user's proxy setting is
	// honoured. Defaults to a plain client with DefaultRequestTimeout.
	HTTPClient *http.Client
	// ClientHeader is the X-OfficeDex-Client value, e.g. "desktop/1.0.6".
	ClientHeader string
	// TestTraffic marks the stream with X-Ops-Test: 1. Every non-release build
	// sets it, so a developer's runs never land in the production funnel.
	TestTraffic bool
	// Enabled is the initial value of the usageAnalyticsEnabled setting.
	Enabled bool
	// MaxOutbox defaults to DefaultMaxOutbox.
	MaxOutbox int

	FlushDebounce  time.Duration
	FlushInterval  time.Duration
	RequestTimeout time.Duration

	Logger *slog.Logger
	Now    func() time.Time
	// Jitter spreads retries from many installs that went offline together. It
	// receives the nominal backoff and returns the one to use.
	Jitter func(time.Duration) time.Duration
}

// Recorder owns the durable outbox and the goroutine that drains it.
//
// Every public method is safe to call from any goroutine and none of them do
// network I/O inline: Enqueue persists and returns, and the flush happens on
// the recorder's own goroutine. That matters because the callers are the task
// event writer and Wails' startup/shutdown hooks, none of which may block on a
// slow network.
type Recorder struct {
	subject        string
	endpoint       string
	client         *http.Client
	clientHeader   string
	testTraffic    bool
	requestTimeout time.Duration
	flushDebounce  time.Duration
	flushInterval  time.Duration
	logger         *slog.Logger
	now            func() time.Time
	jitter         func(time.Duration) time.Duration

	mu       sync.Mutex
	enabled  bool
	userID   string
	outbox   *outbox
	state    *stateStore
	attempts int
	nextTry  time.Time

	// flushMu serialises flushes so a shutdown flush cannot interleave with
	// the loop's. It is separate from mu because a flush must not hold mu
	// across the HTTP call.
	flushMu sync.Mutex

	startOnce sync.Once
	stopOnce  sync.Once
	wake      chan struct{}
	done      chan struct{}
	stopped   chan struct{}
}

// New loads any queue left by the previous session and returns a Recorder that
// is not yet running. Call Start to begin draining.
func New(options Options) (*Recorder, error) {
	if options.Dir == "" {
		return nil, errors.New("opstelemetry: Dir is required")
	}
	if options.Subject == "" {
		return nil, errors.New("opstelemetry: Subject is required")
	}
	logger := options.Logger
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	now := options.Now
	if now == nil {
		now = time.Now
	}
	jitter := options.Jitter
	if jitter == nil {
		jitter = defaultJitter
	}
	endpoint := options.Endpoint
	if endpoint == "" {
		endpoint = DefaultEndpoint
	}
	requestTimeout := options.RequestTimeout
	if requestTimeout <= 0 {
		requestTimeout = DefaultRequestTimeout
	}
	client := options.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: requestTimeout}
	}
	flushDebounce := options.FlushDebounce
	if flushDebounce <= 0 {
		flushDebounce = DefaultFlushDebounce
	}
	flushInterval := options.FlushInterval
	if flushInterval <= 0 {
		flushInterval = DefaultFlushInterval
	}

	recorder := &Recorder{
		subject:        options.Subject,
		endpoint:       endpoint,
		client:         client,
		clientHeader:   options.ClientHeader,
		testTraffic:    options.TestTraffic,
		requestTimeout: requestTimeout,
		flushDebounce:  flushDebounce,
		flushInterval:  flushInterval,
		logger:         logger,
		now:            now,
		jitter:         jitter,
		enabled:        options.Enabled,
		outbox:         newOutbox(options.Dir, options.MaxOutbox),
		state:          newStateStore(options.Dir),
		wake:           make(chan struct{}, 1),
		done:           make(chan struct{}),
		stopped:        make(chan struct{}),
	}
	if err := recorder.state.load(); err != nil {
		logger.Warn("ops telemetry state unreadable; per-install markers reset", slog.Any("err", err))
	}
	if err := recorder.outbox.load(); err != nil {
		logger.Warn("ops telemetry outbox unreadable; pending events dropped", slog.Any("err", err))
	}
	if !recorder.enabled {
		// The setting may have been turned off in a session that never got to
		// clear the queue (a crash, a kill). Honour it now rather than sending
		// what a previous session collected.
		recorder.clearLocked()
	}
	return recorder, nil
}

func defaultJitter(base time.Duration) time.Duration {
	if base <= 0 {
		return base
	}
	// ±20%, which is enough to break up a thundering herd of installs that all
	// came back online when a network did.
	factor := 0.8 + rand.Float64()*0.4 //nolint:gosec // jitter, not a secret
	return time.Duration(float64(base) * factor)
}

// Start launches the drain loop and flushes whatever the last session left
// behind. Calling it more than once is a no-op.
func (r *Recorder) Start() {
	r.startOnce.Do(func() {
		go r.run()
		r.nudge()
	})
}

// Stop asks the loop to exit and gives a final flush at most `timeout` to
// finish. It never blocks longer than that: quitting the app must not wait on
// the network, and every event is already durable on disk, so the worst case is
// that the next launch sends it.
func (r *Recorder) Stop(timeout time.Duration) {
	r.stopOnce.Do(func() { close(r.done) })
	if timeout <= 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		r.Flush(ctx)
	}()
	select {
	case <-finished:
	case <-ctx.Done():
	}
}

// SetEnabled applies the usageAnalyticsEnabled setting. Turning it off clears
// the pending queue and the per-install markers immediately, so nothing already
// collected is sent later — which is what "关闭后清空待发队列" in §7 asks for.
func (r *Recorder) SetEnabled(enabled bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.enabled == enabled {
		return
	}
	r.enabled = enabled
	if !enabled {
		r.clearLocked()
	}
}

// Enabled reports the current setting.
func (r *Recorder) Enabled() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.enabled
}

func (r *Recorder) clearLocked() {
	if err := r.outbox.clear(); err != nil {
		r.logger.Warn("clear ops telemetry outbox", slog.Any("err", err))
	}
	if err := r.state.clear(); err != nil {
		r.logger.Warn("clear ops telemetry state", slog.Any("err", err))
	}
	r.attempts = 0
	r.nextTry = time.Time{}
}

// SetPlatformUserID attaches (or drops) the platform user id that later events
// carry. The caller passes the raw id from `officecli whoami`; a value that is
// not a numeric platform id is ignored, per contract §2's "不得是邮箱".
func (r *Recorder) SetPlatformUserID(platformID string) {
	userID, ok := UserID(platformID)
	r.mu.Lock()
	defer r.mu.Unlock()
	if !ok {
		r.userID = ""
		return
	}
	r.userID = userID
}

// Enqueue validates an event, stamps the current subject and user id onto it,
// and persists it. It returns an error only for a client bug (an invalid event
// or a failed write); a disabled recorder and an already-queued id are both
// silent no-ops.
func (r *Recorder) Enqueue(name, id string, at time.Time) error {
	return r.enqueueAt(name, id, FormatAt(at))
}

// EnqueueAt is Enqueue for an event whose timestamp comes from somewhere other
// than the clock — app_first_open carries the instance's creation time.
func (r *Recorder) EnqueueAt(name, id, at string) error {
	return r.enqueueAt(name, id, NormalizeAt(at))
}

func (r *Recorder) enqueueAt(name, id, at string) error {
	r.mu.Lock()
	if !r.enabled {
		r.mu.Unlock()
		return nil
	}
	event := Event{ID: id, Subject: r.subject, Name: name, At: at, UserID: r.userID}
	if err := event.Validate(r.now()); err != nil {
		r.mu.Unlock()
		return err
	}
	if r.outbox.has(event.ID) {
		r.mu.Unlock()
		return nil
	}
	r.outbox.append(event)
	err := r.outbox.save()
	r.mu.Unlock()
	if err != nil {
		return err
	}
	r.nudge()
	return nil
}

// Pending returns the number of events waiting to be sent. Tests and the
// diagnostics bundle use it; nothing in the delivery path does.
func (r *Recorder) Pending() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.outbox.len()
}

func (r *Recorder) nudge() {
	select {
	case r.wake <- struct{}{}:
	default:
	}
}

func (r *Recorder) run() {
	defer close(r.stopped)
	ticker := time.NewTicker(r.flushInterval)
	defer ticker.Stop()
	for {
		select {
		case <-r.done:
			return
		case <-ticker.C:
			r.flushAll(context.Background())
		case <-r.wake:
			// Debounce: a burst of enqueues becomes one request. A stop during
			// the wait skips the send; Stop's own flush covers it.
			timer := time.NewTimer(r.flushDebounce)
			select {
			case <-r.done:
				timer.Stop()
				return
			case <-timer.C:
			}
			r.flushAll(context.Background())
		}
	}
}

// Flush sends what it can right now. It is exported for the shutdown path and
// for tests; the loop uses it too.
func (r *Recorder) Flush(ctx context.Context) {
	r.flushAll(ctx)
}

// flushAll drains the queue in batches until it is empty, the collector asks us
// to back off, or the context expires.
func (r *Recorder) flushAll(ctx context.Context) {
	r.flushMu.Lock()
	defer r.flushMu.Unlock()
	for {
		if ctx.Err() != nil {
			return
		}
		more, err := r.flushOnce(ctx)
		if err != nil || !more {
			return
		}
	}
}

// flushOnce sends at most one batch. The bool reports whether the queue still
// holds sendable events.
func (r *Recorder) flushOnce(ctx context.Context) (bool, error) {
	r.mu.Lock()
	if !r.enabled || r.outbox.len() == 0 {
		r.mu.Unlock()
		return false, nil
	}
	now := r.now()
	if !r.nextTry.IsZero() && now.Before(r.nextTry) {
		r.mu.Unlock()
		return false, nil
	}
	batch, expired := r.outbox.batch(MaxBatch, func(event Event) bool { return event.Stale(now) })
	if len(expired) > 0 {
		ids := make(map[string]struct{}, len(expired))
		for _, event := range expired {
			ids[event.ID] = struct{}{}
			r.logger.Warn("dropping ops event past the collector's acceptance window",
				slog.String("event", event.Name), slog.String("at", event.At))
		}
		r.outbox.remove(ids)
		if err := r.outbox.save(); err != nil {
			r.logger.Warn("persist ops telemetry outbox", slog.Any("err", err))
		}
	}
	if len(batch) == 0 {
		remaining := r.outbox.len()
		r.mu.Unlock()
		return remaining > 0, nil
	}
	body, err := encodeBatch(&batch)
	r.mu.Unlock()
	if err != nil {
		// Nothing retryable about a batch that will not marshal; drop it so a
		// single poisoned row cannot wedge the queue forever.
		r.logger.Error("encode ops telemetry batch", slog.Any("err", err))
		r.dropBatch(batch)
		return r.hasPending(), err
	}

	outcome, err := r.post(ctx, body)
	if err != nil {
		r.retryLater(err.Error(), len(batch))
		return false, err
	}

	switch {
	case outcome.retry:
		r.retryLater(fmt.Sprintf("http %d", outcome.status), len(batch))
		return false, nil
	case outcome.dropBatch:
		r.logger.Error("collector refused an ops telemetry batch; dropping it",
			slog.Int("status", outcome.status), slog.Int("events", len(batch)))
		r.dropBatch(batch)
		return r.hasPending(), nil
	}

	for _, rejected := range outcome.rejected {
		name := ""
		if rejected.Index >= 0 && rejected.Index < len(batch) {
			name = batch[rejected.Index].Name
		}
		// Reason only: the collector's message describes the field that failed
		// validation, and nothing the event carried is echoed back into a log.
		r.logger.Warn("collector rejected an ops event",
			slog.String("event", name), slog.String("reason", rejected.Reason))
	}
	r.succeeded(batch)
	return r.hasPending(), nil
}

func encodeBatch(batch *[]Event) ([]byte, error) {
	for {
		body, err := json.Marshal(map[string]any{"events": *batch})
		if err != nil {
			return nil, err
		}
		if len(body) <= maxBodyBytes || len(*batch) <= 1 {
			return body, nil
		}
		*batch = (*batch)[:len(*batch)/2]
	}
}

func (r *Recorder) hasPending() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.outbox.len() > 0
}

// succeeded removes a delivered batch — accepted, duplicate and rejected alike.
// All three are terminal: the contract says a rejected event is dropped and
// logged, never retried.
func (r *Recorder) succeeded(batch []Event) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.attempts = 0
	r.nextTry = time.Time{}
	r.removeLocked(batch)
}

func (r *Recorder) dropBatch(batch []Event) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.removeLocked(batch)
}

func (r *Recorder) removeLocked(batch []Event) {
	ids := make(map[string]struct{}, len(batch))
	for _, event := range batch {
		ids[event.ID] = struct{}{}
	}
	r.outbox.remove(ids)
	if err := r.outbox.save(); err != nil {
		r.logger.Warn("persist ops telemetry outbox", slog.Any("err", err))
	}
}

// retryLater keeps the batch and schedules the next attempt. The ids do not
// change, so the collector de-duplicates whatever it already stored.
func (r *Recorder) retryLater(reason string, events int) {
	r.mu.Lock()
	r.attempts++
	delay := r.jitter(backoffFor(r.attempts))
	r.nextTry = r.now().Add(delay)
	attempts := r.attempts
	r.mu.Unlock()
	r.logger.Info("ops telemetry delivery deferred",
		slog.String("reason", reason),
		slog.Int("events", events),
		slog.Int("attempt", attempts),
		slog.Duration("retry_in", delay))
}

// backoffFor is 30s doubling to a one-hour ceiling.
func backoffFor(attempt int) time.Duration {
	if attempt <= 1 {
		return minBackoff
	}
	shift := attempt - 1
	if shift > 16 {
		return maxBackoff
	}
	delay := time.Duration(float64(minBackoff) * math.Pow(2, float64(shift)))
	if delay > maxBackoff || delay <= 0 {
		return maxBackoff
	}
	return delay
}

type rejection struct {
	Index  int    `json:"index"`
	Reason string `json:"reason"`
}

type collectResponse struct {
	Accepted   int         `json:"accepted"`
	Duplicates int         `json:"duplicates"`
	Rejected   []rejection `json:"rejected"`
}

type postOutcome struct {
	status    int
	retry     bool
	dropBatch bool
	rejected  []rejection
}

func (r *Recorder) post(ctx context.Context, body []byte) (postOutcome, error) {
	requestCtx, cancel := context.WithTimeout(ctx, r.requestTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(requestCtx, http.MethodPost, r.endpoint, bytes.NewReader(body))
	if err != nil {
		return postOutcome{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	if r.clientHeader != "" {
		request.Header.Set("X-OfficeDex-Client", r.clientHeader)
	}
	if r.testTraffic {
		request.Header.Set("X-Ops-Test", "1")
	}
	response, err := r.client.Do(request)
	if err != nil {
		return postOutcome{}, err
	}
	defer func() {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 1<<16))
		_ = response.Body.Close()
	}()

	switch {
	case response.StatusCode == http.StatusOK:
		var decoded collectResponse
		raw, readErr := io.ReadAll(io.LimitReader(response.Body, 1<<20))
		if readErr == nil && len(bytes.TrimSpace(raw)) > 0 {
			// A 200 whose body will not decode still means the collector took
			// the batch; only the per-event rejection detail is lost.
			_ = json.Unmarshal(raw, &decoded)
		}
		return postOutcome{status: response.StatusCode, rejected: decoded.Rejected}, nil
	case response.StatusCode == http.StatusTooManyRequests,
		response.StatusCode >= 500:
		return postOutcome{status: response.StatusCode, retry: true}, nil
	default:
		// 400/413 and any other 4xx say this client built something the
		// collector will never take. Retrying cannot fix it.
		return postOutcome{status: response.StatusCode, dropBatch: true}, nil
	}
}
