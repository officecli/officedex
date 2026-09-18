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
import type { FileMeta, Folder } from "../port/types";
import { readPersisted, writePersisted } from "./persist";
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

export function ShellProvider({ children }: { children: ReactNode }) {
  const port = usePort();
  const [state, dispatch] = useReducer(shellReducer, undefined, () => hydrateShellState(readPersisted()));
  const [folders, setFolders] = useState<Folder[]>([]);
  const [files, setFiles] = useState<FileMeta[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    const [nextFolders, nextFiles] = await Promise.all([port.folders.list(), port.files.list()]);
    setFolders(nextFolders);
    setFiles(nextFiles);
    dispatch({ type: "prune-files", files: nextFiles });
  }, [port]);

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
    // Only persist once the workspace is known, so a slow first load cannot
    // write an empty tab list over a good one.
    if (loaded) writePersisted(toPersisted(state));
  }, [state, loaded]);

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
