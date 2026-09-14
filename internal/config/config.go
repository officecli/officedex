// Package config is the inventory of environment variables the desktop app
// reads, and the one place the shared ones are resolved.
//
// These were read inline wherever they were needed, so nothing listed them and
// two lookups had drifted apart. The mop-convert binary was resolved from the
// same two variables in two files: one made the path absolute, the other left
// it as written. A relative path there is a real hazard in a GUI app, whose
// working directory is not the one the user launched it from.
//
// Adding a variable means adding it here.
package config

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// Variables naming where something lives.
const (
	// MOPConvertBinEnv and MOPConvertBinFallbackEnv name the mop-convert
	// executable, in that order.
	MOPConvertBinEnv         = "OFFICEDEX_MOP_CONVERT_BIN"
	MOPConvertBinFallbackEnv = "MOP_CONVERT_BIN"
	// PresentationSourceDirEnv is a checkout of the presentation runtime; the
	// mop-convert binary is looked for under its tools/bin.
	PresentationSourceDirEnv = "PRESENTATION_SOURCE_DIR"
	// PresentationRootEnv and SkillNodeEnv are passed through to the OfficeCLI
	// bridge, which does its own resolution; the app only checks whether the
	// user set them so it knows not to override them.
	PresentationRootEnv    = "OFFICECLI_MOP_PRESENTATION_ROOT"
	SkillNodeEnv           = "OFFICECLI_MOP_SKILL_NODE"
	SkillDirEnv            = "OFFICECLI_MOP_SKILL_DIR"
	JSSDKDesignSkillDirEnv = "OFFICECLI_JSSDK_DESIGN_SKILL_DIR"
	// DesktopBinaryEnv points at the officecli binary to run.
	DesktopBinaryEnv = "OFFICECLI_DESKTOP_BINARY"
	// Office2ModocFFIEnv points at the office2modoc shared library.
	Office2ModocFFIEnv = "OFFICE2MODOC_FFI_PATH"
	// Word2MowConvertBinEnv points at word2mow's `convert` executable, which
	// turns .docx into the MOW packages the Writer editor reads. A packaged app
	// carries it under Contents/Resources/word2mow; this overrides that.
	Word2MowConvertBinEnv = "OFFICEDEX_WORD2MOW_CONVERT_BIN"
	// WriterFontsDirEnv points at the Writer default-font closure. It is served
	// from Contents/Resources/writer-fonts rather than embedded, because the
	// closure is hundreds of megabytes and dist/ is compiled into the binary.
	WriterFontsDirEnv = "OFFICEDEX_WRITER_FONTS_DIR"
	// UpdateManifestURLEnv overrides where update checks look.
	UpdateManifestURLEnv = "OFFICEDEX_UPDATE_MANIFEST_URL"
)

// PPTXJSSDKDesignEnv is a retired switch, retained only for migration tests.
// Its value no longer affects PPTX routing.
const PPTXJSSDKDesignEnv = "OFFICEDEX_PPTX_JSSDK_DESIGN"

// LauncherPWDEnv is the shell's working directory as the launcher saw it. A
// GUI-launched macOS app often has "/" as its real cwd but keeps PWD; it is
// consulted only as a local-development discovery hint.
const LauncherPWDEnv = "PWD"

// LauncherPWD returns the launcher shell's working directory, if any.
func LauncherPWD() string { return Trimmed(LauncherPWDEnv) }

// ProcessCwd is the one place the app asks for its working directory. Every
// caller uses it to find a source checkout next to the process during
// development; a packaged app launched from Finder gets "/" here, which is why
// callers treat the result as a hint and never as a base for user data.
func ProcessCwd() (string, bool) {
	cwd, err := os.Getwd()
	if err != nil || strings.TrimSpace(cwd) == "" {
		return "", false
	}
	return cwd, true
}

// MopConvertTimeout bounds one mop-convert run. Large decks genuinely take
// tens of seconds, so a shorter limit turns slow imports into failures. Both
// converters (the editor's and the MOP HTTP service's) read this one value.
const MopConvertTimeout = 180 * time.Second

// Development and test-only variables. These exist so a developer can run the
// app against a scratch profile or drive it from an end-to-end test.
const (
	DevUserDataDirEnv      = "OFFICEDEX_DEV_USER_DATA_DIR"
	DevOfficeCLIHomeEnv    = "OFFICEDEX_DEV_OFFICECLI_HOME"
	E2EHostEnv             = "OFFICEDEX_E2E_HOST"
	DemoAcceptAnyPromptEnv = "OFFICEDEX_DEMO_ACCEPT_ANY_PROMPT"
)

// MOPConvertBinaryEnvKeys are the variables naming a mop-convert binary, in
// the order they are consulted. Both places that resolve the binary read this
// list rather than each spelling it out.
var MOPConvertBinaryEnvKeys = []string{MOPConvertBinEnv, MOPConvertBinFallbackEnv}

// Trimmed reads a variable with surrounding whitespace removed.
func Trimmed(name string) string {
	return strings.TrimSpace(os.Getenv(name))
}

// IsSet reports whether a variable holds anything but whitespace.
func IsSet(name string) bool { return Trimmed(name) != "" }

// Enabled reports whether a variable reads as true. Used for the development
// and end-to-end switches, which are otherwise compared against a literal "1"
// in each place that reads them.
func Enabled(name string) bool {
	switch strings.ToLower(Trimmed(name)) {
	case "1", "true", "on", "yes":
		return true
	}
	return false
}

// ExecutablePath returns the absolute path in the named variable when it holds
// one that exists and can be run, and "" otherwise.
//
// Absolute is the point: the value may be written relative to wherever the
// user's shell was, and a packaged app does not run from there.
func ExecutablePath(name string) string {
	return ExecutableFile(Trimmed(name))
}

// ExecutableFile is ExecutablePath for a path from somewhere other than the
// environment, such as one built under a source checkout.
func ExecutableFile(candidate string) string {
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

// FirstExecutablePath returns the first of names holding a runnable path.
func FirstExecutablePath(names ...string) string {
	for _, name := range names {
		if path := ExecutablePath(name); path != "" {
			return path
		}
	}
	return ""
}

// ExecutableName appends the platform's executable suffix. A path built from a
// bare tool name is not runnable on Windows, and a lookup that omits the suffix
// fails silently -- the caller just sees "not found".
func ExecutableName(name string) string {
	if runtime.GOOS == "windows" {
		return name + ".exe"
	}
	return name
}

// MopConvertBinary resolves the mop-convert executable, or "" when no build
// staged one.
//
// Both users of the converter -- the MOP HTTP service and the PPTX editor --
// call this. They used to resolve it separately: one consulted only its own
// bundled runtime plus the two variables, the other also searched a source
// checkout and PATH but not the bundled runtime, and only one of them appended
// ".exe". A binary that one could find and the other could not is the whole
// reason this lives here.
//
// presentationRoot is the runtime directory a packaged app carries; repoRoot is
// a development checkout. Either may be empty.
func MopConvertBinary(presentationRoot, repoRoot string) string {
	binary := ExecutableName("mop-convert")
	// An explicit variable wins: it is how a developer points the app at a
	// converter build that is not the bundled one.
	if candidate := FirstExecutablePath(MOPConvertBinaryEnvKeys...); candidate != "" {
		return candidate
	}
	for _, root := range []string{presentationRoot, Trimmed(PresentationSourceDirEnv)} {
		if strings.TrimSpace(root) == "" {
			continue
		}
		if candidate := ExecutableFile(filepath.Join(root, "tools", "bin", binary)); candidate != "" {
			return candidate
		}
	}
	if strings.TrimSpace(repoRoot) != "" {
		for _, relative := range []string{
			filepath.Join("third_party", "presentation", "tools", "bin", binary),
			filepath.Join("build", "presentation", "bin", binary),
		} {
			if candidate := ExecutableFile(filepath.Join(repoRoot, relative)); candidate != "" {
				return candidate
			}
		}
	}
	if candidate, err := exec.LookPath(binary); err == nil {
		return ExecutableFile(candidate)
	}
	return ""
}
