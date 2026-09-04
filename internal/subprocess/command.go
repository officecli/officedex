package subprocess

import (
	"context"
	"os/exec"
	"time"
)

// cancelWaitDelay bounds how long Wait blocks after the context is cancelled
// while descendants that inherited the pipes finish dying.
const cancelWaitDelay = 5 * time.Second

// Command creates an exec.Cmd with platform defaults suitable for a GUI app.
func Command(name string, arg ...string) *exec.Cmd {
	cmd := exec.Command(name, arg...)
	applyPlatformDefaults(cmd)
	return cmd
}

// CommandContext creates an exec.Cmd with platform defaults suitable for a GUI
// app. Cancelling the context kills the whole process tree, not just the
// direct child: exec's default Cancel only kills the process it started, which
// left converter helpers and Node workers running with the session directory
// open after a timeout.
func CommandContext(ctx context.Context, name string, arg ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, name, arg...)
	applyPlatformDefaults(cmd)
	cmd.Cancel = func() error { return KillTree(cmd.Process) }
	cmd.WaitDelay = cancelWaitDelay
	return cmd
}
