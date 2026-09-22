package main

import (
	"strings"

	"officedex/internal/config"
)

const (
	updateChannelStable = "stable"
	updateChannel10     = "1.0"

	stableUpdateManifestURL    = "https://raw.githubusercontent.com/officecli/officedex-dist/main/manifest.json"
	channel10UpdateManifestURL = "https://raw.githubusercontent.com/officecli/officedex-dist/main/channels/1.0/manifest.json"
)

// appUpdateChannel is injected at build time via
// `-ldflags "-X main.appUpdateChannel=<channel>"`.
// develop/1.0 defaults to the 1.0 line so local and unsigned builds still
// poll the isolated manifest rather than the 0.5.x production channel.
var appUpdateChannel = updateChannel10

func resolvedUpdateChannel() string {
	channel := strings.TrimSpace(appUpdateChannel)
	if channel == "" {
		return updateChannel10
	}
	return channel
}

func defaultManifestURLForChannel(channel string) string {
	switch strings.TrimSpace(channel) {
	case updateChannel10:
		return channel10UpdateManifestURL
	default:
		return stableUpdateManifestURL
	}
}

// resolveUpdateManifestURL returns the baked channel name and the manifest
// URL the updater will poll. OFFICEDEX_UPDATE_MANIFEST_URL wins over the
// channel default so developers can still point a build at a staging file.
func resolveUpdateManifestURL() (channel string, manifestURL string) {
	channel = resolvedUpdateChannel()
	if override := config.Trimmed(config.UpdateManifestURLEnv); override != "" {
		return channel, override
	}
	return channel, defaultManifestURLForChannel(channel)
}
