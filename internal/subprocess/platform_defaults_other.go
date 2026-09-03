//go:build !windows

package subprocess

import (
	"os/exec"
	"syscall"
)

// applyPlatformDefaults puts every child in its own process group. The
// children a GUI app starts -- the OfficeCLI bridge, converters -- spawn
// workers of their own (the bridge runs a Node worker per PPTX build), and
// killing only the direct child left those grandchildren running with no
// parent to answer to. A group of their own is what lets the caller take the
// whole tree down with one signal.
func applyPlatformDefaults(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Setpgid = true
}
