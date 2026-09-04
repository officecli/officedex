package pptxeditor

import (
	"context"
	"errors"
	"fmt"
	"officedex/internal/config"
	"officedex/internal/subprocess"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
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

func NewCLIConverter(repoRoot string) *CLIConverter {
	return &CLIConverter{binary: resolveMopConvertBinary(repoRoot)}
}

func (c *CLIConverter) ImportPptx(ctx context.Context, sourcePath, mopDirectory string) error {
	if strings.TrimSpace(c.binary) == "" {
		return errors.New("mop-convert is unavailable; set OFFICEDEX_MOP_CONVERT_BIN or PRESENTATION_SOURCE_DIR")
	}
	return c.run(ctx, "import", "--input", sourcePath, "--mop", mopDirectory, "--format", "json")
}

func (c *CLIConverter) ExportPptx(ctx context.Context, mopDirectory, outputPath string) error {
	if strings.TrimSpace(c.binary) == "" {
		return errors.New("mop-convert is unavailable; set OFFICEDEX_MOP_CONVERT_BIN or PRESENTATION_SOURCE_DIR")
	}
	return c.run(ctx, "export", "--mop", mopDirectory, "--output", outputPath)
}

func (c *CLIConverter) Close() error { return nil }

// converterTimeout bounds one mop-convert run. The context handed in is the
// application's, which only ends when the app does, so a converter that hangs
// used to hold the editor's service lock for the rest of the session and every
// other document froze behind it. mophttp already bounds its own runs the same
// way, at the dev server's CONVERTER_TIMEOUT_MS.
const converterTimeout = 180 * time.Second

func (c *CLIConverter) run(ctx context.Context, args ...string) error {
	runCtx, cancel := context.WithTimeout(ctx, converterTimeout)
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
		return fmt.Errorf("mop-convert %s timed out after %s", args[0], converterTimeout)
	}
	detail := strings.TrimSpace(string(output))
	if detail == "" {
		detail = err.Error()
	}
	return fmt.Errorf("mop-convert %s: %s", args[0], detail)
}

func resolveMopConvertBinary(repoRoot string) string {
	if candidate := config.FirstExecutablePath(config.MOPConvertBinaryEnvKeys...); candidate != "" {
		return candidate
	}
	if sourceRoot := config.Trimmed(config.PresentationSourceDirEnv); sourceRoot != "" {
		if candidate := config.ExecutableFile(filepath.Join(sourceRoot, "tools", "bin", executableName("mop-convert"))); candidate != "" {
			return candidate
		}
	}
	if repoRoot != "" {
		for _, relative := range []string{
			filepath.Join("third_party", "presentation", "tools", "bin", executableName("mop-convert")),
			filepath.Join("build", "presentation", "bin", executableName("mop-convert")),
		} {
			if candidate := config.ExecutableFile(filepath.Join(repoRoot, relative)); candidate != "" {
				return candidate
			}
		}
	}
	if candidate, err := exec.LookPath(executableName("mop-convert")); err == nil {
		return candidate
	}
	return ""
}

func executableName(name string) string {
	if runtime.GOOS == "windows" {
		return name + ".exe"
	}
	return name
}
