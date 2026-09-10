// Package runtimeenv finds the presentation runtime and the Node that runs it,
// and turns what it finds into environment for the OfficeCLI bridge.
//
// Where these live depends on how the app was started. A packaged macOS build
// carries a signed runtime under Contents/Resources; a development build has
// one beside the checkout. A GUI-launched app usually reports "/" as its
// working directory while still carrying the launching shell's PWD, so both
// are worth searching, and a packaged app launched from a developer's shell
// must prefer its own embedded runtime -- pairing a signed x64 Node with an
// unsigned source-tree native addon makes macOS refuse the dlopen.
//
// Two functions here search for the same directory from slightly different
// starting points: BridgeEnv from the bridge's working directory, Root from a
// repository root. IsRoot is what they agree on -- a directory is the runtime
// only if the four files the worker actually opens are all present.
package runtimeenv

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"officedex/internal/config"
)

func BridgeEnv(cwd string) []string {
	rootExplicit := config.IsSet(config.PresentationRootEnv) || config.IsSet(config.PresentationSourceDirEnv)
	nodeExplicit := config.IsSet(config.SkillNodeEnv)
	env := make([]string, 0, 3)
	if skills := bundledSkillsDir(cwd); skills != "" {
		if !config.IsSet(config.SkillDirEnv) {
			env = append(env, config.SkillDirEnv+"="+skills)
		}
		if !config.IsSet(config.JSSDKDesignSkillDirEnv) {
			env = append(env, config.JSSDKDesignSkillDirEnv+"="+filepath.Join(skills, "aippt-jssdk-design"))
		}
	}
	if !nodeExplicit {
		if node := NodeExecutable(); node != "" {
			env = append(env, "OFFICECLI_MOP_SKILL_NODE="+node)
		}
	}
	if rootExplicit {
		if len(env) == 0 {
			return nil
		}
		return env
	}
	candidates := make([]string, 0, 5)
	// A packaged macOS app may be launched from a shell whose PWD points at a
	// developer checkout. Prefer the embedded, signed presentation runtime in
	// that case; otherwise the app can pair its signed x64 Node runtime with an
	// unsigned source-tree Rollup native addon and macOS rejects dlopen().
	if executable, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(executable)
		candidates = append(candidates,
			filepath.Join(exeDir, "..", "Resources", "presentation"),
			filepath.Join(exeDir, "presentation"),
		)
	}
	if strings.TrimSpace(cwd) != "" {
		candidates = append(candidates,
			filepath.Join(cwd, "presentation"),
			filepath.Join(cwd, "..", "presentation"),
		)
	}
	if processCwd, ok := config.ProcessCwd(); ok && processCwd != cwd {
		candidates = append(candidates,
			filepath.Join(processCwd, "presentation"),
			filepath.Join(processCwd, "..", "presentation"),
		)
	}
	// GUI-launched macOS apps often have `/` as their real cwd but retain the
	// launch shell's PWD. Include it as a local-development discovery hint.
	if envPWD := config.LauncherPWD(); envPWD != "" && envPWD != cwd {
		candidates = append(candidates,
			filepath.Join(envPWD, "presentation"),
			filepath.Join(envPWD, "..", "presentation"),
		)
	}
	for _, candidate := range candidates {
		root, err := filepath.Abs(candidate)
		if err != nil {
			continue
		}
		if IsRoot(root) {
			return append(env,
				"PRESENTATION_SOURCE_DIR="+root,
				"OFFICECLI_MOP_PRESENTATION_ROOT="+root,
			)
		}
	}
	if len(env) == 0 {
		return nil
	}
	return env
}

// bundledSkillsDir finds Skills shipped with a packaged desktop app. A source
// checkout is handled separately by the OfficeCLI development environment;
// this probe is intentionally limited to the app bundle and its working tree.
func bundledSkillsDir(cwd string) string {
	candidates := make([]string, 0, 4)
	if executable, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(executable)
		candidates = append(candidates,
			filepath.Join(exeDir, "..", "Resources", "skills"),
			filepath.Join(exeDir, "skills"),
		)
	}
	for _, base := range []string{cwd, config.LauncherPWD()} {
		if strings.TrimSpace(base) != "" {
			candidates = append(candidates, filepath.Join(base, "skills"), filepath.Join(base, "officedex", "skills"), filepath.Join(base, "..", "officedex", "skills"))
		}
	}
	if processCwd, ok := config.ProcessCwd(); ok {
		candidates = append(candidates, filepath.Join(processCwd, "skills"))
	}
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			if _, err := os.Stat(filepath.Join(candidate, "aippt-jssdk-design", "policy.json")); err == nil {
				if abs, err := filepath.Abs(candidate); err == nil {
					return abs
				}
			}
		}
	}
	return ""
}

func Root(repoRoot string) string {
	candidates := make([]string, 0, 6)
	if executable, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(executable)
		candidates = append(candidates,
			filepath.Join(exeDir, "..", "Resources", "presentation"),
			filepath.Join(exeDir, "presentation"),
		)
	}
	if strings.TrimSpace(repoRoot) != "" {
		candidates = append(candidates,
			filepath.Join(repoRoot, "presentation"),
			filepath.Join(repoRoot, "..", "presentation"),
		)
	}
	if cwd, ok := config.ProcessCwd(); ok {
		candidates = append(candidates, filepath.Join(cwd, "presentation"), filepath.Join(cwd, "..", "presentation"))
	}
	for _, candidate := range candidates {
		root, err := filepath.Abs(candidate)
		if err == nil && IsRoot(root) {
			return root
		}
	}
	return ""
}

func NodeExecutable() string {
	if executable, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(executable)
		for _, candidate := range []string{
			filepath.Join(exeDir, "..", "Resources", "mop-runtime", "bin", nodeExecutableName()),
			filepath.Join(exeDir, "mop-runtime", "bin", nodeExecutableName()),
		} {
			if resolved := validNodeExecutable(candidate); resolved != "" {
				return resolved
			}
		}
	}
	if node, err := exec.LookPath("node"); err == nil {
		if resolved := validNodeExecutable(node); resolved != "" {
			return resolved
		}
	}
	// Finder-launched macOS apps typically do not inherit the user's Homebrew
	// PATH. Check the standard package-manager locations so a local development
	// build can still launch the MOP worker without requiring a shell wrapper.
	for _, candidate := range []string{
		"/opt/homebrew/bin/node",
		"/usr/local/bin/node",
		"/usr/bin/node",
	} {
		if resolved := validNodeExecutable(candidate); resolved != "" {
			return resolved
		}
	}
	return ""
}

// EffectiveNode is the Node the MOP worker will actually run.
//
// BridgeEnv hands OFFICECLI_MOP_SKILL_NODE to the bridge only when the user has
// not set it, because officecli reads that variable before doing any resolution
// of its own. So the node in force is the override when it names something
// runnable, and NodeExecutable's choice otherwise -- and anything reporting on
// the runtime has to say the same, or it names a Node nobody will start.
func EffectiveNode() string {
	if explicit := config.ExecutablePath(config.SkillNodeEnv); explicit != "" {
		return explicit
	}
	return NodeExecutable()
}

// NodeVersion runs the resolved Node and returns what it reports.
//
// Resolution stops at "a regular file with the executable bit", which is all
// the app can afford to check on every bridge start -- and is exactly what let
// a staged Homebrew node win: it was a real, executable file, and it aborted
// in dyld the moment the worker started it, because the twenty-seven dylibs it
// loads had stayed behind in the Cellar.
//
// Resolution deliberately does not call this. A packaged app that carries a
// broken runtime has a packaging defect, and silently falling through to some
// other Node would hide it behind a machine that happens to have one. So the
// preference order stays honest and this is offered to the diagnostics, which
// can afford to run the thing and say what happened.
func NodeVersion(node string) (string, error) {
	if strings.TrimSpace(node) == "" {
		return "", errors.New("no Node executable was resolved")
	}
	ctx, cancel := context.WithTimeout(context.Background(), nodeProbeTimeout)
	defer cancel()
	output, err := exec.CommandContext(ctx, node, "--version").CombinedOutput()
	if err != nil {
		detail := strings.TrimSpace(string(output))
		if detail == "" {
			detail = err.Error()
		}
		return "", errors.New(detail)
	}
	return strings.TrimSpace(string(output)), nil
}

// nodeProbeTimeout bounds the probe: a runtime that has not answered by now is
// not one the worker could have used either.
const nodeProbeTimeout = 10 * time.Second

func nodeExecutableName() string {
	if runtime.GOOS == "windows" {
		return "node.exe"
	}
	return "node"
}

// validNodeExecutable is config.ExecutableFile under the name the callers use.
func validNodeExecutable(candidate string) string { return config.ExecutableFile(candidate) }

func IsRoot(root string) bool {
	for _, relative := range []string{
		"package.json",
		filepath.Join("node_modules", "vite", "dist", "node", "index.js"),
		filepath.Join("bos", "dist", "mop-wasm", "pkg", "mop_wasm_bg.wasm"),
		filepath.Join("tools", "fixtures", "blank-presentation", "content.json"),
	} {
		info, err := os.Stat(filepath.Join(root, relative))
		if err != nil || info.IsDir() {
			return false
		}
	}
	return true
}
