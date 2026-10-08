package pptxeditor

import (
	"context"
	"strings"
	"testing"
)

// A build without a converter must report that per call rather than refuse to
// start, so the editor can say the converter is unavailable and everything else
// keeps working.
func TestCLIConverterWithoutBinaryReportsUnavailable(t *testing.T) {
	converter := NewCLIConverter("")
	if err := converter.ImportPptx(context.Background(), "deck.pptx", t.TempDir()); err == nil ||
		!strings.Contains(err.Error(), "mop-convert is unavailable") {
		t.Fatalf("ImportPptx error = %v, want unavailable converter", err)
	}
	if err := converter.ExportPptx(context.Background(), t.TempDir(), "deck.pptx"); err == nil ||
		!strings.Contains(err.Error(), "mop-convert is unavailable") {
		t.Fatalf("ExportPptx error = %v, want unavailable converter", err)
	}
}
