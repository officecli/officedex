package pptxtemplate

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// EnsureDistilled brings a template imported by an older build up to what
// generation reads today.
//
// Early imports wrote only a generic skill note; the fill handbook and slot
// catalog came later, and generation refuses a template without them. Such a
// template still lists as ready, so the user only found out when a run failed
// on a missing file. Everything needed to rebuild the missing pieces is in the
// stored MOP package, so they are derived again here, without a model call.
// A template that already has them is left untouched.
func EnsureDistilled(assetDir string) error {
	missing := false
	for _, name := range []string{filepath.Join("skill", "handbook.json"), "slots.json"} {
		if _, err := os.Stat(filepath.Join(assetDir, name)); errors.Is(err, os.ErrNotExist) {
			missing = true
		} else if err != nil {
			return fmt.Errorf("inspect template %s: %w", name, err)
		}
	}
	if !missing {
		return nil
	}
	mopDir := filepath.Join(assetDir, "source.mop")
	if _, err := os.Stat(mopDir); err != nil {
		return fmt.Errorf("template has no imported package to rebuild from; import it again: %w", err)
	}
	facts, err := ExtractFacts(mopDir)
	if err != nil {
		return fmt.Errorf("re-analyze template: %w", err)
	}
	if err := WriteDistilled(assetDir, facts, FallbackDistilled(facts)); err != nil {
		return fmt.Errorf("rebuild template handbook: %w", err)
	}
	return nil
}
