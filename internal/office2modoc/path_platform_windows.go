//go:build windows && amd64

package office2modoc

func windowsPlatformLibraryPaths() (platformLibraryPaths, bool) {
	return platformLibraryPaths{bundled: bundledWindowsLibraryPath, defaultPath: defaultWindowsLibraryPath}, true
}
