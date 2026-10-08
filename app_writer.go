package main

import (
	"os"
	"path/filepath"
	"runtime"

	"officedex/internal/config"
)

// The Writer editor needs two things that are too large or too platform-specific
// to embed: word2mow's `convert` executable and the default-font closure. Both
// are staged into the bundle by scripts/bundle-runtime.mjs, and both are found
// here the same way the officecli binary is -- next to the executable in a
// packaged app, under build/ in a development checkout.

// resolveWord2MowConvert returns the convert binary, or "" when the build did
// not stage one. word2mowhttp reports that as an unavailable converter rather
// than failing at startup, so an app without it still runs; only DOCX editing
// is unavailable.
func resolveWord2MowConvert() string {
	if fromEnv := config.ExecutablePath(config.Word2MowConvertBinEnv); fromEnv != "" {
		return fromEnv
	}
	name := "convert"
	if runtime.GOOS == "windows" {
		name = "convert.exe"
	}
	for _, candidate := range writerResourceCandidates(filepath.Join("word2mow", name), filepath.Join("build", "writer-convert", name)) {
		if resolved := config.ExecutableFile(candidate); resolved != "" {
			return resolved
		}
	}
	return ""
}

// resolveWriterFontsRoot returns the staged default-font closure, or "" when
// the build did not stage one. writerfonts answers 404 in that case, and the
// editor surfaces the missing metrics itself.
func resolveWriterFontsRoot() string {
	if fromEnv := config.Trimmed(config.WriterFontsDirEnv); fromEnv != "" {
		if abs, err := filepath.Abs(fromEnv); err == nil && isDirectory(abs) {
			return abs
		}
	}
	for _, candidate := range writerResourceCandidates("writer-fonts", filepath.Join("build", "writer-fonts")) {
		if isDirectory(candidate) {
			return filepath.Clean(candidate)
		}
	}
	return ""
}

// writerResourceCandidates lists where a staged Writer resource can live:
// beside the executable in a packaged app, or under the checkout during
// development.
func writerResourceCandidates(bundleRelative, sourceRelative string) []string {
	var candidates []string
	if executable, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(executable)
		candidates = append(candidates,
			// Packaged macOS app: <App>.app/Contents/Resources/<resource>
			filepath.Join(exeDir, "..", "Resources", bundleRelative),
			// Windows release zip: OfficeDex.exe sits beside the resource.
			filepath.Join(exeDir, bundleRelative),
		)
	}
	if cwd, ok := config.ProcessCwd(); ok {
		candidates = append(candidates, filepath.Join(cwd, sourceRelative))
	}
	if pwd := config.LauncherPWD(); pwd != "" {
		candidates = append(candidates, filepath.Join(pwd, sourceRelative))
	}
	return candidates
}

func isDirectory(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}
