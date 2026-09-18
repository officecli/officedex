import { ChevronRight, Folder as FolderIcon, FolderOpen, MoreHorizontal, Pin, Plus } from "lucide-react";
import { useState } from "react";

import { FileTypeIcon } from "../chrome/FileTypeIcon";
import { Menu, type MenuItemSpec } from "../chrome/Menu";
import type { FileMeta, Folder } from "../../shared/uiPort";
import { buildGroups, formatTouched, locationLabel, type FileFilter, type Grouping } from "./fileTreeModel";
import type { FileType } from "../../shared/uiPort";
import "./nav.css";

const SIDEBAR_PAGE = 5;

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
  return (
    <div className="shell-tree" role="tree" aria-label="Folders and files">
      {props.groups.map((group) => {
        const folderId = group.folderId;
        if (!folderId) return null;
        const expanded = props.expandedFolderIds.includes(folderId);
        const revealed = props.revealedFolderIds.includes(folderId);
        const shown = revealed
          ? props.files.filter((file) => file.folderId === folderId)
          : group.files;

        return (
          <section key={group.id} className="shell-tree-folder" role="none">
            <FolderRow
              folder={{ id: folderId, label: group.label, count: group.total }}
              expanded={expanded}
              current={folderId === props.selectedFolderId}
              dropTarget={folderId === props.dropFolderId}
              onToggle={() => props.onToggleFolder(folderId)}
              onSelect={() => props.onSelectFolder(folderId)}
              onCreateFile={(type) => props.onCreateFile(folderId, type)}
              onRename={props.onRenameFolder ? () => props.onRenameFolder?.(folderId) : undefined}
              onRemove={props.onRemoveFolder ? () => props.onRemoveFolder?.(folderId) : undefined}
            />

            {expanded ? (
              <div className="shell-tree-files" role="group">
                {shown.length === 0 ? (
                  <p className="shell-tree-empty">No files yet.</p>
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
                    onClick={() => props.onToggleOverflow(folderId)}
                  >
                    {revealed ? "Show less" : `Show ${group.total - group.files.length} more`}
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
  dropTarget,
  onToggle,
  onSelect,
  onCreateFile,
  onRename,
  onRemove,
}: {
  folder: { id: string; label: string; count: number };
  expanded: boolean;
  current: boolean;
  dropTarget: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onCreateFile: (type: FileType) => void;
  onRename?: () => void;
  onRemove?: () => void;
}) {
  const items: MenuItemSpec[] = [
    { id: "doc", label: "New document", onSelect: () => onCreateFile("doc") },
    { id: "sheet", label: "New workbook", onSelect: () => onCreateFile("sheet") },
    { id: "slides", label: "New presentation", onSelect: () => onCreateFile("slides") },
  ];
  if (onRename) items.push({ id: "rename", label: "Rename folder…", onSelect: onRename });
  if (onRemove) {
    items.push({
      id: "remove",
      label: "Remove folder",
      description: "Files move to Documents",
      onSelect: onRemove,
    });
  }

  return (
    <div
      className={`shell-tree-folder-row${current ? " is-current" : ""}${dropTarget ? " is-drop-target" : ""}`}
      data-drop-folder={folder.id}
    >
      <button
        type="button"
        role="treeitem"
        aria-expanded={expanded}
        className="shell-tree-folder-toggle"
        title={folder.label}
        onClick={() => {
          onToggle();
          onSelect();
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

      <Menu label={`${folder.label} actions`} items={items} align="end" width={220}>
        {(triggerProps) => (
          <button
            {...triggerProps}
            type="button"
            className="shell-tree-folder-add"
            aria-label={`Actions for ${folder.label}`}
            title="New file in this folder"
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
  const items: MenuItemSpec[] = [
    {
      id: "pin",
      label: file.pinned ? "Unpin" : "Pin",
      onSelect: onTogglePinned,
    },
    ...folders
      .filter((folder) => folder.id !== file.folderId)
      .map((folder) => ({
        id: `move-${folder.id}`,
        label: `Move to ${folder.name}`,
        onSelect: () => onMove(folder.id),
      })),
  ];

  return (
    <div
      className={`shell-tree-file-row${current ? " is-current" : ""}`}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("application/x-officedex-file", file.id);
        event.dataTransfer.effectAllowed = "move";
      }}
    >
      <button
        type="button"
        role="treeitem"
        className="shell-tree-file-open"
        title={file.name}
        aria-current={current ? "page" : undefined}
        onClick={onOpen}
      >
        <FileTypeIcon type={file.type} size={15} />
        <span>{file.name.replace(/\.(docx|xlsx|pptx)$/i, "")}</span>
        {file.pinned ? <Pin size={11} strokeWidth={1.8} aria-label="Pinned" /> : null}
      </button>

      <Menu label={`${file.name} actions`} items={items} align="end" width={230}>
        {(triggerProps) => (
          <button
            {...triggerProps}
            type="button"
            className="shell-tree-file-more"
            aria-label={`Actions for ${file.name}`}
            title="File actions"
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
  const [now] = useState(() => Date.now());
  // The sidebar must list every folder so an empty one can still be navigated
  // to; a page-sized list should not spend a heading on "Customer research 0".
  const groups = props.groups.filter((group) => group.files.length > 0);
  const empty = groups.length === 0;

  if (empty) {
    return (
      <div className="shell-list-empty">
        <strong>
          {props.filter === "pinned"
            ? "No pinned files"
            : props.fileType !== "all"
              ? "No files of this type"
              : "No files yet"}
        </strong>
        <p>
          {props.filter === "pinned"
            ? "Pin a file to keep it here."
            : "Create a file, or open one from this computer."}
        </p>
      </div>
    );
  }

  return (
    <table className="shell-list">
      <caption className="shell-visually-hidden">
        Files grouped by {props.grouping === "folder" ? "folder" : "when they were last opened"}
      </caption>
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Folder</th>
          <th scope="col">Last opened</th>
          <th scope="col">
            <span className="shell-visually-hidden">Pin</span>
          </th>
        </tr>
      </thead>
      {groups.map((group) => (
        <tbody key={group.id} data-drop-folder={group.folderId ?? undefined}>
          <tr className="shell-list-group">
            <th scope="colgroup" colSpan={4}>
              {group.label}
              <small>{group.total}</small>
            </th>
          </tr>
          {group.files.map((file) => (
            <tr
              key={file.id}
              className={file.id === props.activeFileId ? "is-current" : undefined}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData("application/x-officedex-file", file.id);
                event.dataTransfer.effectAllowed = "move";
              }}
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
                  {file.dirty ? <i className="shell-list-dirty" aria-label="Unsaved changes" /> : null}
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
                  aria-label={`${file.pinned ? "Unpin" : "Pin"} ${file.name}`}
                  title={file.pinned ? "Unpin" : "Pin"}
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
