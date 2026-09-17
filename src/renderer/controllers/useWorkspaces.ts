import { useCallback, useEffect, useMemo, useState } from "react";
import type { WorkspaceSummary } from "../../shared/types";
import type { OfficeOutputRef } from "../../shared/officeProduct";
import { decodeOfficeOutputs } from "../productRegistryCodec";
import { useDesktopApi } from "../services/desktopApi";
import { getHomeDropZone, setHomeDropZone } from "../homeDropZone";
import { toast } from "../ui";
import { errorMessage } from "../utils/values";
import { classifyError, extractStderr, type FailureKind } from "../failureKind";

export interface WorkspacesDeps {
  /** Reports a failure through the app's error banner. */
  readonly recordError: (text: string, kind: FailureKind, details?: string) => void;
  readonly clearError: () => void;
  readonly refreshRecentFiles: (workspaceId?: string) => Promise<void> | void;
  /**
   * Whether native file drops are listened for. This is the caller's knowledge,
   * not ours: drops are deliberately only accepted on Home (R-H-04), and the
   * controller has no business knowing which surface is on screen.
   */
  readonly dropEnabled: boolean;
  /** Paths dropped on the task intake rather than the workspace list. */
  readonly onIntakeDrop: (paths: string[]) => void;
}

export interface WorkspacesController {
  readonly workspaces: WorkspaceSummary[];
  /** The one the backend considers current. */
  readonly activeWorkspace: WorkspaceSummary | undefined;
  /** The one Home is filtering by; undefined means "all files". */
  readonly homeWorkspaceId: string | undefined;
  readonly productOutputs: OfficeOutputRef[];
  readonly refresh: () => void;
  readonly select: (workspaceId: string) => Promise<void>;
  /** Selects, and points Home at it. */
  readonly selectForHome: (workspaceId: string) => Promise<void>;
  /** Drops the Home filter and shows every recent file. */
  readonly selectAll: () => void;
  readonly add: () => Promise<void>;
  readonly addFromPath: (path: string) => Promise<void>;
  readonly rename: (workspaceId: string, name: string) => Promise<void>;
  readonly reveal: (workspacePath: string) => void;
  readonly remove: (workspaceId: string) => Promise<void>;
}

/**
 * Working directories: the list, which one is current, and everything that
 * creates or destroys one. Project outputs ride along because they are listed
 * per workspace and refreshed on the same beat.
 *
 * Native file drops land here too. They carry no coordinates, so the zone
 * recorded during dragover is the only evidence of where the user aimed: the
 * sidebar's workspace list, or the task intake. Whether drops are listened for
 * at all is the caller's call — see `dropEnabled`.
 */
export function useWorkspaces({ recordError, clearError, refreshRecentFiles, dropEnabled, onIntakeDrop }: WorkspacesDeps): WorkspacesController {
  const api = useDesktopApi();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [productOutputs, setProductOutputs] = useState<OfficeOutputRef[]>([]);
  const [homeWorkspaceId, setHomeWorkspaceId] = useState<string>();

  const activeWorkspace = useMemo(() => workspaces.find((workspace) => workspace.active), [workspaces]);

  const refresh = useCallback(() => {
    api.listWorkspaces()
      .then(setWorkspaces)
      .catch(() => undefined);
    if (api.listOfficeProductOutputs) {
      api.listOfficeProductOutputs(homeWorkspaceId || "", "")
        .then((items) => setProductOutputs(decodeOfficeOutputs(items)))
        .catch(() => undefined);
    }
  }, [api, homeWorkspaceId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const select = useCallback(async (workspaceId: string) => {
    try {
      const selected = await api.selectWorkspace(workspaceId);
      setWorkspaces((current) => current.map((workspace) => ({ ...workspace, active: workspace.id === selected.id })));
      clearError();
    } catch (error) {
      const text = errorMessage(error);
      recordError(text, classifyError(text), extractStderr(text));
    }
  }, [api, clearError, recordError]);

  const selectForHome = useCallback(async (workspaceId: string) => {
    await select(workspaceId);
    setHomeWorkspaceId(workspaceId);
    await refreshRecentFiles(workspaceId);
  }, [refreshRecentFiles, select]);

  const selectAll = useCallback(() => {
    setHomeWorkspaceId(undefined);
    void refreshRecentFiles();
  }, [refreshRecentFiles]);

  const add = useCallback(async () => {
    try {
      const picked = await api.openDirectoryDialog();
      if (!picked) return;
      await api.addWorkspace(picked);
      refresh();
    } catch (error) {
      const text = errorMessage(error);
      recordError(text, classifyError(text), extractStderr(text));
    }
  }, [api, recordError, refresh]);

  const addFromPath = useCallback(async (path: string) => {
    try {
      await api.addWorkspace(path);
      refresh();
    } catch (error) {
      const text = errorMessage(error);
      recordError(text, classifyError(text), extractStderr(text));
    }
  }, [api, recordError, refresh]);

  // Renaming reports through a toast rather than the error banner: it is a
  // local edit on one row, not a failure of the surface.
  const rename = useCallback(async (workspaceId: string, name: string) => {
    try {
      const renamed = await api.renameWorkspace(workspaceId, name);
      setWorkspaces((current) => current.map((workspace) => workspace.id === renamed.id ? renamed : workspace));
      clearError();
    } catch (error) {
      void toast.error(errorMessage(error));
    }
  }, [api, clearError]);

  const reveal = useCallback((workspacePath: string) => {
    void api.showItemInFolder(workspacePath).catch(() => api.openPath(workspacePath));
  }, [api]);

  const remove = useCallback(async (workspaceId: string) => {
    try {
      await api.removeWorkspace(workspaceId);
      setWorkspaces((current) => current.filter((workspace) => workspace.id !== workspaceId));
      refresh();
      clearError();
    } catch (error) {
      const text = errorMessage(error);
      recordError(text, classifyError(text), extractStderr(text));
    }
  }, [api, clearError, recordError, refresh]);

  useEffect(() => {
    if (!dropEnabled) return undefined;
    return api.onFileDrop((paths) => {
      if (paths.length === 0) return;
      const zone = getHomeDropZone();
      setHomeDropZone(null);
      if (zone === "workspaces") {
        for (const path of paths) void addFromPath(path);
        return;
      }
      if (zone === "intake") onIntakeDrop(paths);
    });
  }, [addFromPath, api, dropEnabled, onIntakeDrop]);

  return {
    workspaces,
    activeWorkspace,
    homeWorkspaceId,
    productOutputs,
    refresh,
    select,
    selectForHome,
    selectAll,
    add,
    addFromPath,
    rename,
    reveal,
    remove,
  };
}
