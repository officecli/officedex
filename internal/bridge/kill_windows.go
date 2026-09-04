//go:build windows

package bridge

import (
	"os"

	"officedex/internal/subprocess"
)

func killProcessTree(process *os.Process) error { return subprocess.KillTree(process) }
