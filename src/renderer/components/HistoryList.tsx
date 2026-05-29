import { useCallback, useEffect, useRef, useState } from "react";
import { DeleteOutlined } from "@ant-design/icons";
import { Tooltip } from "antd";
import type { DesktopTask } from "../../shared/types";
import type { ConversationListItem } from "../taskState";
import { FileGlyph, StatusDot } from "./Shell";
import { useT } from "../i18n";

const PAGE_SIZE = 20;

interface HistoryListProps {
  conversations: ConversationListItem[];
  selectedConversationId: string | undefined;
  collapsed: boolean;
  onSelect: (taskId: string) => void;
  onDelete: (conversationId: string) => void;
}

function statusTone(status: DesktopTask["status"]): "blue" | "green" | "orange" | "red" | "gray" {
  switch (status) {
    case "completed": return "green";
    case "failed": return "red";
    case "running": case "starting": return "blue";
    case "question": return "orange";
    case "cancelled": return "gray";
  }
}

function isActiveTask(status: DesktopTask["status"]): boolean {
  return status === "running" || status === "starting";
}

export function HistoryList({ conversations, selectedConversationId, collapsed, onSelect, onDelete }: HistoryListProps) {
  const t = useT();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [conversations.length]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, conversations.length));
        }
      },
      { root: scrollRef.current, threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [conversations.length]);

  const handleDelete = useCallback(
    (e: React.MouseEvent, conversationId: string) => {
      e.stopPropagation();
      onDelete(conversationId);
    },
    [onDelete],
  );

  if (conversations.length === 0) return null;

  const visible = conversations.slice(0, visibleCount);
  const hasMore = visibleCount < conversations.length;

  return (
    <div className="history-list" ref={scrollRef}>
      <div className="history-list-header">
        {!collapsed && <span className="history-list-title">{t("shell.history.title")}</span>}
      </div>
      <div className="history-list-items">
        {visible.map((conversation) => {
          const isSelected = conversation.conversationId === selectedConversationId;
          return (
            <Tooltip key={conversation.conversationId} title={collapsed ? conversation.title : ""} placement="right">
              <div
                className={`history-item ${isSelected ? "active" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(conversation.latestTaskId)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect(conversation.latestTaskId); }}
              >
                <span className="history-item-icon">
                  <FileGlyph type={conversation.documentType} />
                </span>
                {!collapsed && (
                  <>
                    <span className="history-item-title">{conversation.title}</span>
                    {isActiveTask(conversation.status) ? (
                      <span className="status-spinner" aria-hidden />
                    ) : (
                      <StatusDot tone={statusTone(conversation.status)} />
                    )}
                    <button
                      className="history-item-delete"
                      onClick={(e) => handleDelete(e, conversation.conversationId)}
                      aria-label={t("shell.history.delete")}
                    >
                      <DeleteOutlined />
                    </button>
                  </>
                )}
              </div>
            </Tooltip>
          );
        })}
        {hasMore && <div className="history-sentinel" ref={sentinelRef} />}
      </div>
    </div>
  );
}
