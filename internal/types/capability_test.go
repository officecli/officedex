package types

import (
	"reflect"
	"sort"
	"testing"
)

// The preview whitelist used to exist in two hand-written copies (the preview
// registry and the recent-files gate). This is the set they both held; it is
// now derived from the capability table and must not change by accident.
func TestPreviewExtensionsMatchTheHistoricalWhitelist(t *testing.T) {
	want := []string{"docx", "xlsx", "pptx", "pdf", "html", "htm", "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"}
	got := PreviewExtensions()
	sort.Strings(want)
	sort.Strings(got)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("PreviewExtensions() = %v, want %v", got, want)
	}
	for _, ext := range []string{"PPTX", ".docx", " gif "} {
		if !IsPreviewable(ext) {
			t.Errorf("IsPreviewable(%q) = false", ext)
		}
	}
	if IsPreviewable("exe") || IsPreviewable("") {
		t.Error("non-preview extensions accepted")
	}
}

// Every per-type decision the app makes reads the table. A row states what
// its type supports; an unknown type has no capabilities and no preview.
func TestCapabilityTableDrivesPerTypeDecisions(t *testing.T) {
	if !Capability(DocPPTX).Office || Capability(DocPPTX).DefaultPPTXBackend != PPTXBackendMOPSkill {
		t.Error("pptx must be an office document defaulting to the mop-skill backend")
	}
	for _, office := range []DocumentType{DocDOCX, DocXLSX, DocReport} {
		if !Capability(office).Office || Capability(office).DefaultPPTXBackend != "" {
			t.Errorf("%s must be an office document with no backend choice", office)
		}
	}
	img := Capability(DocIMG)
	if img.Office || !img.ImageRatio || !img.Watermark || img.FrameRate {
		t.Errorf("img capability = %+v", img)
	}
	gif := Capability(DocGIF)
	if gif.Office || gif.ImageRatio || gif.Watermark || !gif.FrameRate {
		t.Errorf("gif capability = %+v", gif)
	}
	unknown := Capability(DocumentType("md"))
	if unknown.Office || unknown.ImageRatio || unknown.FrameRate || unknown.Watermark || len(unknown.PreviewExtensions) != 0 {
		t.Errorf("an unknown type must have no capabilities: %+v", unknown)
	}
	for _, t2 := range DocumentTypes {
		if _, ok := DocumentTypeCapabilities[t2]; !ok {
			t.Errorf("document type %s has no capability row", t2)
		}
	}
}
