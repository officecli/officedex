package subprocess

import (
	"context"
	"os/exec"
)

// Command creates an exec.Cmd with platform defaults suitable for a GUI app.
func Command(name string, arg ...string) *exec.Cmd {
	cmd := exec.Command(name, arg...)
	applyPlatformDefaults(cmd)
	return cmd
}

// CommandContext creates an exec.Cmd with platform defaults suitable for a GUI app.
func CommandContext(ctx context.Context, name string, arg ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, name, arg...)
	applyPlatformDefaults(cmd)
	return cmd
}
