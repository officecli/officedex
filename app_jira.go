package main

// Jira connector bindings.
//
// These three methods are the whole desktop surface of the Jira connector:
// Settings reads the current connection, saves/probes a new one, and clears it.
// Issue syncing does NOT come through here — the spreadsheet panel drives the
// `jira.sync.v1` agent workflow instead, so there is deliberately no
// sync/projects/fields binding below.
//
// Everything is a thin passthrough to the OfficeCLI bridge, which owns the
// credential store and every outbound Jira call. We keep the payloads as plain
// JSON (`map[string]any` / `any`) rather than mirroring the bridge's structs:
// the renderer already declares these shapes in `src/shared/verticals.ts`, and
// a second Go-side copy would be one more thing to keep in sync for no gain.
//
// `agentRuntimeRequest` is named for its first caller but is a generic bridge
// request helper — it resolves the client (honouring the test override) and
// decodes the JSON reply. Reusing it keeps one bridge code path.

// GetJiraConnection reports the stored connection. The bridge substitutes a
// default base URL when nothing is configured, so the renderer can prefill the
// form without inventing a value of its own.
func (a *App) GetJiraConnection() (any, error) {
	return a.agentRuntimeRequest("jira/connection/get", map[string]any{})
}

// SaveJiraConnection probes the connection and stores it only if the probe
// succeeds, returning the probe result (server info + authenticated user).
//
// An empty secret is meaningful: the bridge reuses the stored credential when
// the rest of the input addresses the same account. That is what lets the
// Settings form show a "leave blank to keep" placeholder instead of forcing the
// user to retype a PAT to change an unrelated field.
func (a *App) SaveJiraConnection(input map[string]any) (any, error) {
	return a.agentRuntimeRequest("jira/connection/save", input)
}

// ClearJiraConnection removes the stored credential. The bridge replies with a
// small acknowledgement object, which has no use on the renderer side.
func (a *App) ClearJiraConnection() error {
	_, err := a.agentRuntimeRequest("jira/connection/clear", map[string]any{})
	return err
}
