package main

import (
	"strings"
	"sync"
)

// recoveryRoutes maps an interrupted task id to the live task that replaced it.
//
// After an app restart the renderer keeps using the id of the task it was
// showing, while stale-respond recovery has created a replacement with a new
// id. Answers for the old id have to reach the new task, or recovery re-runs
// generation from the idea gate on every step. A task can be recovered more
// than once, so a route may point at an id that itself has a route.
//
// This was a map on App behind the mutex that also guards settings, window
// geometry and the editor services, and follow runs on every Respond. It has
// its own lock now. The zero value is an empty table.
type recoveryRoutes struct {
	mu   sync.Mutex
	next map[string]string
}

// maxRecoveryHops bounds how far follow walks a chain. Sixteen recoveries of
// the same task is not a real scenario; the bound exists so a cycle that
// record failed to prevent cannot hang the caller.
const maxRecoveryHops = 16

// follow returns the live id for taskID, walking the chain of replacements. It
// returns taskID unchanged when nothing replaced it.
func (r *recoveryRoutes) follow(taskID string) string {
	r.mu.Lock()
	defer r.mu.Unlock()
	for hops := 0; hops < maxRecoveryHops; hops++ {
		next, ok := r.next[taskID]
		if !ok || next == "" || next == taskID {
			break
		}
		taskID = next
	}
	return taskID
}

// record notes that oldID was replaced by newID. Blank ids and a task
// "replacing" itself are ignored rather than stored: a self-route would make
// follow loop until the hop bound, and a blank one would route every answer
// with an empty id.
func (r *recoveryRoutes) record(oldID, newID string) {
	oldID = strings.TrimSpace(oldID)
	newID = strings.TrimSpace(newID)
	if oldID == "" || newID == "" || oldID == newID {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.next == nil {
		r.next = make(map[string]string)
	}
	r.next[oldID] = newID
}
