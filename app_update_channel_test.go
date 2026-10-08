package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"strings"
	"testing"

	"officedex/internal/appupdate"
	"officedex/internal/config"
)

func TestDefaultManifestURLForChannel(t *testing.T) {
	t.Parallel()
	cases := []struct {
		channel string
		want    string
	}{
		{updateChannel10, channel10UpdateManifestURL},
		{" 1.0 ", channel10UpdateManifestURL},
		{updateChannelStable, stableUpdateManifestURL},
		{"", stableUpdateManifestURL},
		{"nightly", stableUpdateManifestURL},
	}
	for _, c := range cases {
		if got := defaultManifestURLForChannel(c.channel); got != c.want {
			t.Errorf("defaultManifestURLForChannel(%q) = %q, want %q", c.channel, got, c.want)
		}
	}
}

func TestResolvedUpdateChannelDefault(t *testing.T) {
	t.Parallel()
	if got := resolvedUpdateChannel(); got != updateChannelStable {
		t.Fatalf("source default = %q, want %q", got, updateChannelStable)
	}
}

func TestResolveUpdateManifestURLOverride(t *testing.T) {
	t.Setenv(config.UpdateManifestURLEnv, "https://example.test/staging.json")
	channel, url := resolveUpdateManifestURL()
	if channel != updateChannelStable {
		t.Fatalf("channel = %q, want %q", channel, updateChannelStable)
	}
	if url != "https://example.test/staging.json" {
		t.Fatalf("url = %q", url)
	}
}

func TestResolveUpdateManifestURLDefault(t *testing.T) {
	t.Setenv(config.UpdateManifestURLEnv, "")
	channel, url := resolveUpdateManifestURL()
	if channel != updateChannelStable {
		t.Fatalf("channel = %q, want %q", channel, updateChannelStable)
	}
	if url != stableUpdateManifestURL {
		t.Fatalf("url = %q, want %q", url, stableUpdateManifestURL)
	}
}

func TestReleaseManifestPublicKeyIsBaked(t *testing.T) {
	key, err := appupdate.ParsePublicKey(releaseManifestPublicKey)
	if err != nil {
		t.Fatalf("baked release key is invalid: %v", err)
	}
	if len(key) != ed25519.PublicKeySize {
		t.Fatalf("baked key is %d bytes", len(key))
	}
}

func TestResolveUpdateManifestPublicKeyDefault(t *testing.T) {
	old := appUpdateManifestPublicKey
	t.Cleanup(func() { appUpdateManifestPublicKey = old })
	appUpdateManifestPublicKey = ""
	key, err := resolveUpdateManifestPublicKey()
	if err != nil {
		t.Fatal(err)
	}
	want, _ := appupdate.ParsePublicKey(releaseManifestPublicKey)
	if !key.Equal(want) {
		t.Fatal("default key is not the baked release key")
	}
}

func TestResolveUpdateManifestPublicKeyLdflagsOverride(t *testing.T) {
	old := appUpdateManifestPublicKey
	t.Cleanup(func() { appUpdateManifestPublicKey = old })
	devPub, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	appUpdateManifestPublicKey = " " + base64.StdEncoding.EncodeToString(devPub) + "\n"
	key, err := resolveUpdateManifestPublicKey()
	if err != nil {
		t.Fatal(err)
	}
	if !key.Equal(devPub) {
		t.Fatal("ldflags key not used")
	}

	appUpdateManifestPublicKey = "not-a-key"
	if _, err := resolveUpdateManifestPublicKey(); err == nil || !strings.Contains(err.Error(), "ldflags") {
		t.Fatalf("expected ldflags key error, got %v", err)
	}
}

func TestDefaultManifestURLsAreHTTPS(t *testing.T) {
	for _, u := range []string{stableUpdateManifestURL, channel10UpdateManifestURL} {
		if !strings.HasPrefix(u, "https://") {
			t.Errorf("%s is not https", u)
		}
	}
}
