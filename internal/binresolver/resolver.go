// Package binresolver is the Go port of src/main/binaryResolver.ts.
//
// Style conventions inherited from internal/settings:
//
//   - Options struct uses *string for "missing vs explicit empty" semantics,
//     matching the TS optional-string fields.
//   - Each candidate is trimmed with strings.TrimSpace before the empty check,
//     so whitespace-only inputs fall through to the next slot.
//   - BinarySource literal values ("user", "bundled", "env", "fallback") must
//     stay in sync with the TypeScript union so renderer code can switch on
//     them without a translation table.
package binresolver

import "strings"

// BinarySource names the slot that produced the resolved path.
type BinarySource string

const (
	SourceUser     BinarySource = "user"
	SourceBundled  BinarySource = "bundled"
	SourceEnv      BinarySource = "env"
	SourceFallback BinarySource = "fallback"
)

// fallbackBinary is the bare command name returned when no explicit path is
// supplied. The main process treats this slot as "not configured".
const fallbackBinary = "officecli"

// Options carries the candidate paths for each slot. Nil pointers mean
// "not supplied"; pointers to empty or whitespace strings fall through.
type Options struct {
	UserBinaryPath    *string
	BundledBinaryPath *string
	EnvBinaryPath     *string
}

// Resolved is the result of Resolve: the path and the slot that produced it.
type Resolved struct {
	Path   string
	Source BinarySource
}

// Resolve returns the officecli binary path and the slot that produced it.
// Priority: user → bundled → env → fallback("officecli").
func Resolve(opts Options) Resolved {
	if path, ok := pickTrimmed(opts.UserBinaryPath); ok {
		return Resolved{Path: path, Source: SourceUser}
	}
	if path, ok := pickTrimmed(opts.BundledBinaryPath); ok {
		return Resolved{Path: path, Source: SourceBundled}
	}
	if path, ok := pickTrimmed(opts.EnvBinaryPath); ok {
		return Resolved{Path: path, Source: SourceEnv}
	}
	return Resolved{Path: fallbackBinary, Source: SourceFallback}
}

// ResolvePath is a convenience wrapper that returns only the resolved path.
func ResolvePath(opts Options) string {
	return Resolve(opts).Path
}

func pickTrimmed(p *string) (string, bool) {
	if p == nil {
		return "", false
	}
	trimmed := strings.TrimSpace(*p)
	if trimmed == "" {
		return "", false
	}
	return trimmed, true
}
