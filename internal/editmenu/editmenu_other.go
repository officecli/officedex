//go:build !darwin || !cgo

package editmenu

// ReleaseDeleteKey is a no-op off macOS: only Cocoa's menu takes the key.
func ReleaseDeleteKey() {}
