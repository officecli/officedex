//go:build !windows

package pptxeditor

import "syscall"

// converterProcAttr puts mop-convert in its own process group so a timeout
// takes its children with it.
func converterProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Setpgid: true}
}
