//go:build !darwin

package main

import "errors"

func installDarwinUpdate(_ string) error {
	return errors.New("installDarwinUpdate: not supported on this platform")
}
