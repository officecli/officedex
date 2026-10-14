//go:build darwin && cgo

package editmenu

/*
#cgo LDFLAGS: -framework AppKit
void releaseDeleteKey(void);
*/
import "C"

// ReleaseDeleteKey gives the Delete (backspace) key back to the web view.
//
// Wails' standard Edit menu binds its "Delete" item to a bare backspace key
// equivalent. Cocoa matches key equivalents before a key event reaches
// WKWebView, so Delete never arrives as a keydown: a native text field still
// deletes, through the menu's delete: action, but an editor that handles
// keys itself — Writer's document surface — sees nothing, and Backspace and
// forward Delete did nothing in a document (1.0.34 walkthrough N34-02).
// The item stays in the menu; only its shortcut is cleared. Cut, Copy, Paste
// and Select All keep theirs, which WKWebView needs on macOS.
//
// Call once the main menu is installed (the web view's DOM-ready is after it).
func ReleaseDeleteKey() { C.releaseDeleteKey() }
