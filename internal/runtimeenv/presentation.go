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
// A launcher, though, hands over neither: `open` and Finder start the app
// through launchd, which gives it cwd "/" and no PWD at all. A development
// build that stages no runtime into its bundle -- scripts/build-local-latest.sh
// deliberately ships none, so it runs against the checkout it was built from --
// then has nothing to find the checkout with. The executable's own path is what
// survives that launch, so the checkout is also looked for beside it; see
// checkoutCandidatesBesideExecutable.
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

func BridgeEnv(cwd string) []string { return bridgeEnv(executablePath(), cwd) }

// bridgeEnv is BridgeEnv with the executable's path supplied, so the candidate
// list a launcher would produce can be exercised without depending on where the
// running binary happens to sit.
func bridgeEnv(executable, cwd string) []string {
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
	// A packaged macOS app may be launched from a shell whose PWD points at a
	// developer checkout. Prefer the embedded, signed presentation runtime in
	// that case; otherwise the app can pair its signed x64 Node runtime with an
	// unsigned source-tree Rollup native addon and macOS rejects dlopen().
	if root := bundledPresentationRoot(executable); root != "" {
		return append(env,
			"PRESENTATION_SOURCE_DIR="+root,
			"OFFICECLI_MOP_PRESENTATION_ROOT="+root,
		)
	}
	// Everything below has to be a source checkout, not a staged runtime; see
	// isPresentationCheckout. The working directories come first, as they always
	// have; a launcher supplies none of them, and then the executable's own
	// location decides.
	checkouts := make([]string, 0, 8)
	if strings.TrimSpace(cwd) != "" {
		checkouts = append(checkouts, checkoutCandidates(cwd)...)
	}
	if processCwd, ok := config.ProcessCwd(); ok && processCwd != cwd {
		checkouts = append(checkouts, checkoutCandidates(processCwd)...)
	}
	// GUI-launched macOS apps often have `/` as their real cwd but retain the
	// launch shell's PWD. Include it as a local-development discovery hint.
	if envPWD := config.LauncherPWD(); envPWD != "" && envPWD != cwd {
		checkouts = append(checkouts, checkoutCandidates(envPWD)...)
	}
	checkouts = append(checkouts, checkoutCandidatesBesideExecutable(executable)...)
	if root := firstPresentationCheckout(checkouts); root != "" {
		return append(env,
			"PRESENTATION_SOURCE_DIR="+root,
			"OFFICECLI_MOP_PRESENTATION_ROOT="+root,
		)
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

// presentationDirName is the directory name a presentation runtime carries in
// every layout this package knows about: beside the checkout, under
// Contents/Resources, and under the repository root.
const presentationDirName = "presentation"

func Root(repoRoot string) string { return rootFrom(executablePath(), repoRoot) }

// rootFrom is Root with the executable's path supplied; see bridgeEnv for why.
func rootFrom(executable, repoRoot string) string {
	if root := bundledPresentationRoot(executable); root != "" {
		return root
	}
	// The places a development build has always looked first: the repository it
	// was pointed at, and the working directory it was started in. A launcher
	// supplies neither (see checkoutCandidatesBesideExecutable), and only then
	// does the executable's own location decide.
	candidates := make([]string, 0, 8)
	if strings.TrimSpace(repoRoot) != "" {
		candidates = append(candidates, checkoutCandidates(repoRoot)...)
	}
	if cwd, ok := config.ProcessCwd(); ok {
		candidates = append(candidates, checkoutCandidates(cwd)...)
	}
	candidates = append(candidates, checkoutCandidatesBesideExecutable(executable)...)
	return firstPresentationCheckout(candidates)
}

// checkoutMarker is the file that separates a source checkout from a staged
// runtime. stage-presentation-runtime.mjs copies the worker's module graph and
// the converter, and the result passes IsRoot, but it never copies the JSSDK
// host runner -- officecli's default generation backend execs
// <root>/tools/execute-jssdk.mjs. A tree without the runner can convert a PPTX
// but not generate one, which is how a stale staged copy in a local app bundle
// passed every check and still failed PPTX generation.
const checkoutMarker = "tools/execute-jssdk.mjs"

// isPresentationCheckout reports whether root is the source checkout a
// development build runs against: a bootable runtime that also carries the
// sources and runners a staged copy leaves behind.
func isPresentationCheckout(root string) bool {
	if !IsRoot(root) {
		return false
	}
	info, err := os.Stat(filepath.Join(root, filepath.FromSlash(checkoutMarker)))
	return err == nil && !info.IsDir()
}

// firstPresentationRoot returns the first candidate IsRoot accepts, made
// absolute, or "" when none of them is a runtime.
func firstPresentationRoot(candidates []string) string {
	return firstPresentationMatching(candidates, IsRoot)
}

// firstPresentationCheckout is firstPresentationRoot narrowed to source
// checkouts.
func firstPresentationCheckout(candidates []string) string {
	return firstPresentationMatching(candidates, isPresentationCheckout)
}

func firstPresentationMatching(candidates []string, accepts func(string) bool) string {
	for _, candidate := range candidates {
		root, err := filepath.Abs(candidate)
		if err == nil && accepts(root) {
			return root
		}
	}
	return ""
}

// bundledPresentationRoot is the runtime a packaged desktop app carries beside
// its executable. It is a staged tree rather than a checkout, and a packaged
// app has nothing else, so IsRoot alone decides -- requiring the checkout
// marker would reject the only runtime the app shipped with.
func bundledPresentationRoot(executable string) string {
	if strings.TrimSpace(executable) == "" {
		return ""
	}
	exeDir := filepath.Dir(executable)
	return firstPresentationRoot([]string{
		// Packaged macOS app: <App>.app/Contents/Resources/presentation
		filepath.Join(exeDir, "..", "Resources", presentationDirName),
		// Windows release zip: the runtime sits beside the executable.
		filepath.Join(exeDir, presentationDirName),
	})
}

// checkoutCandidates lists where a presentation checkout may sit relative to a
// known directory: inside it, or beside it. Both layouts are real -- a source
// archive may unpack the runtime into the repository, and a sibling checkout is
// how the repositories are arranged on a development machine.
func checkoutCandidates(base string) []string {
	return []string{
		filepath.Join(base, presentationDirName),
		filepath.Join(base, "..", presentationDirName),
	}
}

// checkoutCandidatesBesideExecutable walks up from the running executable
// looking for the checkout it was built from, nearest ancestor first.
//
// A development app bundle is opened by a launcher, which starts it with cwd
// "/" and no environment: a local build at
// <checkout>/officedex/build/bin/OfficeDex.app/Contents/MacOS/officedex then
// has no working directory to resolve <checkout>/presentation from. Walking the
// executable's ancestors reaches <checkout> regardless, because the bundle is
// nested inside it, and a moved or renamed checkout still resolves.
//
// The search is harmless for a packaged app: its own Contents/Resources runtime
// is checked first and wins, and the ancestors of an installed app
// (/Applications, /) do not hold a checkout. A directory only counts if it is a
// source checkout (see isPresentationCheckout), so the staged tree under
// <repository>/officedex/build/presentation -- which sits between the local app
// bundle and the checkout and passes IsRoot -- is skipped rather than preferred
// for being nearer.
func checkoutCandidatesBesideExecutable(executable string) []string {
	if strings.TrimSpace(executable) == "" {
		return nil
	}
	candidates := make([]string, 0, 6)
	for dir := filepath.Dir(executable); ; {
		candidates = append(candidates, filepath.Join(dir, presentationDirName))
		parent := filepath.Dir(dir)
		if parent == dir {
			return candidates
		}
		dir = parent
	}
}

// executablePath is os.Executable with the error folded into "", so callers can
// treat "unknown executable" as "no candidates there" rather than branching.
func executablePath() string {
	executable, err := os.Executable()
	if err != nil {
		return ""
	}
	return executable
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
