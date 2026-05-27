//go:build windows

package subprocess

import (
	"os/exec"
	"syscall"
)

const createNoWindow = 0x08000000

func applyPlatformDefaults(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.HideWindow = true
	cmd.SysProcAttr.CreationFlags |= createNoWindow
}
