package main

import (
	"sync"
	"time"
)

// binaryCache holds the resolved OfficeCLI binary path and the provider env it
// was resolved with. binresolver.ResolvePath stats the filesystem and
// llmProviderEnv rebuilds the environment on every call, while
// runCommandOptions and ensureBridge run on every RPC, so the result is cached
// until something that changes it happens: the user points at a different
// binary, switches provider or proxy, moves the workspace, logs out, or the
// runtime manager installs a new binary over the old one.
//
// The path, the env and the timestamp are one fact and are only ever correct
// together: env belongs to the binary it was resolved for, and the timestamp
// says whether either was ever resolved at all. They used to be three fields on
// App cleared by hand at four call sites, where forgetting one would leave a
// new binary running with the previous provider's environment. Here they move
// as a unit, behind a lock of their own rather than App's.
//
// The zero value is an empty cache.
type binaryCache struct {
	mu   sync.Mutex
	path string
	env  []string
	at   time.Time
}

// load returns the cached resolution without filling it. at is the zero time
// when nothing has been resolved yet, which is how callers tell "no env
// applied" apart from "resolved with an empty env".
func (c *binaryCache) load() (path string, env []string, at time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.path, append([]string(nil), c.env...), c.at
}

// store records a resolution performed by the caller. ensureBridge resolves
// outside the lock because it does more than binresolver does.
func (c *binaryCache) store(path string, env []string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.path = path
	c.env = append([]string(nil), env...)
	c.at = time.Now()
}

// ensure returns the cached resolution, running resolve once if the cache is
// empty. resolve runs under the lock so that concurrent callers stat the
// filesystem once between them rather than once each.
func (c *binaryCache) ensure(resolve func() (string, []string)) (string, []string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.path == "" {
		c.path, c.env = resolve()
		c.at = time.Now()
	}
	return c.path, append([]string(nil), c.env...)
}

// invalidate forgets the resolution. The next caller resolves again.
func (c *binaryCache) invalidate() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.path = ""
	c.env = nil
	c.at = time.Time{}
}

// seed populates the cache directly. Tests use it to stand up an App whose
// binary is already resolved without running the resolver.
func (c *binaryCache) seed(path string, env []string, at time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.path = path
	c.env = env
	c.at = at
}
