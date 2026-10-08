//go:build !windows

package bridge

import (
	"bufio"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"officedex/internal/subprocess"
)

// The bridge starts a Node worker per PPTX build. Killing only the bridge
// left that worker running with nobody to answer to; the kill has to reach
// the grandchild.
func TestKillProcessTreeReachesGrandchildren(t *testing.T) {
	// The shell prints its background child's pid, then waits on it.
	cmd := subprocess.Command("sh", "-c", "sleep 60 & echo $!; wait")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	line, err := bufio.NewReader(stdout).ReadString('\n')
	if err != nil {
		t.Fatalf("read grandchild pid: %v", err)
	}
	grandchild, err := strconv.Atoi(strings.TrimSpace(line))
	if err != nil {
		t.Fatalf("grandchild pid %q: %v", line, err)
	}
	t.Cleanup(func() { _ = syscall.Kill(grandchild, syscall.SIGKILL) })

	if err := killProcessTree(cmd.Process); err != nil {
		t.Fatalf("killProcessTree: %v", err)
	}
	waited := make(chan struct{})
	go func() { _ = cmd.Wait(); close(waited) }()
	select {
	case <-waited:
	case <-time.After(2 * time.Second):
		t.Fatal("the child itself outlived the kill; a kill that does nothing would pass this test once sleep ran out on its own")
	}

	// Signal 0 probes existence. The grandchild is reparented to init when the
	// shell dies, so this is what tells "killed" apart from "orphaned".
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if err := syscall.Kill(grandchild, 0); err != nil {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("grandchild %d survived the kill: it was orphaned, not taken down with the bridge", grandchild)
}
