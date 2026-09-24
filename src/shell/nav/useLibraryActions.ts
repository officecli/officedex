import { useCallback } from "react";

import { useT } from "../../renderer/i18n";
import { toast } from "../../renderer/ui";
import { usePort } from "../port/PortContext";
import type { FileType } from "../../shared/uiPort";
import { useShell } from "../state/ShellContext";
import { reportPortFailure } from "../port/reportPortFailure";
import { logShellEvent } from "../port/shellLog";

/**
 * The file-navigation behaviours shared by the sidebar tree and the Home list.
 *
 * Both surfaces get the same callbacks, so "open", "move", "pin" and "create"
 * mean exactly one thing in this IA no matter where they are triggered from.
 *
 * Each one reports its own failures. A rejected port call used to disappear —
 * `createFile` on the desktop rejects today, and the menu item simply did
 * nothing when clicked.
 */
export function useLibraryActions() {
  const t = useT();
  const port = usePort();
  const { dispatch, reload, folders } = useShell();

  const openFile = useCallback(
    async (fileId: string) => {
      try {
        const file = await port.files.open(fileId);
        dispatch({ type: "reveal-folder", folderId: file.folderId });
        dispatch({ type: "select-folder", folderId: file.folderId });
        dispatch({ type: "open-file", fileId });
        await reload();
      } catch (reason) {
        reportPortFailure(reason);
      }
    },
    [port, dispatch, reload],
  );

  const createFile = useCallback(
    async (folderId: string, type: FileType) => {
      try {
        const file = await port.files.create(type, folderId);
        dispatch({ type: "reveal-folder", folderId: file.folderId });
        dispatch({ type: "open-file", fileId: file.id });
        await reload();
      } catch (reason) {
        reportPortFailure(reason);
      }
    },
    [port, dispatch, reload],
  );

  const openFromDisk = useCallback(async () => {
    try {
      const file = await port.files.openFromDisk();
      // Null is a cancelled picker, which needs no response at all.
      if (!file) return;
      // An imported file lands in the default folder rather than whichever one
      // was in scope — it is not inside any of the app's directories. Revealing
      // where it went is how the user finds that out.
      dispatch({ type: "reveal-folder", folderId: file.folderId });
      dispatch({ type: "select-folder", folderId: file.folderId });
      dispatch({ type: "open-file", fileId: file.id });
      await reload();
    } catch (reason) {
      reportPortFailure(reason);
    }
  }, [port, dispatch, reload]);

  /**
   * Files dragged in from Finder or Explorer. Each one opens in its own tab and
   * the last one ends up in front, as if they had been opened one after
   * another. One bad file does not stop the rest: the ones that were Word,
   * Excel or PowerPoint open, and the others are named in a single error.
   */
  const openDropped = useCallback(
    async (paths: string[]) => {
      const rejected: string[] = [];
      let opened = 0;
      for (const path of paths) {
        try {
          const file = await port.files.openDropped(path);
          dispatch({ type: "reveal-folder", folderId: file.folderId });
          dispatch({ type: "select-folder", folderId: file.folderId });
          dispatch({ type: "open-file", fileId: file.id });
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

  const moveFile = useCallback(
    async (fileId: string, folderId: string) => {
      try {
        await port.files.move(fileId, folderId);
        dispatch({ type: "reveal-folder", folderId });
        await reload();
        // The one action in this shell whose result the user cannot see: a
        // dragged file leaves the row it was on and appears somewhere that may
        // be scrolled out of view or collapsed. The prototype said where it
        // went, and silence here reads as a drop that did not take.
        const folder = folders.find((entry) => entry.id === folderId);
        if (folder) {
          toast.success({
            key: "file-moved",
            content: t("shell.library.moved", { folder: folder.name }),
          });
        }
      } catch (reason) {
        reportPortFailure(reason);
      }
    },
    [port, dispatch, reload, folders, t],
  );

  const setPinned = useCallback(
    async (fileId: string, pinned: boolean) => {
      try {
        await port.files.setPinned(fileId, pinned);
        await reload();
      } catch (reason) {
        reportPortFailure(reason);
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

  return { openFile, createFile, openFromDisk, openDropped, moveFile, setPinned, removeFile };
}
