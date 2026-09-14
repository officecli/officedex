package main

import (
	"context"
	"encoding/json"
	"fmt"
)

type agentRuntimeRequester interface {
	Request(context.Context, string, any) ([]byte, error)
}

// Agent methods expose the OfficeCLI run lifecycle to the desktop. Keep run
// payloads as JSON objects so Wails returns objects, not base64-encoded bytes.
func (a *App) agentRuntimeRequest(method string, input any) (any, error) {
	client := a.agentRuntimeClient
	if client == nil {
		var err error
		client, err = a.ensureBridge()
		if err != nil {
			return nil, err
		}
	}
	raw, err := client.Request(a.ctx, method, input)
	if err != nil {
		return nil, err
	}
	var result any
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("%s: decode runtime result: %w", method, err)
	}
	return result, nil
}

func (a *App) StartAgentRun(input map[string]any) (any, error) {
	return a.agentRuntimeRequest("run/start", input)
}

func (a *App) GetAgentRun(input string) (any, error) {
	return a.agentRuntimeRequest("run/get", map[string]any{"run_id": input})
}

func (a *App) ListAgentRuns(input int) (any, error) {
	return a.agentRuntimeRequest("run/list", map[string]any{"limit": input})
}

func (a *App) RespondAgentRun(input map[string]any) (any, error) {
	return a.agentRuntimeRequest("run/respond", input)
}

func (a *App) ApproveAgentRun(input map[string]any) (any, error) {
	return a.agentRuntimeRequest("run/approve", input)
}

func (a *App) RetryAgentRun(input string) (any, error) {
	return a.agentRuntimeRequest("run/retry", map[string]any{"run_id": input})
}

func (a *App) CancelAgentRun(input string) (any, error) {
	return a.agentRuntimeRequest("run/cancel", map[string]any{"run_id": input})
}

func (a *App) CompleteAgentClientTool(input map[string]any) (any, error) {
	return a.agentRuntimeRequest("client-tool/result", input)
}

func (a *App) ReassignAgentClientTool(input map[string]any) (any, error) {
	return a.agentRuntimeRequest("client-tool/reassign", input)
}
