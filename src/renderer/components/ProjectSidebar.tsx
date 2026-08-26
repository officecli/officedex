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
  ThunderboltOutlined,
  UserOutlined,
} from "../ui/icons";
import { useT } from "../i18n";
import type { SidebarSignal } from "../taskSignals";
import { dragHasFiles, setHomeDropZone } from "../homeDropZone";
import type { CreditInfo } from "./Shell";

export interface SidebarAccount {
  mode: WhoAmIMode;
  email?: string;
}

export interface ProjectSidebarProps {
  workspaces: WorkspaceSummary[];
  activeWorkspaceId?: string;
  onSelectAll: () => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onAddWorkspace: () => void;
  onRenameWorkspace: (workspaceId: string, name: string) => void | Promise<void>;
  onRevealWorkspace: (workspacePath: string) => void;
  onRemoveWorkspace: (workspaceId: string) => void;
  onOpenSettings: () => void;
  onOpenAccount: () => void;
  signal?: SidebarSignal;
  credit?: CreditInfo;
  hasCustomProvider?: boolean;
  account?: SidebarAccount;
  updateRow?: ReactNode;
  compact?: boolean;
  onCompactChange?: (compact: boolean) => void;
}

function creditValue(credit: CreditInfo): string {
  if (credit.displayMode === "balance") return String(Math.max(0, credit.total));
  return `${Math.max(0, credit.total - credit.used)} / ${credit.total}`;
}

export function ProjectSidebar({ workspaces, activeWorkspaceId, onSelectAll, onSelectWorkspace, onAddWorkspace, onRenameWorkspace, onRevealWorkspace, onRemoveWorkspace, onOpenSettings, onOpenAccount, signal, credit, hasCustomProvider, account, updateRow, compact = false, onCompactChange }: ProjectSidebarProps) {
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

  return (
    <aside className="project-sidebar" aria-label={t("projectSidebar.label")} data-compact={compact ? "true" : "false"}>
      <div className="project-sidebar__brand">
        <img src="./officedex-logo.png" alt="OfficeDex" />
        <span className="project-sidebar__brand-name">OfficeDex</span>
        {onCompactChange ? (
          <button
            type="button"
            className="project-sidebar__compact-toggle"
            aria-label={compact ? t("spreadsheet.sidebar.expand") : t("spreadsheet.sidebar.collapse")}
            onClick={() => onCompactChange(!compact)}
          >
            {compact ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
          </button>
        ) : null}
      </div>
      <nav className="project-sidebar__primary" aria-label={t("projectSidebar.navigation")}>
        {/* Home is the inbox now, so it carries the signal: there is no separate
            tasks page to route people to. */}
        <button type="button" className={!activeWorkspaceId ? "is-active" : ""} onClick={onSelectAll}>
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
            <div className="project-sidebar__workspace" data-active={workspace.id === activeWorkspaceId ? "true" : undefined} key={workspace.id}>
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
          ))}
        </div>
        {dropActive ? <div className="project-sidebar__drop-hint" aria-hidden="true">{t("projectSidebar.dropHint")}</div> : null}
      </section>
      <nav className="project-sidebar__footer" aria-label={t("projectSidebar.utilities")}>
        {updateRow}
        {credit ? (
          <div className="project-sidebar__credit" role="status">
            <ThunderboltOutlined aria-hidden />
            <span>{hasCustomProvider ? t("shell.creditMeter.freeLabel") : credit.planLabel || t("shell.creditMeter.label")}</span>
            {!hasCustomProvider ? <strong>{creditValue(credit)}</strong> : null}
          </div>
        ) : null}
        <button type="button" onClick={onOpenAccount} title={account?.email}>
          <UserOutlined aria-hidden />
          <span>{account?.email ?? t("projectSidebar.account")}</span>
        </button>
        <button type="button" onClick={onOpenSettings}><SettingOutlined aria-hidden /><span>{t("projectSidebar.settings")}</span></button>
      </nav>
    </aside>
  );
}
