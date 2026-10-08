//go:build windows && amd64

package office2modoc

const (
	defaultWindowsLibraryPath = "build/cache/office2modoc/" + Version + "/windows-amd64/office2modoc_ffi.dll"
	bundledWindowsLibraryPath = "office2modoc/office2modoc_ffi.dll"
)
