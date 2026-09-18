import { useCallback } from "react";

import { usePort } from "../port/PortContext";
import type { FileType } from "../../shared/uiPort";
import { useShell } from "../state/ShellContext";
import { reportPortFailure } from "../port/reportPortFailure";

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
  const port = usePort();
  const { dispatch, reload } = useShell();

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

  const moveFile = useCallback(
    async (fileId: string, folderId: string) => {
      try {
        await port.files.move(fileId, folderId);
        dispatch({ type: "reveal-folder", folderId });
        await reload();
      } catch (reason) {
        reportPortFailure(reason);
      }
    },
    [port, dispatch, reload],
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

  return { openFile, createFile, openFromDisk, moveFile, setPinned };
}
