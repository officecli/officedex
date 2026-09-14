package main

import (
	"context"
	"errors"
	"reflect"
	"testing"
)

type recordingAgentRuntime struct {
	method   string
	input    any
	response []byte
	err      error
}

func (r *recordingAgentRuntime) Request(_ context.Context, method string, input any) ([]byte, error) {
	r.method = method
	r.input = input
	return r.response, r.err
}

func TestAgentRuntimeDesktopBindings(t *testing.T) {
	payload := map[string]any{"workflow": "office.docx.edit.v1", "input": map[string]any{"parameters": map[string]any{"prompt": "Translate", "text": "你好", "scope": "selection"}}, "metadata": map[string]any{"origin_client_id": "editor-1"}}
	recorder := &recordingAgentRuntime{response: []byte(`{"id":"run-1","status":"completed","result":{"summary":"Translated","edits":[{"query":"你好","replacement":"Hello"}]}}`)}
	app := &App{ctx: context.Background(), agentRuntimeClient: recorder}
	cases := []struct {
		name, method string
		call         func() (any, error)
		input        any
	}{
		{"start", "run/start", func() (any, error) { return app.StartAgentRun(payload) }, payload},
		{"get", "run/get", func() (any, error) { return app.GetAgentRun("run-1") }, map[string]any{"run_id": "run-1"}},
		{"list", "run/list", func() (any, error) { return app.ListAgentRuns(50) }, map[string]any{"limit": 50}},
		{"respond", "run/respond", func() (any, error) { return app.RespondAgentRun(payload) }, payload},
		{"approve", "run/approve", func() (any, error) { return app.ApproveAgentRun(payload) }, payload},
		{"retry", "run/retry", func() (any, error) { return app.RetryAgentRun("run-1") }, map[string]any{"run_id": "run-1"}},
		{"cancel", "run/cancel", func() (any, error) { return app.CancelAgentRun("run-1") }, map[string]any{"run_id": "run-1"}},
		{"complete", "client-tool/result", func() (any, error) { return app.CompleteAgentClientTool(payload) }, payload},
		{"reassign", "client-tool/reassign", func() (any, error) { return app.ReassignAgentClientTool(payload) }, payload},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			result, err := tc.call()
			if err != nil {
				t.Fatal(err)
			}
			if recorder.method != tc.method || !reflect.DeepEqual(recorder.input, tc.input) {
				t.Fatalf("wrong RPC: %s %#v", recorder.method, recorder.input)
			}
			object, ok := result.(map[string]any)
			if !ok || object["id"] != "run-1" {
				t.Fatalf("result must remain a JSON object: %#v", result)
			}
		})
	}
	recorder.err = errors.New("provider unavailable")
	if _, err := app.GetAgentRun("run-1"); !errors.Is(err, recorder.err) {
		t.Fatalf("lost runtime error: %v", err)
	}
	recorder.err = nil
	recorder.response = []byte(`[]`)
	if result, err := app.ListAgentRuns(50); err != nil || reflect.TypeOf(result).Kind() != reflect.Slice {
		t.Fatalf("list: %#v %v", result, err)
	}
}
