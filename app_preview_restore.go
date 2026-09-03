package main

import "sync"

// previewRestore remembers how to put the main window back after preview mode
// widened it. Entering preview grows the window by previewExtraWidth, clamped
// to the screen, and shifts it left when the right edge would otherwise leave
// the screen; leaving preview has to undo exactly what was done and nothing
// else, including not moving a window that was never shifted.
//
// These were three fields on App -- previewModeWidthBefore, previewModeXBefore,
// previewModeXShifted -- kept consistent by hand inside SetPreviewMode. They
// are one fact: "we are in preview, and this is where the window was". The
// zero value means not in preview.
type previewRestore struct {
	mu      sync.Mutex
	width   int
	x       int
	shifted bool
}

// enter records the pre-preview width and reports whether preview mode was
// entered. It returns false when already in preview, so a repeated request
// does not overwrite the width we need to restore.
func (p *previewRestore) enter(width int) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.width > 0 {
		return false
	}
	p.width = width
	return true
}

// shifted records that the window was moved left from x to stay on screen, so
// leaving preview moves it back rather than leaving it where preview put it.
func (p *previewRestore) shift(x int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.x = x
	p.shifted = true
}

// take returns the geometry to restore and clears it. ok is false when not in
// preview; moved is false when the window was never shifted and its position
// must be left alone.
func (p *previewRestore) take() (width, x int, moved, ok bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.width == 0 {
		return 0, 0, false, false
	}
	width, x, moved = p.width, p.x, p.shifted
	p.width, p.x, p.shifted = 0, 0, false
	return width, x, moved, true
}
