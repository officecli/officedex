//go:build windows

package subprocess

import (
	"os/exec"
	"syscall"
	"testing"
)

func TestCommandHidesWindowsConsole(t *testing.T) {
	cmd := Command("officecli.exe", "whoami")

	if cmd.SysProcAttr == nil {
		t.Fatal("SysProcAttr = nil, want Windows no-window settings")
	}
	if !cmd.SysProcAttr.HideWindow {
		t.Fatal("HideWindow = false, want true")
	}
	if cmd.SysProcAttr.CreationFlags&createNoWindow == 0 {
		t.Fatalf("CreationFlags = %#x, want CREATE_NO_WINDOW", cmd.SysProcAttr.CreationFlags)
	}
}

func TestApplyPlatformDefaultsPreservesExistingWindowsSysProcAttr(t *testing.T) {
	cmd := exec.Command("officecli.exe", "whoami")
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x00000008}

	applyPlatformDefaults(cmd)

	if cmd.SysProcAttr == nil {
		t.Fatal("SysProcAttr = nil, want existing attr preserved")
	}
	if !cmd.SysProcAttr.HideWindow {
		t.Fatal("HideWindow = false, want true")
	}
	if cmd.SysProcAttr.CreationFlags&0x00000008 == 0 {
		t.Fatalf("CreationFlags = %#x, want existing flag preserved", cmd.SysProcAttr.CreationFlags)
	}
	if cmd.SysProcAttr.CreationFlags&createNoWindow == 0 {
		t.Fatalf("CreationFlags = %#x, want CREATE_NO_WINDOW added", cmd.SysProcAttr.CreationFlags)
	}
}
