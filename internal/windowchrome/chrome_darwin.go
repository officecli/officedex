//go:build darwin && cgo

package windowchrome

/*
#cgo LDFLAGS: -framework AppKit
void alignWindowControls(void);
*/
import "C"

// Install aligns the native controls with the shell's 40-point header.
// Call after the webview is ready, when Wails has created its window.
func Install() { C.alignWindowControls() }
