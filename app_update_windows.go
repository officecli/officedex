//go:build windows

package main

import (
	"fmt"
	"os"
	"path/filepath"

	"officedex/internal/subprocess"
)

// Process creation flags for the trampoline: it must outlive us and must not
// be bound to our console or process group, or Quit() would take it down too.
const (
	createNewProcessGroup = 0x00000200
	detachedProcess       = 0x00000008
)

// installWindowsUpdate hands the downloaded NSIS installer to a detached batch
// trampoline (windowsUpdateTrampoline) and returns; InstallAppUpdate then quits
// this process, the trampoline waits for that, installs silently over the
// running copy and relaunches it.
//
// TODO(authenticode): verify the installer's Authenticode signature here before
// anything runs it, the way installDarwinUpdate checks the bundle's Team ID
// against the running app. The check is not written yet because there is no
// certificate to check against: OfficeDex has no Authenticode code-signing
// certificate at the time of writing, so every Windows build is unsigned and a
// signature gate would refuse every update. Once a certificate exists, read the
// signer of `path` with wintrust (WinVerifyTrust) and compare its subject or
// thumbprint with the running executable's; refuse and delete on mismatch.
// Until then the sha256 pinned in the signed update manifest is the only
// integrity check, and the manifest signature is what makes it meaningful.
func installWindowsUpdate(path string) error {
	if err := checkWindowsInstallerAsset(path); err != nil {
		return err
	}
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolve executable: %w", err)
	}
	exe, err = filepath.EvalSymlinks(exe)
	if err != nil {
		return fmt.Errorf("resolve executable: %w", err)
	}
	installer, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("resolve installer path: %w", err)
	}

	script := windowsUpdateTrampoline(os.Getpid(), installer, filepath.Dir(exe), exe)
	scriptPath := filepath.Join(filepath.Dir(installer), "install-update.cmd")
	if err := os.WriteFile(scriptPath, []byte(script), 0o700); err != nil {
		return fmt.Errorf("write install script: %w", err)
	}

	cmd := subprocess.Command("cmd.exe", "/c", scriptPath)
	cmd.SysProcAttr.CreationFlags |= createNewProcessGroup | detachedProcess
	cmd.SysProcAttr.HideWindow = true
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start update trampoline: %w", err)
	}
	// Not waited on: the trampoline is waiting on us.
	_ = cmd.Process.Release()
	return nil
}
