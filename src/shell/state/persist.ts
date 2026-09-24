/**
 * Shell-local view state persistence.
 *
 * This is deliberately separate from the UiPort: how wide the sidebar is and
 * where the agent bubble sits are properties of *this window*, not of the
 * workspace, so they never travel through the service seam. Open tabs and
 * whether the workspace is on screen are session navigation and are not
 * restored on launch — see `omitSessionNavigation`.
 *
 * One namespaced key, one version. A shape change bumps the version and the
 * old value is dropped rather than migrated — view state is cheap to rebuild.
 */

const KEY = "officedex.shell.v1";

export interface PersistedShellState {
  mode: "agent" | "editor";
  navWidth: number;
  navCollapsed: boolean;
  taskWidth: number;
  selectedFolderId: string | null;
  expandedFolderIds: string[];
  revealedFolderIds: string[];
  openFileIds: string[];
  activeFileId: string | null;
  home: boolean;
  homeList: "recent" | "pinned";
  /** The bundled recording is on the canvas rather than a file. */
  demo: boolean;
  /** When it was last asked for; it loses the canvas to anything newer. */
  demoStartedAt?: string | null;
  presence: {
    placement: "docked" | "floating";
    expanded: boolean;
    /** null until the presence has been placed; see PresenceState. */
    x: number | null;
    y: number | null;
    edge: "left" | "right" | "top" | "bottom" | null;
  };
}

export function readPersisted(): Partial<PersistedShellState> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" ? (value as Partial<PersistedShellState>) : {};
  } catch {
    return {};
  }
}

/**
 * Chrome preferences that survive a relaunch. Session navigation — Home vs the
 * workspace, which tabs were open, the bundled recording — does not: entering
 * the app always lands on Home with an empty tab strip. Previous documents stay
 * in the library.
 *
 * Tests that must reload into a workspace (S4) pass `?restoreSession=1`.
 */
export function omitSessionNavigation(
  persisted: Partial<PersistedShellState>,
): Partial<PersistedShellState> {
  const chrome = { ...persisted };
  delete chrome.home;
  delete chrome.openFileIds;
  delete chrome.activeFileId;
  delete chrome.demo;
  delete chrome.demoStartedAt;
  return chrome;
}

export function shouldRestoreSession(search?: string): boolean {
  const query = search ?? (typeof window === "undefined" ? "" : window.location.search);
  return new URLSearchParams(query).get("restoreSession") === "1";
}

/** Persist plus an optional override, with session navigation dropped unless restored. */
export function bootPersisted(
  override: Partial<PersistedShellState> = {},
  search?: string,
): Partial<PersistedShellState> {
  const stored = shouldRestoreSession(search) ? readPersisted() : omitSessionNavigation(readPersisted());
  return { ...stored, ...override };
}

export function writePersisted(state: PersistedShellState): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // A full quota must not break the session; view state is disposable.
  }
}

export function clearPersisted(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
