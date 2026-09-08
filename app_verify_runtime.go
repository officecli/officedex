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
// scripts/verify-packaged-runtime.mjs checks a *packaged* tree against a list of
// expected paths, which is the wrong question for a local build: that build
// stages nothing into Contents/Resources, so the app falls back to the
// presentation checkout beside the repository. Asking the binary itself is the
// only check that cannot drift from what the app does at startup -- it runs the
// same resolvers, from the same executable location.
//
// It is also the support command for a user's machine: run the installed
// binary with this flag and it prints what it can and cannot find.
const VerifyRuntimeFlag = "--verify-runtime"

// verifyRuntimeDeps prints each runtime dependency and reports whether anything
// required is missing.
//
// Only mop-convert is fatal. The Writer payloads are staged by the packaging
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
	report("word2mow convert", resolveWord2MowConvert(), "DOCX editing is unavailable (packaging stages it)")
	report("writer fonts", resolveWriterFontsRoot(), "DOCX layout has no font metrics (packaging stages it)")

	if converter != "" {
		return true
	}
	fmt.Fprintf(out, "verify-runtime: build the converter into %s, or set %s\n",
		filepath.Join(orPlaceholder(presentationRoot, "<presentation checkout>"), "tools", "bin",
			config.ExecutableName("mop-convert")),
		config.MOPConvertBinEnv)
	return false
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
