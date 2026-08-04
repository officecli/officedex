//go:build !darwin || !arm64

package office2modoc

import (
	"fmt"
	"runtime"
)

func openNative(string) (Native, error) {
	return nil, fmt.Errorf("office2modoc: unsupported platform %s/%s", runtime.GOOS, runtime.GOARCH)
}
