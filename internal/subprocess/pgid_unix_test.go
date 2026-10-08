//go:build !windows

package subprocess

import (
	"syscall"
	"testing"
)

// A child in the parent's process group cannot be taken down together with
// its own children; it has to lead a group of its own.
func TestCommandStartsChildInItsOwnProcessGroup(t *testing.T) {
	cmd := Command("sleep", "30")
	if err := cmd.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })

	pgid, err := syscall.Getpgid(cmd.Process.Pid)
	if err != nil {
		t.Fatalf("getpgid: %v", err)
	}
	if pgid != cmd.Process.Pid {
		t.Fatalf("child pgid = %d, want its own pid %d (it is still in the parent's group %d)", pgid, cmd.Process.Pid, syscall.Getpgrp())
	}
}
