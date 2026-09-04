//go:build !windows

package subprocess

import (
	"errors"
	"os"
	"syscall"
)

// KillTree kills the process and everything it started. Command and
// CommandContext put every child in its own process group, so signalling the
// negative pid reaches the child and its grandchildren (a bridge's Node
// workers, a converter's helpers) together. If the pid does not lead a group
// -- the process was not started through this package -- fall back to killing
// just the process.
func KillTree(process *os.Process) error {
	if process == nil {
		return nil
	}
	if err := syscall.Kill(-process.Pid, syscall.SIGKILL); err == nil {
		return nil
	}
	if err := process.Kill(); err != nil && !errors.Is(err, os.ErrProcessDone) {
		return err
	}
	return nil
}
