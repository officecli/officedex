package main

import (
	"testing"

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
	if got := resolvedUpdateChannel(); got != updateChannel10 {
		t.Fatalf("develop/1.0 source default = %q, want %q", got, updateChannel10)
	}
}

func TestResolveUpdateManifestURLOverride(t *testing.T) {
	t.Setenv(config.UpdateManifestURLEnv, "https://example.test/staging.json")
	channel, url := resolveUpdateManifestURL()
	if channel != updateChannel10 {
		t.Fatalf("channel = %q, want %q", channel, updateChannel10)
	}
	if url != "https://example.test/staging.json" {
		t.Fatalf("url = %q", url)
	}
}

func TestResolveUpdateManifestURLDefault(t *testing.T) {
	t.Setenv(config.UpdateManifestURLEnv, "")
	channel, url := resolveUpdateManifestURL()
	if channel != updateChannel10 {
		t.Fatalf("channel = %q, want %q", channel, updateChannel10)
	}
	if url != channel10UpdateManifestURL {
		t.Fatalf("url = %q, want %q", url, channel10UpdateManifestURL)
	}
}
