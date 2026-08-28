package main

import (
	"path/filepath"
	"slices"
	"testing"
)

func TestResolveUserDataDirHonorsAbsoluteDevelopmentOverride(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "instance data")
	t.Setenv("OFFICEDEX_DEV_USER_DATA_DIR", dir)
	got, err := resolveUserDataDir(appName)
	if err != nil {
		t.Fatalf("resolveUserDataDir: %v", err)
	}
	if got != filepath.Clean(dir) {
		t.Fatalf("resolveUserDataDir = %q, want %q", got, filepath.Clean(dir))
	}
}

func TestDevelopmentOfficeCLIEnvIsolatesOnlyAbsoluteHome(t *testing.T) {
	home := filepath.Join(t.TempDir(), "officecli home")
	t.Setenv("OFFICEDEX_DEV_OFFICECLI_HOME", home)
	env := developmentOfficeCLIEnv()
	if !slices.Contains(env, "HOME="+home) {
		t.Fatalf("developmentOfficeCLIEnv = %#v, want isolated HOME", env)
	}
	if !slices.Contains(env, "XDG_CONFIG_HOME="+filepath.Join(home, ".config")) {
		t.Fatalf("developmentOfficeCLIEnv = %#v, want isolated XDG_CONFIG_HOME", env)
	}
	t.Setenv("OFFICEDEX_DEV_OFFICECLI_HOME", "relative")
	if got := developmentOfficeCLIEnv(); got != nil {
		t.Fatalf("relative isolation home produced %#v", got)
	}
}

func TestResolveUserDataDirRejectsRelativeDevelopmentOverride(t *testing.T) {
	t.Setenv("OFFICEDEX_DEV_USER_DATA_DIR", "relative/data")
	if _, err := resolveUserDataDir(appName); err == nil {
		t.Fatal("resolveUserDataDir accepted a relative development override")
	}
}
