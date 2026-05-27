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

func TestCommandDoesNotSetSysProcAttrOnNonWindows(t *testing.T) {
	cmd := Command("echo", "ok")

	if cmd.SysProcAttr != nil {
		t.Fatalf("SysProcAttr = %#v, want nil", cmd.SysProcAttr)
	}
}
