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
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"officedex/internal/config"
)

func BridgeEnv(cwd string) []string {
	rootExplicit := config.IsSet(config.PresentationRootEnv) || config.IsSet(config.PresentationSourceDirEnv)
	nodeExplicit := config.IsSet(config.SkillNodeEnv)
	env := make([]string, 0, 3)
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
	if processCwd, err := os.Getwd(); err == nil && processCwd != cwd {
		candidates = append(candidates,
			filepath.Join(processCwd, "presentation"),
			filepath.Join(processCwd, "..", "presentation"),
		)
	}
	// GUI-launched macOS apps often have `/` as their real cwd but retain the
	// launch shell's PWD. Include it as a local-development discovery hint.
	if envPWD := strings.TrimSpace(os.Getenv("PWD")); envPWD != "" && envPWD != cwd {
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
	if cwd, err := os.Getwd(); err == nil {
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

func nodeExecutableName() string {
	if runtime.GOOS == "windows" {
		return "node.exe"
	}
	return "node"
}

func validNodeExecutable(candidate string) string {
	candidate = strings.TrimSpace(candidate)
	if candidate == "" {
		return ""
	}
	resolved, err := filepath.Abs(candidate)
	if err != nil {
		return ""
	}
	info, err := os.Stat(resolved)
	if err != nil || !info.Mode().IsRegular() {
		return ""
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o111 == 0 {
		return ""
	}
	return resolved
}

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
