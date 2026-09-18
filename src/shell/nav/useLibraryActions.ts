import { useCallback } from "react";

import { usePort } from "../port/PortContext";
import type { FileType } from "../port/types";
import { useShell } from "../state/ShellContext";

/**
 * The file-navigation behaviours shared by the sidebar tree and the Home list.
 *
 * Both surfaces get the same callbacks, so "open", "move", "pin" and "create"
 * mean exactly one thing in this IA no matter where they are triggered from.
 */
export function useLibraryActions() {
  const port = usePort();
  const { dispatch, reload } = useShell();

  const openFile = useCallback(
    async (fileId: string) => {
      const file = await port.files.open(fileId);
      dispatch({ type: "reveal-folder", folderId: file.folderId });
      dispatch({ type: "select-folder", folderId: file.folderId });
      dispatch({ type: "open-file", fileId });
      await reload();
    },
    [port, dispatch, reload],
  );

  const createFile = useCallback(
    async (folderId: string, type: FileType) => {
      const file = await port.files.create(type, folderId);
      dispatch({ type: "reveal-folder", folderId: file.folderId });
      dispatch({ type: "open-file", fileId: file.id });
      await reload();
    },
    [port, dispatch, reload],
  );

  const moveFile = useCallback(
    async (fileId: string, folderId: string) => {
      await port.files.move(fileId, folderId);
      dispatch({ type: "reveal-folder", folderId });
      await reload();
    },
    [port, dispatch, reload],
  );

  const setPinned = useCallback(
    async (fileId: string, pinned: boolean) => {
      await port.files.setPinned(fileId, pinned);
      await reload();
    },
    [port, reload],
  );

  return { openFile, createFile, moveFile, setPinned };
}
