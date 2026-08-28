//go:build officedex_demo

package demoflow

import (
	"context"
	_ "embed"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	goRuntime "runtime"
	"strings"
	"time"
	"unicode"
)

// promptPptxGenerator is intentionally embedded so the local demo does not
// depend on a separate checkout or an installed global Node.js package.
//
//go:embed prompt_pptx_generator.cjs
var promptPptxGenerator []byte

func writePromptPptx(path, prompt string) error {
	nodePath, moduleRoot, err := resolvePptxGenJSRuntime()
	if err != nil {
		return err
	}

	scriptFile, err := os.CreateTemp("", "officedex-prompt-pptx-*.cjs")
	if err != nil {
		return fmt.Errorf("create PPTX generator script: %w", err)
	}
	scriptPath := scriptFile.Name()
	defer os.Remove(scriptPath)
	if _, err := scriptFile.Write(promptPptxGenerator); err != nil {
		_ = scriptFile.Close()
		return fmt.Errorf("write PPTX generator script: %w", err)
	}
	if err := scriptFile.Close(); err != nil {
		return fmt.Errorf("close PPTX generator script: %w", err)
	}

	promptFile, err := os.CreateTemp("", "officedex-prompt-*.txt")
	if err != nil {
		return fmt.Errorf("create PPTX prompt file: %w", err)
	}
	promptPath := promptFile.Name()
	defer os.Remove(promptPath)
	if _, err := promptFile.WriteString(strings.TrimSpace(prompt)); err != nil {
		_ = promptFile.Close()
		return fmt.Errorf("write PPTX prompt file: %w", err)
	}
	if err := promptFile.Close(); err != nil {
		return fmt.Errorf("close PPTX prompt file: %w", err)
	}

	outputPath, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("resolve PPTX output path: %w", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, nodePath, scriptPath, moduleRoot, outputPath, promptPath)
	cmd.Env = append(os.Environ(), "NODE_PATH="+moduleRoot)
	output, err := cmd.CombinedOutput()
	if err != nil {
		message := strings.TrimSpace(string(output))
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return fmt.Errorf("run PPTX generator: timed out after 90s")
		}
		if message == "" {
			message = err.Error()
		}
		return fmt.Errorf("run PPTX generator: %s", message)
	}
	if info, err := os.Stat(outputPath); err != nil || info.Size() == 0 {
		if err == nil {
			err = fmt.Errorf("file is empty")
		}
		return fmt.Errorf("PPTX generator produced no output: %w", err)
	}
	return nil
}

func resolvePptxGenJSRuntime() (string, string, error) {
	nodePath := strings.TrimSpace(os.Getenv("OFFICECLI_PPTXGENJS_NODE"))
	moduleRoot := strings.TrimSpace(os.Getenv("OFFICECLI_PPTXGENJS_NODE_MODULES"))
	if validPptxGenJSRuntime(nodePath, moduleRoot) {
		return nodePath, moduleRoot, nil
	}

	workingDir, err := os.Getwd()
	if err != nil {
		return "", "", fmt.Errorf("resolve PPTX runtime working directory: %w", err)
	}
	nodeName := "node"
	if goRuntime.GOOS == "windows" {
		nodeName = "node.exe"
	}
	for dir := filepath.Clean(workingDir); ; dir = filepath.Dir(dir) {
		for _, root := range []string{
			filepath.Join(dir, "build", "pptxgenjs-runtime"),
			filepath.Join(dir, "officedex", "build", "pptxgenjs-runtime"),
		} {
			if validPptxGenJSRuntime(filepath.Join(root, "bin", nodeName), filepath.Join(root, "node_modules")) {
				return filepath.Join(root, "bin", nodeName), filepath.Join(root, "node_modules"), nil
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
	}
	return "", "", fmt.Errorf("bundled PptxGenJS runtime not found; set OFFICECLI_PPTXGENJS_NODE and OFFICECLI_PPTXGENJS_NODE_MODULES")
}

func validPptxGenJSRuntime(nodePath, moduleRoot string) bool {
	if nodePath == "" || moduleRoot == "" {
		return false
	}
	if info, err := os.Stat(nodePath); err != nil || info.IsDir() {
		return false
	}
	info, err := os.Stat(filepath.Join(moduleRoot, "pptxgenjs"))
	return err == nil && info.IsDir()
}

// promptPptxFileName keeps local artifacts identifiable by their request rather
// than presenting every generated deck as the same demo file. The generator
// still receives the caller-selected path, so this helper is shared by the
// ordinary and staged demo paths.
func promptPptxFileName(prompt string) string {
	topic := strings.TrimSpace(prompt)
	if strings.Contains(strings.ToUpper(topic), "QBR") || strings.Contains(topic, "季度业务回顾") || strings.Contains(topic, "季度复盘") {
		return "QBR-业务回顾.pptx"
	} else if match := firstPromptTopic(topic); match != "" {
		topic = match
	}
	slug := slugifyPromptTopic(topic)
	if slug == "" || slug == "local-demo" || slug == "demo" {
		slug = "prompt-deck"
	}
	return slug + ".pptx"
}

func firstPromptTopic(prompt string) string {
	if start := strings.Index(prompt, "为"); start >= 0 {
		if end := strings.Index(prompt[start+len("为"):], "制作"); end >= 2 {
			return strings.TrimSpace(prompt[start+len("为") : start+len("为")+end])
		}
	}
	lower := strings.ToLower(prompt)
	if start := strings.Index(lower, "for "); start >= 0 {
		candidate := prompt[start+len("for "):]
		if end := strings.IndexAny(candidate, ".。!?！？"); end >= 2 {
			candidate = candidate[:end]
		}
		return strings.TrimSpace(candidate)
	}
	return ""
}

func slugifyPromptTopic(value string) string {
	var b strings.Builder
	lastDash := false
	for _, r := range strings.ToLower(strings.TrimSpace(value)) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
			lastDash = false
			continue
		}
		if b.Len() > 0 && !lastDash {
			b.WriteByte('-')
			lastDash = true
		}
	}
	slug := strings.Trim(b.String(), "-")
	runes := []rune(slug)
	if len(runes) > 56 {
		slug = string(runes[:56])
	}
	return strings.Trim(slug, "-")
}
