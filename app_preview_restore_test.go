package main

import "testing"

// Leaving preview must undo exactly what entering did: restore the width, and
// move the window back only if entering moved it.
func TestPreviewRestoreRoundTrip(t *testing.T) {
	var p previewRestore
	if !p.enter(1200) {
		t.Fatal("first enter should succeed")
	}
	p.shift(340)

	width, x, moved, ok := p.take()
	if !ok || width != 1200 || x != 340 || !moved {
		t.Fatalf("take = (%d, %d, %v, %v), want (1200, 340, true, true)", width, x, moved, ok)
	}
	if _, _, _, ok := p.take(); ok {
		t.Fatal("a second take should report not in preview")
	}
}

// A window that fit on screen was never shifted; restoring must not move it.
func TestPreviewRestoreDoesNotMoveAnUnshiftedWindow(t *testing.T) {
	var p previewRestore
	p.enter(1200)

	_, _, moved, ok := p.take()
	if !ok || moved {
		t.Fatalf("moved=%v ok=%v, want moved=false ok=true", moved, ok)
	}
}

// Asking for preview twice must keep the original width, or leaving preview
// would "restore" the already-widened size.
func TestPreviewRestoreIgnoresARepeatedEnter(t *testing.T) {
	var p previewRestore
	p.enter(1200)
	if p.enter(1680) {
		t.Fatal("second enter should report already in preview")
	}
	width, _, _, _ := p.take()
	if width != 1200 {
		t.Fatalf("restored width = %d, want the original 1200", width)
	}
}

func TestPreviewRestoreZeroValueIsNotInPreview(t *testing.T) {
	var p previewRestore
	if _, _, _, ok := p.take(); ok {
		t.Fatal("zero value should report not in preview")
	}
}
