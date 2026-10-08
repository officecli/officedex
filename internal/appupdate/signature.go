package appupdate

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// Manifest signatures.
//
// Every manifest the updater polls is accompanied by a detached signature at
// <manifestURL>.sig. The file is JSON so both scripts/manifest-signing.mjs
// (which writes it) and this package (which checks it) can parse it without
// a custom grammar:
//
//	{
//	  "format": "officedex-manifest-signature",
//	  "version": 1,
//	  "algorithm": "ed25519",
//	  "keyId": "1a2b3c4d5e6f7a8b",
//	  "signature": "<base64 of the 64-byte Ed25519 signature>"
//	}
//
// The signature covers the exact bytes of manifest.json as served. A manifest
// without a signature, with a signature by another key, or whose bytes were
// changed after signing is rejected before it is parsed, so a compromised
// bucket or dist repository cannot steer clients to a different build.

const (
	// SignatureFormat is the `format` field every signature file carries.
	SignatureFormat = "officedex-manifest-signature"
	// SignatureVersion is the `version` field this package understands.
	SignatureVersion = 1
	// SignatureAlgorithm is the only algorithm accepted.
	SignatureAlgorithm = "ed25519"
	// SignatureSuffix is appended to the manifest URL to find its signature.
	SignatureSuffix = ".sig"
)

// ErrSignatureInvalid is returned when the signature does not verify.
var ErrSignatureInvalid = errors.New("appupdate: manifest signature invalid")

// SignatureFile is the on-the-wire shape of <manifest>.sig.
type SignatureFile struct {
	Format    string `json:"format"`
	Version   int    `json:"version"`
	Algorithm string `json:"algorithm"`
	KeyID     string `json:"keyId,omitempty"`
	Signature string `json:"signature"`
}

// ParsePublicKey decodes a base64 (standard alphabet) Ed25519 public key.
func ParsePublicKey(encoded string) (ed25519.PublicKey, error) {
	trimmed := strings.TrimSpace(encoded)
	if trimmed == "" {
		return nil, errors.New("appupdate: manifest public key is empty")
	}
	raw, err := base64.StdEncoding.DecodeString(trimmed)
	if err != nil {
		return nil, fmt.Errorf("appupdate: manifest public key is not base64: %w", err)
	}
	if len(raw) != ed25519.PublicKeySize {
		return nil, fmt.Errorf("appupdate: manifest public key is %d bytes, want %d", len(raw), ed25519.PublicKeySize)
	}
	return ed25519.PublicKey(raw), nil
}

// KeyID is the short identifier of a public key: the first 8 bytes of its
// SHA-256, hex encoded. Signature files carry it so a mismatch between the
// signing key and the baked key produces a readable error.
func KeyID(pub ed25519.PublicKey) string {
	sum := sha256.Sum256(pub)
	return hex.EncodeToString(sum[:8])
}

// SignatureURL returns where the signature for manifestURL is fetched from.
func SignatureURL(manifestURL string) string {
	return manifestURL + SignatureSuffix
}

// VerifyManifestSignature checks that sigFile is a well-formed signature file
// whose Ed25519 signature over manifest verifies under pub.
func VerifyManifestSignature(pub ed25519.PublicKey, manifest, sigFile []byte) error {
	if len(pub) != ed25519.PublicKeySize {
		return errors.New("appupdate: manifest public key not configured")
	}
	var sig SignatureFile
	if err := json.Unmarshal(sigFile, &sig); err != nil {
		return fmt.Errorf("appupdate: parse manifest signature: %w", err)
	}
	if sig.Format != SignatureFormat {
		return fmt.Errorf("appupdate: manifest signature format %q is not %q", sig.Format, SignatureFormat)
	}
	if sig.Version != SignatureVersion {
		return fmt.Errorf("appupdate: manifest signature version %d is not %d", sig.Version, SignatureVersion)
	}
	if !strings.EqualFold(strings.TrimSpace(sig.Algorithm), SignatureAlgorithm) {
		return fmt.Errorf("appupdate: manifest signature algorithm %q is not %s", sig.Algorithm, SignatureAlgorithm)
	}
	if want := KeyID(pub); sig.KeyID != "" && sig.KeyID != want {
		return fmt.Errorf("appupdate: manifest signed with key %s, this build trusts %s", sig.KeyID, want)
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(sig.Signature))
	if err != nil {
		return fmt.Errorf("appupdate: manifest signature is not base64: %w", err)
	}
	if len(raw) != ed25519.SignatureSize {
		return fmt.Errorf("appupdate: manifest signature is %d bytes, want %d", len(raw), ed25519.SignatureSize)
	}
	if !ed25519.Verify(pub, manifest, raw) {
		return ErrSignatureInvalid
	}
	return nil
}
