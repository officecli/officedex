import { Plus } from "lucide-react";

import { useT } from "../../renderer/i18n";
import { useShell } from "../state/ShellContext";
import { FileTree } from "./FileTree";
import { useFolderDrop } from "./useFolderDrop";
import { useFolderDialogs } from "./useFolderDialogs";
import { useLibraryActions } from "./useLibraryActions";

/**
 * The sidebar's middle: the compact density of the one file list.
 *
 * Agent mode shows it permanently — folders are how a task is scoped. Editor
 * mode keeps its library on Home, so the sidebar there stays a short list of
 * commands and views.
 */
export function SidebarTree() {
  const t = useT();
  const { state, dispatch, folders, files, reload } = useShell();
  const actions = useLibraryActions();
  const dialogs = useFolderDialogs(reload);
  const { overFolderId, dropHandlers } = useFolderDrop(actions.moveFile);

  return (
    <div className="shell-sidebar-tree" {...dropHandlers}>
      <div className="shell-tree-section-head">
        <span>{t("shell.tree.folders")}</span>
        <button
          type="button"
          className="shell-icon-button"
          aria-label={t("shell.tree.newFolder")}
          title={t("shell.tree.newFolder")}
          onClick={dialogs.createFolder}
        >
          <Plus size={15} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>

      <FileTree
        density="compact"
        grouping="folder"
        folders={folders}
        files={files}
        activeFileId={state.home ? null : state.activeFileId}
        selectedFolderId={state.selectedFolderId}
        expandedFolderIds={state.expandedFolderIds}
        revealedFolderIds={state.revealedFolderIds}
        dropFolderId={overFolderId}
        onOpenFile={(fileId) => void actions.openFile(fileId)}
        onToggleFolder={(folderId) => dispatch({ type: "toggle-folder", folderId })}
        onToggleOverflow={(folderId) => dispatch({ type: "toggle-folder-overflow", folderId })}
        onSelectFolder={(folderId) => dispatch({ type: "select-folder", folderId })}
        onCreateFile={(folderId, type) => void actions.createFile(folderId, type)}
        onMoveFile={(fileId, folderId) => void actions.moveFile(fileId, folderId)}
        onTogglePinned={(fileId, pinned) => void actions.setPinned(fileId, pinned)}
        onRenameFolder={(folderId) => {
          const folder = folders.find((entry) => entry.id === folderId);
          if (folder) dialogs.renameFolder(folder);
        }}
        onRemoveFolder={(folderId) => {
          const folder = folders.find((entry) => entry.id === folderId);
          // The default folder is where removed folders' files land, so it
          // cannot itself be removed.
          if (folder && !folder.isDefault) dialogs.removeFolder(folder);
        }}
      />

      {dialogs.element}
    </div>
  );
}
