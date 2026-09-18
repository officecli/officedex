/**
 * The shell's view state as a pure reducer, so the IA's invariants are
 * assertable without mounting React.
 *
 * Two invariants live here and nowhere else:
 *
 *  - Decision 1: the agent presence may only dock in Agent mode. Editor mode
 *    keeps it floating; if Editor could dock it on the right, "Editor with a
 *    dock" would be Agent mode mirrored and the two modes would stop meaning
 *    anything. The user's Agent-mode preference is remembered across the trip
 *    through Editor, so `placement` is a *preference* and
 *    `effectivePlacement()` is what the layout reads.
 *
 *  - Decision 2/3: `selectedFolderId` is a real folder or null for "no folder
 *    chosen". It is never the string "recent" — Recent is a time view over all
 *    files, not a location a file can sit in.
 */

import type { FileMeta } from "../../shared/uiPort";
import type { PersistedShellState } from "./persist";

export type Mode = "agent" | "editor";
export type Placement = "docked" | "floating";
export type Edge = "left" | "right" | "top" | "bottom" | null;
export type HomeList = "recent" | "pinned";

export const NAV_RAIL_WIDTH = 52;
export const NAV_MIN_WIDTH = 160;
export const NAV_MAX_WIDTH = 300;
export const TASK_MIN_WIDTH = 320;
export const TASK_MAX_WIDTH = 660;

export interface PresenceState {
  /** The user's preference. Only honoured in Agent mode — see effectivePlacement. */
  placement: Placement;
  expanded: boolean;
  /**
   * null until the presence has been placed. A sentinel of 0,0 would be
   * indistinguishable from "dragged to the top-left corner", and the resize
   * clamp would quietly turn it into a real position before the first layout
   * ever ran.
   */
  x: number | null;
  y: number | null;
  edge: Edge;
}

export interface ShellState {
  mode: Mode;
  home: boolean;
  homeList: HomeList;
  navWidth: number;
  navCollapsed: boolean;
  taskWidth: number;
  selectedFolderId: string | null;
  /** Which folders are open in the sidebar tree. */
  expandedFolderIds: string[];
  /** Folder keys whose file list is showing past the first few entries. */
  revealedFolderIds: string[];
  openFileIds: string[];
  activeFileId: string | null;
  presence: PresenceState;
}

export type ShellAction =
  | { type: "set-mode"; mode: Mode }
  | { type: "go-home"; list?: HomeList }
  | { type: "set-home-list"; list: HomeList }
  | { type: "select-folder"; folderId: string | null }
  | { type: "toggle-folder"; folderId: string }
  | { type: "reveal-folder"; folderId: string }
  | { type: "toggle-folder-overflow"; folderId: string }
  | { type: "open-file"; fileId: string }
  | { type: "close-file"; fileId: string }
  | { type: "activate-file"; fileId: string }
  | { type: "toggle-nav" }
  | { type: "set-nav-width"; width: number }
  | { type: "set-task-width"; width: number }
  | { type: "set-placement"; placement: Placement }
  | { type: "set-presence-expanded"; expanded: boolean }
  | { type: "set-presence-position"; x: number; y: number; edge: Edge }
  | { type: "prune-files"; files: FileMeta[] };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * `??` only catches null and undefined, so a persisted NaN would survive it and
 * poison the clamp. Persisted view state is untrusted input like any other.
 */
const finite = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

export const initialShellState: ShellState = {
  mode: "agent",
  home: true,
  homeList: "recent",
  navWidth: 220,
  navCollapsed: false,
  taskWidth: 340,
  selectedFolderId: null,
  expandedFolderIds: [],
  revealedFolderIds: [],
  openFileIds: [],
  activeFileId: null,
  presence: { placement: "docked", expanded: true, x: null, y: null, edge: null },
};

const toggleIn = (list: string[], value: string) =>
  list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];

/** Decision 1: docking is an Agent-mode-only affordance. */
export function canDock(state: ShellState): boolean {
  return state.mode === "agent";
}

/** What the layout reads. Never consult `state.presence.placement` directly. */
export function effectivePlacement(state: ShellState): Placement {
  return canDock(state) ? state.presence.placement : "floating";
}

/**
 * Whether the collapsed face is on screen. Docked has no face: the column
 * *is* the presence, so rendering a bubble beside it would be the same object
 * drawn twice — the duplication this refactor exists to remove.
 */
export function showsPresenceFace(state: ShellState): boolean {
  return effectivePlacement(state) === "floating";
}

export function shellReducer(state: ShellState, action: ShellAction): ShellState {
  switch (action.type) {
    case "set-mode": {
      if (state.mode === action.mode) return state;
      return { ...state, mode: action.mode };
    }

    case "go-home":
      return { ...state, home: true, homeList: action.list ?? state.homeList };

    case "set-home-list":
      return { ...state, home: true, homeList: action.list };

    case "select-folder":
      return { ...state, selectedFolderId: action.folderId };

    case "toggle-folder":
      return { ...state, expandedFolderIds: toggleIn(state.expandedFolderIds, action.folderId) };

    case "reveal-folder":
      return state.expandedFolderIds.includes(action.folderId)
        ? state
        : { ...state, expandedFolderIds: [...state.expandedFolderIds, action.folderId] };

    case "toggle-folder-overflow":
      return { ...state, revealedFolderIds: toggleIn(state.revealedFolderIds, action.folderId) };

    case "open-file": {
      const openFileIds = state.openFileIds.includes(action.fileId)
        ? state.openFileIds
        : [...state.openFileIds, action.fileId];
      return { ...state, home: false, openFileIds, activeFileId: action.fileId };
    }

    case "close-file": {
      const index = state.openFileIds.indexOf(action.fileId);
      if (index < 0) return state;
      const openFileIds = state.openFileIds.filter((id) => id !== action.fileId);
      if (state.activeFileId !== action.fileId) return { ...state, openFileIds };
      const next = openFileIds[Math.min(index, openFileIds.length - 1)] ?? null;
      return { ...state, openFileIds, activeFileId: next, home: next === null ? true : state.home };
    }

    case "activate-file": {
      if (!state.openFileIds.includes(action.fileId)) return state;
      return { ...state, home: false, activeFileId: action.fileId };
    }

    case "toggle-nav":
      return { ...state, navCollapsed: !state.navCollapsed };

    case "set-nav-width": {
      if (action.width < (NAV_MIN_WIDTH + NAV_RAIL_WIDTH) / 2) {
        return { ...state, navCollapsed: true };
      }
      return {
        ...state,
        navCollapsed: false,
        navWidth: clamp(Math.round(action.width), NAV_MIN_WIDTH, NAV_MAX_WIDTH),
      };
    }

    case "set-task-width":
      return {
        ...state,
        taskWidth: clamp(Math.round(action.width), TASK_MIN_WIDTH, TASK_MAX_WIDTH),
      };

    case "set-placement":
      // Stored even when Editor mode cannot honour it, so returning to Agent
      // restores what the user chose there.
      return { ...state, presence: { ...state.presence, placement: action.placement } };

    case "set-presence-expanded":
      return { ...state, presence: { ...state.presence, expanded: action.expanded } };

    case "set-presence-position":
      return {
        ...state,
        presence: { ...state.presence, x: action.x, y: action.y, edge: action.edge },
      };

    case "prune-files": {
      // Files can disappear underneath the shell (deleted elsewhere). Tabs that
      // point at nothing are dropped rather than rendered as ghosts.
      const live = new Set(action.files.map((file) => file.id));
      const openFileIds = state.openFileIds.filter((id) => live.has(id));
      if (openFileIds.length === state.openFileIds.length) return state;
      const activeFileId =
        state.activeFileId && live.has(state.activeFileId) ? state.activeFileId : (openFileIds.at(-1) ?? null);
      return { ...state, openFileIds, activeFileId, home: activeFileId === null ? true : state.home };
    }

    default:
      return state;
  }
}

export function hydrateShellState(persisted: Partial<PersistedShellState>): ShellState {
  const presence = persisted.presence;
  return {
    ...initialShellState,
    mode: persisted.mode === "editor" ? "editor" : "agent",
    home: persisted.home ?? initialShellState.home,
    homeList: persisted.homeList === "pinned" ? "pinned" : "recent",
    navWidth: clamp(finite(persisted.navWidth, initialShellState.navWidth), NAV_MIN_WIDTH, NAV_MAX_WIDTH),
    navCollapsed: persisted.navCollapsed ?? false,
    taskWidth: clamp(finite(persisted.taskWidth, initialShellState.taskWidth), TASK_MIN_WIDTH, TASK_MAX_WIDTH),
    selectedFolderId: persisted.selectedFolderId ?? null,
    expandedFolderIds: Array.isArray(persisted.expandedFolderIds) ? persisted.expandedFolderIds : [],
    revealedFolderIds: Array.isArray(persisted.revealedFolderIds) ? persisted.revealedFolderIds : [],
    openFileIds: Array.isArray(persisted.openFileIds) ? persisted.openFileIds : [],
    activeFileId: persisted.activeFileId ?? null,
    presence: {
      placement: presence?.placement === "floating" ? "floating" : "docked",
      expanded: presence?.expanded ?? true,
      x: typeof presence?.x === "number" && Number.isFinite(presence.x) ? presence.x : null,
      y: typeof presence?.y === "number" && Number.isFinite(presence.y) ? presence.y : null,
      edge: presence?.edge ?? null,
    },
  };
}

export function toPersisted(state: ShellState): PersistedShellState {
  return {
    mode: state.mode,
    navWidth: state.navWidth,
    navCollapsed: state.navCollapsed,
    taskWidth: state.taskWidth,
    selectedFolderId: state.selectedFolderId,
    expandedFolderIds: state.expandedFolderIds,
    revealedFolderIds: state.revealedFolderIds,
    openFileIds: state.openFileIds,
    activeFileId: state.activeFileId,
    home: state.home,
    homeList: state.homeList,
    presence: { ...state.presence },
  };
}
