import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from "react";

import { usePort } from "../port/PortContext";
import { logShellEvent } from "../port/shellLog";
import type { FileMeta, Folder } from "../../shared/uiPort";
import { readPersisted, writePersisted, type PersistedShellState } from "./persist";
import {
  hydrateShellState,
  shellReducer,
  toPersisted,
  type ShellAction,
  type ShellState,
} from "./shellReducer";

interface ShellContextValue {
  state: ShellState;
  dispatch: (action: ShellAction) => void;
  folders: Folder[];
  files: FileMeta[];
  /** The file the canvas is showing, or null on Home / with no tabs. */
  activeFile: FileMeta | null;
  /** The folder a new task or file defaults into. Never null once loaded. */
  scopeFolderId: string;
  loaded: boolean;
  reload: () => Promise<void>;
}

const ShellContext = createContext<ShellContextValue | null>(null);

/**
 * `stateOverride` is merged over the persisted view state at boot.
 *
 * Only the dev fixture passes it (see `dev/fixture.ts`), and only so a URL can
 * put the shell straight into one of the ten combinations the audit walks.
 * Merged *over* rather than replacing, so an override naming one axis leaves the
 * rest of the session's real view state alone.
 */
export function ShellProvider({
  children,
  stateOverride,
  persist = true,
}: {
  children: ReactNode;
  stateOverride?: Partial<PersistedShellState>;
  /**
   * Off under the dev fixture. Every audit run must start from its URL, not
   * from what the previous run left in localStorage — and a fixture's file ids
   * have no meaning in the real workspace, so writing them back would seed the
   * next real session with tabs pointing at files that never existed.
   */
  persist?: boolean;
}) {
  const port = usePort();
  const [state, dispatch] = useReducer(shellReducer, undefined, () =>
    hydrateShellState({ ...readPersisted(), ...stateOverride }),
  );
  const [folders, setFolders] = useState<Folder[]>([]);
  const [files, setFiles] = useState<FileMeta[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const [nextFolders, nextFiles] = await Promise.all([port.folders.list(), port.files.list()]);
    setFolders(nextFolders);
    setFiles(nextFiles);
    dispatch({ type: "prune-files", files: nextFiles });
    return { folders: nextFolders, files: nextFiles };
  }, [port]);

  const reload = useCallback(async () => {
    await load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await reload();
      if (!cancelled) setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = port.agent.subscribe((event) => {
      if (event.kind !== "task") return;
      // Apply writes the source file on disk. Reopen that source in the real
      // editor so its in-memory session cannot keep showing the pre-Apply
      // bytes (and avoid racing the completed-artifact auto-open below).
      if (event.task.suggestion?.applied) {
        const sourceId = event.task.suggestion.targetFileId;
        void (async () => {
          try {
            const opened = await port.files.open(sourceId);
            if (cancelled) return;
            dispatch({ type: "reveal-folder", folderId: opened.folderId });
            dispatch({ type: "select-folder", folderId: opened.folderId });
            dispatch({ type: "open-file", fileId: opened.id });
            await reload();
          } catch {
            // The Apply call already reported its failure. Keep the source
            // available in the library if reopening the editor is transient.
          }
        })();
        return;
      }
      if (event.task.status !== "done") return;
      const taskId = event.task.id;

      // The Wails event is emitted before the SQLite writer finishes recording
      // the artifact. Retry briefly instead of racing the projection and
      // leaving a completed result invisible until the next manual reload.
      const delays = [0, 120, 400];
      void (async () => {
        for (const delay of delays) {
          if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));
          if (cancelled) return;
          const next = await load();
          const artifact = next.files.find((file) => file.artifactTaskId === taskId);
          if (!artifact) continue;
          try {
            const opened = await port.files.open(artifact.id);
            if (cancelled) return;
            dispatch({ type: "reveal-folder", folderId: opened.folderId });
            dispatch({ type: "select-folder", folderId: opened.folderId });
            dispatch({ type: "open-file", fileId: opened.id });
            await reload();
          } catch {
            // The task itself already reported its failure. A transient open
            // failure should not turn a successful generation into a shell
            // error; the result remains available in the refreshed library.
          }
          return;
        }
        /*
         * Three passes and no artifact carrying this task's id.
         *
         * The run finished, so something was produced; the shell just cannot
         * tell which file it was, and the editor stays on whatever was open —
         * which looks exactly like the agent having written to the wrong
         * document. Nothing was reported here before, so the one report that
         * matters ("it opened the wrong file") arrived with no trace behind
         * it. The usual cause is a record whose `currentArtifactTaskId` never
         * got written on the desktop side.
         */
        logShellEvent("agent.artifact-not-found", { taskId, files: (await load()).files.length });
      })();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [load, port]);

  useEffect(() => {
    // Only persist once the workspace is known, so a slow first load cannot
    // write an empty tab list over a good one.
    if (persist && loaded) writePersisted(toPersisted(state));
  }, [state, loaded, persist]);

  const activeFile = useMemo(
    () => files.find((file) => file.id === state.activeFileId) ?? null,
    [files, state.activeFileId],
  );

  const scopeFolderId = useMemo(() => {
    const selected = folders.find((folder) => folder.id === state.selectedFolderId);
    if (selected) return selected.id;
    // Falling back to the active file's folder keeps "what the agent will touch"
    // aligned with "what you are looking at" without a second folder control.
    if (activeFile) return activeFile.folderId;
    return folders.find((folder) => folder.isDefault)?.id ?? folders[0]?.id ?? "";
  }, [folders, state.selectedFolderId, activeFile]);

  const value = useMemo<ShellContextValue>(
    () => ({ state, dispatch, folders, files, activeFile, scopeFolderId, loaded, reload }),
    [state, folders, files, activeFile, scopeFolderId, loaded, reload],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useShell must be used inside <ShellProvider>");
  return value;
}
