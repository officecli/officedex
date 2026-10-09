package main

import (
	"os"
	"path/filepath"
	"testing"

	"officedex/internal/appupdate"
	"officedex/internal/config"
	"officedex/internal/settings"
)

func TestUpdateSettingsSwitchesAndPersistsChannel(t *testing.T) {
	t.Setenv(config.UpdateManifestURLEnv, "")
	dir := t.TempDir()
	key, err := resolveUpdateManifestPublicKey()
	if err != nil {
		t.Fatal(err)
	}
	manager, err := appupdate.New(appupdate.Options{Channel: "stable", ManifestURL: stableUpdateManifestURL, ManifestPublicKey: key, CurrentVersion: "1.0.14", UpdatesDir: dir})
	if err != nil {
		t.Fatal(err)
	}
	settingsPath := filepath.Join(dir, "settings.json")
	app := &App{settingsStore: settings.New(settingsPath, nil), appUpdateMgr: manager}
	beta := "beta"
	got, err := app.UpdateSettings(settings.Patch{UpdateChannel: &beta})
	if err != nil {
		t.Fatal(err)
	}
	if got.UpdateChannel != beta || app.GetAppUpdateStatus().ManifestURL != betaUpdateManifestURL {
		t.Fatal("updater and persisted setting disagree")
	}
	reloaded, err := settings.New(settingsPath, nil).Load()
	if err != nil || reloaded.UpdateChannel != beta {
		t.Fatal("channel was not persisted")
	}
	t.Setenv(config.UpdateManifestURLEnv, "https://example.test/override.json")
	stable := "stable"
	if _, err := app.UpdateSettings(settings.Patch{UpdateChannel: &stable}); err == nil {
		t.Fatal("override must prevent misleading switches")
	}
	if app.GetAppUpdateStatus().UpdateChannel != beta {
		t.Fatal("failed change mutated updater")
	}
	t.Setenv(config.UpdateManifestURLEnv, "")
	// A directory cannot be atomically replaced by the settings file.
	blocked := filepath.Join(dir, "blocked")
	if err := os.Mkdir(blocked, 0700); err != nil {
		t.Fatal(err)
	}
	app.settingsStore = settings.New(blocked, nil)
	if _, err := app.UpdateSettings(settings.Patch{UpdateChannel: &stable}); err == nil {
		t.Fatal("expected write failure")
	}
	if app.GetAppUpdateStatus().UpdateChannel != beta {
		t.Fatal("write failure changed the active channel")
	}
}
