//go:build !windows

package main

import "errors"

func installWindowsUpdate(_ string) error {
	return errors.New("installWindowsUpdate: not supported on this platform")
}
