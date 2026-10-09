package main

import (
	"fmt"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
	"net/url"
	"officedex/internal/defaultapps"
	"officedex/internal/onboarding"
	"path/filepath"
	"strings"
)

type setupWindowState struct {
	Width, Height, X, Y int
	Maximized           bool
	Fresh               bool
}

func (a *App) GetSetupState() (onboarding.State, error) {
	a.setupMu.Lock()
	defer a.setupMu.Unlock()
	return onboarding.Load(a.userDataDir)
}
func (a *App) SaveSetupState(state onboarding.State) error {
	a.setupMu.Lock()
	defer a.setupMu.Unlock()
	return onboarding.Save(a.userDataDir, state)
}
func (a *App) GetDefaultDocumentApps() []defaultapps.Result { return defaultapps.Query() }
func (a *App) SetDefaultDocumentApps(extensions []string) ([]defaultapps.Result, error) {
	a.setupMu.Lock()
	defer a.setupMu.Unlock()
	return defaultapps.Apply(extensions)
}

// Window changes are restricted to known setup stages, never arbitrary sizes.
func (a *App) SetSetupWindow(stage string) error {
	if stage != "welcome" && stage != "setup" && stage != "workspace" {
		return fmt.Errorf("unknown window stage")
	}
	a.setupMu.Lock()
	defer a.setupMu.Unlock()
	if a.ctx == nil {
		return nil
	}
	if stage == "workspace" {
		if a.setupWindow == nil {
			return nil
		}
		saved := a.setupWindow
		a.setupWindow = nil
		wailsruntime.WindowSetMinSize(a.ctx, 1040, 720)
		wailsruntime.WindowSetSize(a.ctx, max(1040, saved.Width), max(720, saved.Height))
		if saved.Fresh {
			wailsruntime.WindowCenter(a.ctx)
		} else {
			wailsruntime.WindowSetPosition(a.ctx, saved.X, saved.Y)
		}
		if saved.Maximized {
			wailsruntime.WindowMaximise(a.ctx)
		}
		return nil
	}
	if a.setupWindow == nil {
		w, h := wailsruntime.WindowGetSize(a.ctx)
		x, y := wailsruntime.WindowGetPosition(a.ctx)
		a.setupWindow = &setupWindowState{Width: w, Height: h, X: x, Y: y, Maximized: wailsruntime.WindowIsMaximised(a.ctx)}
	}
	wailsruntime.WindowUnmaximise(a.ctx)
	if stage == "welcome" {
		wailsruntime.WindowSetMinSize(a.ctx, 600, 700)
		wailsruntime.WindowSetSize(a.ctx, 600, 700)
	} else {
		wailsruntime.WindowSetMinSize(a.ctx, 1040, 720)
		wailsruntime.WindowSetSize(a.ctx, 1120, 720)
	}
	wailsruntime.WindowCenter(a.ctx)
	return nil
}

// Finder events can precede the renderer. Keep paths until it is ready, including
// while setup covers the workspace. Import/open uses the existing file service.
func (a *App) queueNativeFile(path string) {
	if !filepath.IsAbs(path) {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, pending := range a.nativeOpenFiles {
		if pending == path {
			return
		}
	}
	a.nativeOpenFiles = append(a.nativeOpenFiles, path)
}
func (a *App) TakeNativeOpenFiles() []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	files := a.nativeOpenFiles
	a.nativeOpenFiles = nil
	if files == nil {
		return []string{}
	}
	return files
}

// A deep link only wakes the app. It never carries credentials or asserts that
// login succeeded; the active flow must still obtain a verified whoami result.
func (a *App) handleNativeURL(raw string) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "officedex" || u.Host != "auth" || strings.TrimSuffix(u.Path, "/") != "/complete" {
		return
	}
	if a.ctx != nil {
		wailsruntime.WindowShow(a.ctx)
		wailsruntime.WindowUnminimise(a.ctx)
		emit(a.ctx, "setup:auth-return", true)
	}
}
