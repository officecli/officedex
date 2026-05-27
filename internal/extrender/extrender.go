package extrender

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"officedex/internal/subprocess"
)

const defaultTimeout = 30 * time.Second

type Renderer struct {
	binaryPath string
}

func New(binaryPath string) *Renderer {
	return &Renderer{binaryPath: binaryPath}
}

func (r *Renderer) Available() bool {
	if r == nil || r.binaryPath == "" {
		return false
	}
	_, err := os.Stat(r.binaryPath)
	return err == nil
}

func (r *Renderer) RenderHTML(ctx context.Context, filePath string) (string, error) {
	if !r.Available() {
		return "", fmt.Errorf("extrender: binary not available")
	}

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	var stdout, stderr bytes.Buffer
	cmd := subprocess.CommandContext(ctx, r.binaryPath, "view", filePath, "html")
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("extrender: %s: %w", strings.TrimSpace(stderr.String()), err)
	}

	tmpPath := ""
	scanner := bufio.NewScanner(&stdout)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line != "" && !strings.HasPrefix(line, "[") {
			tmpPath = line
			break
		}
	}

	if tmpPath == "" {
		return "", fmt.Errorf("extrender: no output file path in stdout")
	}

	html, err := os.ReadFile(tmpPath)
	if err != nil {
		return "", fmt.Errorf("extrender: read output: %w", err)
	}

	os.Remove(tmpPath)

	return string(html), nil
}
