package main

import (
	"errors"
	"fmt"
	"os/exec"
	"strings"
)

// codesignRunner runs `codesign` with args and returns its combined output.
// Tests inject a fake; installDarwinUpdate uses runCodesign.
type codesignRunner func(args ...string) (string, error)

func runCodesign(args ...string) (string, error) {
	out, err := exec.Command("codesign", args...).CombinedOutput()
	return string(out), err
}

// verifyUpdateBundle refuses to hand newApp to the installer trampoline
// unless codesign accepts its signature in strict mode and it was signed by
// the same Apple Team ID as the app that is currently running. A running app
// without a Team ID (ad-hoc or unsigned dev build) cannot establish trust and
// is refused too; such builds do not self-update.
func verifyUpdateBundle(newApp, currentApp string, run codesignRunner) error {
	if run == nil {
		run = runCodesign
	}
	if out, err := run("--verify", "--deep", "--strict", "--verbose=2", newApp); err != nil {
		return fmt.Errorf("appupdate: codesign verify failed for %s: %w: %s", newApp, err, strings.TrimSpace(out))
	}
	currentTeam, err := codesignTeamID(currentApp, run)
	if err != nil {
		return fmt.Errorf("appupdate: read Team ID of running app: %w", err)
	}
	if currentTeam == "" {
		return errors.New("appupdate: running app has no Team ID (unsigned or ad-hoc build); refusing to install an update")
	}
	newTeam, err := codesignTeamID(newApp, run)
	if err != nil {
		return fmt.Errorf("appupdate: read Team ID of downloaded app: %w", err)
	}
	if newTeam != currentTeam {
		return fmt.Errorf("appupdate: Team ID mismatch: downloaded app is signed by %q, running app by %q; refusing to install", displayTeamID(newTeam), currentTeam)
	}
	return nil
}

func codesignTeamID(app string, run codesignRunner) (string, error) {
	out, err := run("-dv", "--verbose=4", app)
	if err != nil {
		return "", fmt.Errorf("codesign -dv %s: %w: %s", app, err, strings.TrimSpace(out))
	}
	return parseCodesignTeamID(out), nil
}

// parseCodesignTeamID extracts the TeamIdentifier from `codesign -dv`
// output. Returns "" when the field is absent or codesign reports "not set"
// (ad-hoc signatures).
func parseCodesignTeamID(output string) string {
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		value, ok := strings.CutPrefix(line, "TeamIdentifier=")
		if !ok {
			continue
		}
		value = strings.TrimSpace(value)
		if value == "" || strings.EqualFold(value, "not set") {
			return ""
		}
		return value
	}
	return ""
}

func displayTeamID(team string) string {
	if team == "" {
		return "not set"
	}
	return team
}
