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

type legacyRuntimeMigrationManifest struct {
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

// prepareLegacyRuntimeMigration publishes the resumable tasks from the
// previous desktop runtime. Terminal tasks are intentionally excluded.
func (a *App) prepareLegacyRuntimeMigration(ctx context.Context) error {
	if a.localStore == nil || a.runtimeRoot == "" {
		return nil
	}
	if err := os.MkdirAll(a.runtimeRoot, 0o700); err != nil {
		return err
	}
	ids := make([]string, 0)
	for _, status := range []string{"running", "question", "plan_review"} {
		part, err := a.localStore.QueryTaskIDsByStatus(ctx, status)
		if err != nil {
			return err
		}
		ids = append(ids, part...)
	}
	sort.Strings(ids)
	manifest, err := json.MarshalIndent(legacyRuntimeMigrationManifest{ClientID: a.desktopInstanceID, TaskIDs: ids}, "", "  ")
	if err != nil {
		return err
	}
	manifest = append(manifest, '\n')
	return atomicfile.WriteFile(filepath.Join(a.runtimeRoot, "legacy-migration.json"), manifest, 0o600)
}
