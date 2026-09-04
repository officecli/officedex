//go:build !windows

package bridge

import (
	"os"

	"officedex/internal/subprocess"
)

// killProcessTree kills the bridge and the workers it started; see
// subprocess.KillTree for the process-group contract.
func killProcessTree(process *os.Process) error { return subprocess.KillTree(process) }
