//go:build !windows

package bridge

import (
	"errors"
	"os"
	"syscall"
)

// killProcessTree kills the process and everything it started. The child is
// launched in its own process group (see internal/subprocess), so signalling
// the negative pid reaches the bridge and its Node workers together. Falls
// back to killing just the process if the group signal fails.
func killProcessTree(process *os.Process) error {
	if process == nil {
		return nil
	}
	// ESRCH here means the pid does not lead a group (the process was not
	// started through subprocess.Command), not that it is gone; fall through
	// and kill the single process.
	if err := syscall.Kill(-process.Pid, syscall.SIGKILL); err == nil {
		return nil
	}
	if err := process.Kill(); err != nil && !errors.Is(err, os.ErrProcessDone) {
		return err
	}
	return nil
}
