package main

import (
	"crypto/ed25519"
	"fmt"
	"strings"

	"officedex/internal/appupdate"
	"officedex/internal/config"
)

const (
	updateChannelStable = "stable"
	updateChannelBeta   = "beta"
	updateChannel10     = "1.0"

	// stable and beta are independent channels: the manifest lives in officedex-dist and
	// the assets on GitHub Releases. Keep in step with MANIFEST_URLS in
	// scripts/update-channel.mjs (a test checks it).
	betaUpdateManifestURL   = "https://raw.githubusercontent.com/officecli/officedex-dist/main/channels/beta/manifest.json"
	stableUpdateManifestURL = "https://raw.githubusercontent.com/officecli/officedex-dist/main/manifest.json"
	// 1.0 is the legacy prerelease channel on Huawei Cloud OBS. Builds 1.0.6
	// through 1.0.12 still poll it; it was written one last time to hand them
	// a stable-channel build and is frozen since. No new build bakes it.
	channel10UpdateManifestURL = "https://aichatoffice-test.obs.cn-north-4.myhuaweicloud.com/officedex/channels/1.0/manifest.json"
)

// releaseManifestPublicKey is the Ed25519 public key (base64, 32 bytes)
// every update manifest must be signed with. The private half lives only in
// ~/.officedex-signing/manifest-signing-key.pem on the release machine and is
// used by scripts/publish-update-channel.mjs; scripts/manifest-signing.mjs
// `keygen` produces a pair. Rotating this key orphans every installed client,
// so it is a product decision, not a code change.
//
// scripts/manifest-signing.test.mjs reads this constant from the source and
// checks that the publish scripts agree with it.
const releaseManifestPublicKey = "/ngH1E85kcD3oOYsQXv9LM6xGalN2O37jOqvq44OSLE="

// appUpdateManifestPublicKey overrides releaseManifestPublicKey when injected
// at build time via `-ldflags "-X main.appUpdateManifestPublicKey=<base64>"`.
// It exists so a developer can point a local build at a manifest signed with
// a throwaway key (see CONTRIBUTING.md, Release flow); release builds leave it
// empty.
var appUpdateManifestPublicKey = ""

// resolveUpdateManifestPublicKey returns the key the updater trusts: the
// ldflags override when set, otherwise the baked release key. An invalid key
// is an error so the app refuses to start with a misconfigured updater rather
// than silently accepting unsigned manifests.
func resolveUpdateManifestPublicKey() (ed25519.PublicKey, error) {
	encoded := strings.TrimSpace(appUpdateManifestPublicKey)
	source := "ldflags"
	if encoded == "" {
		encoded = releaseManifestPublicKey
		source = "release"
	}
	key, err := appupdate.ParsePublicKey(encoded)
	if err != nil {
		return nil, fmt.Errorf("%s manifest public key: %w", source, err)
	}
	return key, nil
}

// appUpdateChannel is injected at build time via
// `-ldflags "-X main.appUpdateChannel=<channel>"`. The default is stable:
// test packages bake beta. A persisted user selection overrides this default.
// The legacy 1.0 (OBS) feed remains frozen.
var appUpdateChannel = updateChannelStable

func resolvedUpdateChannel() string {
	channel := strings.TrimSpace(appUpdateChannel)
	if channel == "" {
		return updateChannelStable
	}
	return channel
}

func defaultManifestURLForChannel(channel string) string {
	switch strings.TrimSpace(channel) {
	case updateChannelBeta:
		return betaUpdateManifestURL
	case updateChannel10:
		return channel10UpdateManifestURL
	default:
		return stableUpdateManifestURL
	}
}

// resolveUpdateManifestURL returns the baked channel name and the manifest
// URL the updater will poll. OFFICEDEX_UPDATE_MANIFEST_URL wins over the
// channel default so developers can still point a build at a staging file.
func resolveUpdateManifestURL(preferred ...string) (channel string, manifestURL string) {
	channel = resolvedUpdateChannel()
	if len(preferred) > 0 && (preferred[0] == updateChannelStable || preferred[0] == updateChannelBeta) {
		channel = preferred[0]
	}
	if override := config.Trimmed(config.UpdateManifestURLEnv); override != "" {
		return channel, override
	}
	return channel, defaultManifestURLForChannel(channel)
}
