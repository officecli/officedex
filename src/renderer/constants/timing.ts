// Timeouts for conversations with the embedded presentation editor. Each was
// a literal at its call site (30_000 six times, 120_000 twice); a change in
// one place silently disagreed with the others.

/** A script sent to the editor (Office.js source) must answer within this. */
export const EDITOR_SCRIPT_TIMEOUT_MS = 120_000;
/** A short probe or state read of the editor. */
export const EDITOR_PROBE_TIMEOUT_MS = 30_000;
/** Swapping the open document for another revision. */
export const EDITOR_SWAP_TIMEOUT_MS = 30_000;
/** The editor frame answering the first hello. */
export const EDITOR_READY_TIMEOUT_MS = 30_000;
/** Loading a deck into the editor, or exporting one out of it. */
export const EDITOR_LOAD_TIMEOUT_MS = 120_000;

// Polling cadences. Every loop goes through utils/usePolling; the numbers
// live here so the cadences can be read side by side.

/** Re-read task history while a task is active, to catch events SSE dropped. */
export const TASK_HISTORY_RECONCILE_INTERVAL_MS = 1_500;
/** Runtime runs table in Settings. */
export const RUNS_POLL_INTERVAL_MS = 5_000;
/** Runtime prompts (runs waiting on the user). */
export const PROMPTS_POLL_INTERVAL_MS = 4_000;
/** The workbook snapshot behind an App Builder preview. */
export const WORKBOOK_POLL_INTERVAL_MS = 1_500;
/** Credit balance and entitlement. */
export const CREDIT_POLL_INTERVAL_MS = 60_000;

/**
 * How long an embedded editor has to report ready before its frame gives up.
 *
 * Generous: these are large WASM/JS bundles and a cold start on a slow disk is
 * seconds. The point is not to be quick, it is to be finite — the failure this
 * replaces had no end at all, and every error path in both frames is reached
 * from a message the embed sends, so an embed that never boots said nothing.
 */
export const EMBED_HANDSHAKE_TIMEOUT_MS = 30_000;
