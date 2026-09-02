package main

import (
	"embed"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:dist
var assets embed.FS

// learnofSourceRoot is injected by the local build so the compiled desktop
// app can start the sibling learnof/pptx runtime when launched directly.
// Release builds leave it empty and use their separately packaged runtime.
var learnofSourceRoot string

func main() {
	learnof, err := startBundledLearnof()
	if err != nil {
		log.Printf("learnof/pptx unavailable: %v", err)
	}
	if learnof != nil {
		defer func() {
			if learnof.Process != nil {
				_ = learnof.Process.Kill()
			}
			_, _ = learnof.Process.Wait()
		}()
	}
	app, err := NewApp()
	if err != nil {
		log.Fatalf("init: %v", err)
	}
	if err := wails.Run(newWailsAppOptions(app)); err != nil {
		log.Fatalf("wails run: %v", err)
	}
}

func startBundledLearnof() (*exec.Cmd, error) {
	root := filepath.Clean(learnofSourceRoot)
	if learnofSourceRoot == "" || root == "." {
		return nil, nil
	}
	if _, err := os.Stat(filepath.Join(root, "package.json")); err != nil {
		return nil, fmt.Errorf("invalid source root %q: %w", root, err)
	}
	const editorURL = "http://127.0.0.1:4178/"
	if response, err := http.Get(editorURL); err == nil {
		_ = response.Body.Close()
		if response.StatusCode >= 200 && response.StatusCode < 500 {
			return nil, nil
		}
	}
	vite := filepath.Join(root, "node_modules", ".bin", "vite")
	if _, err := os.Stat(vite); err != nil {
		return nil, fmt.Errorf("learnof/pptx Vite runtime is unavailable at %q: %w", vite, err)
	}
	cmd := exec.Command(vite, "--config", "packages/presentation-app/vite.config.ts", "--host", "127.0.0.1", "--port", "4178", "--strictPort")
	cmd.Dir = root
	cmd.Env = append(os.Environ(), "VITE_PRESENTATION_SESSION_MODE=browser-local")
	logPath := filepath.Join(os.TempDir(), "officedex-learnof.log")
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	if err := cmd.Start(); err != nil {
		_ = logFile.Close()
		return nil, fmt.Errorf("start learnof/pptx: %w", err)
	}
	_ = logFile.Close()
	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		response, requestErr := http.Get(editorURL)
		if requestErr == nil {
			_ = response.Body.Close()
			if response.StatusCode >= 200 && response.StatusCode < 500 {
				return cmd, nil
			}
		}
		if cmd.ProcessState != nil && cmd.ProcessState.Exited() {
			break
		}
		time.Sleep(200 * time.Millisecond)
	}
	_ = cmd.Process.Kill()
	_, _ = cmd.Process.Wait()
	return nil, fmt.Errorf("learnof/pptx did not become ready; see %s", logPath)
}

func newWailsAppOptions(app *App) *options.App {
	var mopHandler http.Handler
	if app != nil {
		mopHandler = app.mopHTTPHandler
	}
	return &options.App{
		Title:     "OfficeDex",
		Width:     1320,
		Height:    860,
		MinWidth:  1040,
		MinHeight: 720,
		AssetServer: &assetserver.Options{
			Assets:  assets,
			Handler: mopHandler,
		},
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop:     true,
			DisableWebViewDrop: true,
		},
		BackgroundColour: &options.RGBA{R: 246, G: 245, B: 244, A: 255},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Bind:             []any{app},
	}
}
