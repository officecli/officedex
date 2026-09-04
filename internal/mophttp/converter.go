package mophttp

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"officedex/internal/config"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"

	"officedex/internal/subprocess"
)

// Converter runs the mop-convert CLI. It is an interface so tests can exercise
// the HTTP layer's error mapping without a real converter binary.
type Converter interface {
	Import(ctx context.Context, inputPath, packageDirectory string) error
	Export(ctx context.Context, packageDirectory, outputPath string) error
}

// CLIConverter invokes the bundled mop-convert executable.
type CLIConverter struct {
	binary string
}

func NewCLIConverter(binary string) *CLIConverter {
	return &CLIConverter{binary: binary}
}

type conversionOperation struct {
	label       string
	failureCode string
}

var (
	importOperation = conversionOperation{label: "PPTX import", failureCode: "PPTX_CONVERSION_FAILED"}
	exportOperation = conversionOperation{label: "PPTX export", failureCode: "PPTX_GENERATION_FAILED"}
)

func (c *CLIConverter) Import(ctx context.Context, inputPath, packageDirectory string) error {
	if err := c.run(ctx, importOperation, "import", "--input", inputPath, "--mop", packageDirectory, "--format", "json"); err != nil {
		return err
	}
	return normalizeLegacyConverterPackage(packageDirectory)
}

func (c *CLIConverter) Export(ctx context.Context, packageDirectory, outputPath string) error {
	return c.run(ctx, exportOperation, "export", "--mop", packageDirectory, "--output", outputPath)
}

// conversionGapPattern detects the converter's structured "unsupported
// feature" reports, which are a different class of failure from a crash: the
// file is valid, the converter just cannot represent part of it yet, and the
// editor surfaces that to the user as an unsupported-feature message.
var conversionGapPattern = regexp.MustCompile(`(?i)conversion\s*gap|ConversionGap|structured\s+gap(?:\(s\)|s)?`)

func (c *CLIConverter) run(ctx context.Context, operation conversionOperation, args ...string) error {
	if strings.TrimSpace(c.binary) == "" {
		return &apiError{
			status:  http.StatusServiceUnavailable,
			code:    "MOP_CONVERTER_CLI_UNAVAILABLE",
			message: "The PPTX converter command-line tool is unavailable.",
			detail:  "Install or bundle mop-convert, or set MOP_CONVERT_BIN to its executable path.",
		}
	}

	runCtx, cancel := context.WithTimeout(ctx, config.MopConvertTimeout)
	defer cancel()

	// Own process group + tree kill on timeout, otherwise a stuck mop-convert
	// leaves its helpers behind after the deadline fires.
	command := subprocess.CommandContext(runCtx, c.binary, args...)
	command.Env = os.Environ()
	output, err := command.CombinedOutput()
	if err == nil {
		return nil
	}

	detail := strings.TrimSpace(string(output))
	if detail == "" {
		detail = err.Error()
	}

	// A deadline that fired is reported as a killed process, so check the
	// context rather than trying to interpret the exit status.
	if errors.Is(runCtx.Err(), context.DeadlineExceeded) {
		return &apiError{
			status:  http.StatusGatewayTimeout,
			code:    "MOP_CONVERTER_TIMEOUT",
			message: operation.label + " timed out.",
			detail:  detail,
		}
	}
	if errors.Is(err, exec.ErrNotFound) || errors.Is(err, os.ErrNotExist) || errors.Is(err, os.ErrPermission) {
		return &apiError{
			status:  http.StatusServiceUnavailable,
			code:    "MOP_CONVERTER_CLI_UNAVAILABLE",
			message: "The PPTX converter command-line tool is unavailable.",
			detail:  detail,
		}
	}
	if conversionGapPattern.MatchString(detail) {
		return &apiError{
			status:  422,
			code:    "PPTX_CONVERSION_GAP",
			message: "The PowerPoint file contains features that are not supported yet.",
			detail:  detail,
		}
	}
	return &apiError{
		status:  http.StatusBadRequest,
		code:    operation.failureCode,
		message: operation.label + " failed.",
		detail:  detail,
	}
}

// normalizeLegacyConverterPackage rewrites the pre-rename `timingBuild`
// attribute that older converter builds still emit. The editor only knows
// `paragraphAutoAdvance`, so a package carrying the legacy spelling would load
// with its animation timings silently dropped.
func normalizeLegacyConverterPackage(packageDirectory string) error {
	contentPath := filepath.Join(packageDirectory, contentFileName)
	content, err := os.ReadFile(contentPath)
	if err != nil {
		// A missing content.json is reported by package validation, which
		// produces a far clearer error than this normalization step could.
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	snapshot, err := decodeSnapshot(content)
	if err != nil {
		return nil
	}
	changed, err := normalizeLegacyTimingBuilds(snapshot)
	if err != nil {
		return err
	}
	if !changed {
		return nil
	}
	encoded, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(contentPath, append(encoded, '\n'), 0o644)
}

func normalizeLegacyTimingBuilds(value any) (bool, error) {
	changed := false
	switch typed := value.(type) {
	case []any:
		for _, item := range typed {
			itemChanged, err := normalizeLegacyTimingBuilds(item)
			if err != nil {
				return changed, err
			}
			changed = changed || itemChanged
		}
	case map[string]any:
		if nodeType, _ := typed["type"].(string); nodeType == "timingBuild" {
			if attrs, ok := typed["attrs"].(map[string]any); ok {
				if legacy, present := attrs["autoAdvance"]; present {
					normalized := jsonScalarString(legacy)
					if existing, hasExisting := attrs["paragraphAutoAdvance"]; hasExisting && jsonScalarString(existing) != normalized {
						return changed, errors.New("legacy timingBuild autoAdvance conflicts with paragraphAutoAdvance")
					}
					attrs["paragraphAutoAdvance"] = normalized
					delete(attrs, "autoAdvance")
					changed = true
				}
			}
		}
		for _, nested := range typed {
			nestedChanged, err := normalizeLegacyTimingBuilds(nested)
			if err != nil {
				return changed, err
			}
			changed = changed || nestedChanged
		}
	}
	return changed, nil
}

// jsonScalarString reproduces JavaScript's String() for the scalar types that
// can appear in this attribute, so a boolean `true` normalizes to "true" the
// same way the dev server normalizes it.
func jsonScalarString(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case json.Number:
		return typed.String()
	case bool:
		if typed {
			return "true"
		}
		return "false"
	case nil:
		return "null"
	default:
		encoded, err := json.Marshal(typed)
		if err != nil {
			return ""
		}
		return string(encoded)
	}
}
