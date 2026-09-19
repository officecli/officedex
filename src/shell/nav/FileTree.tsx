import { ChevronRight, Folder as FolderIcon, FolderOpen, MoreHorizontal, Pin, Plus } from "lucide-react";
import { useRef, useState } from "react";

import { useT } from "../../renderer/i18n";
import { FileTypeIcon } from "../chrome/FileTypeIcon";
import { Menu, type MenuHandle, type MenuItemSpec } from "../chrome/Menu";
import type { FileMeta, Folder } from "../../shared/uiPort";
import { buildGroups, formatTouched, locationLabel, type FileFilter, type Grouping } from "./fileTreeModel";
import type { FileType } from "../../shared/uiPort";
import "./nav.css";

const SIDEBAR_PAGE = 5;

/**
 * One string, both densities.
 *
 * The sidebar said "No files yet." and Home said "No files yet" — two hardcoded
 * copies 243 lines apart in this file, which is exactly how they drifted
 * (S3-013). Naming it is the only thing that stops it happening again; now that
 * it is a dictionary key, the two densities cannot drift in any language.
 */
const NO_FILES_YET = "shell.tree.noFilesYet";

/**
 * Arrow-key movement between a folder and the files inside it.
 *
 * Done by walking the DOM rather than by holding a focus index in state: the
 * tree is rendered from two different call sites at two densities, its rows
 * come and go as folders expand, and an index would have to be kept in sync
 * with all of that to answer a question the DOM already knows the answer to.
 */
function focusFirstFile(toggle: HTMLElement): void {
  const section = toggle.closest(".shell-tree-folder");
  section?.querySelector<HTMLButtonElement>(".shell-tree-file-open")?.focus();
}

function focusOwningFolder(fileButton: HTMLElement): void {
  const section = fileButton.closest(".shell-tree-folder");
  section?.querySelector<HTMLButtonElement>(".shell-tree-folder-toggle")?.focus();
}

export interface FileTreeProps {
  /** `compact` is the always-on sidebar; `comfortable` is the Home list. */
  density: "compact" | "comfortable";
  grouping: Grouping;
  folders: Folder[];
  files: FileMeta[];
  activeFileId: string | null;
  selectedFolderId: string | null;
  expandedFolderIds: string[];
  revealedFolderIds: string[];
  filter?: FileFilter;
  fileType?: FileType | "all";
  /** Folder currently under a dragged file, for the drop highlight. */
  dropFolderId?: string | null;
  onOpenFile: (fileId: string) => void;
  onToggleFolder: (folderId: string) => void;
  onToggleOverflow: (folderId: string) => void;
  onSelectFolder: (folderId: string) => void;
  onCreateFile: (folderId: string, type: FileType) => void;
  onMoveFile: (fileId: string, folderId: string) => void;
  onTogglePinned: (fileId: string, pinned: boolean) => void;
  onRenameFolder?: (folderId: string) => void;
  onRemoveFolder?: (folderId: string) => void;
}

/**
 * One file list, two densities.
 *
 * Both branches read the same `buildGroups` output, so the folder structure the
 * sidebar shows and the structure Home shows cannot drift apart — which was the
 * whole problem with the prototype's four separate entry points.
 */
export function FileTree(props: FileTreeProps) {
  const groups = buildGroups(props.grouping, props.folders, props.files, {
    filter: props.filter,
    fileType: props.fileType,
    limit: props.density === "compact" ? SIDEBAR_PAGE : undefined,
  });

  if (props.density === "comfortable") return <ComfortableList {...props} groups={groups} />;
  return <CompactTree {...props} groups={groups} />;
}

type WithGroups = FileTreeProps & { groups: ReturnType<typeof buildGroups> };

/* ------------------------------------------------------------- compact */

function CompactTree(props: WithGroups) {
  const t = useT();
  return (
    <div className="shell-tree" role="tree" aria-label={t("shell.tree.ariaLabel")}>
      {props.groups.map((group) => {
        const folderId = group.folderId;
        if (!folderId) return null;
        const expanded = props.expandedFolderIds.includes(folderId);
        const revealed = props.revealedFolderIds.includes(folderId);
        const shown = revealed
          ? props.files.filter((file) => file.folderId === folderId)
          : group.files;

        return (
          <section
            key={group.id}
            className={`shell-tree-folder${folderId === props.dropFolderId ? " is-drop-target" : ""}`}
            role="none"
            /*
             * The drop target is the folder, and the folder is this section —
             * title row plus the files under it. It used to be the title row
             * alone, which `useFolderDrop`'s `closest()` could not reach from
             * the file area because that area is the row's *sibling*: an open
             * folder accepted a drop on 14%–19% of its own surface and silently
             * refused the rest (S8-014).
             */
            data-drop-folder={folderId}
          >
            <FolderRow
              folder={{ id: folderId, label: group.label, count: group.total }}
              expanded={expanded}
              current={folderId === props.selectedFolderId}
              onToggle={() => props.onToggleFolder(folderId)}
              onSelect={() => props.onSelectFolder(folderId)}
              onCreateFile={(type) => props.onCreateFile(folderId, type)}
              onRename={props.onRenameFolder ? () => props.onRenameFolder?.(folderId) : undefined}
              onRemove={props.onRemoveFolder ? () => props.onRemoveFolder?.(folderId) : undefined}
            />

            {expanded ? (
              <div className="shell-tree-files" role="group">
                {shown.length === 0 ? (
                  <p className="shell-tree-empty">{t(NO_FILES_YET)}</p>
                ) : (
                  shown.map((file) => (
                    <FileRow
                      key={file.id}
                      file={file}
                      folders={props.folders}
                      current={file.id === props.activeFileId}
                      onOpen={() => props.onOpenFile(file.id)}
                      onMove={(target) => props.onMoveFile(file.id, target)}
                      onTogglePinned={() => props.onTogglePinned(file.id, !file.pinned)}
                    />
                  ))
                )}

                {group.total > group.files.length || revealed ? (
                  <button
                    type="button"
                    className="shell-tree-more"
                    onClick={(event) => {
                      // Revealing 40 rows pushes this button — which still has
                      // focus — out of the scroll port, so the keyboard user
                      // loses their place and cannot collapse the list again
                      // (S1-010). The button is not remounted, so bringing it
                      // back after the commit is enough.
                      const button = event.currentTarget;
                      props.onToggleOverflow(folderId);
                      requestAnimationFrame(() => button.scrollIntoView({ block: "nearest" }));
                    }}
                  >
                    {revealed
                      ? t("shell.tree.showLess")
                      : t("shell.tree.showMore", { count: group.total - group.files.length })}
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function FolderRow({
  folder,
  expanded,
  current,
  onToggle,
  onSelect,
  onCreateFile,
  onRename,
  onRemove,
}: {
  folder: { id: string; label: string; count: number };
  expanded: boolean;
  current: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onCreateFile: (type: FileType) => void;
  onRename?: () => void;
  onRemove?: () => void;
}) {
  const t = useT();
  const items: MenuItemSpec[] = [
    { id: "doc", label: t("shell.tree.newDocument"), onSelect: () => onCreateFile("doc") },
    { id: "sheet", label: t("shell.tree.newWorkbook"), onSelect: () => onCreateFile("sheet") },
    { id: "slides", label: t("shell.tree.newPresentation"), onSelect: () => onCreateFile("slides") },
  ];
  if (onRename) items.push({ id: "rename", label: t("shell.tree.renameFolder"), onSelect: onRename });
  if (onRemove) {
    items.push({
      id: "remove",
      label: t("shell.tree.removeFolder"),
      description: t("shell.tree.removeFolderDescription"),
      onSelect: onRemove,
    });
  }

  const menuRef = useRef<MenuHandle>(null);

  return (
    <div
      className={`shell-tree-folder-row${current ? " is-current" : ""}`}
      onContextMenu={(event) => {
        event.preventDefault();
        menuRef.current?.open();
      }}
    >
      <button
        type="button"
        role="treeitem"
        aria-expanded={expanded}
        className="shell-tree-folder-toggle"
        title={folder.label}
        /*
         * Without this the name and the count run together into one word —
         * "Archive 2026" + "45" was announced as "Archive 202645" (S1-012).
         * There is no text node between the two elements to separate them and
         * `title` does not contribute once an element has text content.
         */
        aria-label={t("shell.tree.folderAria", { folder: folder.label, count: folder.count })}
        onClick={() => {
          onToggle();
          onSelect();
        }}
        onKeyDown={(event) => {
          // Tree keys, as the prototype had them: right opens the folder and
          // then steps into it, left closes it. F2 is the menu, for the same
          // reason the desktop uses it — a context menu with no pointer.
          if (event.key === "F2") {
            event.preventDefault();
            menuRef.current?.open();
            return;
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            if (!expanded) onToggle();
            else focusFirstFile(event.currentTarget);
            return;
          }
          if (event.key === "ArrowLeft" && expanded) {
            event.preventDefault();
            onToggle();
          }
        }}
      >
        <ChevronRight className="shell-tree-chevron" size={12} strokeWidth={2} aria-hidden="true" />
        {expanded ? (
          <FolderOpen size={17} strokeWidth={1.6} aria-hidden="true" />
        ) : (
          <FolderIcon size={17} strokeWidth={1.6} aria-hidden="true" />
        )}
        <span>{folder.label}</span>
        <small>{folder.count}</small>
      </button>

      <Menu
        ref={menuRef}
        label={t("shell.tree.folderMenu", { folder: folder.label })}
        items={items}
        align="end"
        width={220}
      >
        {(triggerProps) => (
          <button
            {...triggerProps}
            type="button"
            className="shell-tree-folder-add"
            aria-label={t("shell.tree.folderActionsFor", { folder: folder.label })}
            title={t("shell.tree.newFileHere")}
          >
            <Plus size={15} strokeWidth={1.8} aria-hidden="true" />
          </button>
        )}
      </Menu>
    </div>
  );
}

function FileRow({
  file,
  folders,
  current,
  onOpen,
  onMove,
  onTogglePinned,
}: {
  file: FileMeta;
  folders: Folder[];
  current: boolean;
  onOpen: () => void;
  onMove: (folderId: string) => void;
  onTogglePinned: () => void;
}) {
  const t = useT();
  const items: MenuItemSpec[] = [
    {
      id: "pin",
      label: t(file.pinned ? "shell.common.unpin" : "shell.common.pin"),
      onSelect: onTogglePinned,
    },
    ...folders
      .filter((folder) => folder.id !== file.folderId)
      .map((folder) => ({
        id: `move-${folder.id}`,
        label: t("shell.tree.moveTo", { folder: folder.name }),
        onSelect: () => onMove(folder.id),
      })),
  ];

  const menuRef = useRef<MenuHandle>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      className={`shell-tree-file-row${current ? " is-current" : ""}${dragging ? " is-dragging" : ""}`}
      draggable
      onContextMenu={(event) => {
        event.preventDefault();
        menuRef.current?.open();
      }}
      onDragStart={(event) => {
        event.dataTransfer.setData("application/x-officedex-file", file.id);
        event.dataTransfer.effectAllowed = "move";
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
    >
      <button
        type="button"
        role="treeitem"
        className="shell-tree-file-open"
        title={file.name}
        aria-current={current ? "page" : undefined}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === "F2") {
            event.preventDefault();
            menuRef.current?.open();
            return;
          }
          // Left goes back up to the folder this file is in — the counterpart
          // of right-arrow stepping into it.
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            focusOwningFolder(event.currentTarget);
          }
        }}
      >
        <FileTypeIcon type={file.type} size={15} />
        <span>{file.name.replace(/\.(docx|xlsx|pptx)$/i, "")}</span>
        {file.pinned ? <Pin size={11} strokeWidth={1.8} aria-label={t("shell.sidebar.pinned")} /> : null}
      </button>

      <Menu
        ref={menuRef}
        label={t("shell.tree.fileMenu", { file: file.name })}
        items={items}
        align="end"
        width={230}
      >
        {(triggerProps) => (
          <button
            {...triggerProps}
            type="button"
            className="shell-tree-file-more"
            aria-label={t("shell.tree.fileActionsFor", { file: file.name })}
            title={t("shell.common.fileActions")}
          >
            <MoreHorizontal size={14} strokeWidth={1.8} aria-hidden="true" />
          </button>
        )}
      </Menu>
    </div>
  );
}

/* --------------------------------------------------------- comfortable */

function ComfortableList(props: WithGroups) {
  const t = useT();
  const [now] = useState(() => Date.now());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // The sidebar must list every folder so an empty one can still be navigated
  // to; a page-sized list should not spend a heading on "Customer research 0".
  const groups = props.groups.filter((group) => group.files.length > 0);
  const empty = groups.length === 0;

  if (empty) {
    /*
     * Three headings, and the body has to match all of them — including the
     * case where both filters are on at once.
     *
     * The heading was a three-way choice and the body only a two-way one, so
     * "No pinned files" was explained by "Pin a file to keep it here." while a
     * File type filter was also narrowing the list and the screen never
     * mentioned it. Whichever filter is hiding files has to be named, because
     * clearing it is the shortest way out (S3-014).
     */
    const pinnedOnly = props.filter === "pinned";
    const typeFiltered = Boolean(props.fileType && props.fileType !== "all");
    const heading = t(
      pinnedOnly ? "shell.list.noPinned" : typeFiltered ? "shell.list.noOfType" : NO_FILES_YET,
    );
    const body = t(
      pinnedOnly && typeFiltered
        ? "shell.list.emptyPinnedAndType"
        : pinnedOnly
          ? "shell.list.emptyPinned"
          : typeFiltered
            ? "shell.list.emptyType"
            : "shell.list.empty",
    );

    return (
      <div className="shell-list-empty">
        <strong>{heading}</strong>
        <p>{body}</p>
      </div>
    );
  }

  return (
    <table className="shell-list">
      <caption className="shell-visually-hidden">
        {t(props.grouping === "folder" ? "shell.list.captionFolder" : "shell.list.captionTime")}
      </caption>
      <thead>
        <tr>
          <th scope="col">{t("shell.list.columnName")}</th>
          <th scope="col">{t("shell.list.columnFolder")}</th>
          <th scope="col">{t("shell.list.columnLastOpened")}</th>
          <th scope="col">
            <span className="shell-visually-hidden">{t("shell.common.pin")}</span>
          </th>
        </tr>
      </thead>
      {groups.map((group) => (
        <tbody
          key={group.id}
          data-drop-folder={group.folderId ?? undefined}
          /*
           * The tbody already accepted drops — it just never said so, so a file
           * moved on release with nothing on screen having changed (S8-015).
           * `ComfortableList` was the half of this component that never read
           * `dropFolderId` at all.
           */
          className={
            group.folderId !== null && group.folderId === props.dropFolderId
              ? "is-drop-target"
              : undefined
          }
        >
          <tr className="shell-list-group">
            <th scope="colgroup" colSpan={4}>
              {group.label}
              <small aria-hidden="true">{group.total}</small>
              {/* Same gluing as the sidebar's folder rows (S1-012). */}
              <span className="shell-visually-hidden">{t("shell.list.groupCount", { count: group.total })}</span>
            </th>
          </tr>
          {group.files.map((file) => (
            <tr
              key={file.id}
              className={
                `${file.id === props.activeFileId ? "is-current" : ""}${
                  file.id === draggingId ? " is-dragging" : ""
                }`.trim() || undefined
              }
              /*
               * Only rows that have somewhere to go are draggable.
               *
               * Under time grouping every group has `folderId: null` by design
               * — a time bucket is a view, not a place — so no target in the
               * page accepted a drop, yet every row advertised itself as
               * draggable. The user could pick a file up, carry it around the
               * whole page and put it back down with no explanation (S8-016).
               * Not offering the gesture is the honest version of that.
               */
              draggable={group.folderId !== null}
              onDragStart={(event) => {
                event.dataTransfer.setData("application/x-officedex-file", file.id);
                event.dataTransfer.effectAllowed = "move";
                setDraggingId(file.id);
              }}
              onDragEnd={() => setDraggingId(null)}
            >
              <td>
                <button
                  type="button"
                  className="shell-list-file"
                  title={file.name}
                  onClick={() => props.onOpenFile(file.id)}
                >
                  <FileTypeIcon type={file.type} />
                  <span>{file.name}</span>
                  {file.dirty ? (
                    <i className="shell-list-dirty" aria-label={t("workbench.state.dirty")} />
                  ) : null}
                </button>
              </td>
              <td>{locationLabel(file, props.folders)}</td>
              <td>
                <time dateTime={new Date(file.lastOpenedAt ?? file.updatedAt).toISOString()}>
                  {formatTouched(file, now)}
                </time>
              </td>
              <td>
                <button
                  type="button"
                  className={`shell-list-pin${file.pinned ? " is-pinned" : ""}`}
                  aria-pressed={file.pinned}
                  aria-label={t(file.pinned ? "shell.list.unpinFile" : "shell.list.pinFile", {
                    file: file.name,
                  })}
                  title={t(file.pinned ? "shell.common.unpin" : "shell.common.pin")}
                  onClick={() => props.onTogglePinned(file.id, !file.pinned)}
                >
                  <Pin size={14} strokeWidth={1.7} aria-hidden="true" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  );
}
