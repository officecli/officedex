package bridge

import (
	"testing"

	"officedex/internal/types"
)

// A deck can be grounded in a workbook, so the attachment has to survive the
// bridge args. Without a PPTX source-workbook spec the path was dropped here
// and the deck was generated with no data and no error.
func TestBuildAttachmentArgsCarriesPPTXSourceWorkbook(t *testing.T) {
	args := buildAttachmentArgs(types.GenerateInput{
		DocumentType: types.DocPPTX,
		SourceFile:   "/tmp/q3.xlsx",
	})
	if args["file_path"] != "/tmp/q3.xlsx" {
		t.Fatalf("file_path = %v, want the workbook to reach office.generate", args["file_path"])
	}
}

func TestBuildAttachmentArgsOmitsPPTXWorkbookWhenAbsent(t *testing.T) {
	args := buildAttachmentArgs(types.GenerateInput{DocumentType: types.DocPPTX})
	if _, ok := args["file_path"]; ok {
		t.Fatalf("file_path must be absent without an attachment, got %v", args["file_path"])
	}
}
