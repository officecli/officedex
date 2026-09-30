import { useCallback } from "react";

import { useT } from "../../renderer/i18n";
import { notice } from "../kit/layers";
import { usePort } from "../port/PortContext";
import type { FileType } from "../../shared/uiPort";
import { useShell } from "../state/ShellContext";
import { reportPortFailure } from "../port/reportPortFailure";
import { logShellEvent } from "../port/shellLog";
import { toast } from "../../renderer/ui";

/**
 * Opening, creating and filing documents — one meaning each, wherever the
 * gesture came from.
 *
 * The distinction OD-UI-1.2 draws is *context*, not location. A file opened
 * from a project's Assets stays beside that conversation; the same file opened
 * from Home's Recent, from Local or from the system picker opens as Local, with
 * no conversation attached (§09, WORKSPACE-STANDARD §04). Nothing is moved or
 * copied either way — the context belongs to the tab.
 *
 * Each action reports its own failures.
 */
export function useLibraryActions() {
  const t = useT();
  const port = usePort();
  const { dispatch, reload, folders, defaultFolderId } = useShell();

  /** Opens beside the conversation on screen, or as Local when there is none. */
  const openFile = useCallback(
    async (fileId: string) => {
      logShellEvent("file_open_started", { fileId });
      try {
        await port.files.open(fileId);
        dispatch({ type: "open-file", fileId });
        logShellEvent("file_open_succeeded", { fileId });
        await reload();
      } catch (reason) {
        logShellEvent("file_open_failed", { fileId });
        reportPortFailure(reason);
      }
    },
    [port, dispatch, reload],
  );

  /** Opens as Local: Home's Recent, the Local page, Quick start. */
  const openLocalFile = useCallback(
    async (fileId: string) => {
      logShellEvent("file_open_started", { fileId });
      try {
        await port.files.open(fileId);
        dispatch({ type: "open-local-file", fileId });
        logShellEvent("file_open_succeeded", { fileId });
        await reload();
      } catch (reason) {
        logShellEvent("file_open_failed", { fileId });
        reportPortFailure(reason);
      }
    },
    [port, dispatch, reload],
  );

  /**
   * A blank document, opened as Local. New and Quick start both land here:
   * choosing a type never adds a file to the conversation that happens to be
   * open (§18).
   */
  const createLocalFile = useCallback(
    async (type: FileType) => {
      try {
        const file = await port.files.create(type, defaultFolderId);
        dispatch({ type: "open-local-file", fileId: file.id });
        await reload();
      } catch (reason) {
        reportPortFailure(reason);
      }
    },
    [port, dispatch, reload, defaultFolderId],
  );

  /** The system picker. Cancelling is an ordinary thing to do and says nothing. */
  const openFromDisk = useCallback(async () => {
    try {
      const file = await port.files.openFromDisk();
      if (!file) return;
      dispatch({ type: "open-local-file", fileId: file.id });
      await reload();
    } catch (reason) {
      reportPortFailure(reason);
    }
  }, [port, dispatch, reload]);

  /**
   * Files dragged in from Finder or Explorer. One bad file does not stop the
   * rest: the ones that can be opened are, and the others are named once.
   */
  const openDropped = useCallback(
    async (paths: string[]) => {
      const rejected: string[] = [];
      let opened = 0;
      for (const path of paths) {
        try {
          const file = await port.files.openDropped(path);
          dispatch({ type: "open-local-file", fileId: file.id });
          opened += 1;
        } catch (reason) {
          logShellEvent("drop-open-failed", {
            path,
            message: reason instanceof Error ? reason.message : String(reason),
          });
          rejected.push(path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1));
        }
      }
      if (opened > 0) await reload();
      if (rejected.length > 0) {
        toast.error({
          key: "drop-open-failed",
          content: t("shell.home.dropRejected", { count: rejected.length }),
          description: rejected.join(", "),
        });
      }
    },
    [port, dispatch, reload, t],
  );

  /** Adds a file to a project's Assets. A reference, not a copy. */
  const moveFile = useCallback(
    async (fileId: string, folderId: string) => {
      try {
        await port.files.move(fileId, folderId);
        await reload();
        const folder = folders.find((entry) => entry.id === folderId);
        if (folder) notice(t("shell.library.moved", { folder: folder.name }));
      } catch (reason) {
        reportPortFailure(reason);
      }
    },
    [port, reload, folders, t],
  );

  const setFavorite = useCallback(
    async (fileId: string, favorite: boolean) => {
      try {
        await port.files.setPinned(fileId, favorite);
        await reload();
      } catch (reason) {
        reportPortFailure(reason);
      }
    },
    [port, reload],
  );

  const renameFile = useCallback(
    async (fileId: string, name: string) => {
      await port.files.rename(fileId, name);
      await reload();
    },
    [port, reload],
  );

  const duplicateFile = useCallback(
    async (fileId: string) => {
      try {
        const copy = await port.files.duplicate(fileId);
        await reload();
        return copy;
      } catch (reason) {
        reportPortFailure(reason);
        return null;
      }
    },
    [port, reload],
  );

  const removeFile = useCallback(
    async (fileId: string) => {
      try {
        await port.files.remove(fileId);
        dispatch({ type: "close-file", fileId });
        await reload();
      } catch (reason) {
        reportPortFailure(reason);
      }
    },
    [port, dispatch, reload],
  );

  return {
    openFile,
    openLocalFile,
    createLocalFile,
    openFromDisk,
    openDropped,
    moveFile,
    setFavorite,
    renameFile,
    duplicateFile,
    removeFile,
  };
}
