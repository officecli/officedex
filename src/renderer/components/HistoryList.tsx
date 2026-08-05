import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { DeleteOutlined, DownOutlined, EditOutlined, FolderAddOutlined, FolderOpenOutlined, MoreOutlined, RightOutlined } from "../ui/icons";
import { Dropdown, Tooltip, type MenuProps } from "../ui";
import type { DesktopTask, WorkspaceConversationSummary, WorkspaceSummary } from "../../shared/types";
import { FileGlyph, StatusDot } from "./Shell";
import { useT } from "../i18n";

const PAGE_SIZE = 20;

interface HistoryListProps {
  workspaces: WorkspaceSummary[];
  chats: WorkspaceConversationSummary[];
  activeWorkspaceId: string | undefined;
  selectedConversationId: string | undefined;
  collapsed: boolean;
  onSelect: (taskId: string) => void;
  onDelete: (conversationId: string) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onNewConversation: (workspaceId: string) => void;
  onAddWorkspace: () => void;
  onRevealWorkspace: (workspacePath: string) => void;
  onRemoveWorkspace: (workspaceId: string) => void;
}

function statusTone(status: DesktopTask["status"]): "blue" | "green" | "orange" | "red" | "gray" {
  switch (status) {
    case "completed": return "green";
    case "failed": return "red";
    case "running": case "starting": return "blue";
    case "question": case "plan_review": return "orange";
    case "cancelled": return "gray";
  }
}

function isActiveTask(status: DesktopTask["status"]): boolean {
  return status === "running" || status === "starting" || status === "question" || status === "plan_review";
}

export function HistoryList({ workspaces, chats, activeWorkspaceId, selectedConversationId, collapsed, onSelect, onDelete, onSelectWorkspace, onNewConversation, onAddWorkspace, onRevealWorkspace, onRemoveWorkspace }: HistoryListProps) {
  const t = useT();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [chatsExpanded, setChatsExpanded] = useState(true);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [workspaces.length]);

  useEffect(() => {
    setExpanded((current) => {
      const next = { ...current };
      for (const workspace of workspaces) {
        if (next[workspace.id] === undefined) {
          next[workspace.id] = true;
        }
      }
      return next;
    });
  }, [workspaces]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, workspaces.length));
        }
      },
      { root: scrollRef.current, threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [workspaces.length]);

  const handleDelete = useCallback(
    (e: MouseEvent, conversationId: string) => {
      e.stopPropagation();
      onDelete(conversationId);
    },
    [onDelete],
  );

  const addProjectMenu: MenuProps = {
    items: [
      { key: "existing", label: t("shell.projects.useExistingFolder"), icon: <FolderAddOutlined /> },
    ],
    onClick: ({ key }) => {
      if (key === "existing") onAddWorkspace();
    },
  };

  const projectActionMenu = useCallback((workspace: WorkspaceSummary): MenuProps => ({
    items: [
      { key: "pin", label: t("shell.projects.menu.pin"), disabled: true },
      { key: "reveal", label: t("shell.projects.menu.reveal") },
      { key: "worktree", label: t("shell.projects.menu.worktree"), disabled: true },
      { key: "rename", label: t("shell.projects.menu.rename"), disabled: true },
      { key: "archive", label: t("shell.projects.menu.archive"), disabled: true },
      { type: "divider" },
      { key: "remove", label: t("shell.projects.menu.remove"), danger: true },
    ],
    onClick: ({ key, domEvent }) => {
      domEvent.stopPropagation();
      if (key === "reveal") {
        onRevealWorkspace(workspace.path);
      } else if (key === "remove" && window.confirm(t("shell.projects.removeConfirm", { name: workspace.name }))) {
        onRemoveWorkspace(workspace.id);
      }
    },
  }), [onRemoveWorkspace, onRevealWorkspace, t]);

  const visible = workspaces.slice(0, visibleCount);
  const hasMore = visibleCount < workspaces.length;

  return (
    <div className="history-list" ref={scrollRef}>
      <div className="history-list-header">
        {!collapsed && <span className="history-list-title">{t("shell.projects.title")}</span>}
        {!collapsed && (
          <Dropdown menu={addProjectMenu} trigger={["click"]}>
            <Tooltip title={t("shell.projects.add")}>
              <button type="button" className="history-header-action" aria-label={t("shell.projects.add")} onClick={(event) => event.preventDefault()}>
                <FolderAddOutlined />
              </button>
            </Tooltip>
          </Dropdown>
        )}
      </div>
      <div className="history-list-items">
        {visible.map((workspace) => {
          const isWorkspaceActive = workspace.id === activeWorkspaceId || workspace.active;
          const isExpanded = expanded[workspace.id] !== false;
          return (
            <div className="workspace-group" key={workspace.id}>
              <Tooltip title={collapsed ? workspace.name : ""} placement="right">
                <div
                  className={`workspace-item ${isWorkspaceActive ? "active" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-label={workspace.name}
                  onClick={() => onSelectWorkspace(workspace.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelectWorkspace(workspace.id); }}
                >
                  <span className="history-item-icon">
                    <FolderOpenOutlined />
                  </span>
                  {!collapsed && (
                    <>
                      <span className="history-item-title">{workspace.name}</span>
                      <button
                        type="button"
                        className="workspace-row-action"
                        aria-label={`${isExpanded ? "Collapse" : "Expand"} ${workspace.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setExpanded((current) => ({ ...current, [workspace.id]: !isExpanded }));
                        }}
                      >
                        {isExpanded ? <DownOutlined /> : <RightOutlined />}
                      </button>
                      <button
                        type="button"
                        className="workspace-row-action"
                        aria-label={`New chat in ${workspace.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onNewConversation(workspace.id);
                        }}
                      >
                        <EditOutlined />
                      </button>
                      <Dropdown menu={projectActionMenu(workspace)} trigger={["click"]}>
                        <button
                          type="button"
                          className="workspace-row-action"
                          aria-label={`Project actions for ${workspace.name}`}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                        >
                          <MoreOutlined />
                        </button>
                      </Dropdown>
                    </>
                  )}
                </div>
              </Tooltip>
              {!collapsed && isExpanded ? (
                <div className="workspace-conversations">
                  {workspace.conversations.length === 0 ? (
                    <div className="workspace-empty">{t("shell.projects.noChats")}</div>
                  ) : workspace.conversations.map((conversation) => (
                    <ConversationRow
                      key={conversation.conversationId}
                      conversation={conversation}
                      selected={conversation.conversationId === selectedConversationId}
                      onSelect={onSelect}
                      onDelete={handleDelete}
                      deleteLabel={t("shell.history.delete")}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
        {hasMore && <div className="history-sentinel" ref={sentinelRef} />}
        {!collapsed ? (
          <div className="chat-section">
            <button
              type="button"
              className="chat-section-title"
              aria-label={`${chatsExpanded ? "Collapse" : "Expand"} ${t("shell.chats.title")}`}
              onClick={() => setChatsExpanded((current) => !current)}
            >
              <span>{t("shell.chats.title")}</span>
              {chatsExpanded ? <DownOutlined /> : <RightOutlined />}
            </button>
            {chatsExpanded ? (
              chats.length === 0 ? (
                <div className="workspace-empty">{t("shell.projects.noChats")}</div>
              ) : chats.map((conversation) => (
                <ConversationRow
                  key={conversation.conversationId}
                  conversation={conversation}
                  selected={conversation.conversationId === selectedConversationId}
                  onSelect={onSelect}
                  onDelete={handleDelete}
                  deleteLabel={t("shell.history.delete")}
                />
              ))
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ConversationRow({ conversation, selected, onSelect, onDelete, deleteLabel }: {
  conversation: WorkspaceConversationSummary;
  selected: boolean;
  onSelect: (taskId: string) => void;
  onDelete: (event: MouseEvent, conversationId: string) => void;
  deleteLabel: string;
}) {
  return (
    <Tooltip title="" placement="right">
      <div
        className={`history-item ${selected ? "active" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => onSelect(conversation.latestTaskId)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect(conversation.latestTaskId); }}
      >
        <span className="history-item-icon">
          <FileGlyph type={conversation.documentType} />
        </span>
        <span className="history-item-title">{conversation.title}</span>
        {isActiveTask(conversation.status) ? (
          <span className="status-spinner" aria-hidden />
        ) : (
          <StatusDot tone={statusTone(conversation.status)} />
        )}
        <button
          className="history-item-delete"
          onClick={(e) => onDelete(e, conversation.conversationId)}
          aria-label={deleteLabel}
        >
          <DeleteOutlined />
        </button>
      </div>
    </Tooltip>
  );
}
