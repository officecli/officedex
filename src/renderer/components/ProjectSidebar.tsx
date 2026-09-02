import { useState, type DragEvent, type ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
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
  onAddWorkspace: () => void;
  onRenameWorkspace: (workspaceId: string, name: string) => void | Promise<void>;
  onRevealWorkspace: (workspacePath: string) => void;
  onRemoveWorkspace: (workspaceId: string) => void;
  onOpenSettings: () => void;
  onOpenAccount: () => void;
  signal?: SidebarSignal;
  account?: SidebarAccount;
  updateRow?: ReactNode;
  compact?: boolean;
  onCompactChange?: (compact: boolean) => void;
}

export function ProjectSidebar({ workspaces, documents = [], activeWorkspaceId, activeDocumentId, onSelectAll, onSelectWorkspace, onOpenDocument, onDeleteDocument, onAddWorkspace, onRenameWorkspace, onRevealWorkspace, onRemoveWorkspace, onOpenSettings, onOpenAccount, signal, account, updateRow, compact = false, onCompactChange }: ProjectSidebarProps) {
  const t = useT();
  const [renamingId, setRenamingId] = useState<string>();
  const [renameValue, setRenameValue] = useState("");
  const [dropActive, setDropActive] = useState(false);

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

  const renderDocument = (document: SidebarDocument) => (
    <div
      className="project-sidebar__document"
      data-active={document.id === activeDocumentId ? "true" : undefined}
      key={document.id}
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
        {document.status && document.status !== "completed" ? <em data-status={document.status} aria-label={document.status} /> : null}
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
  );

  return (
    <aside className="project-sidebar" aria-label={t("projectSidebar.label")} data-compact={compact ? "true" : "false"}>
      <div className="project-sidebar__brand">
        <img src="./officedex-logo.png" alt="OfficeDex" />
        <span className="project-sidebar__brand-name">OfficeDex</span>
        {onCompactChange ? (
          <button
            type="button"
            className="project-sidebar__compact-toggle"
            aria-label={compact ? t("shell.sidebar.expand") : t("shell.sidebar.collapse")}
            onClick={() => onCompactChange(!compact)}
          >
            {compact ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
          </button>
        ) : null}
      </div>
      <nav className="project-sidebar__primary" aria-label={t("projectSidebar.navigation")}>
        {/* Home is the inbox now, so it carries the signal: there is no separate
            tasks page to route people to. */}
        <button type="button" className={!activeWorkspaceId ? "is-active" : ""} aria-label={t("projectSidebar.home")} onClick={onSelectAll}>
          <HomeOutlined aria-hidden /><span>{t("projectSidebar.home")}</span>
          {signal ? (
            <Tooltip title={t(`projectSidebar.signal.${signal.kind}`, { count: signal.count })} placement="right">
              <em
                className={`project-sidebar__badge project-sidebar__badge--${signal.kind}`}
                aria-label={t(`projectSidebar.signal.${signal.kind}`, { count: signal.count })}
              >
                {signal.kind === "attention" ? signal.count : null}
              </em>
            </Tooltip>
          ) : null}
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
        <div className="project-sidebar__list">
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
                <button type="button" className="project-sidebar__workspace-select" aria-label={workspace.name} title={workspace.name} onClick={() => onSelectWorkspace(workspace.id)}>
                  <FolderOpenOutlined aria-hidden /><span>{workspace.name}</span>
                </button>
              )}
              <div className="project-sidebar__workspace-actions">
                <Dropdown menu={workspaceMenu(workspace)} trigger={["click"]} placement="bottom">
                  <button type="button" aria-label={t("projectSidebar.workspaceMenuAria", { name: workspace.name })}><MoreOutlined aria-hidden /></button>
                </Dropdown>
              </div>
            </div>
            {documents.filter((document) => document.workspaceId === workspace.id).map(renderDocument)}
            </div>
          ))}
        </div>
        {documents.some((document) => !document.workspaceId) ? (
          <div className="project-sidebar__unscoped-documents">
            {documents.filter((document) => !document.workspaceId).map(renderDocument)}
          </div>
        ) : null}
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
