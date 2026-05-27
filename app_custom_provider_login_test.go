package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"officedex/internal/netproxy"
	"officedex/internal/settings"
	"officedex/internal/types"
)

func TestCustomProviderRequiresLoggedInForSettings(t *testing.T) {
	t.Run("anonymous cannot save custom provider", func(t *testing.T) {
		app := newCustomProviderLoginTestApp(t, "anonymous", types.UserSettings{})

		_, err := app.UpdateSettings(settings.Patch{LlmProvider: customProviderForLoginTest()})
		if err == nil || err.Error() != "custom_provider.login_required" {
			t.Fatalf("UpdateSettings err = %v, want custom_provider.login_required", err)
		}

		stored, loadErr := app.settingsStore.Load()
		if loadErr != nil {
			t.Fatalf("Load settings: %v", loadErr)
		}
		if stored.LlmProvider != nil {
			t.Fatalf("LlmProvider was persisted after rejected update: %+v", stored.LlmProvider)
		}
	})

	t.Run("api key mode cannot save custom provider", func(t *testing.T) {
		app := newCustomProviderLoginTestApp(t, "api_key", types.UserSettings{})

		_, err := app.UpdateSettings(settings.Patch{LlmProvider: customProviderForLoginTest()})
		if err == nil || err.Error() != "custom_provider.login_required" {
			t.Fatalf("UpdateSettings err = %v, want custom_provider.login_required", err)
		}
	})

	t.Run("logged in can save custom provider", func(t *testing.T) {
		app := newCustomProviderLoginTestApp(t, "logged_in", types.UserSettings{})

		got, err := app.UpdateSettings(settings.Patch{LlmProvider: customProviderForLoginTest()})
		if err != nil {
			t.Fatalf("UpdateSettings: %v", err)
		}
		if got.LlmProvider == nil || got.LlmProvider.Type != types.LlmCustom {
			t.Fatalf("LlmProvider = %+v, want saved custom provider", got.LlmProvider)
		}
	})

	t.Run("anonymous can clear existing custom provider", func(t *testing.T) {
		app := newCustomProviderLoginTestApp(t, "anonymous", types.UserSettings{
			LlmProvider: customProviderForLoginTest(),
		})

		got, err := app.UpdateSettings(settings.Patch{ClearLlmProvider: true})
		if err != nil {
			t.Fatalf("UpdateSettings clear provider: %v", err)
		}
		if got.LlmProvider != nil {
			t.Fatalf("LlmProvider = %+v, want nil after clear", got.LlmProvider)
		}
	})
}

func TestCustomProviderRequiresLoggedInForGenerateBeforeBridgeStart(t *testing.T) {
	app := newCustomProviderLoginTestApp(t, "anonymous", types.UserSettings{
		LlmProvider: customProviderForLoginTest(),
	})

	_, err := app.Generate(types.GenerateInput{
		DocumentType: types.DocPPTX,
		Topic:        "login gate",
		Prompt:       "make a deck",
	})
	if err == nil || err.Error() != "custom_provider.login_required" {
		t.Fatalf("Generate err = %v, want custom_provider.login_required", err)
	}
}

func TestCustomProviderRequiresLoggedInForProviderTest(t *testing.T) {
	t.Run("custom override requires logged in", func(t *testing.T) {
		app := newCustomProviderLoginTestApp(t, "anonymous", types.UserSettings{})

		_, err := app.TestProviderWithInput(types.ProviderTestInput{
			UseProviderOverride: true,
			LlmProvider:         customProviderForLoginTest(),
		})
		if err == nil || err.Error() != "custom_provider.login_required" {
			t.Fatalf("TestProviderWithInput err = %v, want custom_provider.login_required", err)
		}
	})

	t.Run("official paid probe does not require logged in by desktop gate", func(t *testing.T) {
		app := newCustomProviderLoginTestApp(t, "anonymous", types.UserSettings{})

		got, err := app.TestProviderWithInput(types.ProviderTestInput{
			UseProviderOverride:    true,
			LlmProvider:            nil,
			AllowPaidOfficialProbe: false,
		})
		if err != nil {
			t.Fatalf("TestProviderWithInput official: %v", err)
		}
		if !got.Unavailable {
			t.Fatalf("official provider test result = %+v, want unavailable without custom login gate", got)
		}
	})
}

func newCustomProviderLoginTestApp(t *testing.T, whoamiMode string, initial types.UserSettings) *App {
	t.Helper()
	dir := t.TempDir()
	store := settings.New(filepath.Join(dir, "settings.json"), nil)
	if initial.LlmProvider != nil {
		if _, err := store.Update(settings.Patch{LlmProvider: initial.LlmProvider}); err != nil {
			t.Fatalf("seed provider settings: %v", err)
		}
	}
	cached, err := store.Load()
	if err != nil {
		t.Fatalf("load seeded settings: %v", err)
	}
	binary := writeWhoamiFakeOfficeCLI(t, whoamiMode)
	return &App{
		userDataDir:        dir,
		workspaceDir:       filepath.Join(dir, "workspace"),
		settingsStore:      store,
		cachedSettings:     cached,
		proxyPool:          netproxy.NewPool(),
		resolvedBinaryPath: binary,
		resolvedBinaryEnv:  []string{},
	}
}

func customProviderForLoginTest() *types.LlmProvider {
	return &types.LlmProvider{
		Type:    types.LlmCustom,
		BaseURL: "http://127.0.0.1:1/v1",
		APIKey:  "sk-test",
		Model:   "gpt-test",
	}
}

func writeWhoamiFakeOfficeCLI(t *testing.T, mode string) string {
	t.Helper()
	var body string
	switch mode {
	case "logged_in":
		body = "printf 'Mode: logged in\\nUser ID: user-test\\nSession: sess-test\\n'\nexit 0\n"
	case "api_key":
		body = "printf 'API key configured: true\\n'\nexit 0\n"
	case "anonymous":
		body = "printf 'Not logged in\\n'\nexit 1\n"
	default:
		t.Fatalf("unknown whoami mode %q", mode)
	}
	script := "#!/bin/sh\nif [ \"$1\" = \"whoami\" ]; then\n" + body + "fi\nprintf 'unexpected command: %s\\n' \"$1\" >&2\nexit 64\n"
	path := filepath.Join(t.TempDir(), "officecli-fake")
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake officecli: %v", err)
	}
	if strings.TrimSpace(path) == "" {
		t.Fatal("empty fake officecli path")
	}
	return path
}
