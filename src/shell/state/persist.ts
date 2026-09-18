/**
 * Shell-local view state persistence.
 *
 * This is deliberately separate from the UiPort: which tabs are open, how wide
 * the sidebar is and where the agent bubble sits are properties of *this
 * window*, not of the workspace, so they never travel through the service seam.
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
