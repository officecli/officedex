//go:build !windows

package subprocess

import "testing"

func TestCommandPreservesNameAndArgs(t *testing.T) {
	cmd := Command("echo", "ok")

	if cmd.Args[0] != "echo" {
		t.Fatalf("Args[0] = %q, want echo", cmd.Args[0])
	}
	if len(cmd.Args) != 2 || cmd.Args[0] != "echo" || cmd.Args[1] != "ok" {
		t.Fatalf("Args = %#v, want [echo ok]", cmd.Args)
	}
}

// On unix the only platform default is a process group of the child's own;
// nothing else about how it runs may be changed here.
func TestCommandOnlySetsAProcessGroupOnNonWindows(t *testing.T) {
	cmd := Command("sleep", "0")
	if cmd.SysProcAttr == nil || !cmd.SysProcAttr.Setpgid {
		t.Fatalf("SysProcAttr = %+v, want Setpgid so the child leads its own group", cmd.SysProcAttr)
	}
	if cmd.SysProcAttr.Setsid || cmd.SysProcAttr.Noctty || cmd.SysProcAttr.Foreground {
		t.Fatalf("unexpected extra attributes: %+v", cmd.SysProcAttr)
	}
}
