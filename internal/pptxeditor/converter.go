package pptxeditor

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// Converter translates between PowerPoint files and the editable MOP package
// consumed by learnof/pptx. Implementations must be safe for sequential reuse.
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

func (c *CLIConverter) run(ctx context.Context, args ...string) error {
	command := exec.CommandContext(ctx, c.binary, args...)
	command.Env = os.Environ()
	output, err := command.CombinedOutput()
	if err == nil {
		return nil
	}
	detail := strings.TrimSpace(string(output))
	if detail == "" {
		detail = err.Error()
	}
	return fmt.Errorf("mop-convert %s: %s", args[0], detail)
}

func resolveMopConvertBinary(repoRoot string) string {
	for _, key := range []string{"OFFICEDEX_MOP_CONVERT_BIN", "MOP_CONVERT_BIN"} {
		if candidate := validExecutable(os.Getenv(key)); candidate != "" {
			return candidate
		}
	}
	if sourceRoot := strings.TrimSpace(os.Getenv("PRESENTATION_SOURCE_DIR")); sourceRoot != "" {
		if candidate := validExecutable(filepath.Join(sourceRoot, "tools", "bin", executableName("mop-convert"))); candidate != "" {
			return candidate
		}
	}
	if repoRoot != "" {
		for _, relative := range []string{
			filepath.Join("third_party", "presentation", "tools", "bin", executableName("mop-convert")),
			filepath.Join("build", "presentation", "bin", executableName("mop-convert")),
		} {
			if candidate := validExecutable(filepath.Join(repoRoot, relative)); candidate != "" {
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

func validExecutable(candidate string) string {
	candidate = strings.TrimSpace(candidate)
	if candidate == "" {
		return ""
	}
	abs, err := filepath.Abs(candidate)
	if err != nil {
		return ""
	}
	info, err := os.Stat(abs)
	if err != nil || !info.Mode().IsRegular() {
		return ""
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o111 == 0 {
		return ""
	}
	return abs
}
