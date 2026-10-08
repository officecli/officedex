package main

import (
	"fmt"
	"path/filepath"
	"strings"
)

// Windows updates ship as the NSIS installer (OfficeDex-<v>-windows-amd64-
// installer.exe; see scripts/dist-win.mjs), not as the portable zip: the zip
// has no notion of "replace what is installed", whereas the installer does,
// silently, with `/S`. The manifest's windows-amd64 asset therefore points at
// the installer, and the updater refuses anything else -- `cmd /c start` on a
// zip used to pop an Explorer window and call that an install.
//
// The pieces that are pure (no process, no registry) live here so they can be
// unit-tested on every platform; app_update_windows.go runs them.

// windowsInstallerExtension is the only asset kind the Windows updater runs.
const windowsInstallerExtension = ".exe"

// checkWindowsInstallerAsset refuses a downloaded asset that is not an
// executable installer. The sha256 was already verified by the download
// manager; this is about the kind of file, not its integrity.
func checkWindowsInstallerAsset(path string) error {
	if !strings.EqualFold(filepath.Ext(path), windowsInstallerExtension) {
		return fmt.Errorf("appupdate: windows asset %q is not an installer (.exe); the manifest's windows-amd64 asset must be the NSIS installer", filepath.Base(path))
	}
	return nil
}

// windowsUpdateTrampoline is the batch script that performs the update once
// this process has exited. It mirrors the darwin trampoline in
// app_update_darwin.go: wait for our PID to disappear, replace the install,
// relaunch.
//
//   - The NSIS installer runs silently (`/S`) into the directory the running
//     executable lives in (`/D=`), so the update lands where the app already
//     is -- for a machine-scope install that is Program Files, for a copy run
//     from the portable zip it is wherever the user unpacked it. NSIS requires
//     `/D=` to be the last argument and unquoted even when the path has
//     spaces; `start` passes the tail of its command line through verbatim,
//     which is why this is a batch file and not a PowerShell one-liner
//     (PowerShell re-quotes arguments containing spaces).
//   - `start "" /wait` is what makes cmd wait for a GUI subsystem program.
//   - The relaunch only happens when the installer exited 0; a declined UAC
//     prompt or a failed install leaves the current version in place and the
//     user re-opens the app themselves.
//
// Paths are embedded with cmd's `"..."` quoting; a double quote inside a path
// is not a valid Windows file name character, so none needs escaping.
func windowsUpdateTrampoline(pid int, installer, installDir, relaunch string) string {
	return strings.Join([]string{
		"@echo off",
		"setlocal",
		":wait",
		fmt.Sprintf(`tasklist /FI "PID eq %d" 2>nul | find "%d" >nul`, pid, pid),
		"if not errorlevel 1 (",
		"  timeout /t 1 /nobreak >nul",
		"  goto wait",
		")",
		fmt.Sprintf(`start "" /wait "%s" /S /D=%s`, installer, installDir),
		"if errorlevel 1 exit /b %errorlevel%",
		fmt.Sprintf(`start "" "%s"`, relaunch),
		"endlocal",
		"",
	}, "\r\n")
}
