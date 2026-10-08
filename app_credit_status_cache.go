package main

import (
	"sync"
	"time"

	"officedex/internal/types"
)

// creditStatusTTL bounds how stale the entitlement behind a Generate may be.
//
// The cached value decides one thing: whether this account may turn the image
// watermark off. That is a property of the plan, which changes when the user
// logs in, logs out, or redeems a code — all of which invalidate this cache
// outright. The TTL only covers the remaining case, an entitlement changed on
// the web while the app is open, and a minute of lag there is invisible next to
// the time a generation takes.
const creditStatusTTL = time.Minute

// creditStatusCache memoises `officecli auth status --json` for the Generate
// path.
//
// Every Generate used to spawn a whole officecli subprocess to ask one boolean,
// on the request path, before any work started. A burst of generations paid for
// a process launch each. This keeps the answer for creditStatusTTL and hands the
// same one to everyone who asks in that window.
//
// The renderer's GetCreditStatus binding deliberately does not read this: it
// displays a credit balance that moves with every generation, so it wants the
// live number, not a recent one.
//
// The zero value is an empty cache.
type creditStatusCache struct {
	mu       sync.Mutex
	status   types.CreditStatus
	err      error
	fetched  bool
	fetchedA time.Time
	now      func() time.Time // nil means time.Now; tests set it
}

// get returns the cached status, calling fetch when nothing usable is held.
//
// A failed fetch is cached alongside a successful one, and on purpose: the
// watermark policy fails closed on error, so repeating a failing subprocess
// spawn on every Generate would buy nothing but latency. The error clears on
// the same TTL and on the same invalidations as a value.
//
// fetch runs under the lock so that concurrent Generates spawn one subprocess
// between them rather than one each.
func (c *creditStatusCache) get(fetch func() (types.CreditStatus, error)) (types.CreditStatus, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.fetched && c.clock().Sub(c.fetchedA) < creditStatusTTL {
		return c.status, c.err
	}
	c.status, c.err = fetch()
	c.fetched = true
	c.fetchedA = c.clock()
	return c.status, c.err
}

// invalidate forgets the cached status. The next Generate asks the CLI again.
func (c *creditStatusCache) invalidate() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.status = types.CreditStatus{}
	c.err = nil
	c.fetched = false
	c.fetchedA = time.Time{}
}

func (c *creditStatusCache) clock() time.Time {
	if c.now != nil {
		return c.now()
	}
	return time.Now()
}
