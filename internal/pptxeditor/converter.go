package pptxeditor

import (
	"context"
	"errors"
	"fmt"
	"log"
	"officedex/internal/config"
	"officedex/internal/pptxdegrade"
	"officedex/internal/subprocess"
	"os"
	"path/filepath"
	"strings"
)

// Converter translates between PowerPoint files and the editable MOP package
// consumed by the presentation editor. Implementations must be safe for
// sequential reuse.
type Converter interface {
	ImportPptx(context.Context, string, string) error
	ExportPptx(context.Context, string, string) error
	Close() error
}

type CLIConverter struct {
	binary string
}

// NewCLIConverter takes the already-resolved mop-convert executable.
//
// Resolution belongs to config.MopConvertBinary, which the app calls once and
// hands to both this converter and the MOP HTTP service. The two used to
// resolve the binary separately and could disagree; see that function's
// comment. An empty path is allowed and means every call reports the converter
// as unavailable.
func NewCLIConverter(binary string) *CLIConverter {
	return &CLIConverter{binary: binary}
}

func (c *CLIConverter) ImportPptx(ctx context.Context, sourcePath, mopDirectory string) error {
	if strings.TrimSpace(c.binary) == "" {
		return errors.New("mop-convert is unavailable; set OFFICEDEX_MOP_CONVERT_BIN or PRESENTATION_SOURCE_DIR")
	}
	// The converter refuses a whole deck over a single unreviewed field;
	// pptxdegrade retries on a copy with just those fields dropped.
	removals, err := pptxdegrade.Import(ctx, sourcePath, func(ctx context.Context, path string) error {
		if path != sourcePath {
			// The failed attempt can leave a partial package behind.
			if err := resetMopDirectory(mopDirectory); err != nil {
				return err
			}
		}
		return c.run(ctx, "import", "--input", path, "--mop", mopDirectory, "--format", "json")
	}, func(err error) string { return err.Error() })
	if err != nil {
		return err
	}
	for _, removal := range removals {
		log.Printf("mop-convert import: dropped unsupported markup from %s: %s", filepath.Base(sourcePath), removal)
	}
	return nil
}

// resetMopDirectory empties the import target between attempts without
// removing the directory itself, which the caller owns.
func resetMopDirectory(directory string) error {
	entries, err := os.ReadDir(directory)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if err := os.RemoveAll(filepath.Join(directory, entry.Name())); err != nil {
			return err
		}
	}
	return nil
}

func (c *CLIConverter) ExportPptx(ctx context.Context, mopDirectory, outputPath string) error {
	if strings.TrimSpace(c.binary) == "" {
		return errors.New("mop-convert is unavailable; set OFFICEDEX_MOP_CONVERT_BIN or PRESENTATION_SOURCE_DIR")
	}
	return c.run(ctx, "export", "--mop", mopDirectory, "--output", outputPath)
}

func (c *CLIConverter) Close() error { return nil }

func (c *CLIConverter) run(ctx context.Context, args ...string) error {
	runCtx, cancel := context.WithTimeout(ctx, config.MopConvertTimeout)
	defer cancel()
	// subprocess.CommandContext puts mop-convert in its own process group and
	// kills the whole group on timeout: mop-convert spawns helpers, and killing
	// only the parent left them holding the session directory open.
	command := subprocess.CommandContext(runCtx, c.binary, args...)
	command.Env = os.Environ()
	output, err := command.CombinedOutput()
	if err == nil {
		return nil
	}
	if runCtx.Err() == context.DeadlineExceeded {
		return fmt.Errorf("mop-convert %s timed out after %s", args[0], config.MopConvertTimeout)
	}
	detail := strings.TrimSpace(string(output))
	if detail == "" {
		detail = err.Error()
	}
	return fmt.Errorf("mop-convert %s: %s", args[0], detail)
}
