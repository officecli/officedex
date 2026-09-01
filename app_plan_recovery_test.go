package main

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"officedex/internal/bridge"
	"officedex/internal/localstore"
	"officedex/internal/types"
)

func TestRespondRecoversStalePlanQuestionTask(t *testing.T) {
	ctx := context.Background()
	oldTaskID := "task-stale-plan-question"
	newTaskID := "task-recovered-plan-question"
	workspaceDir := t.TempDir()

	store := localstore.New(filepath.Join(t.TempDir(), "officedex.db"))
	if err := store.Open(ctx); err != nil {
		t.Fatalf("open local store: %v", err)
	}
	t.Cleanup(func() {
		_ = store.Close()
	})

	workspace, err := store.EnsureWorkspace(ctx, workspaceDir)
	if err != nil {
		t.Fatalf("EnsureWorkspace: %v", err)
	}
	if err := store.EnsureConversation(ctx, workspace.ID, "conversation-recover", "Generate investor deck"); err != nil {
		t.Fatalf("EnsureConversation: %v", err)
	}
	if err := store.RecordTaskContext(ctx, oldTaskID, localstore.TaskContext{
		WorkspaceID:    workspace.ID,
		ConversationID: "conversation-recover",
	}); err != nil {
		t.Fatalf("RecordTaskContext: %v", err)
	}
	if err := store.RecordEvent(types.BridgeEvent{
		EventID: "event-user-input",
		TaskID:  oldTaskID,
		Type:    "task.user_input",
		Payload: map[string]any{
			"document_type": "pptx",
			"topic":         "Investor deck",
			"prompt":        "Generate an investor deck",
			"enable_images": true,
			"local_preview": true,
		},
	}); err != nil {
		t.Fatalf("RecordEvent user input: %v", err)
	}
	if err := store.RecordEvent(types.BridgeEvent{
		EventID: "event-question",
		TaskID:  oldTaskID,
		Type:    "task.question",
		Payload: map[string]any{
			"id":           "question-group",
			"question":     "Who is the audience?",
			"currentIndex": 1,
			"questions": []map[string]any{
				{"id": "q-audience", "question": "Who is the audience?"},
				{"id": "q-tone", "question": "Which tone should it use?"},
			},
		},
	}); err != nil {
		t.Fatalf("RecordEvent question: %v", err)
	}
	if err := store.RecordTaskAnswers(ctx, oldTaskID, []localstore.TaskAnswer{
		{QuestionGroupID: "question-group", QuestionID: "q-audience", OptionID: "leadership", Answer: "Leadership", QuestionIndex: 0},
	}); err != nil {
		t.Fatalf("RecordTaskAnswers existing: %v", err)
	}

	transport := newCancelPersistTransport()
	client := bridge.New(bridge.Options{
		RequestTimeout: 500 * time.Millisecond,
		CreateTransport: func(opts bridge.Options) (bridge.Transport, error) {
			return transport, nil
		},
		DisableAutoReconnect: true,
	})
	if err := client.Start(ctx); err != nil {
		t.Fatalf("start bridge client: %v", err)
	}
	t.Cleanup(client.Stop)

	app := &App{
		ctx:             ctx,
		userDataDir:     t.TempDir(),
		workspaceDir:    workspaceDir,
		localStore:      store,
		bridgeClients:   map[string]*bridge.Client{workspaceDir: client},
		bridgeRecentCwd: workspaceDir,
	}

	done := make(chan struct {
		raw []byte
		err error
	}, 1)
	go func() {
		raw, err := app.Respond(RespondInput{
			TaskID:     oldTaskID,
			QuestionID: "question-group",
			OptionID:   "concise",
			Answer:     "Concise",
			Answers: []RespondAnswerInput{
				{QuestionGroupID: "question-group", QuestionID: "q-audience", OptionID: "leadership", Answer: "Leadership", QuestionIndex: 0},
				{QuestionGroupID: "question-group", QuestionID: "q-tone", OptionID: "concise", Answer: "Concise", QuestionIndex: 1},
			},
		})
		done <- struct {
			raw []byte
			err error
		}{raw: raw, err: err}
	}()

	req := transport.readRequest(t)
	if req.Method != "task/respond" {
		t.Fatalf("bridge request method = %q, want task/respond", req.Method)
	}
	transport.writeError(t, req.ID, "task not found: "+oldTaskID)

	req = transport.readRequest(t)
	if req.Method != "session/open" {
		t.Fatalf("bridge request method = %q, want session/open", req.Method)
	}
	transport.writeResponse(t, req.ID, map[string]any{"id": "session-recovered"})

	req = transport.readRequest(t)
	if req.Method != "task/invoke" {
		t.Fatalf("bridge request method = %q, want task/invoke", req.Method)
	}
	var invokeParams map[string]any
	if err := json.Unmarshal(req.Params, &invokeParams); err != nil {
		t.Fatalf("decode task/invoke params: %v", err)
	}
	args, ok := invokeParams["args"].(map[string]any)
	if !ok {
		t.Fatalf("task/invoke args = %#v", invokeParams["args"])
	}
	if args["document_type"] != "pptx" || args["prompt"] != "Generate an investor deck" {
		t.Fatalf("task/invoke args = %#v", args)
	}
	if args["topic"] != "Investor deck" {
		t.Fatalf("task/invoke topic = %#v, want Investor deck; args=%#v", args["topic"], args)
	}
	transport.writeResponse(t, req.ID, map[string]any{"task_id": newTaskID, "session_id": "session-recovered", "status": "running"})

	req = transport.readRequest(t)
	if req.Method != "task/status" {
		t.Fatalf("bridge request method = %q, want task/status", req.Method)
	}
	transport.writeResponse(t, req.ID, map[string]any{
		"task_id":    newTaskID,
		"session_id": "session-recovered",
		"status":     "question",
		"current_question": map[string]any{
			"id":            "question-group",
			"current_index": 0,
			"questions": []map[string]any{
				{"id": "q-audience", "question": "Who is the audience?"},
				{"id": "q-tone", "question": "Which tone should it use?"},
			},
		},
	})

	req = transport.readRequest(t)
	if req.Method != "task/respond" {
		t.Fatalf("bridge request method = %q, want recovered task/respond", req.Method)
	}
	var respondParams map[string]any
	if err := json.Unmarshal(req.Params, &respondParams); err != nil {
		t.Fatalf("decode recovered task/respond params: %v", err)
	}
	if respondParams["task_id"] != newTaskID {
		t.Fatalf("recovered task_id = %q, want %q", respondParams["task_id"], newTaskID)
	}
	rawAnswers, ok := respondParams["answers"].([]any)
	if !ok || len(rawAnswers) != 2 {
		t.Fatalf("recovered answers = %#v, want two answers", respondParams["answers"])
	}
	if respondParams["option_id"] != "concise" || respondParams["answer"] != "Concise" {
		t.Fatalf("recovered single-answer fallback = option_id:%#v answer:%#v, want concise/Concise", respondParams["option_id"], respondParams["answer"])
	}
	transport.writeResponse(t, req.ID, map[string]any{"accepted": true, "task_id": newTaskID})

	select {
	case out := <-done:
		if out.err != nil {
			t.Fatalf("Respond: %v", out.err)
		}
		text := string(out.raw)
		if !strings.Contains(text, `"recoveredFrom":"`+oldTaskID+`"`) || !strings.Contains(text, `"taskId":"`+newTaskID+`"`) {
			t.Fatalf("Respond raw = %s, want recovered metadata", text)
		}
	case <-time.After(time.Second):
		t.Fatal("Respond did not return")
	}

	answers, err := store.QueryTaskAnswers(ctx, oldTaskID)
	if err != nil {
		t.Fatalf("QueryTaskAnswers: %v", err)
	}
	if len(answers) != 2 || answers[1].QuestionID != "q-tone" || answers[1].OptionID != "concise" {
		t.Fatalf("persisted answers after recovery = %#v", answers)
	}
	recoveredAnswers, err := store.QueryTaskAnswers(ctx, newTaskID)
	if err != nil {
		t.Fatalf("QueryTaskAnswers recovered: %v", err)
	}
	if len(recoveredAnswers) != 2 || recoveredAnswers[0].QuestionID != "q-audience" || recoveredAnswers[1].QuestionID != "q-tone" {
		t.Fatalf("replacement answer history = %#v, want both prior answers", recoveredAnswers)
	}
}

func TestRecoveryInheritsMultiQuestionAnswersFromRecoveredParent(t *testing.T) {
	ctx := context.Background()
	store := localstore.New(filepath.Join(t.TempDir(), "officedex.db"))
	if err := store.Open(ctx); err != nil {
		t.Fatalf("open local store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	parentTaskID := "task-recovery-parent"
	childTaskID := "task-recovery-child"
	if err := store.RecordEvent(types.BridgeEvent{
		TaskID: parentTaskID,
		Type:   "task.cancelled",
		Payload: map[string]any{
			"message": "Task was recovered after the application restarted",
		},
	}); err != nil {
		t.Fatalf("RecordEvent parent cancellation: %v", err)
	}
	if err := store.RecordTaskAnswers(ctx, parentTaskID, []localstore.TaskAnswer{
		{QuestionGroupID: "question-old", QuestionID: "q1", OptionID: "overview", Answer: "Overview", QuestionIndex: 0},
		{QuestionGroupID: "question-old", QuestionID: "q2", OptionID: "monthly", Answer: "Monthly", QuestionIndex: 1},
		{QuestionGroupID: "question-old", QuestionID: "q3", OptionID: "company", Answer: "Company", QuestionIndex: 2},
	}); err != nil {
		t.Fatalf("RecordTaskAnswers parent: %v", err)
	}
	childEvents := []types.BridgeEvent{{
		TaskID: childTaskID,
		Type:   "task.question",
		Payload: map[string]any{
			"id": "question-live",
			"questions": []map[string]any{
				{"id": "q1"},
				{"id": "q2"},
				{"id": "q3"},
			},
		},
	}}
	app := &App{ctx: ctx, localStore: store}
	merged, err := app.inheritRecoveredMultiQuestionAnswers(ctx, localstore.TaskContext{ParentTaskID: parentTaskID}, childEvents, []localstore.TaskAnswer{
		{QuestionGroupID: "question-live", QuestionID: "q2", OptionID: "quarterly", Answer: "Quarterly", QuestionIndex: 1},
	})
	if err != nil {
		t.Fatalf("inheritRecoveredMultiQuestionAnswers: %v", err)
	}
	if len(merged) != 3 {
		t.Fatalf("merged answers = %#v, want three inherited answers", merged)
	}
	if merged[1].OptionID != "quarterly" || merged[1].Answer != "Quarterly" || merged[1].QuestionGroupID != "question-old" {
		t.Fatalf("merged current answer = %#v, want latest value in inherited group", merged[1])
	}
}

// TestRespondRecoveryUsesLivePendingQuestionID reproduces the restart bug where
// the re-created bridge task re-mints the question ID from a per-process counter,
// so the renderer's replayed (stale) question ID no longer matches. The recovery
// path must answer with the live pending ID, not the stale one, or the bridge
// rejects it with "question mismatch".
func TestRespondRecoveryUsesLivePendingQuestionID(t *testing.T) {
	ctx := context.Background()
	oldTaskID := "task-stale-idea"
	newTaskID := "task-recovered-idea"
	staleQuestionID := "question-000016"
	liveQuestionID := "question-000006"
	workspaceDir := t.TempDir()

	store := localstore.New(filepath.Join(t.TempDir(), "officedex.db"))
	if err := store.Open(ctx); err != nil {
		t.Fatalf("open local store: %v", err)
	}
	t.Cleanup(func() {
		_ = store.Close()
	})

	workspace, err := store.EnsureWorkspace(ctx, workspaceDir)
	if err != nil {
		t.Fatalf("EnsureWorkspace: %v", err)
	}
	if err := store.EnsureConversation(ctx, workspace.ID, "conversation-idea", "Introduce Shimo Docs"); err != nil {
		t.Fatalf("EnsureConversation: %v", err)
	}
	if err := store.RecordTaskContext(ctx, oldTaskID, localstore.TaskContext{
		WorkspaceID:    workspace.ID,
		ConversationID: "conversation-idea",
	}); err != nil {
		t.Fatalf("RecordTaskContext: %v", err)
	}
	if err := store.RecordEvent(types.BridgeEvent{
		EventID: "event-user-input",
		TaskID:  oldTaskID,
		Type:    "task.user_input",
		Payload: map[string]any{
			"document_type": "pptx",
			"topic":         "Introduce Shimo Docs",
			"prompt":        "Introduce Shimo Docs",
			"local_preview": true,
		},
	}); err != nil {
		t.Fatalf("RecordEvent user input: %v", err)
	}
	if err := store.RecordEvent(types.BridgeEvent{
		EventID: "event-question",
		TaskID:  oldTaskID,
		Type:    "task.question",
		Payload: map[string]any{
			"id":       staleQuestionID,
			"question": "Confirm the Idea",
		},
	}); err != nil {
		t.Fatalf("RecordEvent question: %v", err)
	}

	transport := newCancelPersistTransport()
	client := bridge.New(bridge.Options{
		RequestTimeout: 500 * time.Millisecond,
		CreateTransport: func(opts bridge.Options) (bridge.Transport, error) {
			return transport, nil
		},
		DisableAutoReconnect: true,
	})
	if err := client.Start(ctx); err != nil {
		t.Fatalf("start bridge client: %v", err)
	}
	t.Cleanup(client.Stop)

	app := &App{
		ctx:             ctx,
		userDataDir:     t.TempDir(),
		workspaceDir:    workspaceDir,
		localStore:      store,
		bridgeClients:   map[string]*bridge.Client{workspaceDir: client},
		bridgeRecentCwd: workspaceDir,
	}

	done := make(chan struct {
		raw []byte
		err error
	}, 1)
	go func() {
		// The renderer confirms with the stale, replayed question ID.
		raw, err := app.Respond(RespondInput{
			TaskID:     oldTaskID,
			QuestionID: staleQuestionID,
			OptionID:   "confirm",
			Answer:     "Confirm",
		})
		done <- struct {
			raw []byte
			err error
		}{raw: raw, err: err}
	}()

	req := transport.readRequest(t)
	if req.Method != "task/respond" {
		t.Fatalf("bridge request method = %q, want task/respond", req.Method)
	}
	transport.writeError(t, req.ID, "task not found: "+oldTaskID)

	req = transport.readRequest(t)
	if req.Method != "session/open" {
		t.Fatalf("bridge request method = %q, want session/open", req.Method)
	}
	transport.writeResponse(t, req.ID, map[string]any{"id": "session-recovered"})

	req = transport.readRequest(t)
	if req.Method != "task/invoke" {
		t.Fatalf("bridge request method = %q, want task/invoke", req.Method)
	}
	transport.writeResponse(t, req.ID, map[string]any{"task_id": newTaskID, "session_id": "session-recovered", "status": "running"})

	req = transport.readRequest(t)
	if req.Method != "task/status" {
		t.Fatalf("bridge request method = %q, want task/status", req.Method)
	}
	// The re-created task is waiting on a freshly minted question ID.
	transport.writeResponse(t, req.ID, map[string]any{
		"task_id":    newTaskID,
		"session_id": "session-recovered",
		"status":     "question",
		"current_question": map[string]any{
			"id":       liveQuestionID,
			"question": "Confirm the Idea",
		},
	})

	req = transport.readRequest(t)
	if req.Method != "task/respond" {
		t.Fatalf("bridge request method = %q, want recovered task/respond", req.Method)
	}
	var respondParams map[string]any
	if err := json.Unmarshal(req.Params, &respondParams); err != nil {
		t.Fatalf("decode recovered task/respond params: %v", err)
	}
	if respondParams["task_id"] != newTaskID {
		t.Fatalf("recovered task_id = %q, want %q", respondParams["task_id"], newTaskID)
	}
	if respondParams["question_id"] != liveQuestionID {
		t.Fatalf("recovered question_id = %#v, want live %q (not stale %q)", respondParams["question_id"], liveQuestionID, staleQuestionID)
	}
	transport.writeResponse(t, req.ID, map[string]any{"accepted": true, "task_id": newTaskID})

	select {
	case out := <-done:
		if out.err != nil {
			t.Fatalf("Respond: %v", out.err)
		}
	case <-time.After(time.Second):
		t.Fatal("Respond did not return")
	}

	// The next step still answers against the stale (renderer-held) id, but it
	// must now route straight to the live recovered task — a single task/respond
	// to newTaskID, with no second from-scratch recovery (session/open +
	// task/invoke) that would replay an empty answer into the idea gate.
	done2 := make(chan struct {
		raw []byte
		err error
	}, 1)
	go func() {
		raw, err := app.Respond(RespondInput{
			TaskID:     oldTaskID,
			QuestionID: "stale-vibe-story-ready",
			OptionID:   "generate_chapters",
		})
		done2 <- struct {
			raw []byte
			err error
		}{raw: raw, err: err}
	}()

	req = transport.readRequest(t)
	if req.Method != "task/status" {
		t.Fatalf("follow-up request method = %q, want task/status to resolve the live question id", req.Method)
	}
	transport.writeResponse(t, req.ID, map[string]any{
		"task_id":    newTaskID,
		"session_id": "session-recovered",
		"status":     "question",
		"current_question": map[string]any{
			"id":       "vibe-story-live-id",
			"question": "Generate Chapters?",
		},
	})

	req = transport.readRequest(t)
	if req.Method != "task/respond" {
		t.Fatalf("follow-up request method = %q, want task/respond after live status lookup", req.Method)
	}
	var followParams map[string]any
	if err := json.Unmarshal(req.Params, &followParams); err != nil {
		t.Fatalf("decode follow-up task/respond params: %v", err)
	}
	if followParams["task_id"] != newTaskID {
		t.Fatalf("follow-up task_id = %#v, want live %q", followParams["task_id"], newTaskID)
	}
	if followParams["question_id"] != "vibe-story-live-id" {
		t.Fatalf("follow-up question_id = %#v, want live pending id", followParams["question_id"])
	}
	if followParams["option_id"] != "generate_chapters" {
		t.Fatalf("follow-up option_id = %#v, want generate_chapters", followParams["option_id"])
	}
	transport.writeResponse(t, req.ID, map[string]any{"accepted": true, "task_id": newTaskID})

	select {
	case out := <-done2:
		if out.err != nil {
			t.Fatalf("follow-up Respond: %v", out.err)
		}
	case <-time.After(time.Second):
		t.Fatal("follow-up Respond did not return")
	}
}

// TestRespondRecoveryReplaysFullAnswerHistory covers a restart at a LATER step:
// the recovered task re-runs from the idea gate, so recovery must replay every
// prior confirmation in order (idea confirm -> generate chapters -> current
// step) instead of delivering the current step's empty-bodied action to the
// idea gate (which would fail with "idea confirmation is required").
func TestRespondRecoveryReplaysFullAnswerHistory(t *testing.T) {
	ctx := context.Background()
	oldTaskID := "task-stale-later-step"
	newTaskID := "task-recovered-later-step"
	ideaAnswer := `{"kind":"vibe_node_confirmed","nodeId":"root"}`
	workspaceDir := t.TempDir()

	store := localstore.New(filepath.Join(t.TempDir(), "officedex.db"))
	if err := store.Open(ctx); err != nil {
		t.Fatalf("open local store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	workspace, err := store.EnsureWorkspace(ctx, workspaceDir)
	if err != nil {
		t.Fatalf("EnsureWorkspace: %v", err)
	}
	if err := store.EnsureConversation(ctx, workspace.ID, "conversation-later", "Introduce Shimo Docs"); err != nil {
		t.Fatalf("EnsureConversation: %v", err)
	}
	if err := store.RecordTaskContext(ctx, oldTaskID, localstore.TaskContext{
		WorkspaceID:    workspace.ID,
		ConversationID: "conversation-later",
	}); err != nil {
		t.Fatalf("RecordTaskContext: %v", err)
	}
	if err := store.RecordEvent(types.BridgeEvent{
		EventID: "event-user-input",
		TaskID:  oldTaskID,
		Type:    "task.user_input",
		Payload: map[string]any{
			"document_type": "pptx",
			"topic":         "Introduce Shimo Docs",
			"prompt":        "Introduce Shimo Docs",
			"local_preview": true,
		},
	}); err != nil {
		t.Fatalf("RecordEvent user input: %v", err)
	}
	if err := store.RecordEvent(types.BridgeEvent{
		EventID: "event-question",
		TaskID:  oldTaskID,
		Type:    "task.question",
		Payload: map[string]any{"id": "question-old-outline", "question": "Chapter 已生成"},
	}); err != nil {
		t.Fatalf("RecordEvent question: %v", err)
	}
	// Prior confirmations made before the restart: idea gate, then story_ready.
	if err := store.RecordTaskAnswers(ctx, oldTaskID, []localstore.TaskAnswer{
		{QuestionID: "q-idea", Answer: ideaAnswer, QuestionIndex: -1},
		{QuestionID: "q-story", OptionID: "generate_chapters", QuestionIndex: -1},
	}); err != nil {
		t.Fatalf("RecordTaskAnswers prior: %v", err)
	}

	transport := newCancelPersistTransport()
	client := bridge.New(bridge.Options{
		RequestTimeout: 500 * time.Millisecond,
		CreateTransport: func(opts bridge.Options) (bridge.Transport, error) {
			return transport, nil
		},
		DisableAutoReconnect: true,
	})
	if err := client.Start(ctx); err != nil {
		t.Fatalf("start bridge client: %v", err)
	}
	t.Cleanup(client.Stop)

	app := &App{
		ctx:             ctx,
		userDataDir:     t.TempDir(),
		workspaceDir:    workspaceDir,
		localStore:      store,
		bridgeClients:   map[string]*bridge.Client{workspaceDir: client},
		bridgeRecentCwd: workspaceDir,
	}

	done := make(chan struct {
		raw []byte
		err error
	}, 1)
	go func() {
		// The current (post-restart) step is the next action; its answer body is
		// empty — exactly the input that previously misfired into the idea gate.
		raw, err := app.Respond(RespondInput{
			TaskID:     oldTaskID,
			QuestionID: "question-old-outline",
			OptionID:   "generate_outline",
		})
		done <- struct {
			raw []byte
			err error
		}{raw: raw, err: err}
	}()

	req := transport.readRequest(t)
	if req.Method != "task/respond" {
		t.Fatalf("bridge request method = %q, want task/respond", req.Method)
	}
	transport.writeError(t, req.ID, "task not found: "+oldTaskID)

	req = transport.readRequest(t)
	if req.Method != "session/open" {
		t.Fatalf("bridge request method = %q, want session/open", req.Method)
	}
	transport.writeResponse(t, req.ID, map[string]any{"id": "session-recovered"})

	req = transport.readRequest(t)
	if req.Method != "task/invoke" {
		t.Fatalf("bridge request method = %q, want task/invoke", req.Method)
	}
	transport.writeResponse(t, req.ID, map[string]any{"task_id": newTaskID, "session_id": "session-recovered", "status": "running"})

	// Each stage replays in order against its own live (re-minted) question id.
	type expectStage struct {
		liveQuestionID string
		wantOption     string
		wantAnswer     string
	}
	stages := []expectStage{
		{liveQuestionID: "question-000003", wantOption: "", wantAnswer: ideaAnswer},
		{liveQuestionID: "question-000007", wantOption: "generate_chapters", wantAnswer: ""},
		{liveQuestionID: "question-000011", wantOption: "generate_outline", wantAnswer: ""},
	}
	for i, stage := range stages {
		req = transport.readRequest(t)
		if req.Method != "task/status" {
			t.Fatalf("stage %d method = %q, want task/status", i, req.Method)
		}
		transport.writeResponse(t, req.ID, map[string]any{
			"task_id":          newTaskID,
			"session_id":       "session-recovered",
			"status":           "question",
			"current_question": map[string]any{"id": stage.liveQuestionID, "question": "stage"},
		})

		req = transport.readRequest(t)
		if req.Method != "task/respond" {
			t.Fatalf("stage %d method = %q, want task/respond", i, req.Method)
		}
		var p map[string]any
		if err := json.Unmarshal(req.Params, &p); err != nil {
			t.Fatalf("stage %d decode params: %v", i, err)
		}
		if p["task_id"] != newTaskID {
			t.Fatalf("stage %d task_id = %#v, want %q", i, p["task_id"], newTaskID)
		}
		if p["question_id"] != stage.liveQuestionID {
			t.Fatalf("stage %d question_id = %#v, want live %q", i, p["question_id"], stage.liveQuestionID)
		}
		if p["option_id"] != stage.wantOption {
			t.Fatalf("stage %d option_id = %#v, want %q", i, p["option_id"], stage.wantOption)
		}
		if p["answer"] != stage.wantAnswer {
			t.Fatalf("stage %d answer = %#v, want %q", i, p["answer"], stage.wantAnswer)
		}
		transport.writeResponse(t, req.ID, map[string]any{"accepted": true, "task_id": newTaskID})
	}

	select {
	case out := <-done:
		if out.err != nil {
			t.Fatalf("Respond: %v", out.err)
		}
	case <-time.After(time.Second):
		t.Fatal("Respond did not return")
	}
}

// TestRespondRecoverySkipsStalePerNodeFeedback ensures a per-node revision in
// the saved history is dropped during replay (its node id won't exist in the
// regenerated tree, which would crash the recovered task) while the surrounding
// stage-advancing answers still replay in order.
func TestRespondRecoverySkipsStalePerNodeFeedback(t *testing.T) {
	ctx := context.Background()
	oldTaskID := "task-stale-feedback"
	newTaskID := "task-recovered-feedback"
	ideaAnswer := `{"kind":"vibe_node_confirmed","nodeId":"root"}`
	feedbackAnswer := `{"kind":"vibe_node_feedback","nodeId":"branch-old","feedback":"punchier"}`
	workspaceDir := t.TempDir()

	store := localstore.New(filepath.Join(t.TempDir(), "officedex.db"))
	if err := store.Open(ctx); err != nil {
		t.Fatalf("open local store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	workspace, err := store.EnsureWorkspace(ctx, workspaceDir)
	if err != nil {
		t.Fatalf("EnsureWorkspace: %v", err)
	}
	if err := store.EnsureConversation(ctx, workspace.ID, "conversation-fb", "Introduce Shimo Docs"); err != nil {
		t.Fatalf("EnsureConversation: %v", err)
	}
	if err := store.RecordTaskContext(ctx, oldTaskID, localstore.TaskContext{
		WorkspaceID:    workspace.ID,
		ConversationID: "conversation-fb",
	}); err != nil {
		t.Fatalf("RecordTaskContext: %v", err)
	}
	if err := store.RecordEvent(types.BridgeEvent{
		EventID: "event-user-input",
		TaskID:  oldTaskID,
		Type:    "task.user_input",
		Payload: map[string]any{"document_type": "pptx", "topic": "Introduce Shimo Docs", "prompt": "Introduce Shimo Docs", "local_preview": true},
	}); err != nil {
		t.Fatalf("RecordEvent user input: %v", err)
	}
	if err := store.RecordEvent(types.BridgeEvent{
		EventID: "event-question",
		TaskID:  oldTaskID,
		Type:    "task.question",
		Payload: map[string]any{"id": "question-old-story", "question": "Project Map 已生成"},
	}); err != nil {
		t.Fatalf("RecordEvent question: %v", err)
	}
	// Prior history: idea confirm, then a per-node feedback at the story stage.
	if err := store.RecordTaskAnswers(ctx, oldTaskID, []localstore.TaskAnswer{
		{QuestionID: "q-a-idea", Answer: ideaAnswer, QuestionIndex: -1},
		{QuestionID: "q-b-feedback", Answer: feedbackAnswer, QuestionIndex: -1},
	}); err != nil {
		t.Fatalf("RecordTaskAnswers prior: %v", err)
	}

	transport := newCancelPersistTransport()
	client := bridge.New(bridge.Options{
		RequestTimeout:       500 * time.Millisecond,
		CreateTransport:      func(opts bridge.Options) (bridge.Transport, error) { return transport, nil },
		DisableAutoReconnect: true,
	})
	if err := client.Start(ctx); err != nil {
		t.Fatalf("start bridge client: %v", err)
	}
	t.Cleanup(client.Stop)

	app := &App{
		ctx:             ctx,
		userDataDir:     t.TempDir(),
		workspaceDir:    workspaceDir,
		localStore:      store,
		bridgeClients:   map[string]*bridge.Client{workspaceDir: client},
		bridgeRecentCwd: workspaceDir,
	}

	done := make(chan struct {
		raw []byte
		err error
	}, 1)
	go func() {
		raw, err := app.Respond(RespondInput{
			TaskID:     oldTaskID,
			QuestionID: "question-old-story",
			OptionID:   "generate_chapters",
		})
		done <- struct {
			raw []byte
			err error
		}{raw: raw, err: err}
	}()

	req := transport.readRequest(t)
	if req.Method != "task/respond" {
		t.Fatalf("method = %q, want task/respond", req.Method)
	}
	transport.writeError(t, req.ID, "task not found: "+oldTaskID)

	req = transport.readRequest(t)
	if req.Method != "session/open" {
		t.Fatalf("method = %q, want session/open", req.Method)
	}
	transport.writeResponse(t, req.ID, map[string]any{"id": "session-recovered"})

	req = transport.readRequest(t)
	if req.Method != "task/invoke" {
		t.Fatalf("method = %q, want task/invoke", req.Method)
	}
	transport.writeResponse(t, req.ID, map[string]any{"task_id": newTaskID, "session_id": "session-recovered", "status": "running"})

	// Only two responds: idea confirm then the generate_chapters action. The
	// per-node feedback must NOT be replayed.
	type expectStage struct {
		liveQuestionID string
		wantOption     string
		wantAnswer     string
	}
	stages := []expectStage{
		{liveQuestionID: "question-000003", wantOption: "", wantAnswer: ideaAnswer},
		{liveQuestionID: "question-000007", wantOption: "generate_chapters", wantAnswer: ""},
	}
	for i, stage := range stages {
		req = transport.readRequest(t)
		if req.Method != "task/status" {
			t.Fatalf("stage %d method = %q, want task/status", i, req.Method)
		}
		transport.writeResponse(t, req.ID, map[string]any{
			"task_id":          newTaskID,
			"session_id":       "session-recovered",
			"status":           "question",
			"current_question": map[string]any{"id": stage.liveQuestionID, "question": "stage"},
		})

		req = transport.readRequest(t)
		if req.Method != "task/respond" {
			t.Fatalf("stage %d method = %q, want task/respond", i, req.Method)
		}
		var p map[string]any
		if err := json.Unmarshal(req.Params, &p); err != nil {
			t.Fatalf("stage %d decode: %v", i, err)
		}
		if p["question_id"] != stage.liveQuestionID {
			t.Fatalf("stage %d question_id = %#v, want %q", i, p["question_id"], stage.liveQuestionID)
		}
		if p["answer"] != stage.wantAnswer {
			t.Fatalf("stage %d answer = %#v, want %q (feedback must be skipped)", i, p["answer"], stage.wantAnswer)
		}
		if p["option_id"] != stage.wantOption {
			t.Fatalf("stage %d option_id = %#v, want %q", i, p["option_id"], stage.wantOption)
		}
		transport.writeResponse(t, req.ID, map[string]any{"accepted": true, "task_id": newTaskID})
	}

	select {
	case out := <-done:
		if out.err != nil {
			t.Fatalf("Respond: %v", out.err)
		}
	case <-time.After(time.Second):
		t.Fatal("Respond did not return")
	}
}

func TestRecoverGenerateInputFromEventsFillsMissingTopicFromPrompt(t *testing.T) {
	got, err := recoverGenerateInputFromEvents([]types.BridgeEvent{
		{
			EventID: "event-user-input",
			TaskID:  "task-prompt-only",
			Type:    "task.user_input",
			Payload: map[string]any{
				"document_type": "pptx",
				"prompt":        "Generate a reloaded deck",
			},
		},
		{
			EventID: "event-question",
			TaskID:  "task-prompt-only",
			Type:    "task.question",
			Payload: map[string]any{"id": "question-group"},
		},
	}, localstore.TaskContext{WorkspaceID: "ws-1", ConversationID: "conversation-1"})
	if err != nil {
		t.Fatalf("recoverGenerateInputFromEvents: %v", err)
	}
	if got.Topic != "Generate a reloaded deck" {
		t.Fatalf("Topic = %q, want prompt fallback", got.Topic)
	}
	if got.Prompt != "Generate a reloaded deck" {
		t.Fatalf("Prompt = %q, want original prompt", got.Prompt)
	}
}

func TestRecoverGenerateInputFromEventsReadsNestedTextInputTopic(t *testing.T) {
	got, err := recoverGenerateInputFromEvents([]types.BridgeEvent{
		{
			EventID: "event-user-input",
			TaskID:  "task-nested-topic",
			Type:    "task.user_input",
			Payload: map[string]any{
				"documentType": "docx",
				"text_input": map[string]any{
					"topic":  "Quarterly impact report",
					"prompt": "Write a concise quarterly impact report",
				},
			},
		},
		{
			EventID: "event-question",
			TaskID:  "task-nested-topic",
			Type:    "task.question",
			Payload: map[string]any{"id": "question-group"},
		},
	}, localstore.TaskContext{WorkspaceID: "ws-1", ConversationID: "conversation-1"})
	if err != nil {
		t.Fatalf("recoverGenerateInputFromEvents: %v", err)
	}
	if got.Topic != "Quarterly impact report" {
		t.Fatalf("Topic = %q, want nested text_input topic", got.Topic)
	}
	if got.Prompt != "Write a concise quarterly impact report" {
		t.Fatalf("Prompt = %q, want nested text_input prompt", got.Prompt)
	}
}

func TestGenerateInputEventPayloadBackfillsTopicFromPrompt(t *testing.T) {
	payload := generateInputEventPayload(types.GenerateInput{
		DocumentType: types.DocPPTX,
		Prompt:       "Generate a recovery-safe deck",
	}, localstore.TaskContext{})
	if payload["topic"] != "Generate a recovery-safe deck" {
		t.Fatalf("payload topic = %#v, want prompt fallback; payload=%#v", payload["topic"], payload)
	}
	if payload["prompt"] != "Generate a recovery-safe deck" {
		t.Fatalf("payload prompt = %#v, want original prompt; payload=%#v", payload["prompt"], payload)
	}
}

func TestGenerateInputEventPayloadAndRecoveryPreserveGenerationMode(t *testing.T) {
	payload := generateInputEventPayload(types.GenerateInput{
		DocumentType:   types.DocDOCX,
		Topic:          "Plan mode recovery",
		Prompt:         "Write a plan-mode document",
		GenerationMode: "plan",
	}, localstore.TaskContext{})
	if payload["generation_mode"] != "plan" || payload["generationMode"] != "plan" {
		t.Fatalf("generation mode payload = %#v", payload)
	}
	if _, ok := payload["runtime_mode"]; ok {
		t.Fatalf("runtime_mode should not carry generation mode: %#v", payload["runtime_mode"])
	}

	got, err := recoverGenerateInputFromEvents([]types.BridgeEvent{
		{
			EventID: "event-user-input",
			TaskID:  "task-plan-recovery",
			Type:    "task.user_input",
			Payload: payload,
		},
		{
			EventID: "event-question",
			TaskID:  "task-plan-recovery",
			Type:    "task.question",
			Payload: map[string]any{"id": "question-group"},
		},
	}, localstore.TaskContext{})
	if err != nil {
		t.Fatalf("recoverGenerateInputFromEvents: %v", err)
	}
	if got.GenerationMode != "plan" {
		t.Fatalf("GenerationMode = %q, want plan", got.GenerationMode)
	}
	if got.RuntimeMode != "" {
		t.Fatalf("RuntimeMode = %q, want empty", got.RuntimeMode)
	}
}
