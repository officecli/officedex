import { useState, type DragEvent, type ReactNode } from "react";
import type { WhoAmIMode, WorkspaceSummary } from "../../shared/types";
import { Button, Dropdown, Input, Tooltip, dialog, type MenuProps } from "../ui";
import {
  DeleteOutlined,
  EditOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
  HomeOutlined,
  MoreOutlined,
  PlusOutlined,
  SettingOutlined,
  UserOutlined,
} from "../ui/icons";
import { useT } from "../i18n";
import type { SidebarSignal } from "../taskSignals";
import { dragHasFiles, setHomeDropZone } from "../homeDropZone";
import { DocTypeIcon } from "./DocTypeIcon";

export interface SidebarAccount {
  mode: WhoAmIMode;
  email?: string;
}

export interface SidebarDocument {
  id: string;
  createdAt?: string;
  title: string;
  documentType: string;
  filePath?: string;
  conversationId?: string;
  workspaceId?: string;
  status?: "starting" | "running" | "question" | "plan_review" | "completed" | "failed" | "cancelled";
}

export interface ProjectSidebarProps {
  workspaces: WorkspaceSummary[];
  documents?: SidebarDocument[];
  activeDocumentId?: string;
  activeWorkspaceId?: string;
  onSelectAll: () => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onOpenDocument?: (document: SidebarDocument) => void;
  onDeleteDocument?: (document: SidebarDocument) => void | Promise<void>;
  /** Deletes a folded group in one operation after the sidebar confirms it. */
  onDeleteDocuments?: (documents: SidebarDocument[]) => void | Promise<void>;
  onAddWorkspace: () => void;
  onRenameWorkspace: (workspaceId: string, name: string) => void | Promise<void>;
  onRevealWorkspace: (workspacePath: string) => void;
  onRemoveWorkspace: (workspaceId: string) => void;
  onOpenSettings: () => void;
  onOpenAccount: () => void;
  signal?: SidebarSignal;
  account?: SidebarAccount;
  updateRow?: ReactNode;
  /** Set while the rail is only peeked open, so hovering it keeps it there. */
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}

/** Rows that share a title are indistinguishable in a list, so they fold. */
function groupByTitle(documents: SidebarDocument[]): Array<{ title: string; documents: SidebarDocument[] }> {
  const groups: Array<{ title: string; documents: SidebarDocument[] }> = [];
  const indexByTitle = new Map<string, number>();
  for (const document of documents) {
    const at = indexByTitle.get(document.title);
    if (at === undefined) {
      indexByTitle.set(document.title, groups.length);
      groups.push({ title: document.title, documents: [document] });
    } else {
      groups[at].documents.push(document);
    }
  }
  return groups;
}

/** Waiting on a person, versus merely still working. */
const ATTENTION_STATUSES = new Set(["question", "plan_review"]);
const RUNNING_STATUSES = new Set(["starting", "running"]);

export function ProjectSidebar({ workspaces, documents = [], activeWorkspaceId, activeDocumentId, onSelectAll, onSelectWorkspace, onOpenDocument, onDeleteDocument, onDeleteDocuments, onAddWorkspace, onRenameWorkspace, onRevealWorkspace, onRemoveWorkspace, onOpenSettings, onOpenAccount, signal, account, updateRow, onPointerEnter, onPointerLeave }: ProjectSidebarProps) {
  const t = useT();
  const [renamingId, setRenamingId] = useState<string>();
  const [renameValue, setRenameValue] = useState("");
  const [dropActive, setDropActive] = useState(false);
  const [unfolded, setUnfolded] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  const submitRename = async (workspaceId: string) => {
    const name = renameValue.trim();
    if (!name) return;
    await onRenameWorkspace(workspaceId, name);
    setRenamingId(undefined);
    setRenameValue("");
  };

  const workspaceMenu = (workspace: WorkspaceSummary): MenuProps => ({
    items: [
      { key: "rename", label: t("projectSidebar.rename"), icon: <EditOutlined aria-hidden /> },
      { key: "reveal", label: t("projectSidebar.reveal"), icon: <FolderOpenOutlined aria-hidden /> },
      { type: "divider" as const },
      { key: "remove", label: t("projectSidebar.remove"), icon: <DeleteOutlined aria-hidden />, danger: true },
    ],
    onClick: ({ key }) => {
      if (key === "rename") {
        setRenamingId(workspace.id);
        setRenameValue(workspace.name);
      }
      if (key === "reveal") onRevealWorkspace(workspace.path);
      if (key === "remove") {
        dialog.confirm({
          title: t("projectSidebar.removeTitle", { name: workspace.name }),
          content: t("projectSidebar.removeBody"),
          okText: t("projectSidebar.remove"),
          cancelText: t("projectSidebar.cancel"),
          tone: "danger",
          onOk: () => onRemoveWorkspace(workspace.id),
        });
      }
    },
  });

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    setHomeDropZone("workspaces");
    setDropActive(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setHomeDropZone(null);
    setDropActive(false);
  };

  const confirmDeleteDocument = (document: SidebarDocument) => {
    dialog.confirm({
      title: t("projectSidebar.deleteDocumentTitle", { name: document.title }),
      content: t("projectSidebar.deleteDocumentBody"),
      okText: t("projectSidebar.deleteDocument"),
      cancelText: t("projectSidebar.cancel"),
      tone: "danger",
      onOk: () => onDeleteDocument?.(document),
    });
  };

  const confirmDeleteDocuments = (group: SidebarDocument[]) => {
    if (group.length === 0) return;
    dialog.confirm({
      title: t("projectSidebar.deleteDocumentsTitle", { count: String(group.length), name: group[0].title }),
      content: t("projectSidebar.deleteDocumentsBody", { count: String(group.length) }),
      okText: t("projectSidebar.deleteDocuments", { count: String(group.length) }),
      cancelText: t("projectSidebar.cancel"),
      tone: "danger",
      onOk: () => onDeleteDocuments
        ? onDeleteDocuments(group)
        : Promise.all(group.map((document) => onDeleteDocument?.(document))),
    });
  };

  const documentMenu = (document: SidebarDocument): MenuProps => ({
    items: [
      { key: "open", label: t("projectSidebar.openDocument") },
      ...(onDeleteDocument ? [{ key: "delete", label: t("projectSidebar.deleteDocument"), icon: <DeleteOutlined aria-hidden />, danger: true }] : []),
    ],
    onClick: ({ key }) => {
      if (key === "open") onOpenDocument?.(document);
      if (key === "delete") confirmDeleteDocument(document);
    },
  });

  const renderDocument = (document: SidebarDocument) => (
    <Dropdown menu={documentMenu(document)} trigger={["contextMenu"]} placement="right" key={document.id}>
      <div
        className="project-sidebar__document"
        data-active={document.id === activeDocumentId ? "true" : undefined}
      >
        <button
          type="button"
          className="project-sidebar__document-open"
          data-active={document.id === activeDocumentId ? "true" : undefined}
          title={document.title}
          onClick={() => onOpenDocument?.(document)}
        >
          <DocTypeIcon type={document.documentType} />
          <span>{document.title}</span>
          {document.status && document.status !== "completed" ? (
            <em className="project-sidebar__document-status" data-status={document.status} aria-label={t(`tasks.status.${document.status}`)} title={t(`tasks.status.${document.status}`)}>
              {RUNNING_STATUSES.has(document.status) ? <i aria-hidden="true" /> : null}
              {t(`tasks.status.${document.status}`)}
            </em>
          ) : null}
        </button>
        {onDeleteDocument ? (
          <button
            type="button"
            className="project-sidebar__document-delete"
            aria-label={t("projectSidebar.deleteDocumentAria", { name: document.title })}
            title={t("projectSidebar.deleteDocument")}
            onClick={() => confirmDeleteDocument(document)}
          >
            <DeleteOutlined aria-hidden />
          </button>
        ) : null}
      </div>
    </Dropdown>
  );

  const renderFolded = (group: SidebarDocument[], key: string) => {
    const open = unfolded.includes(key);
    return (
      <div className="project-sidebar__fold" key={key}>
        <Dropdown
          menu={{
            items: onDeleteDocument || onDeleteDocuments
              ? [{ key: "delete-all", label: t("projectSidebar.deleteDocuments", { count: String(group.length) }), icon: <DeleteOutlined aria-hidden />, danger: true }]
              : [],
            onClick: ({ key }) => { if (key === "delete-all") confirmDeleteDocuments(group); },
          }}
          trigger={["contextMenu"]}
          placement="right"
        >
          <button
            type="button"
            className="project-sidebar__fold-toggle"
            aria-expanded={open}
            aria-label={t("projectSidebar.foldedDocumentsAria", { count: String(group.length), name: group[0].title })}
            title={group[0].title}
            onClick={() => setUnfolded((current) => open ? current.filter((item) => item !== key) : [...current, key])}
          >
            <DocTypeIcon type={group[0].documentType} />
            <span>{group[0].title}</span>
            <em aria-hidden="true">×{group.length}</em>
          </button>
        </Dropdown>
        {open ? <div className="project-sidebar__fold-body">{group.map(renderDocument)}</div> : null}
      </div>
    );
  };

  /**
   * The document on screen always keeps its own row, so the user can see and
   * act on it; only the same-titled ones behind it fold under a count.
   */
  const renderDocuments = (documents: SidebarDocument[], groupKey: string) => groupByTitle(documents).flatMap((group) => {
    const onScreen = group.documents.filter((document) => document.id === activeDocumentId);
    const rest = group.documents.filter((document) => document.id !== activeDocumentId);
    if (rest.length <= 1) return [...onScreen, ...rest].map(renderDocument);
    return [...onScreen.map(renderDocument), renderFolded(rest, `${groupKey}\u001f${group.title}`)];
  });

  /**
   * A flat list makes the reader find the two rows that need them among thirty
   * that do not. Status sections are only labelled when a workspace actually
   * holds more than one kind, so the common single-kind workspace keeps its
   * previous, unlabelled look.
   */
  const renderStatusSections = (documents: SidebarDocument[], groupKey: string) => {
    const sections = [
      { key: "attention", documents: documents.filter((document) => ATTENTION_STATUSES.has(document.status ?? "")) },
      { key: "running", documents: documents.filter((document) => RUNNING_STATUSES.has(document.status ?? "")) },
      { key: "recent", documents: documents.filter((document) => !ATTENTION_STATUSES.has(document.status ?? "") && !RUNNING_STATUSES.has(document.status ?? "")) },
    ].filter((section) => section.documents.length > 0);
    const labelled = sections.length > 1;
    return sections.flatMap((section) => [
      ...(labelled ? [<p className="project-sidebar__group-label" key={`${groupKey}-${section.key}-label`}>{t(`projectSidebar.group.${section.key}`)}</p>] : []),
      ...renderDocuments(section.documents, `${groupKey}\u001f${section.key}`),
    ]);
  };

  const query = search.trim().toLowerCase();
  const searching = query.length > 0;
  // Matching a workspace name keeps that workspace's documents, so searching for
  // "Client A" is a way to narrow the list, not a way to empty it.
  const matchedWorkspaceIds = new Set(workspaces.filter((workspace) => !query || workspace.name.toLowerCase().includes(query)).map((workspace) => workspace.id));
  const visibleDocuments = documents.filter((document) => (
    !query || document.title.toLowerCase().includes(query) || (document.workspaceId ? matchedWorkspaceIds.has(document.workspaceId) : false)
  ));

  return (
    <aside className="project-sidebar" aria-label={t("projectSidebar.label")} onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}>
      {/* Holds the rail toggle Shell parks over it, and on the desktop window
          the traffic lights as well — which is why it also drags the window. */}
      <div className="project-sidebar__window-drag" aria-hidden="true" />
      <div className="project-sidebar__brand">
        <img src="./officedex-logo.png" alt="OfficeDex" />
        <span className="project-sidebar__brand-name">OfficeDex</span>
      </div>
      <nav className="project-sidebar__primary" aria-label={t("projectSidebar.navigation")}>
        <button type="button" className={`project-sidebar__new ${!activeWorkspaceId ? "is-active" : ""}`} aria-label={t("preview.copy.new")} onClick={onSelectAll}>
          <PlusOutlined className="project-sidebar__new-icon" aria-hidden="true" />
          <span>{t("preview.copy.new")}</span>
        </button>
      </nav>
      <section
        className={`project-sidebar__projects ${dropActive ? "is-drop-active" : ""}`}
        aria-labelledby="project-sidebar-title"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={() => setDropActive(false)}
      >
        <div className="project-sidebar__section-header">
          <h2 id="project-sidebar-title">{t("projectSidebar.projects")}</h2>
          <Button variant="ghost-normal" size="small" ariaLabel={t("projectSidebar.add")} icon={<PlusOutlined />} onClick={onAddWorkspace} />
        </div>
        {documents.length > 0 ? (
          <div className="project-sidebar__search">
            <Input
              aria-label={t("projectSidebar.search")}
              placeholder={t("projectSidebar.searchPlaceholder")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        ) : null}
        <div className="project-sidebar__list">
          {searching && visibleDocuments.length === 0 ? (
            <p className="project-sidebar__no-matches">{t("projectSidebar.searchEmpty")}</p>
          ) : null}
          {workspaces.length === 0 ? (
            <button type="button" className="project-sidebar__empty" onClick={onAddWorkspace}>
              <FolderAddOutlined aria-hidden />
              <span>{t("projectSidebar.emptyHint")}</span>
              <em>{t("projectSidebar.emptyAction")}</em>
            </button>
          ) : workspaces.map((workspace) => (
            <div className="project-sidebar__workspace-group" key={workspace.id}>
            <div className="project-sidebar__workspace" data-active={workspace.id === activeWorkspaceId ? "true" : undefined}>
              {renamingId === workspace.id ? (
                <Input
                  autoFocus
                  aria-label={t("projectSidebar.projectName")}
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onBlur={() => void submitRename(workspace.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void submitRename(workspace.id);
                    if (event.key === "Escape") setRenamingId(undefined);
                  }}
                />
              ) : (
                <Dropdown menu={workspaceMenu(workspace)} trigger={["contextMenu"]} placement="right">
                  <button type="button" className="project-sidebar__workspace-select" aria-label={workspace.name} title={workspace.name} onClick={() => onSelectWorkspace(workspace.id)}>
                    <FolderOpenOutlined aria-hidden /><span>{workspace.name}</span>
                  </button>
                </Dropdown>
              )}
              <div className="project-sidebar__workspace-actions">
                <Dropdown menu={workspaceMenu(workspace)} trigger={["click"]} placement="bottom">
                  <button type="button" aria-label={t("projectSidebar.workspaceMenuAria", { name: workspace.name })}><MoreOutlined aria-hidden /></button>
                </Dropdown>
              </div>
            </div>
            {renderStatusSections(visibleDocuments.filter((document) => document.workspaceId === workspace.id), workspace.id)}
            </div>
          ))}
          {visibleDocuments.some((document) => !document.workspaceId) ? (
            <div className="project-sidebar__unscoped-documents">
              {renderStatusSections(visibleDocuments.filter((document) => !document.workspaceId), "unscoped")}
            </div>
          ) : null}
        </div>
        {dropActive ? <div className="project-sidebar__drop-hint" aria-hidden="true">{t("projectSidebar.dropHint")}</div> : null}
      </section>
      <nav className="project-sidebar__footer" aria-label={t("projectSidebar.utilities")}>
        {updateRow}
        <button type="button" aria-label={account?.email ?? t("projectSidebar.account")} onClick={onOpenAccount} title={account?.email}>
          <UserOutlined aria-hidden />
          <span>{account?.email ?? t("projectSidebar.account")}</span>
        </button>
        <button type="button" aria-label={t("projectSidebar.settings")} onClick={onOpenSettings}><SettingOutlined aria-hidden /><span>{t("projectSidebar.settings")}</span></button>
      </nav>
    </aside>
  );
}
