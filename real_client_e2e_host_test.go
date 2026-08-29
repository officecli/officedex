//go:build real_e2e

package main

import (
	"archive/zip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"officedex/internal/demoflow"
	"officedex/internal/settings"
	"officedex/internal/types"
)

type realClientE2EHost struct {
	app         *App
	report      *realReportServer
	outputRoot  string
	fixtures    map[string]string
	startedAt   time.Time
	passthrough bool

	mu              sync.Mutex
	subscribers     map[string]map[chan realClientE2EEvent]struct{}
	seenEvents      map[string]struct{}
	fileDialogQueue [][]string
	actions         []realClientE2EAction
	records         []realClientE2ERecord
	previewIssued   int
	previewRevoked  int
}

type realClientE2EEvent struct {
	Channel string `json:"channel"`
	Payload any    `json:"payload"`
}

type realClientE2EAction struct {
	Kind  string `json:"kind"`
	Value string `json:"value"`
}

type realClientE2ERecord struct {
	UIScenario string `json:"uiScenario"`
	Document   string `json:"documentType,omitempty"`
	Mode       string `json:"mode,omitempty"`
	TaskID     string `json:"taskId,omitempty"`
	Artifact   string `json:"artifactPath,omitempty"`
	FileSize   int64  `json:"fileSize,omitempty"`
	DurationMS int64  `json:"durationMs,omitempty"`
	Credits    any    `json:"credits,omitempty"`
	Runtime    any    `json:"runtime,omitempty"`
	Error      string `json:"error,omitempty"`
	RecordedAt string `json:"recordedAt"`
	Source     string `json:"source"`
}

func TestRealOfficeDexClientBridgeHost(t *testing.T) {
	if os.Getenv("OFFICEDEX_E2E_HOST") != "1" {
		t.Skip("OFFICEDEX_E2E_HOST=1 is required to start the real client E2E bridge host")
	}

	app := newRealOfficeDexApp(t)
	reportServer := newRealReportServer(t)
	endpoint := reportServer.URL
	token := "real-client-e2e-token"
	if _, err := app.UpdateSettings(settings.Patch{SupportReportEndpoint: &endpoint, SupportReportToken: &token}); err != nil {
		t.Fatalf("configure support report endpoint: %v", err)
	}

	host := newRealClientE2EHost(t, app, reportServer)
	server := newRealClientE2EServer(t, host.routes())
	defer server.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go host.tailTaskEvents(ctx)

	fmt.Printf("OFFICEDEX_REAL_E2E_ENDPOINT=%s\n", server.URL)
	<-ctx.Done()
	// Stop accepting work before closing App resources. EventSource clients keep
	// HTTP/1.1 connections open indefinitely; without an explicit disconnect,
	// httptest.Server.Close blocks and devctl eventually has to SIGKILL a host
	// that may already be partially torn down.
	server.CloseClientConnections()
	server.Close()
	app.shutdown(context.Background())
}

func TestRealClientE2EHostReopensClosedLocalStore(t *testing.T) {
	app := newRealOfficeDexApp(t)
	host := newRealClientE2EHost(t, app, newRealReportServer(t))
	if err := app.localStore.Close(); err != nil {
		t.Fatalf("close local store: %v", err)
	}

	result, err := host.call("ListRecentFiles", json.RawMessage(`""`))
	if err != nil {
		t.Fatalf("ListRecentFiles should reopen local store: %v", err)
	}
	if files, ok := result.([]types.RecentFile); !ok || len(files) != 0 {
		t.Fatalf("ListRecentFiles result = %#v, want empty recent files", result)
	}
	if _, err := app.localStore.QueryRecentFiles(context.Background(), "", 1); err != nil {
		t.Fatalf("query reopened local store: %v", err)
	}
}

func newRealClientE2EServer(t *testing.T, handler http.Handler) *httptest.Server {
	t.Helper()
	address := strings.TrimSpace(os.Getenv("OFFICEDEX_E2E_BRIDGE_ADDR"))
	if address == "" {
		return httptest.NewServer(handler)
	}
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		t.Fatalf("parse OFFICEDEX_E2E_BRIDGE_ADDR: %v", err)
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		t.Fatalf("OFFICEDEX_E2E_BRIDGE_ADDR must use a loopback IP: %s", address)
	}
	listener, err := net.Listen("tcp", address)
	if err != nil {
		t.Fatalf("listen on OFFICEDEX_E2E_BRIDGE_ADDR: %v", err)
	}
	server := httptest.NewUnstartedServer(handler)
	server.Listener = listener
	server.Start()
	return server
}

func newRealClientE2EHost(t *testing.T, app *App, reportServer *realReportServer) *realClientE2EHost {
	t.Helper()
	root := filepath.Join(realAppOutputRoot(t), "_client")
	fixtureDir := filepath.Join(root, "fixtures")
	if err := os.MkdirAll(fixtureDir, 0o755); err != nil {
		t.Fatalf("mkdir client fixtures: %v", err)
	}
	workspaceDir := filepath.Join(root, "workspace-project")
	if err := os.MkdirAll(workspaceDir, 0o755); err != nil {
		t.Fatalf("mkdir workspace fixture: %v", err)
	}
	sourceWorkbook := filepath.Join(fixtureDir, "sales-report.xlsx")
	writeClientE2EWorkbook(t, sourceWorkbook)
	referenceImage := filepath.Join(fixtureDir, "reference.png")
	if err := os.WriteFile(referenceImage, onePixelPNG(), 0o644); err != nil {
		t.Fatalf("write reference image: %v", err)
	}
	blankPptx := filepath.Join(fixtureDir, "blank.pptx")
	if err := os.WriteFile(blankPptx, blankPptxDraft, 0o644); err != nil {
		t.Fatalf("write blank PPTX fixture: %v", err)
	}

	return &realClientE2EHost{
		app:         app,
		report:      reportServer,
		outputRoot:  root,
		startedAt:   time.Now(),
		passthrough: os.Getenv("OFFICEDEX_E2E_OS_PASSTHROUGH") == "1",
		subscribers: map[string]map[chan realClientE2EEvent]struct{}{},
		seenEvents:  map[string]struct{}{},
		fixtures: map[string]string{
			"workspace":         workspaceDir,
			"sales-report.xlsx": sourceWorkbook,
			"reference.png":     referenceImage,
			"blank.pptx":        blankPptx,
		},
	}
}

func (h *realClientE2EHost) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/rpc/", h.handleRPC)
	mux.HandleFunc("/events", h.handleEvents)
	mux.HandleFunc("/control/file-dialog", h.handleFileDialogControl)
	mux.HandleFunc("/control/fixture/", h.handleFixture)
	mux.HandleFunc("/control/records", h.handleRecordControl)
	mux.HandleFunc("/control/report", h.handleReport)
	mux.HandleFunc("/control/actions", h.handleActions)
	mux.HandleFunc("/control/preview-tokens", h.handlePreviewTokens)
	mux.HandleFunc("/control/artifacts/latest", h.handleLatestArtifactControl)
	mux.HandleFunc("/control/auth-event", h.handleAuthEvent)
	mux.HandleFunc("/control/demo/session", h.handleDemoSessionControl)
	mux.HandleFunc("/control/seed/failed-task", h.handleSeedFailedTask)
	mux.HandleFunc("/control/seed/completed-pptx-artifact", h.handleSeedCompletedPptxArtifact)
	mux.HandleFunc("/control/task/", h.handleTaskControl)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "content-type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		mux.ServeHTTP(w, r)
	})
}

func (h *realClientE2EHost) handleRPC(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeRealClientError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	method := strings.TrimPrefix(r.URL.Path, "/rpc/")
	var raw json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil && !errors.Is(err, os.ErrClosed) {
		writeRealClientError(w, http.StatusBadRequest, fmt.Sprintf("decode rpc input: %v", err))
		return
	}
	result, err := h.call(method, raw)
	if err != nil {
		writeRealClientError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeRealClientJSON(w, map[string]any{"ok": true, "result": result})
}

func (h *realClientE2EHost) call(method string, raw json.RawMessage) (any, error) {
	if err := h.app.ensureLocalStoreOpen(context.Background()); err != nil {
		return nil, err
	}
	switch method {
	case "Initialize":
		return h.app.Initialize()
	case "GetCapabilities":
		return h.app.GetCapabilities()
	case "ListImageTemplates":
		return h.app.ListImageTemplates()
	case "ListAgentRuns":
		// The real generation E2E host does not run the separate Agent Runtime;
		// return an empty, valid collection so the renderer can finish startup.
		return []any{}, nil
	case "CreateImageTemplate":
		var input types.CreateUserImageTemplateInput
		if err := decodeRealClientInput(raw, &input); err != nil {
			return nil, err
		}
		return h.app.CreateImageTemplate(input)
	case "CreateImageTemplatePublishRequest":
		var input types.CreateImageTemplatePublishRequestInput
		if err := decodeRealClientInput(raw, &input); err != nil {
			return nil, err
		}
		return h.app.CreateImageTemplatePublishRequest(input)
	case "Generate":
		var input types.GenerateInput
		if err := decodeRealClientInput(raw, &input); err != nil {
			return nil, err
		}
		return h.app.Generate(input)
	case "Modify":
		var input types.ModifyInput
		if err := decodeRealClientInput(raw, &input); err != nil {
			return nil, err
		}
		return h.app.Modify(input)
	case "ArtifactStageEdit":
		var input types.ArtifactStageEditInput
		if err := decodeRealClientInput(raw, &input); err != nil {
			return nil, err
		}
		return h.app.ArtifactStageEdit(input)
	case "Respond":
		var input RespondInput
		if err := decodeRealClientInput(raw, &input); err != nil {
			return nil, err
		}
		return h.app.Respond(input)
	case "Cancel":
		taskID, err := decodeRealClientString(raw)
		if err != nil {
			return nil, err
		}
		return h.app.Cancel(taskID)
	case "OpenPath":
		value, err := decodeRealClientString(raw)
		if err != nil {
			return nil, err
		}
		h.recordAction("openPath", value)
		if h.passthrough {
			return nil, h.app.OpenPath(value)
		}
		return nil, nil
	case "ShowItemInFolder":
		value, err := decodeRealClientString(raw)
		if err != nil {
			return nil, err
		}
		h.recordAction("showItemInFolder", value)
		if h.passthrough {
			return nil, h.app.ShowItemInFolder(value)
		}
		return nil, nil
	case "OpenExternal":
		value, err := decodeRealClientString(raw)
		if err != nil {
			return nil, err
		}
		h.recordAction("openExternal", value)
		return nil, nil
	case "OpenFileDialog":
		return h.popFileDialog(false), nil
	case "OpenDirectoryDialog":
		return h.popFileDialog(false), nil
	case "OpenMultiFileDialog":
		return h.popFileDialog(true), nil
	case "SavePastedImage":
		var input PastedImageInput
		if err := decodeRealClientInput(raw, &input); err != nil {
			return nil, err
		}
		return h.app.SavePastedImage(input)
	case "SavePptx":
		var input SavePptxInput
		if err := decodeRealClientInput(raw, &input); err != nil {
			return nil, err
		}
		return h.app.SavePptx(input)
	case "CreateLivePptxDraft":
		value, err := decodeRealClientString(raw)
		if err != nil {
			return nil, err
		}
		return h.app.CreateLivePptxDraft(value)
	case "ModifyPptistDeck":
		var input ModifyPptistDeckInput
		if err := decodeRealClientInput(raw, &input); err != nil {
			return nil, err
		}
		return h.app.ModifyPptistDeck(input)
	case "PlanPptxJS":
		var input PlanPptxJSInput
		if err := decodeRealClientInput(raw, &input); err != nil {
			return nil, err
		}
		return h.app.PlanPptxJS(input)
	case "PreviewArtifact":
		var artifact types.Artifact
		if err := decodeRealClientInput(raw, &artifact); err != nil {
			return nil, err
		}
		return nil, h.app.previewReg.AllowArtifact(artifact)
	case "IssuePreviewToken":
		var artifact types.Artifact
		if err := decodeRealClientInput(raw, &artifact); err != nil {
			return nil, err
		}
		grant, err := h.app.IssuePreviewToken(artifact)
		if err == nil {
			h.mu.Lock()
			h.previewIssued++
			h.mu.Unlock()
		}
		return grant, err
	case "RevokePreviewToken":
		token, err := decodeRealClientString(raw)
		if err != nil {
			return nil, err
		}
		h.app.RevokePreviewToken(token)
		h.mu.Lock()
		h.previewRevoked++
		h.mu.Unlock()
		return nil, nil
	case "ReadArtifactFile":
		token, err := decodeRealClientString(raw)
		if err != nil {
			return nil, err
		}
		return h.app.ReadArtifactFile(token)
	case "ReadLocalImage":
		value, err := decodeRealClientString(raw)
		if err != nil {
			return nil, err
		}
		return h.app.ReadLocalImage(value)
	case "CopyImageToClipboard":
		value, err := decodeRealClientString(raw)
		if err != nil {
			return nil, err
		}
		h.recordAction("copyImageToClipboard", value)
		if h.passthrough {
			return nil, h.app.CopyImageToClipboard(value)
		}
		return nil, nil
	case "SetPreviewMode":
		var active bool
		if err := decodeRealClientInput(raw, &active); err != nil {
			return nil, err
		}
		h.recordAction("setPreviewMode", fmt.Sprintf("%t", active))
		return nil, nil
	case "Login":
		var input LoginInput
		if len(raw) > 0 && string(raw) != "null" {
			if err := decodeRealClientInput(raw, &input); err != nil {
				return nil, err
			}
		}
		// The browser dev bridge normally behaves like the app rather than an
		// auth fixture. Keep the deterministic loopback URL for isolated E2E
		// tests, but allow devctl's non-demo browser instance to start the
		// user's real OfficeCLI login flow.
		if os.Getenv("OFFICEDEX_DEV_BROWSER_REAL_LOGIN") == "1" {
			return h.app.Login(input)
		}
		url := "http://127.0.0.1/oauth/local-real-e2e"
		event := types.AuthEvent{Type: types.AuthEventURL, URL: url}
		h.broadcast("auth", event)
		return LoginURLResult{URL: url}, nil
	case "CancelLogin":
		h.broadcast("auth", types.AuthEvent{Type: types.AuthEventExit})
		return nil, nil
	case "WhoAmI":
		return h.app.WhoAmI()
	case "Logout":
		return nil, h.app.Logout()
	case "GetCreditStatus":
		return h.app.GetCreditStatus()
	case "GetInviteInfo":
		return h.app.GetInviteInfo()
	case "Redeem":
		code, err := decodeRealClientString(raw)
		if err != nil {
			return nil, err
		}
		return h.app.Redeem(code)
	case "GetSettings":
		return h.app.GetSettings()
	case "UpdateSettings":
		var patch settings.Patch
		if err := decodeRealClientInput(raw, &patch); err != nil {
			return nil, err
		}
		return h.app.UpdateSettings(patch)
	case "GetDefaultWorkspaceDir":
		return h.app.GetDefaultWorkspaceDir(), nil
	case "ListWorkspaces":
		return h.app.ListWorkspaces()
	case "ListRecentFiles":
		workspaceID, err := decodeRealClientString(raw)
		if err != nil {
			return nil, err
		}
		return h.app.ListRecentFiles(workspaceID)
	case "AddWorkspace":
		value, err := decodeRealClientString(raw)
		if err != nil {
			return nil, err
		}
		return h.app.AddWorkspace(value)
	case "SelectWorkspace":
		value, err := decodeRealClientString(raw)
		if err != nil {
			return nil, err
		}
		return h.app.SelectWorkspace(value)
	case "RemoveWorkspace":
		value, err := decodeRealClientString(raw)
		if err != nil {
			return nil, err
		}
		return nil, h.app.RemoveWorkspace(value)
	case "GetAppVersion":
		return h.app.GetAppVersion(), nil
	case "GetAppUpdateStatus":
		return h.app.GetAppUpdateStatus(), nil
	case "CheckAppUpdate":
		result, err := h.app.CheckAppUpdate()
		if err == nil {
			h.broadcast("appupdate", map[string]any{"type": "status", "status": result.Status})
		}
		return result, err
	case "DownloadAppUpdate":
		path, err := h.app.DownloadAppUpdate()
		if err == nil {
			h.broadcast("appupdate", map[string]any{"type": "downloaded", "path": path, "status": h.app.GetAppUpdateStatus()})
		}
		return path, err
	case "InstallAppUpdate":
		h.recordAction("installAppUpdate", "")
		return nil, nil
	case "CancelAppUpdate":
		return nil, h.app.CancelAppUpdate()
	case "ExportLogs":
		var input ExportLogsInput
		if len(raw) > 0 && string(raw) != "null" {
			if err := decodeRealClientInput(raw, &input); err != nil {
				return nil, err
			}
		}
		return h.app.ExportLogs(input)
	case "SubmitReport":
		var input SubmitReportInput
		if err := decodeRealClientInput(raw, &input); err != nil {
			return nil, err
		}
		return h.app.SubmitReport(input)
	case "GetReportCapability":
		return h.app.GetReportCapability(), nil
	case "PeekReportContext":
		value, err := decodeRealClientString(raw)
		if err != nil {
			return nil, err
		}
		return h.app.PeekReportContext(value)
	case "GetTaskHistory":
		var limit int
		if len(raw) > 0 && string(raw) != "null" {
			_ = json.Unmarshal(raw, &limit)
		}
		return h.app.GetTaskHistory(limit)
	case "GetBridgeRuntimeSnapshot":
		return h.app.GetBridgeRuntimeSnapshot()
	case "SendDesktopNotification":
		var input DesktopNotificationInput
		if err := decodeRealClientInput(raw, &input); err != nil {
			return nil, err
		}
		h.recordAction("notification", input.Title+" "+input.Body)
		return nil, nil
	case "TestProvider":
		if len(raw) == 0 || string(raw) == "null" {
			return h.app.TestProvider()
		}
		var input types.ProviderTestInput
		if err := decodeRealClientInput(raw, &input); err != nil {
			return nil, err
		}
		return h.app.TestProviderWithInput(input)
	default:
		return nil, fmt.Errorf("unknown real e2e rpc method %q", method)
	}
}

func (h *realClientE2EHost) handleEvents(w http.ResponseWriter, r *http.Request) {
	channel := r.URL.Query().Get("channel")
	if channel == "" {
		channel = "*"
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeRealClientError(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	ch := h.subscribe(channel)
	defer h.unsubscribe(channel, ch)
	_, _ = fmt.Fprintf(w, ": connected\n\n")
	flusher.Flush()
	for {
		select {
		case <-r.Context().Done():
			return
		case ev := <-ch:
			body, _ := json.Marshal(ev)
			_, _ = fmt.Fprintf(w, "event: %s\n", ev.Channel)
			_, _ = fmt.Fprintf(w, "data: %s\n\n", body)
			flusher.Flush()
		}
	}
}

func (h *realClientE2EHost) handleFileDialogControl(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeRealClientError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var input struct {
		Paths []string `json:"paths"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeRealClientError(w, http.StatusBadRequest, err.Error())
		return
	}
	h.mu.Lock()
	h.fileDialogQueue = append(h.fileDialogQueue, append([]string(nil), input.Paths...))
	h.mu.Unlock()
	writeRealClientJSON(w, map[string]any{"ok": true})
}

func (h *realClientE2EHost) handleFixture(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/control/fixture/")
	name = strings.TrimSpace(name)
	path, ok := h.fixtures[name]
	if !ok {
		writeRealClientError(w, http.StatusNotFound, "fixture not found")
		return
	}
	writeRealClientJSON(w, map[string]any{"path": path})
}

func (h *realClientE2EHost) handleRecordControl(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeRealClientError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var record realClientE2ERecord
	if err := json.NewDecoder(r.Body).Decode(&record); err != nil {
		writeRealClientError(w, http.StatusBadRequest, err.Error())
		return
	}
	record.RecordedAt = time.Now().UTC().Format(time.RFC3339Nano)
	record.Source = "playwright"
	if record.Artifact != "" && record.FileSize == 0 {
		if info, err := os.Stat(record.Artifact); err == nil {
			record.FileSize = info.Size()
		}
	}
	if record.Runtime == nil {
		if snapshot, err := h.app.GetBridgeRuntimeSnapshot(); err == nil {
			record.Runtime = snapshot
		}
	}
	if record.Credits == nil {
		if credits, err := h.app.GetCreditStatus(); err == nil {
			record.Credits = credits
		}
	}
	h.mu.Lock()
	h.records = append(h.records, record)
	h.mu.Unlock()
	writeRealClientJSON(w, map[string]any{"ok": true})
}

func (h *realClientE2EHost) handleDemoSessionControl(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		whoami, credit, session, ok := demoflow.SessionOverride()
		if !ok {
			writeRealClientError(w, http.StatusNotFound, "demo session is not enabled")
			return
		}
		writeRealClientJSON(w, map[string]any{"session": session, "whoami": whoami, "credit": credit})
	case http.MethodPost:
		var input demoflow.DemoSession
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			writeRealClientError(w, http.StatusBadRequest, err.Error())
			return
		}
		session, err := demoflow.UpdateSession(input.Auth, input.Credits)
		if err != nil {
			writeRealClientError(w, http.StatusBadRequest, err.Error())
			return
		}
		whoami, credit, _, _ := demoflow.SessionOverride()
		h.broadcast("auth", types.AuthEvent{Type: types.AuthEventSuccess})
		writeRealClientJSON(w, map[string]any{"session": session, "whoami": whoami, "credit": credit})
	default:
		writeRealClientError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *realClientE2EHost) handleReport(w http.ResponseWriter, r *http.Request) {
	writeRealClientJSON(w, h.snapshotReport())
}

func (h *realClientE2EHost) handleActions(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	actions := append([]realClientE2EAction(nil), h.actions...)
	h.mu.Unlock()
	writeRealClientJSON(w, map[string]any{"actions": actions})
}

func (h *realClientE2EHost) handlePreviewTokens(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	issued := h.previewIssued
	revoked := h.previewRevoked
	h.mu.Unlock()
	writeRealClientJSON(w, map[string]any{"issued": issued, "revoked": revoked})
}

func (h *realClientE2EHost) handleAuthEvent(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeRealClientError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var event types.AuthEvent
	if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
		writeRealClientError(w, http.StatusBadRequest, err.Error())
		return
	}
	h.broadcast("auth", event)
	writeRealClientJSON(w, map[string]any{"ok": true})
}

func (h *realClientE2EHost) handleSeedFailedTask(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeRealClientError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var input struct {
		TaskID       string `json:"taskId"`
		DocumentType string `json:"documentType"`
	}
	_ = json.NewDecoder(r.Body).Decode(&input)
	if input.TaskID == "" {
		input.TaskID = "real-e2e-failed-ui-task"
	}
	if input.DocumentType == "" {
		input.DocumentType = "docx"
	}
	event := types.BridgeEvent{
		EventID:   "real-client-e2e-failed-" + input.TaskID,
		TaskID:    input.TaskID,
		RequestID: "req-real-client-e2e",
		Type:      "task.failed",
		TS:        time.Now().UTC().Format(time.RFC3339Nano),
		Payload: map[string]any{
			"document_type":   input.DocumentType,
			"topic":           "Real E2E failed task",
			"message":         "Real E2E diagnostic failure fixture",
			"error_code":      "real_client_e2e",
			"error_message":   "Real E2E diagnostic failure fixture",
			"request_id":      "req-real-client-e2e",
			"credits_charged": 0,
			"credit_mode":     "hosted",
		},
	}
	if err := h.app.localStore.RecordEvent(event); err != nil {
		writeRealClientError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.broadcast("bridge", event)
	writeRealClientJSON(w, map[string]any{"taskId": input.TaskID})
}

// handleSeedCompletedPptxArtifact copies an existing .pptx into the app
// workspace and records a completed task whose artifact points at it, so a
// browser E2E can open a real, pre-existing deck in the PPTX workbench without
// running a generation first.
func (h *realClientE2EHost) handleSeedCompletedPptxArtifact(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeRealClientError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var input struct {
		TaskID     string `json:"taskId"`
		SourcePath string `json:"sourcePath"`
		FileName   string `json:"fileName"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeRealClientError(w, http.StatusBadRequest, err.Error())
		return
	}
	if input.SourcePath == "" || strings.ToLower(filepath.Ext(input.SourcePath)) != ".pptx" {
		writeRealClientError(w, http.StatusBadRequest, "sourcePath must point at a .pptx file")
		return
	}
	if input.TaskID == "" {
		input.TaskID = "real-e2e-seeded-pptx-" + fmt.Sprintf("%d", time.Now().UnixNano())
	}
	if input.FileName == "" {
		input.FileName = filepath.Base(input.SourcePath)
	}
	data, err := os.ReadFile(input.SourcePath)
	if err != nil {
		writeRealClientError(w, http.StatusBadRequest, err.Error())
		return
	}
	dest := filepath.Join(h.app.workspaceDir, input.FileName)
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		writeRealClientError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := writeFileAtomic(dest, data, 0o644); err != nil {
		writeRealClientError(w, http.StatusInternalServerError, err.Error())
		return
	}
	artifact := types.Artifact{TaskID: input.TaskID, FilePath: dest, FileName: input.FileName, DocumentType: "pptx"}
	if err := h.app.previewReg.AllowArtifact(artifact); err != nil {
		writeRealClientError(w, http.StatusInternalServerError, err.Error())
		return
	}
	event := types.BridgeEvent{
		EventID:   "real-client-e2e-seeded-pptx-" + input.TaskID,
		TaskID:    input.TaskID,
		RequestID: "req-real-client-e2e-seeded-pptx",
		Type:      "task.completed",
		TS:        time.Now().UTC().Format(time.RFC3339Nano),
		Payload: map[string]any{
			"document_type":   "pptx",
			"topic":           strings.TrimSuffix(input.FileName, ".pptx"),
			"prompt":          "Open " + input.FileName,
			"request_id":      "req-real-client-e2e-seeded-pptx",
			"credits_charged": 0,
			"credit_mode":     "hosted",
			"result": map[string]any{
				"file_path":     dest,
				"file_name":     input.FileName,
				"document_type": "pptx",
			},
		},
	}
	if err := h.app.localStore.RecordEvent(event); err != nil {
		writeRealClientError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.broadcast("bridge", event)
	writeRealClientJSON(w, map[string]any{"taskId": input.TaskID, "path": dest, "size": len(data)})
}

func (h *realClientE2EHost) handleTaskControl(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.TrimPrefix(r.URL.Path, "/control/task/")
	parts := strings.Split(strings.Trim(trimmed, "/"), "/")
	if len(parts) != 2 || parts[1] != "artifact" {
		writeRealClientError(w, http.StatusNotFound, "unknown task control path")
		return
	}
	taskID := parts[0]
	events, err := h.app.localStore.QueryEventsByTask(context.Background(), taskID)
	if err != nil {
		writeRealClientError(w, http.StatusInternalServerError, err.Error())
		return
	}
	for i := len(events) - 1; i >= 0; i-- {
		artifact := artifactFromCompletedEvent(events[i])
		if artifact == nil {
			continue
		}
		info, err := os.Stat(artifact.FilePath)
		if err != nil {
			writeRealClientError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeRealClientJSON(w, map[string]any{"path": artifact.FilePath, "size": info.Size(), "documentType": artifact.DocumentType})
		return
	}
	writeRealClientError(w, http.StatusNotFound, "completed artifact not found")
}

func (h *realClientE2EHost) handleLatestArtifactControl(w http.ResponseWriter, r *http.Request) {
	events, err := h.app.localStore.QueryRecentEvents(context.Background(), 1000)
	if err != nil {
		writeRealClientError(w, http.StatusInternalServerError, err.Error())
		return
	}
	for _, event := range events {
		artifact := artifactFromCompletedEvent(event)
		if artifact == nil {
			continue
		}
		info, err := os.Stat(artifact.FilePath)
		if err != nil {
			writeRealClientError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeRealClientJSON(w, map[string]any{
			"taskId":       event.TaskID,
			"path":         artifact.FilePath,
			"size":         info.Size(),
			"documentType": artifact.DocumentType,
		})
		return
	}
	writeRealClientError(w, http.StatusNotFound, "completed artifact not found")
}

func (h *realClientE2EHost) subscribe(channel string) chan realClientE2EEvent {
	ch := make(chan realClientE2EEvent, 128)
	h.mu.Lock()
	if h.subscribers[channel] == nil {
		h.subscribers[channel] = map[chan realClientE2EEvent]struct{}{}
	}
	h.subscribers[channel][ch] = struct{}{}
	h.mu.Unlock()
	return ch
}

func (h *realClientE2EHost) unsubscribe(channel string, ch chan realClientE2EEvent) {
	h.mu.Lock()
	if subscribers := h.subscribers[channel]; subscribers != nil {
		delete(subscribers, ch)
	}
	h.mu.Unlock()
	close(ch)
}

func (h *realClientE2EHost) broadcast(channel string, payload any) {
	event := realClientE2EEvent{Channel: channel, Payload: payload}
	h.mu.Lock()
	targets := make([]chan realClientE2EEvent, 0)
	for _, key := range []string{channel, "*"} {
		for ch := range h.subscribers[key] {
			targets = append(targets, ch)
		}
	}
	h.mu.Unlock()
	for _, ch := range targets {
		select {
		case ch <- event:
		default:
		}
	}
}

func (h *realClientE2EHost) tailTaskEvents(ctx context.Context) {
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.publishRecentTaskEvents()
		}
	}
}

func (h *realClientE2EHost) publishRecentTaskEvents() {
	if h.app.localStore == nil {
		return
	}
	events, err := h.app.localStore.QueryRecentEvents(context.Background(), 500)
	if err != nil {
		return
	}
	sort.SliceStable(events, func(i, j int) bool {
		return events[i].TS < events[j].TS
	})
	for _, event := range events {
		key := event.EventID
		if key == "" {
			key = fmt.Sprintf("%s:%s:%s", event.TaskID, event.Type, event.TS)
		}
		h.mu.Lock()
		_, seen := h.seenEvents[key]
		if !seen {
			h.seenEvents[key] = struct{}{}
		}
		h.mu.Unlock()
		if !seen {
			h.broadcast("bridge", event)
		}
	}
}

func (h *realClientE2EHost) popFileDialog(multiple bool) any {
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.fileDialogQueue) == 0 {
		if multiple {
			return []string{}
		}
		return ""
	}
	next := h.fileDialogQueue[0]
	h.fileDialogQueue = h.fileDialogQueue[1:]
	if multiple {
		return next
	}
	if len(next) == 0 {
		return ""
	}
	return next[0]
}

func (h *realClientE2EHost) recordAction(kind, value string) {
	h.mu.Lock()
	h.actions = append(h.actions, realClientE2EAction{Kind: kind, Value: value})
	h.mu.Unlock()
}

func (h *realClientE2EHost) snapshotReport() map[string]any {
	h.mu.Lock()
	records := append([]realClientE2ERecord(nil), h.records...)
	actions := append([]realClientE2EAction(nil), h.actions...)
	issued := h.previewIssued
	revoked := h.previewRevoked
	h.mu.Unlock()
	return map[string]any{
		"status":        "running",
		"source":        "real-client-playwright",
		"startedAt":     h.startedAt.UTC().Format(time.RFC3339Nano),
		"generatedAt":   time.Now().UTC().Format(time.RFC3339Nano),
		"outputRoot":    h.outputRoot,
		"fixtures":      h.fixtures,
		"records":       records,
		"actions":       actions,
		"previewTokens": map[string]int{"issued": issued, "revoked": revoked},
		"reportBytes":   h.report.PayloadBytes(),
	}
}

func decodeRealClientInput(raw json.RawMessage, out any) error {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("decode rpc input: %w", err)
	}
	return nil
}

func decodeRealClientString(raw json.RawMessage) (string, error) {
	var value string
	if err := decodeRealClientInput(raw, &value); err != nil {
		return "", err
	}
	return value, nil
}

func writeRealClientJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	body, err := json.Marshal(value)
	if err != nil {
		writeRealClientError(w, http.StatusInternalServerError, err.Error())
		return
	}
	_, _ = w.Write(body)
	_, _ = w.Write([]byte("\n"))
}

func writeRealClientError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": message})
}

func writeClientE2EWorkbook(t *testing.T, path string) {
	t.Helper()
	file, err := os.Create(path)
	if err != nil {
		t.Fatalf("create xlsx fixture: %v", err)
	}
	zw := zip.NewWriter(file)
	files := map[string]string{
		"[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
		"_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
		"xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Sales" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
		"xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
		"xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>Month</t></is></c><c r="B1" t="inlineStr"><is><t>Revenue</t></is></c><c r="C1" t="inlineStr"><is><t>Cost</t></is></c></row>
<row r="2"><c r="A2" t="inlineStr"><is><t>January</t></is></c><c r="B2"><v>120</v></c><c r="C2"><v>80</v></c></row>
<row r="3"><c r="A3" t="inlineStr"><is><t>February</t></is></c><c r="B3"><v>150</v></c><c r="C3"><v>95</v></c></row>
<row r="4"><c r="A4" t="inlineStr"><is><t>March</t></is></c><c r="B4"><v>180</v></c><c r="C4"><v>110</v></c></row>
</sheetData>
</worksheet>`,
	}
	for name, body := range files {
		part, err := zw.Create(name)
		if err != nil {
			t.Fatalf("create xlsx part %s: %v", name, err)
		}
		if _, err := part.Write([]byte(body)); err != nil {
			t.Fatalf("write xlsx part %s: %v", name, err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("close xlsx fixture zip: %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("close xlsx fixture: %v", err)
	}
}

func onePixelPNG() []byte {
	return []byte{
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
		0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
		0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
		0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xff, 0xff, 0x3f,
		0x00, 0x05, 0xfe, 0x02, 0xfe, 0xdc, 0xcc, 0x59, 0xe7, 0x00, 0x00, 0x00,
		0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
	}
}
