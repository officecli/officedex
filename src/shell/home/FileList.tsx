import { useT } from "../../renderer/i18n";
import { FileTree } from "../nav/FileTree";
import { useFolderDrop } from "../nav/useFolderDrop";
import { useLibraryActions } from "../nav/useLibraryActions";
import { useShell } from "../state/ShellContext";

/**
 * Agent Home's file list: the comfortable density of the one file tree.
 *
 * Decision 2 — this and the sidebar tree are the same component at two
 * densities, sharing `nav/fileTreeModel` so they cannot disagree about what
 * the library contains.
 */
export function FileList() {
  const t = useT();
  const { state, dispatch, folders, files, scopeFolderId } = useShell();
  const actions = useLibraryActions();
  const { overFolderId, dropHandlers } = useFolderDrop(actions.moveFile);
  const scope = folders.find((folder) => folder.id === scopeFolderId);

  return (
    <section className="shell-home-list" aria-label={t("shell.home.filesAria")} {...dropHandlers}>
      <h2 className="shell-home-subhead">
        {scope ? t("shell.home.filesIn", { folder: scope.name }) : t("shell.home.yourFiles")}
      </h2>
      <FileTree
        density="comfortable"
        grouping="folder"
        folders={folders}
        files={files}
        activeFileId={state.activeFileId}
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
      />
    </section>
  );
}
