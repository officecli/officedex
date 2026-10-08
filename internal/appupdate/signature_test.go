package appupdate

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"strings"
	"testing"
)

func TestParsePublicKey(t *testing.T) {
	encoded := base64.StdEncoding.EncodeToString(testKeys.pub)
	pub, err := ParsePublicKey(" " + encoded + "\n")
	if err != nil {
		t.Fatal(err)
	}
	if !pub.Equal(testKeys.pub) {
		t.Fatal("parsed key differs")
	}
	for name, bad := range map[string]string{
		"empty":    "",
		"nonb64":   "!!!",
		"short":    base64.StdEncoding.EncodeToString([]byte("short")),
		"too-long": base64.StdEncoding.EncodeToString(append([]byte{}, testKeys.priv...)),
	} {
		if _, err := ParsePublicKey(bad); err == nil {
			t.Errorf("%s: expected error", name)
		}
	}
}

func TestKeyIDIsStableAndShort(t *testing.T) {
	id := KeyID(testKeys.pub)
	if len(id) != 16 {
		t.Fatalf("KeyID = %q, want 16 hex chars", id)
	}
	if id != KeyID(testKeys.pub) {
		t.Fatal("KeyID not deterministic")
	}
	other, _, _ := ed25519.GenerateKey(rand.Reader)
	if KeyID(other) == id {
		t.Fatal("different keys share a KeyID")
	}
}

func TestVerifyManifestSignature(t *testing.T) {
	manifest := []byte(`{"version":"1.0.12","assets":{}}`)
	good := testKeys.signatureFile(manifest)
	if err := VerifyManifestSignature(testKeys.pub, manifest, good); err != nil {
		t.Fatalf("valid signature rejected: %v", err)
	}

	otherPub, otherPriv, _ := ed25519.GenerateKey(rand.Reader)
	cases := map[string]struct {
		pub      ed25519.PublicKey
		manifest []byte
		sig      []byte
		want     string
	}{
		"no key":          {nil, manifest, good, "not configured"},
		"tampered body":   {testKeys.pub, []byte(`{"version":"9.9.9","assets":{}}`), good, ErrSignatureInvalid.Error()},
		"other key":       {testKeys.pub, manifest, signatureFileWith(manifest, otherPriv, testKeys.pub), ErrSignatureInvalid.Error()},
		"other key id":    {testKeys.pub, manifest, signatureFileWith(manifest, otherPriv, otherPub), "signed with key"},
		"not json":        {testKeys.pub, manifest, []byte("garbage"), "parse manifest signature"},
		"wrong format":    {testKeys.pub, manifest, []byte(`{"format":"minisign","version":1,"algorithm":"ed25519","signature":"AA=="}`), "format"},
		"wrong version":   {testKeys.pub, manifest, []byte(`{"format":"officedex-manifest-signature","version":2,"algorithm":"ed25519","signature":"AA=="}`), "version 2"},
		"wrong algorithm": {testKeys.pub, manifest, []byte(`{"format":"officedex-manifest-signature","version":1,"algorithm":"rsa","signature":"AA=="}`), "algorithm"},
		"short signature": {testKeys.pub, manifest, []byte(`{"format":"officedex-manifest-signature","version":1,"algorithm":"ed25519","signature":"AA=="}`), "1 bytes"},
		"non-b64":         {testKeys.pub, manifest, []byte(`{"format":"officedex-manifest-signature","version":1,"algorithm":"ed25519","signature":"***"}`), "not base64"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			err := VerifyManifestSignature(c.pub, c.manifest, c.sig)
			if err == nil {
				t.Fatal("expected error")
			}
			if !strings.Contains(err.Error(), c.want) {
				t.Fatalf("error %q does not mention %q", err, c.want)
			}
			if c.want == ErrSignatureInvalid.Error() && !errors.Is(err, ErrSignatureInvalid) {
				t.Fatalf("expected ErrSignatureInvalid, got %v", err)
			}
		})
	}
}

func TestSignatureURL(t *testing.T) {
	if got := SignatureURL("https://x/channels/1.0/manifest.json"); got != "https://x/channels/1.0/manifest.json.sig" {
		t.Fatalf("SignatureURL = %q", got)
	}
}
