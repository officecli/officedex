/**
 * Shell-local view state persistence.
 *
 * This is deliberately separate from the UiPort: whether the sidebar is hidden,
 * how wide the conversation is and which avatar the user picked are properties
 * of *this window*, not of the workspace, so they never travel through the
 * service seam. Open tabs, the open conversation and the page on screen are
 * session navigation and are not restored on launch — see
 * `omitSessionNavigation`.
 *
 * One namespaced key, one version. A shape change bumps the version and the
 * old value is dropped rather than migrated — view state is cheap to rebuild.
 * `v2` is the OD-UI-1.2 shape; `v1` belonged to the Agent/Editor shell and
 * shares no field that would mean the same thing here.
 */

import type { AvatarId, ChatPanel, ChatPosition, ChatRef, Page, SettingsSectionId } from "./shellReducer";

const KEY = "officedex.shell.v2";

export interface PersistedShellState {
  page: Page;
  chat: ChatRef | null;
  panel: ChatPanel;
  workspaceOpen: boolean;
  chatFloating: boolean;
  chatPosition: ChatPosition;
  chatWidth: number;
  navCollapsed: boolean;
  expandedFolderIds: string[];
  openFileIds: string[];
  activeFileId: string | null;
  tabContexts: Record<string, ChatRef | null>;
  settingsSection: SettingsSectionId;
  avatar: AvatarId;
  theme: "light" | "dark";
  featuresVisible: boolean;
  featuresDocked: boolean;
  /** The bundled recording is on the canvas rather than a file. */
  demo: boolean;
  /** When it was last asked for; it loses the canvas to anything newer. */
  demoStartedAt?: string | null;
  /** A run's live stage is on the canvas rather than a file. */
  stage: boolean;
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
 * Preferences survive a relaunch; session navigation does not.
 *
 * OD-UI-1.2 §02: an ordinary launch lands on Home with no document tabs, and
 * does not restore the previous ones. Whatever was open stays in the library,
 * and unsaved drafts come back through the recovery entry on Home, by the
 * user's choice.
 *
 * Tests that must reload into a workspace pass `?restoreSession=1`.
 */
export function omitSessionNavigation(
  persisted: Partial<PersistedShellState>,
): Partial<PersistedShellState> {
  const preferences = { ...persisted };
  delete preferences.page;
  delete preferences.chat;
  delete preferences.panel;
  delete preferences.workspaceOpen;
  delete preferences.chatFloating;
  delete preferences.openFileIds;
  delete preferences.activeFileId;
  delete preferences.tabContexts;
  delete preferences.demo;
  delete preferences.demoStartedAt;
  delete preferences.stage;
  return preferences;
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
