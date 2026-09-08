package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"

	"officedex/internal/atomicfile"
)

type processIdentity struct {
	PID               int    `json:"pid"`
	DesktopInstanceID string `json:"desktop_instance_id"`
	StartedAt         string `json:"started_at"`
}

// resumableTaskManifestName is the file the bridge reads to learn which tasks
// this app still expects to resume. The name predates that use.
const resumableTaskManifestName = "legacy-migration.json"

type resumableTaskManifest struct {
	ClientID string   `json:"client_id"`
	TaskIDs  []string `json:"task_ids"`
}

func (a *App) writeProcessIdentity() error {
	if a.userDataDir == "" {
		return fmt.Errorf("process identity: user data directory is empty")
	}
	if err := os.MkdirAll(a.userDataDir, 0o700); err != nil {
		return err
	}
	payload, err := json.Marshal(processIdentity{PID: os.Getpid(), DesktopInstanceID: a.desktopInstanceID, StartedAt: time.Now().UTC().Format(time.RFC3339Nano)})
	if err != nil {
		return err
	}
	return atomicfile.WriteFile(filepath.Join(a.userDataDir, "process.json"), append(payload, '\n'), 0o600)
}

func (a *App) removeProcessIdentity() {
	if a.userDataDir == "" {
		return
	}
	path := filepath.Join(a.userDataDir, "process.json")
	raw, err := os.ReadFile(path)
	if err == nil {
		var identity processIdentity
		if json.Unmarshal(raw, &identity) == nil && identity.PID != 0 && identity.PID != os.Getpid() {
			return
		}
	}
	_ = os.Remove(path)
}

// publishResumableTaskManifest tells the bridge which tasks this app still
// expects to resume, so a run whose task is gone can be cancelled instead of
// replayed. Call it after failInterruptedTasks: whatever survives that pass is
// what "resumable" means, and deriving the list from the store afterwards
// keeps that policy in one place.
//
// The file name is historical -- it was added for a runtime migration and
// never read by anything -- but the manifest it holds is now the contract that
// stops abandoned runs from resurrecting their desktop tasks. See
// agent_bridge_desktop_reconcile.go on the officecli side.
func (a *App) publishResumableTaskManifest(ctx context.Context) error {
	if a.localStore == nil || a.runtimeRoot == "" {
		return nil
	}
	if err := os.MkdirAll(a.runtimeRoot, 0o700); err != nil {
		return err
	}
	ids := make([]string, 0)
	for _, status := range []string{"starting", "running", "question", "plan_review"} {
		part, err := a.localStore.QueryTaskIDsByStatus(ctx, status)
		if err != nil {
			return err
		}
		ids = append(ids, part...)
	}
	sort.Strings(ids)
	manifest, err := json.MarshalIndent(resumableTaskManifest{ClientID: a.desktopInstanceID, TaskIDs: ids}, "", "  ")
	if err != nil {
		return err
	}
	manifest = append(manifest, '\n')
	return atomicfile.WriteFile(filepath.Join(a.runtimeRoot, resumableTaskManifestName), manifest, 0o600)
}
