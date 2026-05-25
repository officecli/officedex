//go:build darwin

package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
)

// installDarwinUpdate extracts the downloaded .zip, strips the quarantine
// attribute, and launches a detached trampoline script that replaces the
// running .app bundle in-place so users never see a Gatekeeper prompt.
func installDarwinUpdate(zipPath string) error {
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolve executable: %w", err)
	}
	appBundle := exe
	for !strings.HasSuffix(appBundle, ".app") {
		parent := filepath.Dir(appBundle)
		if parent == appBundle {
			return exec.Command("open", zipPath).Start()
		}
		appBundle = parent
	}

	extractDir, err := os.MkdirTemp("", "officedex-update-*")
	if err != nil {
		return fmt.Errorf("create temp dir: %w", err)
	}
	if err := exec.Command("ditto", "-xk", zipPath, extractDir).Run(); err != nil {
		os.RemoveAll(extractDir)
		return fmt.Errorf("extract zip: %w", err)
	}

	entries, err := os.ReadDir(extractDir)
	if err != nil {
		os.RemoveAll(extractDir)
		return fmt.Errorf("read extract dir: %w", err)
	}
	var newApp string
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".app") {
			newApp = filepath.Join(extractDir, e.Name())
			break
		}
	}
	if newApp == "" {
		os.RemoveAll(extractDir)
		return errors.New("no .app found in archive")
	}

	exec.Command("xattr", "-dr", "com.apple.quarantine", newApp).Run()

	script := fmt.Sprintf(`#!/bin/bash
set -e
while kill -0 %d 2>/dev/null; do sleep 0.3; done

old_backup=$(mktemp -d /tmp/officedex-old-XXXXXX)
mv %q "$old_backup/" 2>/dev/null || rm -rf %q
mv %q %q
xattr -dr com.apple.quarantine %q 2>/dev/null || true
open %q
rm -rf "$old_backup" %q
`, os.Getpid(),
		appBundle, appBundle,
		newApp, appBundle,
		appBundle,
		appBundle, extractDir)

	scriptPath := filepath.Join(extractDir, "install.sh")
	if err := os.WriteFile(scriptPath, []byte(script), 0o755); err != nil {
		os.RemoveAll(extractDir)
		return fmt.Errorf("write install script: %w", err)
	}

	cmd := exec.Command("bash", scriptPath)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	return cmd.Start()
}
