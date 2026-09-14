package main

import (
	"context"
	"officedex/internal/bridge"
	"time"
)

// GetPptxTaskStatus queries the task owner; it does not replay task histories.
func (a *App) GetPptxTaskStatus(taskID string) (bridge.TaskStatusResult, error) {
	client, err := a.ensureBridgeForTask(taskID)
	if err != nil {
		return bridge.TaskStatusResult{}, err
	}
	parent := a.ctx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, 8*time.Second)
	defer cancel()
	result, err := client.CompactTaskStatus(ctx, taskID)
	return result, withBridgeErrorCode(err)
}
