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
