import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DesktopTask } from "../../shared/types";
import { useTaskStore } from "../store/taskStore";
import { getRunLineage } from "../taskState";
import type { NavKey } from "../defaults";

export type SelectedTask =
  | { kind: "auto" }
  | { kind: "none" }
  | { kind: "task"; id: string };

export interface StoredAppRoute {
  nav: NavKey;
  taskId?: string;
}

const APP_ROUTE_STORAGE_KEY = "officedex.appRoute";

export function readStoredAppRoute(storage?: Pick<Storage, "getItem">): StoredAppRoute {
  try {
    const target = storage ?? (typeof sessionStorage !== "undefined" ? sessionStorage : undefined);
    const raw = target?.getItem(APP_ROUTE_STORAGE_KEY);
    if (!raw) return { nav: "home" };
    const parsed = JSON.parse(raw) as Partial<StoredAppRoute>;
    const nav = parsed.nav;
    if (nav !== "home" && nav !== "document" && nav !== "spreadsheet" && nav !== "settings" && nav !== "login") {
      return { nav: "home" };
    }
    const taskId = typeof parsed.taskId === "string" && parsed.taskId.trim() ? parsed.taskId.trim() : undefined;
    return { nav, ...(nav === "document" && taskId ? { taskId } : {}) };
  } catch {
    return { nav: "home" };
  }
}

export function writeStoredAppRoute(route: StoredAppRoute, storage?: Pick<Storage, "setItem">): void {
  try {
    const target = storage ?? (typeof sessionStorage !== "undefined" ? sessionStorage : undefined);
    target?.setItem(APP_ROUTE_STORAGE_KEY, JSON.stringify(route));
  } catch {
    // Route persistence is best-effort; in-memory navigation remains usable.
  }
}

export interface AppRoutingDeps {
  /**
   * Wraps a navigation so a dirty workbook can refuse it (R-G-01). Resolves to
   * whether the navigation went through.
   */
  readonly guardNavigation: (action: () => Promise<void>) => Promise<boolean>;
  readonly hasOpenDocument: boolean;
  readonly closeDocument: () => Promise<void>;
  /** A task may belong to a working directory other than the current one. */
  readonly selectWorkspace: (workspaceId: string) => void | Promise<void>;
  /**
   * Read at call time rather than taken as a value: the workspace controller is
   * built after this one (it needs `activeNav` for the drop target), and
   * comparing against the current directory only matters while selecting.
   */
  readonly getActiveWorkspaceId: () => string | undefined;
  readonly onSelectTask?: () => void;
}

export interface AppRoutingController {
  readonly activeNav: NavKey;
  readonly selectedTaskID: SelectedTask;
  /** The lineage key of the selected run. */
  readonly conversationId: string | undefined;
  /** Every run in that lineage, oldest first. */
  readonly conversationTasks: DesktopTask[];
  /** The run the document surface is showing: the newest of the lineage. */
  readonly documentTask: DesktopTask | undefined;
  readonly completedDocumentRoute: boolean;
  /** The submission whose production stage Home is showing, if any. */
  readonly stageTaskId: string | undefined;

  /** Switches without passing the gate. For flows that already decided. */
  readonly setNav: (key: NavKey) => void;
  readonly setSelectedTask: (selected: SelectedTask) => void;
  /** A user-initiated navigation: passes the gate and closes what is open. */
  readonly navigate: (key: NavKey) => void;
  readonly selectTask: (taskId: string) => void;
  readonly openLogin: () => void;
  readonly returnFromLogin: () => void;

  readonly beginStage: (taskId: string) => void;
  /** Renames the staged submission once its real id arrives. */
  readonly promoteStage: (from: string, to: string) => boolean;
  /** Clears the stage, optionally only when it is still the given task. */
  readonly clearStage: (only?: string) => void;
}

/**
 * Where the app is: which surface, which run, and which submission owns the
 * production stage.
 *
 * Two kinds of navigation, and conflating them changes behaviour: `setNav` is
 * for flows that have already decided where they are going (a submission moves
 * to the document surface), while `navigate` is what a user click does — it
 * passes the unsaved-changes gate and closes an open document first (R-B-07).
 */
export function useAppRouting({
  guardNavigation,
  hasOpenDocument,
  closeDocument,
  selectWorkspace,
  getActiveWorkspaceId,
  onSelectTask,
}: AppRoutingDeps): AppRoutingController {
  const { state } = useTaskStore();
  const initialRoute = useMemo(() => readStoredAppRoute(), []);
  const [selectedTaskID, setSelectedTaskID] = useState<SelectedTask>(
    () => initialRoute.taskId ? { kind: "task", id: initialRoute.taskId } : { kind: "auto" },
  );
  const [activeNav, setActiveNav] = useState<NavKey>(initialRoute.nav);
  const activeNavRef = useRef(activeNav);
  activeNavRef.current = activeNav;
  const loginReturnNavRef = useRef<NavKey>("home");

  // A newly submitted task is shown in the Home stage shell first. The ref
  // scopes auto-opening to this submission only; the state drives rendering.
  const stageRef = useRef<string | undefined>(undefined);
  const [stageTaskId, setStageTaskId] = useState<string>();

  const firstTaskID = state.taskOrder[0];
  useEffect(() => {
    if (firstTaskID && selectedTaskID.kind === "auto") {
      setSelectedTaskID({ kind: "task", id: firstTaskID });
    }
  }, [firstTaskID, selectedTaskID.kind]);

  const conversationId = useMemo(() => {
    if (selectedTaskID.kind === "task") return state.tasks[selectedTaskID.id]?.conversationId;
    if (selectedTaskID.kind === "auto" && firstTaskID) return state.tasks[firstTaskID]?.conversationId;
    return undefined;
  }, [selectedTaskID, state.tasks, firstTaskID]);

  const conversationTasks = useMemo(
    () => conversationId ? getRunLineage(state, conversationId) : [],
    [state, conversationId],
  );
  const documentTask = conversationTasks.at(-1)
    ?? (selectedTaskID.kind === "task" ? state.tasks[selectedTaskID.id] : undefined);
  const completedDocumentRoute = activeNav === "document" && documentTask?.status === "completed";

  // Completed artifacts open in their suite editor. Home is the surface
  // underneath it, including when restoring an old completed document route.
  useEffect(() => {
    if (completedDocumentRoute) setActiveNav("home");
  }, [completedDocumentRoute]);

  useEffect(() => {
    writeStoredAppRoute({
      nav: activeNav,
      ...(activeNav === "document" && selectedTaskID.kind === "task" ? { taskId: selectedTaskID.id } : {}),
    });
  }, [activeNav, selectedTaskID]);

  // A restored document route can name a task this session never learns about.
  // Rather than an empty workbench, adopt a live run — or failing that, the
  // newest one.
  useEffect(() => {
    if (activeNav !== "document" || documentTask || state.taskOrder.length === 0) return;
    const fallback = state.taskOrder
      .map((taskId) => state.tasks[taskId])
      .find((task) => task && ["starting", "running", "question", "plan_review"].includes(task.status))
      ?? state.tasks[state.taskOrder[0]];
    if (fallback) setSelectedTaskID({ kind: "task", id: fallback.id });
  }, [activeNav, documentTask, state.taskOrder, state.tasks]);

  const beginStage = useCallback((taskId: string) => {
    stageRef.current = taskId;
    setStageTaskId(taskId);
  }, []);

  const promoteStage = useCallback((from: string, to: string) => {
    if (stageRef.current !== from) return false;
    stageRef.current = to;
    setStageTaskId(to);
    return true;
  }, []);

  const clearStage = useCallback((only?: string) => {
    if (only !== undefined && stageRef.current !== only) return;
    stageRef.current = undefined;
    setStageTaskId(undefined);
  }, []);

  const selectTask = useCallback((taskId: string) => {
    const taskWorkspaceId = state.tasks[taskId]?.workspaceId;
    if (taskWorkspaceId && taskWorkspaceId !== getActiveWorkspaceId()) {
      void selectWorkspace(taskWorkspaceId);
    }
    setSelectedTaskID({ kind: "task", id: taskId });
    onSelectTask?.();
    setActiveNav("document");
  }, [getActiveWorkspaceId, onSelectTask, selectWorkspace, state.tasks]);

  const navigate = useCallback((key: NavKey) => {
    // Home is the inbox, not the production stage that happened to be picked.
    if (key === "home") clearStage();
    // Already there with nothing open: there is nothing to do, and running the
    // gate for it would ask about unsaved changes for a no-op.
    if (key === activeNavRef.current && !hasOpenDocument) return;
    void guardNavigation(async () => {
      if (hasOpenDocument) await closeDocument();
      setActiveNav(key);
    });
  }, [clearStage, closeDocument, guardNavigation, hasOpenDocument]);

  const openLogin = useCallback(() => {
    if (activeNavRef.current !== "login") loginReturnNavRef.current = activeNavRef.current;
    setActiveNav("login");
  }, []);

  const returnFromLogin = useCallback(() => {
    setActiveNav(loginReturnNavRef.current === "login" ? "home" : loginReturnNavRef.current);
  }, []);

  return {
    activeNav,
    selectedTaskID,
    conversationId,
    conversationTasks,
    documentTask,
    completedDocumentRoute,
    stageTaskId,
    setNav: setActiveNav,
    setSelectedTask: setSelectedTaskID,
    navigate,
    selectTask,
    openLogin,
    returnFromLogin,
    beginStage,
    promoteStage,
    clearStage,
  };
}
