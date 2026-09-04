package main

import (
	"errors"
	"sync"
	"testing"
	"time"

	"officedex/internal/types"
)

func TestCreditStatusCacheServesTheSecondCallWithoutFetching(t *testing.T) {
	var cache creditStatusCache
	now := time.Now()
	cache.now = func() time.Time { return now }

	calls := 0
	fetch := func() (types.CreditStatus, error) {
		calls++
		return types.CreditStatus{Mode: types.WhoAmILoggedIn, PaidEntitlement: true}, nil
	}

	first, err := cache.get(fetch)
	if err != nil {
		t.Fatalf("first get: %v", err)
	}
	second, err := cache.get(fetch)
	if err != nil {
		t.Fatalf("second get: %v", err)
	}
	if calls != 1 {
		t.Fatalf("expected one fetch behind two gets, got %d", calls)
	}
	if !second.PaidEntitlement || second.Mode != first.Mode {
		t.Fatalf("cached value differs from the fetched one: %#v vs %#v", second, first)
	}
}

func TestCreditStatusCacheRefetchesAfterTheTTL(t *testing.T) {
	var cache creditStatusCache
	now := time.Now()
	cache.now = func() time.Time { return now }

	calls := 0
	fetch := func() (types.CreditStatus, error) {
		calls++
		return types.CreditStatus{PlanName: "plan", RewardRemaining: calls}, nil
	}

	if _, err := cache.get(fetch); err != nil {
		t.Fatalf("first get: %v", err)
	}
	// One tick short of the TTL is still a hit.
	now = now.Add(creditStatusTTL - time.Millisecond)
	if _, err := cache.get(fetch); err != nil {
		t.Fatalf("get inside the TTL: %v", err)
	}
	if calls != 1 {
		t.Fatalf("expected the value inside the TTL to be cached, got %d fetches", calls)
	}

	now = now.Add(2 * time.Millisecond)
	got, err := cache.get(fetch)
	if err != nil {
		t.Fatalf("get past the TTL: %v", err)
	}
	if calls != 2 {
		t.Fatalf("expected a refetch past the TTL, got %d fetches", calls)
	}
	if got.RewardRemaining != 2 {
		t.Fatalf("expected the refetched value, got %#v", got)
	}
}

func TestCreditStatusCacheInvalidateForcesARefetch(t *testing.T) {
	// This is the case the TTL cannot cover: logging out changes the answer now,
	// not in a minute.
	var cache creditStatusCache
	now := time.Now()
	cache.now = func() time.Time { return now }

	entitled := true
	calls := 0
	fetch := func() (types.CreditStatus, error) {
		calls++
		return types.CreditStatus{PaidEntitlement: entitled}, nil
	}

	if _, err := cache.get(fetch); err != nil {
		t.Fatalf("first get: %v", err)
	}
	entitled = false
	cache.invalidate()

	got, err := cache.get(fetch)
	if err != nil {
		t.Fatalf("get after invalidate: %v", err)
	}
	if calls != 2 {
		t.Fatalf("expected invalidate to force a refetch, got %d fetches", calls)
	}
	if got.PaidEntitlement {
		t.Fatal("expected the post-logout entitlement, got the cached one")
	}
}

func TestCreditStatusCacheKeepsTheErrorWithTheValue(t *testing.T) {
	// A failed fetch is cached on purpose: the watermark policy fails closed, so
	// respawning a failing subprocess on every Generate buys latency and nothing
	// else. The caller must still see the error, not a zero value passing as an
	// answer.
	var cache creditStatusCache
	now := time.Now()
	cache.now = func() time.Time { return now }

	wantErr := errors.New("officecli is not installed")
	calls := 0
	fetch := func() (types.CreditStatus, error) {
		calls++
		return types.CreditStatus{}, wantErr
	}

	if _, err := cache.get(fetch); !errors.Is(err, wantErr) {
		t.Fatalf("first get: %v", err)
	}
	if _, err := cache.get(fetch); !errors.Is(err, wantErr) {
		t.Fatalf("second get lost the error: %v", err)
	}
	if calls != 1 {
		t.Fatalf("expected the failure to be cached, got %d fetches", calls)
	}

	// And it clears like a value does.
	cache.invalidate()
	fetch = func() (types.CreditStatus, error) {
		calls++
		return types.CreditStatus{Mode: types.WhoAmILoggedIn}, nil
	}
	if _, err := cache.get(fetch); err != nil {
		t.Fatalf("expected the error to clear on invalidate, got %v", err)
	}
}

func TestCreditStatusCacheCollapsesConcurrentGenerates(t *testing.T) {
	// A burst of Generates used to be a burst of officecli process launches.
	var cache creditStatusCache
	now := time.Now()
	cache.now = func() time.Time { return now }

	var mu sync.Mutex
	calls := 0
	fetch := func() (types.CreditStatus, error) {
		mu.Lock()
		calls++
		mu.Unlock()
		time.Sleep(5 * time.Millisecond)
		return types.CreditStatus{Mode: types.WhoAmILoggedIn}, nil
	}

	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := cache.get(fetch); err != nil {
				t.Errorf("concurrent get: %v", err)
			}
		}()
	}
	wg.Wait()

	mu.Lock()
	defer mu.Unlock()
	if calls != 1 {
		t.Fatalf("expected eight concurrent gets to share one fetch, got %d", calls)
	}
}
