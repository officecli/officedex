//go:build windows

package subprocess

import (
	"errors"
	"os"
)

// KillTree on Windows kills the process itself. There is no process group to
// signal; a job object would be the equivalent and is not in place.
func KillTree(process *os.Process) error {
	if process == nil {
		return nil
	}
	if err := process.Kill(); err != nil && !errors.Is(err, os.ErrProcessDone) {
		return err
	}
	return nil
}
