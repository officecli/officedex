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

  /*
   * On the 52px rail a folder has nowhere to open into.
   *
   * The rail hides `.shell-tree-files`, so pressing a folder icon used to flip
   * `aria-expanded` and change nothing on screen, while the nine file rows it
   * "revealed" sat in the DOM at 0×0, invisible and unfocusable — the second
   * half of S1-008. Widening the sidebar is the only place the files can go, so
   * that is what the press does now, and the folder is opened in the same
   * gesture. Collapsing again is the sidebar's own toggle, unchanged.
   */
  const collapsed = state.navCollapsed;
  const expandedFolderIds = collapsed ? [] : state.expandedFolderIds;

  const toggleFolder = (folderId: string) => {
    if (!collapsed) {
      dispatch({ type: "toggle-folder", folderId });
      return;
    }
    dispatch({ type: "toggle-nav" });
    if (!state.expandedFolderIds.includes(folderId)) {
      dispatch({ type: "toggle-folder", folderId });
    }
  };

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
        expandedFolderIds={expandedFolderIds}
        revealedFolderIds={state.revealedFolderIds}
        dropFolderId={overFolderId}
        onOpenFile={(fileId) => void actions.openFile(fileId)}
        onToggleFolder={toggleFolder}
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
