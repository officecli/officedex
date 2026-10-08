package main

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"officedex/internal/bridge"
	"officedex/internal/types"
)

// poolTestClient builds a bridge client over a fake transport, the way the
// retire tests do, and registers the production event listener.
func poolTestClient(t *testing.T, app *App) (*bridge.Client, *authResetBridgeTransport) {
	t.Helper()
	transport := newAuthResetBridgeTransport()
	client := bridge.New(bridge.Options{
		RequestTimeout: 500 * time.Millisecond,
		CreateTransport: func(opts bridge.Options) (bridge.Transport, error) {
			return transport, nil
		},
		DisableAutoReconnect: true,
	})
	client.OnEvent(app.bridgeEventListener(client))
	if err := client.Start(context.Background()); err != nil {
		t.Fatalf("start bridge client: %v", err)
	}
	t.Cleanup(func() { client.Close() })
	return client, transport
}

// Regression: a task lives inside the child process that started it, and that
// process is keyed by working directory. A single client slot meant starting a
// task in a second workspace killed the first workspace's process — and every
// later call about the first task started a third process that had never heard
// of it, so answers and cancels landed nowhere.
func TestBridgePoolKeepsOneClientPerWorkspace(t *testing.T) {
	app := &App{userDataDir: t.TempDir(), workspaceDir: t.TempDir()}
	first, firstTransport := poolTestClient(t, app)
	second, secondTransport := poolTestClient(t, app)

	app.mu.Lock()
	app.bridges.seed("/ws/two", map[string]*bridge.Client{"/ws/one": first, "/ws/two": second})
	app.mu.Unlock()

	// A task started in the first workspace.
	writeRetireNotification(t, firstTransport.stdoutW, "task-1", "task.started")
	waitForBusy(t, first, true)

	// Working in the second workspace must not disturb it.
	got, err := app.ensureBridgeForCwd("/ws/two")
	if err != nil {
		t.Fatalf("ensureBridgeForCwd: %v", err)
	}
	if got != second {
		t.Fatal("the second workspace should resolve to its own client")
	}
	if kills := firstTransport.kills.Load(); kills != 0 {
		t.Fatalf("the first workspace's process was killed (kills = %d)", kills)
	}

	// Coming back to the first workspace reaches the process that owns the
	// task, rather than starting a fresh one that has never heard of it.
	got, err = app.ensureBridgeForCwd("/ws/one")
	if err != nil {
		t.Fatalf("ensureBridgeForCwd: %v", err)
	}
	if got != first {
		t.Fatal("the running task's own client should still answer for its workspace")
	}
	if kills := secondTransport.kills.Load(); kills != 0 {
		t.Fatalf("returning to the first workspace killed the second (kills = %d)", kills)
	}
}

// Renderer startup requests bridge metadata from more than one effect. Those
// calls used to race between the empty-pool check and putIfAbsent, starting two
// children for the same cwd. Closing the loser emitted bridge.exited and made
// the home screen claim the connection was interrupted even though the winner
// was healthy.
func TestEnsureBridgeForCwdStartsOneClientWhenCalledConcurrently(t *testing.T) {
	workspaceDir := t.TempDir()
	binaryPath := "/bin/true"
	app := &App{
		userDataDir:    t.TempDir(),
		workspaceDir:   workspaceDir,
		cachedSettings: types.UserSettings{BridgeBinaryPath: &binaryPath},
	}
	app.startEventWriter()

	var created atomic.Int32
	var transportsMu sync.Mutex
	var transports []*handshakeFakeTransport
	app.bridgeClientFactory = func(options bridge.Options) *bridge.Client {
		created.Add(1)
		transport := newHandshakeFakeTransport()
		transportsMu.Lock()
		transports = append(transports, transport)
		transportsMu.Unlock()
		options.CreateTransport = func(bridge.Options) (bridge.Transport, error) { return transport, nil }
		options.DisableAutoReconnect = true
		options.RequestTimeout = 2 * time.Second
		client := bridge.New(options)
		go answerInitializeWithProtocol(t, transport, bridge.MinProtocolVersion, "test")
		return client
	}

	const callers = 8
	results := make(chan *bridge.Client, callers)
	errs := make(chan error, callers)
	var wg sync.WaitGroup
	for i := 0; i < callers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			client, err := app.ensureBridgeForCwd(workspaceDir)
			results <- client
			errs <- err
		}()
	}
	wg.Wait()
	close(results)
	close(errs)

	for err := range errs {
		if err != nil {
			t.Fatalf("ensureBridgeForCwd: %v", err)
		}
	}
	var first *bridge.Client
	for client := range results {
		if first == nil {
			first = client
		} else if client != first {
			t.Fatal("concurrent callers received different bridge clients")
		}
	}
	if got := created.Load(); got != 1 {
		t.Fatalf("created %d bridge clients, want 1", got)
	}

	transportsMu.Lock()
	started := append([]*handshakeFakeTransport(nil), transports...)
	transportsMu.Unlock()
	for _, transport := range started {
		_ = transport.Kill()
	}
	app.drainEventWrites()
}

// A settings change that invalidates every child (binary, provider, proxy)
// still has to empty the whole pool, not just one entry.
func TestTakeBridgeClientsEmptiesThePool(t *testing.T) {
	app := &App{userDataDir: t.TempDir(), workspaceDir: t.TempDir()}
	first, _ := poolTestClient(t, app)
	second, _ := poolTestClient(t, app)

	app.mu.Lock()
	app.bridges.seed("/ws/one", map[string]*bridge.Client{"/ws/one": first, "/ws/two": second})
	app.mu.Unlock()

	app.mu.Lock()
	taken := app.takeBridgeClientsLocked()
	remaining, recent := app.bridges.size(), app.bridges.recent()
	app.mu.Unlock()
	if len(taken) != 2 {
		t.Fatalf("took %d clients, want 2", len(taken))
	}
	if remaining != 0 || recent != "" {
		t.Fatalf("pool not emptied: %d clients, recent = %q", remaining, recent)
	}
}

// bridgeForMetadata must reuse a connected client rather than start a process
// just to read capabilities.
func TestBridgeForMetadataReusesAPooledClient(t *testing.T) {
	app := &App{userDataDir: t.TempDir(), workspaceDir: t.TempDir()}
	client, transport := poolTestClient(t, app)

	app.mu.Lock()
	app.bridges.seed("", map[string]*bridge.Client{"/ws/one": client})
	// No recent cwd: the lookup has to fall back to scanning the pool.
	app.mu.Unlock()

	got, err := app.bridgeForMetadata()
	if err != nil {
		t.Fatalf("bridgeForMetadata: %v", err)
	}
	if got != client {
		t.Fatal("bridgeForMetadata should reuse the pooled client")
	}
	if kills := transport.kills.Load(); kills != 0 {
		t.Fatalf("metadata lookup killed a live bridge (kills = %d)", kills)
	}
}

// The pool used to be three fields on App behind the same mutex as settings,
// window geometry and the editor services, so looking up a client contended
// with every unrelated call. Its own lock has to actually hold under
// concurrency.
func TestBridgePoolIsSafeUnderConcurrentUse(t *testing.T) {
	var pool bridgePool
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(3)
		go func() { defer wg.Done(); pool.putIfAbsent("/ws", &bridge.Client{}) }()
		go func() { defer wg.Done(); pool.get("/ws") }()
		go func() { defer wg.Done(); pool.size() }()
	}
	wg.Wait()
	if pool.size() != 1 {
		t.Fatalf("one directory should hold one client, got %d", pool.size())
	}
}

// A zero App has a working pool; the tests build one that way constantly.
func TestBridgePoolZeroValueIsUsable(t *testing.T) {
	app := &App{}
	if app.bridges.size() != 0 {
		t.Fatal("a fresh pool should be empty")
	}
	if got := app.bridges.all(); len(got) != 0 {
		t.Fatalf("a fresh pool should hold nothing, got %d", len(got))
	}
	if app.bridges.unpark(&bridge.Client{}) {
		t.Error("unparking a client that was never parked should report false")
	}
}

// A parked client is one that was replaced while still running work. Only one
// caller may close it: the idle reaper and the grace timer both race for it.
func TestBridgePoolParkingHandsOwnershipToOneCaller(t *testing.T) {
	var pool bridgePool
	client := &bridge.Client{}
	pool.park(client)

	if !pool.unpark(client) {
		t.Fatal("the first unpark owns closing the client")
	}
	if pool.unpark(client) {
		t.Fatal("a second unpark must not also claim ownership")
	}
}
