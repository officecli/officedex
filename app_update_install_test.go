package main

import (
	"strings"
	"testing"
)

func TestCheckWindowsInstallerAssetAcceptsOnlyExecutables(t *testing.T) {
	for _, ok := range []string{
		`C:\Users\me\AppData\Roaming\officedex\updates\1.0.14\OfficeDex-1.0.14-windows-amd64-installer.exe`,
		`updates/1.0.14/OfficeDex-1.0.14-windows-amd64-installer.EXE`,
	} {
		if err := checkWindowsInstallerAsset(ok); err != nil {
			t.Fatalf("%s: unexpected error %v", ok, err)
		}
	}
	// The 0.6.9 shape: a zip the old code handed to `cmd /c start`.
	for _, bad := range []string{
		`updates/1.0.14/OfficeDex-v1.0.14-windows-amd64.zip`,
		`updates/1.0.14/update.bin`,
		`updates/1.0.14/installer`,
	} {
		err := checkWindowsInstallerAsset(bad)
		if err == nil {
			t.Fatalf("%s: expected an error", bad)
		}
		if !strings.Contains(err.Error(), "not an installer") {
			t.Fatalf("%s: unexpected error text %q", bad, err)
		}
	}
}

func TestWindowsUpdateTrampolineWaitsInstallsSilentlyAndRelaunches(t *testing.T) {
	script := windowsUpdateTrampoline(
		4242,
		`C:\Users\me\AppData\Roaming\officedex\updates\1.0.14\OfficeDex-1.0.14-windows-amd64-installer.exe`,
		`C:\Program Files\OfficeDex\OfficeDex`,
		`C:\Program Files\OfficeDex\OfficeDex\officedex.exe`,
	)
	for _, want := range []string{
		// Waits for *this* process, by PID, before touching anything.
		`tasklist /FI "PID eq 4242"`,
		"goto wait",
		// Silent install into the running copy's directory. /D= is last and
		// unquoted even though the path has spaces: NSIS reads it raw.
		`start "" /wait "C:\Users\me\AppData\Roaming\officedex\updates\1.0.14\OfficeDex-1.0.14-windows-amd64-installer.exe" /S /D=C:\Program Files\OfficeDex\OfficeDex`,
		// No relaunch after a failed or declined install.
		"if errorlevel 1 exit /b %errorlevel%",
		`start "" "C:\Program Files\OfficeDex\OfficeDex\officedex.exe"`,
	} {
		if !strings.Contains(script, want) {
			t.Fatalf("trampoline is missing %q:\n%s", want, script)
		}
	}
	if strings.Contains(script, `"/D=`) || strings.Contains(script, `/D="`) {
		t.Fatalf("/D= must not be quoted, NSIS rejects it:\n%s", script)
	}
	if !strings.HasSuffix(script, "\r\n") || strings.Contains(strings.ReplaceAll(script, "\r\n", ""), "\n") {
		t.Fatalf("cmd batch files need CRLF line endings throughout:\n%q", script)
	}
	// The install step must come after the wait loop, and the relaunch after
	// the install.
	wait := strings.Index(script, ":wait")
	install := strings.Index(script, "/S /D=")
	relaunch := strings.LastIndex(script, `start "" "C:\Program Files`)
	if !(wait < install && install < relaunch) {
		t.Fatalf("steps out of order (wait %d, install %d, relaunch %d)", wait, install, relaunch)
	}
}
