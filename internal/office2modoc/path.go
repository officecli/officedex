package office2modoc

import (
	"fmt"
	"os"
	"path/filepath"
)

// ResolveLibraryPath returns the configured FFI library path, or the
// repository-local default when no override is set.
func ResolveLibraryPath(repoRoot string) (string, error) {
	if override := os.Getenv("OFFICE2MODOC_FFI_PATH"); override != "" {
		if !filepath.IsAbs(override) {
			return "", fmt.Errorf("OFFICE2MODOC_FFI_PATH must be an absolute path: %q", override)
		}
		return override, nil
	}
	return filepath.Join(repoRoot, DefaultRelativeLibraryPath), nil
}
