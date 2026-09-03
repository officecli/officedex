//go:build windows

package pptxeditor

import "syscall"

// converterProcAttr is a no-op on Windows; process groups work differently and
// CommandContext already terminates the child.
func converterProcAttr() *syscall.SysProcAttr { return nil }
