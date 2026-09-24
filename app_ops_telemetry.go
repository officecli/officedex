package main

import (
	"context"
	"log/slog"
	"path/filepath"
	"time"

	"officedex/internal/applog"
	"officedex/internal/config"
	"officedex/internal/localstore"
	"officedex/internal/opstelemetry"
	"officedex/internal/types"
)

// Product-usage reporting, wired Go-side.
//
// The renderer is deliberately not involved. Every event here is derived from a
// state change the Go layer already owns — a status transition inside the local
// store's write transaction, a file on disk, the instance identity file — so a
// reload, a closed window or a renderer bug cannot invent, duplicate or lose
// one. The frontend's only part in this is the on/off switch.

// opsShutdownFlush bounds the final send. Quitting must not wait on a network,
// and the queue is durable, so anything that does not make it here goes out on
// the next launch.
const opsShutdownFlush = 2 * time.Second

// opsTelemetryTestTraffic reports whether this process's events must be marked
// `X-Ops-Test: 1`. Three things make a build non-production: a dev/devtools
// build tag, an appVersion that was never injected by the release script, and
// an explicit override for someone testing the pipeline from a real build.
func opsTelemetryTestTraffic() bool {
	if opsTelemetryDevBuild || appVersion == "dev" || appVersion == "" {
		return true
	}
	return config.Trimmed(config.OpsTestEnv) == "1"
}

// initOpsTelemetry builds the recorder. It never fails the app: usage reporting
// that cannot start is a missing statistic, not a broken product, so an error
// is logged and the recorder is left nil (every call site tolerates that).
func (a *App) initOpsTelemetry(instanceCreatedAt string, enabled bool) {
	a.instanceCreatedAt = instanceCreatedAt
	if opsTelemetryDemoBuild {
		return
	}
	endpoint := config.Trimmed(config.OpsCollectURLEnv)
	recorder, err := opstelemetry.New(opstelemetry.Options{
		Dir:          filepath.Join(a.userDataDir, "ops-telemetry"),
		Subject:      opstelemetry.Subject(a.desktopInstanceID),
		Endpoint:     endpoint,
		HTTPClient:   a.proxyPool.NewClient(opstelemetry.DefaultRequestTimeout),
		ClientHeader: "desktop/" + appVersion,
		TestTraffic:  opsTelemetryTestTraffic(),
		Enabled:      enabled,
		Logger:       applog.With(slog.String("component", "opstelemetry")),
	})
	if err != nil {
		applog.Logger().Warn("ops telemetry unavailable", applog.Err(err))
		return
	}
	a.opsTelemetry = recorder
}

// startOpsTelemetry runs once the app is up and the local store is open. It is
// called from startup, not from instance.LoadOrCreate: the contract's
// app_first_open means "首次启动成功", and identity creation happens long before
// anything has proven the app can start.
func (a *App) startOpsTelemetry(ctx context.Context) {
	if a.opsTelemetry == nil {
		return
	}
	a.seedOpsHistoryMarker(ctx)
	if err := a.opsTelemetry.RecordAppFirstOpen(a.desktopInstanceID, a.instanceCreatedAt); err != nil {
		applog.Logger().Warn("queue app_first_open", applog.Err(err))
	}
	a.opsTelemetry.Start()
}

// seedOpsHistoryMarker decides, once per install, whether this profile's first
// document success is still ahead of it.
//
// An install that upgrades into this feature usually already has finished
// documents. Its real first success is not observable any more, so the next one
// must not be reported as the first — that would show every existing install
// converting on the day they updated.
func (a *App) seedOpsHistoryMarker(ctx context.Context) {
	if a.opsTelemetry == nil || a.localStore == nil {
		return
	}
	if a.opsTelemetry.FirstDocumentSuccessSettled() {
		return
	}
	hasHistory, err := a.localStore.HasCompletedDocumentHistory(ctx)
	if err != nil {
		// Unknown history is treated as none: a new install is the common case
		// and losing a first_document_success is worse than the small risk of
		// dating an old one, which the collector's id de-duplication bounds to
		// one row either way.
		applog.Logger().Warn("inspect document history for usage reporting", applog.Err(err))
		return
	}
	if hasHistory {
		a.opsTelemetry.NoteHistoryBeforeTracking()
	}
}

// stopOpsTelemetry gives the queue one short chance to drain on the way out.
func (a *App) stopOpsTelemetry() {
	if a.opsTelemetry == nil {
		return
	}
	a.opsTelemetry.Stop(opsShutdownFlush)
}

// setOpsTelemetryEnabled applies the usageAnalyticsEnabled setting.
func (a *App) setOpsTelemetryEnabled(enabled bool) {
	if a.opsTelemetry == nil {
		return
	}
	a.opsTelemetry.SetEnabled(enabled)
}

// noteOpsTelemetryIdentity attaches the platform account to later events.
// Called from WhoAmI, which the shell asks for on start and after a login, so
// the id lands without this package ever spawning its own `officecli` run.
// Only a numeric platform id is accepted; an API-key session or an anonymous
// one clears it (contract §3: `inst:*` → account only via an explicit mapping).
func (a *App) noteOpsTelemetryIdentity(result types.WhoAmIResult) {
	if a.opsTelemetry == nil {
		return
	}
	if result.Mode != types.WhoAmILoggedIn {
		a.opsTelemetry.SetPlatformUserID("")
		return
	}
	a.opsTelemetry.SetPlatformUserID(result.UserID)
}

// observeTaskTelemetry turns one recorded task event into at most one product
// event. It runs on the event-writer goroutine, right after the store has
// committed, and it only ever reads the transition the store computed — which
// is what makes it fire once per real outcome rather than once per frame.
//
//   - completed, for the first time, with a usable artifact → document_success
//     (plus first_document_success if this install has none yet)
//   - failed, for the first time → generation_failed
//   - cancelled → nothing at all; the contract lists cancel under 不得触发
//   - a replayed or late event → nothing, because Entered is false
func (a *App) observeTaskTelemetry(event types.BridgeEvent, transition localstore.StatusTransition, artifact *types.Artifact) {
	if a.opsTelemetry == nil || event.TaskID == "" {
		return
	}
	at := opsEventTime(event)
	switch {
	case transition.Entered("completed"):
		if artifact == nil {
			// A task can finish without producing a file (an answer, an
			// analysis). Nothing to count as a document.
			return
		}
		if err := opstelemetry.ArtifactUsable(artifact.FilePath); err != nil {
			// The bridge reports a path without checking it wrote one. Counting
			// a run whose file is missing, empty or truncated would inflate the
			// single number this funnel exists to measure.
			applog.Logger().Info("not counting a completed task as a document success",
				applog.Task(event.TaskID), applog.Err(err))
			return
		}
		if err := a.opsTelemetry.RecordDocumentSuccess(a.desktopInstanceID, event.TaskID, at); err != nil {
			applog.Logger().Warn("queue document_success", applog.Task(event.TaskID), applog.Err(err))
		}
	case transition.Entered("failed"):
		if err := a.opsTelemetry.RecordGenerationFailed(event.TaskID, at); err != nil {
			applog.Logger().Warn("queue generation_failed", applog.Task(event.TaskID), applog.Err(err))
		}
	}
}

// opsEventTime prefers the event's own timestamp over the wall clock, so an
// event written by the startup recovery pass (failInterruptedTasks) is dated
// when it was synthesised rather than whenever the writer goroutine got to it.
func opsEventTime(event types.BridgeEvent) time.Time {
	if parsed, err := time.Parse(time.RFC3339, event.TS); err == nil {
		return parsed
	}
	return time.Now().UTC()
}
