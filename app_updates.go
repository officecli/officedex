package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"runtime"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"officedex/internal/appupdate"
	runtimemgr "officedex/internal/runtime"
	"officedex/internal/subprocess"
	"officedex/internal/types"
)

// ─── App update bindings ────────────────────────────────────────────────────

// AppUpdateCheckResult is the renderer-facing result of CheckAppUpdate.
type AppUpdateCheckResult struct {
	Release *appupdate.ReleaseInfo `json:"release"`
	Status  appupdate.Status       `json:"status"`
}

// GetAppVersion returns the desktop app version string.
func (a *App) GetAppVersion() string { return appVersion }

// GetAppUpdateStatus returns the cached status snapshot.
func (a *App) GetAppUpdateStatus() appupdate.Status {
	return a.appUpdateMgr.Status()
}

// CheckAppUpdate polls the manifest URL and returns the parsed release info
// plus a fresh status snapshot.
func (a *App) CheckAppUpdate() (AppUpdateCheckResult, error) {
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	rel, err := a.appUpdateMgr.CheckLatest(ctx)
	if err != nil {
		return AppUpdateCheckResult{Status: a.appUpdateMgr.Status()}, err
	}
	return AppUpdateCheckResult{Release: rel, Status: a.appUpdateMgr.Status()}, nil
}

// DownloadAppUpdate fetches the asset for the current platform and returns
// the absolute path to the verified file.
func (a *App) DownloadAppUpdate() (string, error) {
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	return a.appUpdateMgr.DownloadUpdate(ctx)
}

// CancelAppUpdate aborts any in-flight download.
func (a *App) CancelAppUpdate() error {
	a.appUpdateMgr.CancelDownload()
	return nil
}

// InstallAppUpdate launches the downloaded installer in a platform-specific
// way then quits the current process so the installer can replace files.
// Returns an error when no download has completed.
func (a *App) InstallAppUpdate() error {
	dp := a.appUpdateMgr.DownloadedPath()
	if dp == nil {
		return errors.New("appupdate: not downloaded")
	}
	path := *dp
	if _, err := os.Stat(path); err != nil {
		return fmt.Errorf("appupdate: installer file missing: %w", err)
	}
	if err := launchInstaller(path); err != nil {
		return fmt.Errorf("appupdate: launch installer: %w", err)
	}
	rel := a.appUpdateMgr.LatestRelease()
	if rel != nil {
		a.appUpdateMgr.MarkInstalled(rel.Version)
	}
	if a.ctx != nil {
		wailsruntime.Quit(a.ctx)
	}
	return nil
}

// ─── Runtime (OfficeCLI) update bindings ───────────────────────────────────

// RuntimeUpdateCheckResult is the renderer-facing result of CheckRuntimeUpdate.
type RuntimeUpdateCheckResult struct {
	Latest *runtimemgr.LatestRelease `json:"latest"`
	Status types.RuntimeStatus       `json:"status"`
}

// GetRuntimeStatus returns the cached runtime manager status snapshot.
func (a *App) GetRuntimeStatus() types.RuntimeStatus {
	return a.runtimeMgr.Status()
}

// CheckRuntimeUpdate queries GitHub Releases for the latest officecli version.
func (a *App) CheckRuntimeUpdate() (RuntimeUpdateCheckResult, error) {
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	latest, err := a.runtimeMgr.CheckLatestVersion(ctx)
	if err != nil {
		return RuntimeUpdateCheckResult{Status: a.runtimeMgr.Status()}, err
	}
	return RuntimeUpdateCheckResult{Latest: latest, Status: a.runtimeMgr.Status()}, nil
}

// DownloadRuntimeUpdate fetches the latest officecli binary and installs it
// into the managed runtime directory.
func (a *App) DownloadRuntimeUpdate() (types.RuntimeStatus, error) {
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	status, err := a.runtimeMgr.DownloadAndInstall(ctx)
	if err != nil {
		return status, err
	}
	a.mu.Lock()
	a.binary.invalidate()
	clients := a.takeBridgeClientsLocked()
	a.mu.Unlock()
	// The binary every child was started from has been replaced.
	for _, client := range clients {
		client.Close()
	}
	return status, nil
}

// CancelRuntimeUpdate aborts any in-flight runtime download.
func (a *App) CancelRuntimeUpdate() error {
	a.runtimeMgr.CancelDownload()
	return nil
}

func launchInstaller(path string) error {
	switch runtime.GOOS {
	case "darwin":
		return installDarwinUpdate(path)
	case "windows":
		return subprocess.Command("cmd", "/c", "start", "", path).Start()
	default:
		return subprocess.Command("xdg-open", path).Start()
	}
}
