//go:build !windows

package subprocess

import "os/exec"

func applyPlatformDefaults(cmd *exec.Cmd) {
}
