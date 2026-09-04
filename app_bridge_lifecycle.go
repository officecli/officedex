package main

import (
	"context"
	"errors"
	"officedex/internal/config"
	"officedex/internal/providerenv"
	"officedex/internal/runtimeenv"
	"officedex/internal/workspace"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"officedex/internal/binresolver"
	"officedex/internal/bridge"
	"officedex/internal/login"
	"officedex/internal/types"
)

// ─── Bridge lifecycle ───────────────────────────────────────────────────────

// bridgeEventListener builds the event callback for a bridge client: it stamps
// runtime provenance onto task.started, records and forwards every task event,
// and releases the client when a retired one goes idle. The Wails context is
// captured at construction time, matching the client's own lifetime.
func (a *App) bridgeEventListener(client *bridge.Client) bridge.EventListener {
	ctx := a.ctx
	return func(event types.BridgeEvent) {
		if strings.HasPrefix(event.Type, "bridge.") {
			emit(ctx, bridgeEventChannel, event)
			return
		}
		if event.Type == types.EventTaskStarted {
			// Read the snapshot, not App's mutex: this runs on the bridge's
			// stdout reader, and a settings write holding a.mu while it
			// resolves binaries used to stall the whole op stream.
			mode := a.runtimeModeSnapshot()
			_, env, at := a.binary.load()
			if mode != "" {
				if event.Payload == nil {
					event.Payload = map[string]any{}
				}
				event.Payload["runtime_mode"] = string(mode)
				if mode == types.RuntimeCustom {
					if p := providerenv.Snapshot(env); p != nil {
						event.Payload["runtime_provider"] = map[string]any{
							"type":           string(p.Type),
							"base_url_host":  p.BaseURLHost,
							"model":          p.Model,
							"api_key_masked": p.APIKeyMasked,
							"api_key_length": p.APIKeyLength,
						}
						if !at.IsZero() {
							event.Payload["runtime_applied_at"] = at.UTC().Format(time.RFC3339)
						}
					}
				}
			}
		}
		// The renderer acts on task.completed the moment it arrives, usually
		// by asking for a preview token of the finished artifact. Grant that
		// before emitting (an in-memory registry write) so the request cannot
		// race the writer goroutine and fail with "artifact is not registered".
		if event.Type == types.EventTaskCompleted {
			if artifact := artifactFromCompletedEvent(event); artifact != nil {
				if err := a.AllowArtifact(*artifact); err != nil {
					wailsruntime.LogWarningf(ctx, "grant completed artifact: %v", err)
				}
			}
		}
		// The renderer sees the event immediately; persistence goes to the
		// writer goroutine so this reader can get back to the pipe.
		emit(ctx, bridgeEventChannel, event)
		persisted := event
		a.queueEventWrite(func() {
			if err := a.recordTaskEvent(persisted); err != nil {
				wailsruntime.LogWarningf(ctx, "record task event: %v", err)
			}
			// Credit bookkeeping is a SQLite write too; it used to run on the
			// reader inline, right after the queue was introduced to keep
			// SQLite off the reader.
			if persisted.Type == types.EventTaskCompleted || persisted.Type == types.EventTaskFailed {
				if a.localStore != nil && persisted.Payload != nil {
					if c, ok := persisted.Payload["credits_charged"].(float64); ok {
						charged := int(c)
						mode, _ := persisted.Payload["credit_mode"].(string)
						if err := a.localStore.RecordTaskCredit(persisted.TaskID, &charged, mode); err != nil {
							wailsruntime.LogWarningf(ctx, "record task credit: %v", err)
						}
					}
				}
			}
		})
		a.reapRetiredBridge(client)
	}
}

func (a *App) ensureBridge() (*bridge.Client, error) {
	a.mu.Lock()
	settingsValue := a.cachedSettings
	a.mu.Unlock()
	return a.ensureBridgeForCwd(a.effectiveWorkspaceDirForRuntime(settingsValue))
}

func (a *App) ensureBridgeForTask(taskID string) (*bridge.Client, error) {
	if a.localStore == nil || strings.TrimSpace(taskID) == "" {
		return a.ensureBridge()
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	workspacePath, ok, err := a.localStore.TaskWorkspacePath(ctx, taskID)
	if err != nil {
		return nil, err
	}
	if !ok || strings.TrimSpace(workspacePath) == "" {
		return a.ensureBridge()
	}
	cwd, err := workspace.CleanExistingDir(workspacePath)
	if err != nil {
		return nil, err
	}
	return a.ensureBridgeForCwd(cwd)
}

// takeBridgeClientsLocked empties the pool and returns everything that was in
// it, for the callers that invalidate every child process at once (shutdown, a
// binary/provider change, a runtime update). Callers already hold a.mu.
func (a *App) takeBridgeClientsLocked() []*bridge.Client {
	return a.bridges.takeAll()
}

// retireBridge lets go of a bridge client that is no longer the active one.
// An idle client is closed immediately; a client with tasks still in flight is
// parked instead, keeping its process and event listeners alive so those tasks
// reach the renderer and the local store normally. Closing it unconditionally
// is what used to strand generations as permanently "running" whenever a second
// task -- or any call resolving to a different cwd -- swapped the bridge out.
func (a *App) retireBridge(client *bridge.Client) {
	if client == nil {
		return
	}
	if !client.HasActiveWork() {
		client.Close()
		return
	}
	a.bridges.park(client)
	time.AfterFunc(retiredBridgeGrace, func() { a.forceCloseRetiredBridge(client) })
	// The client may have gone idle between the check and the append.
	a.reapRetiredBridge(client)
}

// reapRetiredBridge closes a parked client once its last task finishes. It runs
// from the client's own event listener, so every terminal event is a chance to
// release the process.
func (a *App) reapRetiredBridge(client *bridge.Client) {
	if client == nil || client.HasActiveWork() {
		return
	}
	if a.takeRetiredBridge(client) {
		client.Close()
	}
}

// forceCloseRetiredBridge drops a parked client that outlived the grace period.
// Client.Close reports the still-running tasks as failed on its way out.
func (a *App) forceCloseRetiredBridge(client *bridge.Client) {
	if a.takeRetiredBridge(client) {
		client.Close()
	}
}

// takeRetiredBridge removes client from the parking lot, reporting whether this
// call is the one that owns closing it.
func (a *App) takeRetiredBridge(client *bridge.Client) bool {
	return a.bridges.unpark(client)
}

// bridgeForMetadata returns a client for calls that only read bridge-side state
// (capabilities, image templates) and do not care about the
// child process working directory. Reusing whichever client is already
// connected keeps these calls from starting a process just to ask a question.
func (a *App) bridgeForMetadata() (*bridge.Client, error) {
	if client := a.bridges.anyConnected(); client != nil {
		return client, nil
	}
	return a.ensureBridge()
}

// ensureBridgeForCwd returns the live child process for a working directory,
// starting one if this is the first call for it. Clients are pooled rather than
// swapped: a task belongs to the process that started it, and replacing that
// process to serve an unrelated call stranded the task inside a child nobody
// could reach anymore.
// startBridge starts a bridge process and completes the protocol handshake
// before anyone sends it work. The version check used to run only when the
// renderer called Initialize at startup, so a process started for a task in a
// second workspace, or restarted after it exited, was never checked and an
// old officecli failed partway through a generation with "method not found".
func (a *App) startBridge(client *bridge.Client) error {
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	if err := client.Start(ctx); err != nil {
		return err
	}
	if _, err := client.Initialize(ctx); err != nil {
		// Not usable: take the process down rather than leaving it pooled
		// and connected for the next call to trip over.
		client.Stop()
		return err
	}
	return nil
}

func (a *App) ensureBridgeForCwd(cwd string) (*bridge.Client, error) {
	if client := a.bridges.get(cwd); client != nil {
		if !client.Connected() {
			if err := a.startBridge(client); err != nil {
				return nil, err
			}
		}
		return client, nil
	}

	a.mu.Lock()
	settingsValue := a.cachedSettings
	a.mu.Unlock()

	resolved := binresolver.Resolve(a.resolverOptions(settingsValue))
	if resolved.Source == binresolver.SourceFallback {
		message := "OfficeCLI binary is not configured. Install it or set a Bridge binary path in Settings."
		if a.ctx != nil {
			emit(a.ctx, bridgeEventChannel, types.BridgeEvent{
				Type:    "bridge.unconfigured",
				Payload: map[string]any{"message": message, "kind": string(types.FailureSetup)},
			})
		}
		return nil, errors.New(types.TagFailure(types.FailureSetup, message))
	}

	env := providerenv.Env(settingsValue)
	// The progressive PPTX worker is a subprocess of the OfficeCLI bridge. In
	// local development the fegit presentation checkout lives beside the
	// OfficeDex checkout, so pass its absolute root explicitly instead of
	// relying on the bridge's (often different) working directory. Packaged
	// builds can place the same runtime under Resources/presentation; an
	// explicit user env still wins and is never overwritten.
	env = append(env, runtimeenv.BridgeEnv(cwd)...)

	a.binary.store(resolved.Path, env)
	// Another call may have started this cwd's client while the binary was
	// being resolved; one process per cwd, so that one wins.
	if existing := a.bridges.get(cwd); existing != nil {
		return existing, nil
	}

	client := bridge.New(bridge.Options{
		BinaryPath:     resolved.Path,
		Env:            env,
		Cwd:            cwd,
		ClientID:       a.desktopInstanceID,
		RuntimeRoot:    a.runtimeRoot,
		LogDir:         filepath.Join(a.userDataDir, "logs"),
		RequestTimeout: 30 * time.Second,
	})
	client.OnEvent(a.bridgeEventListener(client))

	if err := a.startBridge(client); err != nil {
		return nil, err
	}

	winner, stored := a.bridges.putIfAbsent(cwd, client)
	if !stored {
		client.Close()
	}
	return winner, nil
}

func resolveMopConvertFromEnvironment() string {
	// This used to keep the value exactly as written, while the pptxeditor
	// package resolved the same two variables to an absolute path. A relative
	// path is not usable from a packaged app, whose working directory is not
	// the shell's.
	return config.FirstExecutablePath(config.MOPConvertBinaryEnvKeys...)
}

func (a *App) ensureLoginManagerLocked() *login.Manager {
	if a.loginManager != nil {
		return a.loginManager
	}
	path, env := a.resolvedBinaryLocked()
	manager := login.New(login.ManagerOptions{
		BinaryPath: path,
		Env:        env,
		URLTimeout: 30 * time.Second,
	})
	ctx := a.ctx
	unsub := manager.OnEvent(func(event login.LoginEvent) {
		switch event.Type {
		case login.EventSuccess:
			a.mu.Lock()
			a.pendingLoginURL = ""
			a.mu.Unlock()
			a.resetBridgeRuntime()
			emit(ctx, authEventChannel, types.AuthEvent{Type: types.AuthEventSuccess})
		case login.EventFailure:
			a.mu.Lock()
			a.pendingLoginURL = ""
			a.mu.Unlock()
			emit(ctx, authEventChannel, types.AuthEvent{Type: types.AuthEventFailure, Message: event.Message})
		case login.EventExit:
			a.mu.Lock()
			a.pendingLoginURL = ""
			a.mu.Unlock()
			emit(ctx, authEventChannel, types.AuthEvent{Type: types.AuthEventExit, Code: event.Code, Signal: event.Signal})
		}
	})
	a.loginManager = manager
	a.loginUnsub = unsub
	return manager
}

func (a *App) resetBridgeRuntime() {
	a.mu.Lock()
	clients := a.takeBridgeClientsLocked()
	a.binary.invalidate()
	a.mu.Unlock()

	for _, client := range clients {
		client.Close()
	}
}

func (a *App) runCommandOptions() login.ManagerOptions {
	a.mu.Lock()
	defer a.mu.Unlock()
	path, env := a.resolvedBinaryLocked()
	return login.ManagerOptions{
		BinaryPath: path,
		Env:        env,
	}
}

// resolvedBinaryLocked returns the cached binary path + provider env, running
// binresolver / llmProviderEnv at most once per settings change. Caller must
// hold a.mu, which is what makes reading cachedSettings here safe; the cache
// itself is invalidated by UpdateSettings when touchesBridge=true.
func (a *App) resolvedBinaryLocked() (string, []string) {
	settings := a.cachedSettings
	return a.binary.ensure(func() (string, []string) {
		return binresolver.ResolvePath(a.resolverOptions(settings)),
			providerenv.Env(settings)
	})
}

func (a *App) resolverOptions(s types.UserSettings) binresolver.Options {
	var userPath *string
	if s.BridgeBinaryPath != nil && strings.TrimSpace(*s.BridgeBinaryPath) != "" {
		userPath = s.BridgeBinaryPath
	}
	bundled := a.bundledBinaryPath()
	var bundledPtr *string
	if bundled != "" {
		bundledPtr = &bundled
	}
	env := config.Trimmed(config.DesktopBinaryEnv)
	var envPtr *string
	if env != "" {
		envPtr = &env
	}
	var managedPtr *string
	if a.runtimeMgr != nil {
		status := a.runtimeMgr.Status()
		if status.Installed {
			mp := a.runtimeMgr.ManagedBinaryPath()
			managedPtr = &mp
		}
	}
	return binresolver.Options{
		UserBinaryPath:    userPath,
		BundledBinaryPath: bundledPtr,
		ManagedBinaryPath: managedPtr,
		EnvBinaryPath:     envPtr,
	}
}

func (a *App) bundledBinaryPath() string {
	exe := ""
	if resolvedExe, err := os.Executable(); err == nil {
		exe = resolvedExe
	}
	cwd, _ := config.ProcessCwd()
	return findBundledBinaryPath(runtime.GOOS, exe, cwd, func(candidate string) bool {
		_, err := os.Stat(candidate)
		return err == nil
	})
}

func findBundledBinaryPath(goos, exePath, cwd string, exists func(string) bool) string {
	binaryName := "officecli"
	if goos == "windows" {
		binaryName = "officecli.exe"
	}
	if exePath != "" {
		exeDir := filepath.Dir(exePath)
		candidates := []string{
			// Packaged macOS Wails app: <App>.app/Contents/Resources/officecli/<binary>
			filepath.Join(exeDir, "..", "Resources", "officecli", binaryName),
			// Windows release zip: OfficeDex.exe sits beside officecli/<binary>.
			filepath.Join(exeDir, "officecli", binaryName),
		}
		for _, candidate := range candidates {
			if exists(candidate) {
				return filepath.Clean(candidate)
			}
		}
	}
	if cwd != "" {
		candidate := filepath.Join(cwd, "build", "officecli", binaryName)
		if exists(candidate) {
			return candidate
		}
	}
	return ""
}
