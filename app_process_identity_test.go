package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestProcessIdentityIsScopedAndOwnedByCurrentPID(t *testing.T) {
	app := &App{userDataDir: t.TempDir(), desktopInstanceID: "desktop-test"}
	if err := app.writeProcessIdentity(); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(app.userDataDir, "process.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var payload struct {
		PID               int    `json:"pid"`
		DesktopInstanceID string `json:"desktop_instance_id"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}
	if payload.PID != os.Getpid() || payload.DesktopInstanceID != "desktop-test" {
		t.Fatalf("process identity = %#v", payload)
	}
	app.removeProcessIdentity()
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("process identity was not removed: %v", err)
	}
}
