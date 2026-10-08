package main

import (
	"testing"
	"time"
)

// A client replaced while it still had work in flight is parked, not pooled.
// Shutdown used to stop only the pool, so the parked process outlived the app
// and its listener kept firing into a closing event writer.
func TestShutdownClosesRetiredBridges(t *testing.T) {
	app := &App{userDataDir: t.TempDir(), workspaceDir: t.TempDir()}
	app.startEventWriter()
	retired, retiredTransport := poolTestClient(t, app)
	writeRetireNotification(t, retiredTransport.stdoutW, "task-1", "task.started")
	waitForBusy(t, retired, true)
	app.bridges.park(retired)

	app.shutdown(nil)

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && retiredTransport.kills.Load() == 0 {
		time.Sleep(5 * time.Millisecond)
	}
	if kills := retiredTransport.kills.Load(); kills != 1 {
		t.Fatalf("retired bridge kills = %d after shutdown, want 1", kills)
	}
	if left := app.bridges.takeRetired(); len(left) != 0 {
		t.Fatalf("%d retired clients still parked after shutdown", len(left))
	}
}
