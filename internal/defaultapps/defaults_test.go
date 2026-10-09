package defaultapps

import "testing"

func TestInvalidAssociationRequestIsRejectedBeforeAnySystemChange(t *testing.T) {
	result, err := Apply([]string{"docx", "exe"})
	if err == nil || result != nil {
		t.Fatalf("invalid batch accepted: %v %v", result, err)
	}
}
func TestSupportedDocumentTypes(t *testing.T) {
	for _, ext := range Extensions {
		uti, err := Types(ext)
		if err != nil || uti == "" {
			t.Fatalf("missing type %s", ext)
		}
	}
	if _, err := Types("pdf"); err == nil {
		t.Fatal("extended consent beyond three types")
	}
}
