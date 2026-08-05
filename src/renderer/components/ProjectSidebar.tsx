import { useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { WorkspaceSummary } from "../../shared/types";
import { Button, Input, dialog } from "../ui";
import {
  AppstoreOutlined,
  EditOutlined,
  FolderOpenOutlined,
  HistoryOutlined,
  MoreOutlined,
  PlusOutlined,
  SettingOutlined,
  UserOutlined,
  DeleteOutlined,
} from "../ui/icons";
import { useT } from "../i18n";

export interface ProjectSidebarProps {
  workspaces: WorkspaceSummary[];
  activeWorkspaceId?: string;
  onSelectAll: () => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onAddWorkspace: () => void;
  onRenameWorkspace: (workspaceId: string, name: string) => void | Promise<void>;
  onRevealWorkspace: (workspacePath: string) => void;
  onRemoveWorkspace: (workspaceId: string) => void;
  onOpenTasks: () => void;
  onOpenSettings: () => void;
  onOpenAccount: () => void;
  compact?: boolean;
  onCompactChange?: (compact: boolean) => void;
}

export function ProjectSidebar({ workspaces, activeWorkspaceId, onSelectAll, onSelectWorkspace, onAddWorkspace, onRenameWorkspace, onRevealWorkspace, onRemoveWorkspace, onOpenTasks, onOpenSettings, onOpenAccount, compact = false, onCompactChange }: ProjectSidebarProps) {
  const t = useT();
  const [renamingId, setRenamingId] = useState<string>();
  const [renameValue, setRenameValue] = useState("");

  const submitRename = async (workspaceId: string) => {
    const name = renameValue.trim();
    if (!name) return;
    await onRenameWorkspace(workspaceId, name);
    setRenamingId(undefined);
    setRenameValue("");
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
            aria-label={compact ? "Expand project sidebar" : "Collapse project sidebar"}
            onClick={() => onCompactChange(!compact)}
          >
            {compact ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
          </button>
        ) : null}
      </div>
      <nav className="project-sidebar__primary" aria-label={t("projectSidebar.navigation")}>
        <button type="button" className={!activeWorkspaceId ? "is-active" : ""} onClick={onSelectAll}><AppstoreOutlined aria-hidden /><span>{t("projectSidebar.allFiles")}</span></button>
      </nav>
      <section className="project-sidebar__projects" aria-labelledby="project-sidebar-title">
        <div className="project-sidebar__section-header">
          <h2 id="project-sidebar-title">{t("projectSidebar.projects")}</h2>
          <Button variant="ghost-normal" size="small" ariaLabel={t("projectSidebar.add")} icon={<PlusOutlined />} onClick={onAddWorkspace} />
        </div>
        <div className="project-sidebar__list">
          {workspaces.map((workspace) => (
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
                <button type="button" className="project-sidebar__workspace-select" aria-label={workspace.name} onClick={() => onSelectWorkspace(workspace.id)}>
                  <FolderOpenOutlined aria-hidden /><span>{workspace.name}</span>
                </button>
              )}
              <div className="project-sidebar__workspace-actions">
                <button type="button" aria-label={t("projectSidebar.renameAria", { name: workspace.name })} onClick={() => { setRenamingId(workspace.id); setRenameValue(workspace.name); }}><EditOutlined aria-hidden /></button>
                <button type="button" aria-label={t("projectSidebar.revealAria", { name: workspace.name })} onClick={() => onRevealWorkspace(workspace.path)}><MoreOutlined aria-hidden /></button>
                <button type="button" aria-label={t("projectSidebar.removeAria", { name: workspace.name })} onClick={() => dialog.confirm({
                  title: t("projectSidebar.removeTitle", { name: workspace.name }),
                  content: t("projectSidebar.removeBody"),
                  okText: t("projectSidebar.remove"),
                  cancelText: t("projectSidebar.cancel"),
                  tone: "danger",
                  onOk: () => onRemoveWorkspace(workspace.id),
                })}><DeleteOutlined aria-hidden /></button>
              </div>
            </div>
          ))}
        </div>
      </section>
      <nav className="project-sidebar__footer" aria-label={t("projectSidebar.utilities")}>
        <button type="button" onClick={onOpenTasks}><HistoryOutlined aria-hidden /><span>{t("projectSidebar.tasks")}</span></button>
        <button type="button" onClick={onOpenSettings}><SettingOutlined aria-hidden /><span>{t("projectSidebar.settings")}</span></button>
        <button type="button" onClick={onOpenAccount}><UserOutlined aria-hidden /><span>{t("projectSidebar.account")}</span></button>
      </nav>
    </aside>
  );
}
