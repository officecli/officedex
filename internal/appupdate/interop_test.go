package appupdate

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The fixtures under testdata were produced by scripts/manifest-signing.mjs
// (the publishing side) with a throwaway key whose private half was
// discarded. This pins the wire format between the Node signer and the Go
// verifier: a change to either side that breaks the other fails here.
func TestVerifyManifestSignature_NodeSignedFixture(t *testing.T) {
	read := func(name string) []byte {
		t.Helper()
		b, err := os.ReadFile(filepath.Join("testdata", name))
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	pub, err := ParsePublicKey(string(read("public-key.txt")))
	if err != nil {
		t.Fatal(err)
	}
	manifest := read("manifest.json")
	sig := read("manifest.json.sig")
	if err := VerifyManifestSignature(pub, manifest, sig); err != nil {
		t.Fatalf("Node-produced signature rejected by Go verifier: %v", err)
	}
	tampered := []byte(strings.Replace(string(manifest), `"1.0.12"`, `"1.0.13"`, 1))
	if err := VerifyManifestSignature(pub, tampered, sig); err == nil {
		t.Fatal("tampered fixture manifest must not verify")
	}
	if !strings.Contains(string(sig), `"keyId": "`+KeyID(pub)+`"`) {
		t.Fatalf("Node keyId differs from Go KeyID %s:\n%s", KeyID(pub), sig)
	}
}
