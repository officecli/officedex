const CLIENT_ID_STORAGE_KEY = "officedex.agentClientId";

// Identity of this OfficeDex page.
//
// Client tools act on "the current workbook", and the host polls the Runtime for
// pending calls. Without an identity every open tab races to claim every call,
// and a stale tab holding a different document can win — which is how a write
// lands in the wrong file.
//
// Kept in localStorage, not sessionStorage. The shipping form is a Wails desktop
// client with a single webview, where relaunching the app would clear a session
// -scoped id and orphan any Run still parked on a client tool: its stored target
// would name a host that can never exist again. A stable per-installation id
// keeps those Runs claimable across restarts. The cost is that two tabs in
// browser dev mode share an id — that multi-tab race is a development-only
// artifact, and the pre-write document check remains the real safety property.
//
// This module deliberately has no imports: both the bridge and the client-tool
// host depend on it, and routing it through either would create an import cycle.
let cachedClientId: string | undefined;

export function agentClientId(): string {
  if (cachedClientId) return cachedClientId;
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(CLIENT_ID_STORAGE_KEY);
  } catch {
    stored = null;
  }
  if (!stored) {
    stored = `client-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
    try {
      window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, stored);
    } catch {
      // Storage failures still leave a usable in-memory identity for this run.
    }
  }
  cachedClientId = stored;
  return cachedClientId;
}

// Test seam: lets a test simulate a second page without touching storage.
export function __setAgentClientIdForTest(value: string | undefined): void {
  cachedClientId = value;
}
