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
/**
 * What Editor Home shows. `new` is the prototype's New page — three blank
 * templates — reached from the sidebar's "+"; it is a place, not a filter, so it
 * is never restored on reload and Home on its own leaves it.
 */
export type HomeList = "recent" | "pinned" | "new";

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
  /**
   * The canvas is showing the bundled recording, not a file.
   *
   * Part of shell state rather than the canvas adapter's, because three things
   * have to agree about it: the workspace has to be on screen (`home`), the
   * canvas host has to treat it as visible-without-a-file, and a reload has to
   * come back to the same thing rather than to Home. It is cleared the moment a
   * real file is opened — see `open-file`.
   */
  demo: boolean;
  /**
   * When the recording was last asked for, ISO, or null when it was never
   * asked for.
   *
   * Two jobs, and they are the same fact:
   *
   * 1. **Restarting.** Going Home does not unmount the canvas (the workspace is
   *    hidden, not torn down), so pressing the button again set a flag that was
   *    already set — no state change, no re-render, and the stage's start-once
   *    ref kept the finished deck on screen. A value that always moves is what
   *    the stage keys its session on.
   * 2. **Losing to a run.** The recording holds the canvas until something else
   *    asks for it, and a new run does — but `demo` stayed true through that,
   *    because only `open-file` clears it and a run has no file. So the canvas
   *    kept the finished recording up while the panel beside it listed the new
   *    run's pages. Comparing this against the task's own `createdAt` says
   *    which of the two was asked for later, which is the honest rule.
   */
  demoStartedAt: string | null;
}

export type ShellAction =
  | { type: "set-mode"; mode: Mode }
  | { type: "go-home"; list?: HomeList }
  /**
   * Leaves Home without opening anything.
   *
   * The counterpart of `go-home`, and the only way to reach the workspace when
   * there is no file to reach it through. A deck being generated is exactly
   * that case: its draft is scratch that never enters the library, so there is
   * no tab to open and the canvas is put on screen by the run itself.
   *
   * `demo` asks for the bundled recording instead, and asking a second time
   * replays it from a fresh draft rather than being a no-op — see
   * `demoStartedAt`.
   */
  | { type: "enter-workspace"; demo?: boolean }
  /**
   * The recording lost the canvas to something newer, and says so.
   *
   * Without this the flag outlives its own demo: a reload restores `demo` and
   * its stamp, and the recording comes back over a run that has since
   * finished. The canvas decides precedence and the shell owns the state, so
   * the canvas has to report the decision it made.
   */
  | { type: "leave-demo" }
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
  navWidth: 190,
  // The reference shell opens on the compact icon rail; users can expand it
  // with the window-bar control and the preference is persisted thereafter.
  navCollapsed: true,
  taskWidth: 320,
  selectedFolderId: null,
  expandedFolderIds: [],
  revealedFolderIds: [],
  openFileIds: [],
  activeFileId: null,
  presence: { placement: "docked", expanded: true, x: null, y: null, edge: null },
  demo: false,
  demoStartedAt: null,
};

/**
 * A stamp that is always *newer* than the last one, never just different.
 *
 * `new Date().toISOString()` is not enough: two presses inside the same
 * millisecond produce the same string, the stage's key does not change, and the
 * second press silently does nothing — the exact bug this replaced a counter to
 * fix. It also has to stay ahead of a live run's `createdAt`, which is what
 * decides who owns the canvas.
 */
function nextDemoStamp(previous: string | null): string {
  const now = Date.now();
  const last = previous === null ? Number.NaN : Date.parse(previous);
  return new Date(Number.isNaN(last) ? now : Math.max(now, last + 1)).toISOString();
}

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
      return {
        ...state,
        mode: action.mode,
        /*
         * Agent mode's conversation is the centre of the window. An expanded
         * library beside it is a second navigator for the same folders the
         * composer already scopes, so entering Agent always returns to the
         * compact rail. Editor keeps whatever the user last chose there.
         */
        ...(action.mode === "agent" ? { navCollapsed: true } : {}),
        /*
         * Editor's presence is the collapsed mark in the corner. Opening the
         * panel is a click, not the default: the document is the work, and an
         * expanded conversation on top of it is something the user asks for.
         */
        ...(action.mode === "editor"
          ? { presence: { ...state.presence, expanded: false } }
          : {}),
      };
    }

    case "go-home":
      return {
        ...state,
        home: true,
        homeList: action.list ?? (state.homeList === "new" ? "recent" : state.homeList),
      };

    case "enter-workspace": {
      const demo = action.demo === true;
      return {
        ...state,
        home: false,
        /*
         * Nothing is open — including whatever was open before this.
         *
         * The canvas already knows a run outranks the open file (see
         * `CanvasContent`), but everything drawn *around* the canvas reads
         * `activeFileId` instead: the selected tab, the status bar's name, and
         * the composer's target. Leaving a stale id set meant generating a
         * workbook from Home with a document still open put that document's
         * name in the tab strip and the status bar, over a stage visibly
         * writing something else.
         *
         * The composer is the half that does damage rather than merely
         * confusing: `SendInput.activeFileId` is not a hint, it is the whole
         * routing decision (`send` in services/agent.ts), so a follow-up typed
         * while the workbook was being written would have gone to
         * `office.modify` against the document instead.
         *
         * Only the selection goes; the tabs stay open. `ShellContext` opens the
         * artifact by `artifactTaskId` when the run finishes, which is what
         * makes this the brief state it looks like.
         */
        activeFileId: null,
        demo,
        /*
         * Stamped only when the recording is asked for. A live run's stage has
         * its own lifecycle and must not be remounted under a sequencer that is
         * mid-draw, so its `enter-workspace` leaves the recording's timestamp
         * alone — and that is also what lets the run outrank it below.
         */
        demoStartedAt: demo ? nextDemoStamp(state.demoStartedAt) : state.demoStartedAt,
      };
    }

    case "leave-demo":
      if (!state.demo && state.demoStartedAt === null) return state;
      return { ...state, demo: false, demoStartedAt: null };

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
      return {
        ...state,
        home: false,
        openFileIds,
        activeFileId: action.fileId,
        demo: false,
        demoStartedAt: null,
        // A document opening in Editor is the user going to write, not to
        // talk. The mark stays in the corner until they open it themselves.
        ...(state.mode === "editor"
          ? { presence: { ...state.presence, expanded: false } }
          : {}),
      };
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
      return {
        ...state,
        home: false,
        activeFileId: action.fileId,
        demo: false,
        demoStartedAt: null,
      };
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
    navCollapsed: persisted.navCollapsed ?? initialShellState.navCollapsed,
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
    demo: persisted.demo === true,
    demoStartedAt: persisted.demoStartedAt ?? null,
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
    // The New page is somewhere you go, not where you were; reload lands on the list.
    homeList: state.homeList === "new" ? "recent" : state.homeList,
    demo: state.demo,
    demoStartedAt: state.demoStartedAt,
    presence: { ...state.presence },
  };
}
