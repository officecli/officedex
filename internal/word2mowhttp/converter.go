package word2mowhttp

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/exec"
	"strings"

	"officedex/internal/config"
	"officedex/internal/subprocess"
)

// Converter runs the word2mow convert CLI. It is an interface so tests can
// exercise the HTTP layer's error mapping without a real converter binary.
type Converter interface {
	// Import turns a .docx at inputPath into a MOW directory package at
	// packageDirectory.
	Import(ctx context.Context, inputPath, packageDirectory string) error
	// Export turns a MOW directory package into a .docx at outputPath.
	Export(ctx context.Context, packageDirectory, outputPath string) error
}

// CLIConverter invokes the bundled word2mow `convert` executable.
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
	importOperation = conversionOperation{label: "DOCX import", failureCode: "DOCX_CONVERSION_FAILED"}
	exportOperation = conversionOperation{label: "DOCX export", failureCode: "DOCX_GENERATION_FAILED"}
)

// The argument shapes match writer's dev-server runner (word2mow-converter.ts):
// import writes the MOW directory named by -m, export reads it and writes -o.
func (c *CLIConverter) Import(ctx context.Context, inputPath, packageDirectory string) error {
	return c.run(ctx, importOperation, "import", "-i", inputPath, "-m", packageDirectory)
}

func (c *CLIConverter) Export(ctx context.Context, packageDirectory, outputPath string) error {
	return c.run(ctx, exportOperation, "export", "-m", packageDirectory, "-o", outputPath)
}

func (c *CLIConverter) run(ctx context.Context, operation conversionOperation, args ...string) error {
	if strings.TrimSpace(c.binary) == "" {
		return &apiError{
			status:  http.StatusServiceUnavailable,
			code:    "WORD2MOW_CLI_UNAVAILABLE",
			message: "The DOCX converter command-line tool is unavailable.",
			detail:  "Bundle word2mow's convert executable, or set " + config.Word2MowConvertBinEnv + " to its path.",
		}
	}

	runCtx, cancel := context.WithTimeout(ctx, config.MopConvertTimeout)
	defer cancel()

	// Own process group + tree kill on timeout: convert spawns helpers, and a
	// stuck run would otherwise leave them behind after the deadline fires.
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
			code:    "WORD2MOW_TIMEOUT",
			message: operation.label + " timed out.",
			detail:  detail,
		}
	}
	if errors.Is(err, exec.ErrNotFound) || errors.Is(err, os.ErrNotExist) || errors.Is(err, os.ErrPermission) {
		return &apiError{
			status:  http.StatusServiceUnavailable,
			code:    "WORD2MOW_CLI_UNAVAILABLE",
			message: "The DOCX converter command-line tool is unavailable.",
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
