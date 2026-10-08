package main

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"officedex/internal/netproxy"
	"officedex/internal/settings"
)

// The watermark decision on the Generate path used to spawn a whole officecli
// subprocess every time, before any work started, to read one boolean. These
// tests pin the two halves of the fix: that repeated Generates share one answer,
// and that anything which can change the account drops it.

func TestRefreshImageWatermarkForGenerateReusesTheCachedEntitlement(t *testing.T) {
	app, callsPath := newWatermarkCacheTestApp(t, true)

	first, firstOpts := app.refreshImageWatermarkSettingsForGenerate(app.cachedSettings)
	second, secondOpts := app.refreshImageWatermarkSettingsForGenerate(first)

	if n := countFakeCLICalls(t, callsPath); n != 1 {
		t.Fatalf("expected two Generates to share one auth status call, got %d", n)
	}
	if !firstOpts.PaidEntitlement || !secondOpts.PaidEntitlement {
		t.Fatalf("expected a paid entitlement on both, got %+v then %+v", firstOpts, secondOpts)
	}
	if second.ImageWatermark.ShowWatermark {
		t.Fatal("a paid entitlement should have cleared the system watermark preference")
	}
}

func TestResetBridgeRuntimeDropsTheCachedEntitlement(t *testing.T) {
	// Logging out has to take effect on the next Generate, not a minute later,
	// so the TTL cannot be what covers this.
	app, callsPath := newWatermarkCacheTestApp(t, true)

	if _, opts := app.refreshImageWatermarkSettingsForGenerate(app.cachedSettings); !opts.PaidEntitlement {
		t.Fatalf("expected the seeded entitlement, got %+v", opts)
	}
	app.resetBridgeRuntime()
	if _, opts := app.refreshImageWatermarkSettingsForGenerate(app.cachedSettings); !opts.PaidEntitlement {
		t.Fatalf("expected the refetched entitlement, got %+v", opts)
	}
	if n := countFakeCLICalls(t, callsPath); n != 2 {
		t.Fatalf("expected resetBridgeRuntime to force a second auth status call, got %d", n)
	}
}

// newWatermarkCacheTestApp returns an App whose officecli is a script that
// records every invocation, alongside the path that recording goes to.
func newWatermarkCacheTestApp(t *testing.T, paidEntitlement bool) (*App, string) {
	t.Helper()
	dir := t.TempDir()
	store := settings.New(filepath.Join(dir, "settings.json"), nil)
	cached, err := store.Load()
	if err != nil {
		t.Fatalf("load settings: %v", err)
	}
	callsPath := filepath.Join(dir, "calls.txt")
	fakeCLI := writeAuthStatusFakeOfficeCLI(t, paidEntitlement, callsPath)
	// As a setting rather than only a seed: resetBridgeRuntime drops the binary
	// cache along with the credit one, so a seeded-only path would not survive
	// the very thing this test exercises.
	cached.BridgeBinaryPath = &fakeCLI
	app := &App{
		ctx:            context.Background(),
		userDataDir:    dir,
		workspaceDir:   filepath.Join(dir, "workspace"),
		settingsStore:  store,
		cachedSettings: cached,
		proxyPool:      netproxy.NewPool(),
	}
	app.binary.seed(fakeCLI, []string{}, time.Now())
	return app, callsPath
}

func writeAuthStatusFakeOfficeCLI(t *testing.T, paidEntitlement bool, callsPath string) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("the fake officecli here is a shell script")
	}
	entitlement := "false"
	if paidEntitlement {
		entitlement = "true"
	}
	report := `{"mode":"logged_in","access_mode":"hosted","plan_name":"Pro","paid_entitlement":` + entitlement +
		`,"hosted_credit_balance":100,"anonymous_credit":null,"reward_remaining":0,"paid_key":null,` +
		`"license_enabled":true,"session_configured":true,"api_key_configured":false}`
	script := "#!/bin/sh\n" +
		"echo \"$@\" >> " + callsPath + "\n" +
		"if [ \"$1\" = \"auth\" ] && [ \"$2\" = \"status\" ]; then\n" +
		"  printf '%s\\n' '" + report + "'\n" +
		"  exit 0\n" +
		"fi\n" +
		"printf 'unexpected command: %s\\n' \"$1\" >&2\nexit 64\n"
	path := filepath.Join(t.TempDir(), "officecli-fake")
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake officecli: %v", err)
	}
	return path
}

func countFakeCLICalls(t *testing.T, callsPath string) int {
	t.Helper()
	raw, err := os.ReadFile(callsPath)
	if os.IsNotExist(err) {
		return 0
	}
	if err != nil {
		t.Fatalf("read fake officecli call log: %v", err)
	}
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" {
		return 0
	}
	return len(strings.Split(trimmed, "\n"))
}
