import { FolderOpen, Plus } from "lucide-react";
import { useState } from "react";

import { useT } from "../../renderer/i18n";
import { Select } from "../../renderer/ui";
import { FileTree } from "../nav/FileTree";
import { useFolderDrop } from "../nav/useFolderDrop";
import { useLibraryActions } from "../nav/useLibraryActions";
import type { FileType } from "../../shared/uiPort";
import { useShell } from "../state/ShellContext";
import type { Grouping } from "../nav/fileTreeModel";
import "./home.css";

/** Value plus dictionary key; the visible label is resolved per render. */
const TYPE_OPTIONS = [
  { value: "all", labelKey: "shell.home.allTypes" },
  { value: "doc", labelKey: "shell.home.documents" },
  { value: "sheet", labelKey: "shell.home.workbooks" },
  { value: "slides", labelKey: "shell.home.presentations" },
];

const GROUPING_OPTIONS = [
  { value: "time", labelKey: "shell.list.columnLastOpened" },
  { value: "folder", labelKey: "shell.list.columnFolder" },
];

const BLANK_KEYS = {
  doc: "shell.home.blankDocument",
  sheet: "shell.home.blankWorkbook",
  slides: "shell.home.blankPresentation",
} as const;

/**
 * Editor mode's Home: the comfortable density of the one file list.
 *
 * Decision 2 in practice — Recent and Pinned are a filter over the same list,
 * and grouping is a control on it. Switching the grouping to "Folder" lines the
 * page up with the sidebar tree row for row, because both read the same model.
 */
export function EditorHome() {
  const t = useT();
  const { state, dispatch, folders, files } = useShell();
  const actions = useLibraryActions();
  const [grouping, setGrouping] = useState<Grouping>("time");
  const [fileType, setFileType] = useState<FileType | "all">("all");
  const { overFolderId, dropHandlers } = useFolderDrop(actions.moveFile);

  const defaultFolderId = folders.find((folder) => folder.isDefault)?.id ?? folders[0]?.id ?? "";

  return (
    <div className="shell-home shell-region shell-home--editor">
      <header className="shell-home-head">
        <h1>{t(state.homeList === "pinned" ? "shell.sidebar.pinned" : "shell.sidebar.recent")}</h1>

        <div className="shell-home-controls">
          <Select
            aria-label={t("shell.home.groupBy")}
            value={grouping}
            options={GROUPING_OPTIONS.map(({ value, labelKey }) => ({ value, label: t(labelKey) }))}
            onChange={(value) => setGrouping(value as Grouping)}
          />
          <Select
            aria-label={t("shell.home.fileType")}
            value={fileType}
            options={TYPE_OPTIONS.map(({ value, labelKey }) => ({ value, label: t(labelKey) }))}
            onChange={(value) => setFileType(value as FileType | "all")}
          />
        </div>
      </header>

      <div className="shell-home-actions">
        {(["doc", "sheet", "slides"] as const).map((type) => (
          <button
            key={type}
            type="button"
            className="shell-home-new"
            onClick={() => void actions.createFile(defaultFolderId, type)}
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

      <div className="shell-home-list" {...dropHandlers}>
        <FileTree
          density="comfortable"
          grouping={grouping}
          folders={folders}
          files={files}
          activeFileId={state.activeFileId}
          selectedFolderId={state.selectedFolderId}
          expandedFolderIds={state.expandedFolderIds}
          revealedFolderIds={state.revealedFolderIds}
          filter={state.homeList === "pinned" ? "pinned" : "all"}
          fileType={fileType}
          dropFolderId={overFolderId}
          onOpenFile={(fileId) => void actions.openFile(fileId)}
          onToggleFolder={(folderId) => dispatch({ type: "toggle-folder", folderId })}
          onToggleOverflow={(folderId) => dispatch({ type: "toggle-folder-overflow", folderId })}
          onSelectFolder={(folderId) => dispatch({ type: "select-folder", folderId })}
          onCreateFile={(folderId, type) => void actions.createFile(folderId, type)}
          onMoveFile={(fileId, folderId) => void actions.moveFile(fileId, folderId)}
          onTogglePinned={(fileId, pinned) => void actions.setPinned(fileId, pinned)}
        />
      </div>
    </div>
  );
}
