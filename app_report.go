package main

import (
	"context"
	"fmt"
	"runtime"
	"strings"
	"time"

	"officedex/internal/report"
	"officedex/internal/types"
)

// ─── Issue report bindings ──────────────────────────────────────────────────

// SubmitReportInput is the renderer-facing payload for SubmitReport.
type SubmitReportInput struct {
	TaskID       string `json:"taskId,omitempty"`
	Description  string `json:"description"`
	ContactEmail string `json:"contactEmail,omitempty"`
}

// SubmitReportResult is the value returned to the renderer.
type SubmitReportResult struct {
	TicketID       string `json:"ticketId,omitempty"`
	ViewURL        string `json:"viewUrl,omitempty"`
	RequestID      string `json:"requestId,omitempty"`
	Uploaded       bool   `json:"uploaded"`
	FallbackReason string `json:"fallbackReason,omitempty"`
}

// ReportCapabilityResult is the gated view the renderer uses to decide whether
// to surface a "Report issue" action vs falling back to "Copy request id".
type ReportCapabilityResult struct {
	Enabled bool   `json:"enabled"`
	Reason  string `json:"reason,omitempty"`
}

// PeekReportContextResult is the renderer-facing snapshot of the failed-task
// context the report dialog renders in its header bar. All fields are empty
// when the user opens the dialog without a task selection (e.g. from
// Settings) or when no failure has been recorded yet.
type PeekReportContextResult struct {
	RequestID    string `json:"requestId"`
	ErrorCode    string `json:"errorCode"`
	ErrorMessage string `json:"errorMessage"`
	RuntimeMode  string `json:"runtimeMode"`
}

const reportDescriptionMinLen = 10

// GetReportCapability returns a renderer-friendly snapshot of whether report
// submission is available.
func (a *App) GetReportCapability() ReportCapabilityResult {
	cap := a.detectReportCapability()
	return ReportCapabilityResult{Enabled: cap.Enabled, Reason: cap.Reason}
}

// PeekReportContext returns the report header data the renderer renders in
// the dialog (request_id + error code + error message + runtime mode). Safe
// to call with empty taskID; returns zero-value result without error.
func (a *App) PeekReportContext(taskID string) (PeekReportContextResult, error) {
	out := PeekReportContextResult{}
	if a.localStore == nil || strings.TrimSpace(taskID) == "" {
		return out, nil
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	requestID, err := a.localStore.LatestRequestID(ctx, taskID)
	if err != nil {
		return out, fmt.Errorf("peek report context: latest request id: %w", err)
	}
	out.RequestID = requestID

	events, err := a.localStore.QueryEventsByTask(ctx, taskID)
	if err != nil {
		return out, fmt.Errorf("peek report context: query events: %w", err)
	}
	if failure := report.LatestFailedEvent(events); failure != nil {
		out.ErrorCode, out.ErrorMessage = report.ErrorFields(failure)
	}
	out.RuntimeMode = string(a.currentRuntimeMode())
	return out, nil
}

// SubmitReport posts a minimal JSON payload to the configured support
// endpoint. Validation errors return verbatim; upload failures degrade to
// Uploaded=false with a FallbackReason so the renderer can prompt the user
// to copy the request id manually.
func (a *App) SubmitReport(input SubmitReportInput) (SubmitReportResult, error) {
	desc := strings.TrimSpace(input.Description)
	if len(desc) < reportDescriptionMinLen {
		return SubmitReportResult{}, fmt.Errorf("submit report: description must be at least %d characters", reportDescriptionMinLen)
	}

	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}

	result := SubmitReportResult{}
	payload := report.ReportPayload{
		TaskID:       strings.TrimSpace(input.TaskID),
		Description:  desc,
		ContactEmail: strings.TrimSpace(input.ContactEmail),
		Timestamp:    time.Now().UTC().Format(time.RFC3339),
		Via:          "http",
		RuntimeMode:  string(a.currentRuntimeMode()),
	}

	if payload.TaskID != "" && a.localStore != nil {
		if requestID, err := a.localStore.LatestRequestID(ctx, payload.TaskID); err == nil {
			payload.RequestID = requestID
		}
		if events, err := a.localStore.QueryEventsByTask(ctx, payload.TaskID); err == nil {
			if failure := report.LatestFailedEvent(events); failure != nil {
				payload.ErrorCode, payload.ErrorMessage = report.ErrorFields(failure)
			}
		}
	}
	result.RequestID = payload.RequestID

	cap := a.detectReportCapability()
	if !cap.Enabled {
		result.FallbackReason = "capability_not_enabled"
		return result, nil
	}

	a.mu.Lock()
	s := a.cachedSettings
	a.mu.Unlock()
	endpoint := ""
	token := ""
	if s.SupportReportEndpoint != nil {
		endpoint = *s.SupportReportEndpoint
	}
	if s.SupportReportToken != nil {
		token = *s.SupportReportToken
	}
	sub := report.NewHTTPSubmitter(report.HTTPOptions{
		Endpoint:   endpoint,
		Token:      token,
		UserAgent:  fmt.Sprintf("OfficeDex/%s (%s; %s)", appVersion, runtime.GOOS, runtime.GOARCH),
		HTTPClient: a.proxyPool.NewClient(30 * time.Second),
	})
	sr, err := sub.Submit(ctx, payload)
	if err != nil {
		result.FallbackReason = fmt.Sprintf("http_upload_failed: %v", err)
		return result, nil
	}
	result.TicketID = sr.TicketID
	result.ViewURL = sr.ViewURL
	result.Uploaded = true
	return result, nil
}

// detectReportCapability resolves the inputs and runs report.DetectCapability.
// Never panics; on any unexpected condition returns a disabled snapshot.
func (a *App) detectReportCapability() report.ReportCapability {
	a.mu.Lock()
	s := a.cachedSettings
	a.mu.Unlock()
	client := a.bridges.mostRecentlyUsed()

	endpoint := ""
	if s.SupportReportEndpoint != nil {
		endpoint = *s.SupportReportEndpoint
	}

	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}

	var capsPayload []byte
	if client != nil {
		if payload, err := client.GetCapabilities(ctx); err == nil {
			capsPayload = payload
		}
	}

	return report.DetectCapability(ctx, report.CapabilityOptions{
		HTTPEndpoint:        endpoint,
		CapabilitiesPayload: capsPayload,
	})
}

func (a *App) currentRuntimeMode() types.RuntimeMode {
	a.mu.Lock()
	mode := a.currentRuntimeModeLocked()
	a.mu.Unlock()
	return mode
}

// currentRuntimeModeLocked returns the cached runtime mode. Caller must hold
// a.mu; bridge event callbacks use this to avoid blocking the stdout reader by
// trying to acquire the same mutex twice.
func (a *App) currentRuntimeModeLocked() types.RuntimeMode {
	return runtimeModeFor(a.cachedSettings)
}

func runtimeModeFor(s types.UserSettings) types.RuntimeMode {
	if s.LlmProvider == nil {
		return types.RuntimeHosted
	}
	return types.RuntimeCustom
}

// storeRuntimeModeSnapshot publishes the runtime mode for readers that must not
// take a.mu (the bridge's stdout listener). Call it wherever cachedSettings
// changes.
func (a *App) storeRuntimeModeSnapshot(s types.UserSettings) {
	a.runtimeMode.Store(string(runtimeModeFor(s)))
}

// runtimeModeSnapshot returns the last published runtime mode, or "" before
// settings have loaded.
func (a *App) runtimeModeSnapshot() types.RuntimeMode {
	if v, ok := a.runtimeMode.Load().(string); ok {
		return types.RuntimeMode(v)
	}
	return ""
}
