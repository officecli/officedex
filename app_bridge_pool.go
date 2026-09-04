package main

import (
	"sync"

	"officedex/internal/bridge"
)

// bridgePool owns the live child processes: one per working directory, plus
// the ones that were replaced while still running work.
//
// These fields used to sit on App behind the same mutex as settings, window
// geometry, the editor services and everything else, so looking up a client
// contended with every unrelated call. The pool carries its own lock, which
// also makes the ownership rule explicit: a task belongs to the process that
// started it, and replacing that process to serve an unrelated call is what
// used to strand generations inside a child nobody could reach.
// The zero value is ready to use, so an App built without a constructor — the
// tests do this constantly — has a working, empty pool rather than a nil map.
type bridgePool struct {
	mu sync.Mutex
	// clients is keyed by working directory.
	clients map[string]*bridge.Client
	// recentCwd is the last directory served, so calls that only read
	// bridge-side state can reuse a connected client instead of starting one.
	recentCwd string
	// retired holds clients replaced while they still had tasks in flight.
	// They keep running so those tasks reach the renderer normally.
	retired []*bridge.Client
}

// get returns the client for a working directory, if one is pooled.
func (p *bridgePool) get(cwd string) *bridge.Client {
	p.mu.Lock()
	defer p.mu.Unlock()
	client := p.clients[cwd]
	if client != nil {
		p.recentCwd = cwd
	}
	return client
}

// putIfAbsent stores client for cwd unless another call already pooled one for
// it. The returned client is the one that won; a caller whose client lost must
// close it.
func (p *bridgePool) putIfAbsent(cwd string, client *bridge.Client) (*bridge.Client, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if existing := p.clients[cwd]; existing != nil {
		p.recentCwd = cwd
		return existing, false
	}
	if p.clients == nil {
		p.clients = map[string]*bridge.Client{}
	}
	p.clients[cwd] = client
	p.recentCwd = cwd
	return client, true
}

// mostRecentlyUsed returns the client for the last directory served, which may
// be nil or disconnected.
func (p *bridgePool) mostRecentlyUsed() *bridge.Client {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.clients[p.recentCwd]
}

// anyConnected returns a client that is already running, preferring the most
// recently used one, so a call that only asks a question does not start a
// process to ask it.
func (p *bridgePool) anyConnected() *bridge.Client {
	p.mu.Lock()
	defer p.mu.Unlock()
	if client := p.clients[p.recentCwd]; client != nil && client.Connected() {
		return client
	}
	for _, candidate := range p.clients {
		if candidate.Connected() {
			return candidate
		}
	}
	return nil
}

// all returns every pooled client without emptying the pool.
func (p *bridgePool) all() []*bridge.Client {
	p.mu.Lock()
	defer p.mu.Unlock()
	clients := make([]*bridge.Client, 0, len(p.clients))
	for _, client := range p.clients {
		clients = append(clients, client)
	}
	return clients
}

// takeAll empties the pool and returns what was in it, for the callers that
// invalidate every child process at once: shutdown, a binary or provider
// change, a runtime update.
func (p *bridgePool) takeAll() []*bridge.Client {
	p.mu.Lock()
	defer p.mu.Unlock()
	clients := make([]*bridge.Client, 0, len(p.clients))
	for _, client := range p.clients {
		clients = append(clients, client)
	}
	p.clients = map[string]*bridge.Client{}
	p.recentCwd = ""
	return clients
}

// park keeps a replaced client alive because it still has work in flight.
func (p *bridgePool) park(client *bridge.Client) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.retired = append(p.retired, client)
}

// takeRetired empties the parked list and returns it, for shutdown: those
// clients still belong to the app and must not outlive it.
func (p *bridgePool) takeRetired() []*bridge.Client {
	p.mu.Lock()
	defer p.mu.Unlock()
	retired := p.retired
	p.retired = nil
	return retired
}

// unpark removes a parked client, reporting whether this call is the one that
// owns closing it. Both the idle-reaper and the grace-period timer race for it.
func (p *bridgePool) unpark(client *bridge.Client) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	for i, parked := range p.retired {
		if parked == client {
			p.retired = append(p.retired[:i], p.retired[i+1:]...)
			return true
		}
	}
	return false
}

// size reports how many clients are pooled, for assertions about invalidation.
func (p *bridgePool) size() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.clients)
}

// recent reports the last directory served.
func (p *bridgePool) recent() string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.recentCwd
}

// seed fills the pool directly. Tests use it to stand up a pool without
// starting real child processes.
func (p *bridgePool) seed(recentCwd string, clients map[string]*bridge.Client) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.clients = map[string]*bridge.Client{}
	for cwd, client := range clients {
		p.clients[cwd] = client
	}
	p.recentCwd = recentCwd
}
