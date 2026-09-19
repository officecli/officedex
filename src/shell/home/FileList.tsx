import { FolderOpen, Plus } from "lucide-react";

import { useT } from "../../renderer/i18n";
import { FileTree } from "../nav/FileTree";
import { useFolderDrop } from "../nav/useFolderDrop";
import { useLibraryActions } from "../nav/useLibraryActions";
import { useShell } from "../state/ShellContext";

/** Same three blanks Editor's Home offers, same dictionary keys. */
const BLANK_KEYS = {
  doc: "shell.home.blankDocument",
  sheet: "shell.home.blankWorkbook",
  slides: "shell.home.blankPresentation",
} as const;

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

  /*
   * A new file goes where this band says it is looking: the scope folder when
   * one is chosen, the default folder otherwise. The fallback to `folders[0]`
   * matches EditorHome's, for the workspace that has not been seeded yet.
   */
  const targetFolderId =
    scope?.id ?? folders.find((folder) => folder.isDefault)?.id ?? folders[0]?.id ?? "";

  return (
    <section className="shell-home-list" aria-label={t("shell.home.filesAria")} {...dropHandlers}>
      <h2 className="shell-home-subhead">
        {scope ? t("shell.home.filesIn", { folder: scope.name }) : t("shell.home.yourFiles")}
      </h2>

      {/*
       * The two actions the empty state names, on the screen that names them.
       *
       * "Create a file, or open one from this computer." is one string shared by
       * both Homes (`nav/FileTree.tsx`). On Editor's Home it is true — those four
       * buttons sit directly above the list. On Agent's Home it was a promise the
       * screen could not keep: of the 28 controls reachable in C1 not one created
       * or opened a file, and the real route was six steps long, starting at an
       * unlabelled icon (S8-008). Rather than soften the sentence, this makes it
       * true in the second place too — the same four actions, the same keys, the
       * same `.shell-home-new` shape as `home/EditorHome.tsx`.
       */}
      <div className="shell-home-actions shell-home-actions--compact">
        {(["doc", "sheet", "slides"] as const).map((type) => (
          <button
            key={type}
            type="button"
            className="shell-home-new"
            onClick={() => void actions.createFile(targetFolderId, type)}
          >
            <Plus size={15} strokeWidth={1.8} aria-hidden="true" />
            {t(BLANK_KEYS[type])}
          </button>
        ))}
        <button
          type="button"
          className="shell-home-new shell-home-new--ghost"
          onClick={() => void actions.openFromDisk()}
        >
          <FolderOpen size={15} strokeWidth={1.7} aria-hidden="true" />
          {t("shell.home.openFromComputer")}
        </button>
      </div>

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
