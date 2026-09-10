package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"

	"officedex/internal/config"
	"officedex/internal/runtimeenv"
)

// VerifyRuntimeFlag asks the app to report the runtime payloads it would resolve
// and exit, instead of opening a window.
//
// scripts/verify-packaged-runtime.mjs checks what a *package* carries. This
// checks what *this app, here* would resolve, which is a different question
// whenever the two can disagree: a local build stages nothing into
// Contents/Resources and falls back to the checkout beside the repository, and
// a packaged app prefers its own embedded runtime over anything on PATH.
// Asking the binary itself is the only check that cannot drift from what the
// app does at startup -- it runs the same resolvers, from the same executable
// location.
//
// Both now ask the same thing of an executable payload: not "is it there" but
// "does it run". They disagreed once, and the gap was where a Node that could
// not start passed for a Node.
//
// It is also the support command for a user's machine: run the installed
// binary with this flag and it prints what it can and cannot find.
const VerifyRuntimeFlag = "--verify-runtime"

// verifyRuntimeDeps prints each runtime dependency and reports whether anything
// required is missing.
//
// mop-convert and the MOP Node runtime are fatal: without either, PPTX
// generation cannot run at all. The Writer payloads are staged by the packaging
// flow alone, so a local build legitimately ships without them -- they are
// reported so the absence is visible, not so the build fails.
func verifyRuntimeDeps(out io.Writer) bool {
	repoRoot, _ := config.ProcessCwd()
	presentationRoot := runtimeenv.Root(repoRoot)
	converter := config.MopConvertBinary(presentationRoot, repoRoot)

	report := func(label, path, absence string) {
		if path != "" {
			fmt.Fprintf(out, "verify-runtime: %-24s %s\n", label, path)
			return
		}
		fmt.Fprintf(out, "verify-runtime: %-24s MISSING -- %s\n", label, absence)
	}

	report("presentation runtime", presentationRoot,
		"the MOP worker has no SSR root; PPTX editing cannot start")
	report("mop-convert", converter,
		"every PPTX import and export will report the converter as unavailable")
	nodeOK := reportNodeRuntime(out)
	report("word2mow convert", resolveWord2MowConvert(), "DOCX editing is unavailable (packaging stages it)")
	report("writer fonts", resolveWriterFontsRoot(), "DOCX layout has no font metrics (packaging stages it)")

	if converter == "" {
		fmt.Fprintf(out, "verify-runtime: build the converter into %s, or set %s\n",
			filepath.Join(orPlaceholder(presentationRoot, "<presentation checkout>"), "tools", "bin",
				config.ExecutableName("mop-convert")),
			config.MOPConvertBinEnv)
	}
	return converter != "" && nodeOK
}

// reportNodeRuntime reports the Node the app hands the bridge, and whether it
// starts.
//
// It is reported by running it because resolution cannot: the app picks the
// first executable file it finds, preferring the one beside its own binary, and
// a Homebrew node staged into a bundle satisfies that and still dies in dyld.
// That build shipped, every gate was green, and the first sign of trouble was
// "MOP skill authoring failed" inside a user's generation. Naming the version
// here is what makes the difference visible before then -- and naming the path
// is what says *which* Node won, which is the question this incident turned on.
func reportNodeRuntime(out io.Writer) bool {
	const label = "mop node runtime"
	node := runtimeenv.EffectiveNode()
	if node == "" {
		fmt.Fprintf(out, "verify-runtime: %-24s MISSING -- the MOP worker has no Node; PPTX generation cannot run\n", label)
		fmt.Fprintf(out, "verify-runtime: install Node, or set %s\n", config.SkillNodeEnv)
		return false
	}
	version, err := runtimeenv.NodeVersion(node)
	if err != nil {
		fmt.Fprintf(out, "verify-runtime: %-24s BROKEN  -- %s\n", label, node)
		fmt.Fprintf(out, "verify-runtime: %-24s          %s\n", "", err)
		fmt.Fprintf(out, "verify-runtime: this Node resolves but does not start. A runtime copied out of a package manager's\n")
		fmt.Fprintf(out, "verify-runtime: tree leaves its libraries behind; stage a self-contained build, or set %s\n", config.SkillNodeEnv)
		return false
	}
	fmt.Fprintf(out, "verify-runtime: %-24s %s (%s)\n", label, node, version)
	return true
}

func orPlaceholder(value, placeholder string) string {
	if value == "" {
		return placeholder
	}
	return value
}

// runVerifyRuntimeIfRequested handles the flag before anything with side effects
// runs: NewApp creates the user data directory and opens the local store, and a
// preflight check has no business doing either.
func runVerifyRuntimeIfRequested() {
	if len(os.Args) < 2 || os.Args[1] != VerifyRuntimeFlag {
		return
	}
	if verifyRuntimeDeps(os.Stdout) {
		os.Exit(0)
	}
	os.Exit(1)
}
