import { useCallback, useEffect, useRef, useState } from "react";
import { DeleteOutlined } from "@ant-design/icons";
import { Tooltip } from "antd";
import type { DesktopTask } from "../../shared/types";
import { FileGlyph, StatusDot } from "./Shell";
import { useT } from "../i18n";

const PAGE_SIZE = 20;

interface HistoryListProps {
  tasks: DesktopTask[];
  selectedTaskId: string | undefined;
  collapsed: boolean;
  onSelect: (taskId: string) => void;
  onDelete: (taskId: string) => void;
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

export function HistoryList({ tasks, selectedTaskId, collapsed, onSelect, onDelete }: HistoryListProps) {
  const t = useT();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [tasks.length]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, tasks.length));
        }
      },
      { root: scrollRef.current, threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [tasks.length]);

  const handleDelete = useCallback(
    (e: React.MouseEvent, taskId: string) => {
      e.stopPropagation();
      onDelete(taskId);
    },
    [onDelete],
  );

  if (tasks.length === 0) return null;

  const visible = tasks.slice(0, visibleCount);
  const hasMore = visibleCount < tasks.length;

  return (
    <div className="history-list" ref={scrollRef}>
      <div className="history-list-header">
        {!collapsed && <span className="history-list-title">{t("shell.history.title")}</span>}
      </div>
      <div className="history-list-items">
        {visible.map((task) => {
          const title = task.topic || task.artifact?.fileName || task.id;
          const isSelected = task.id === selectedTaskId;
          return (
            <Tooltip key={task.id} title={collapsed ? title : ""} placement="right">
              <div
                className={`history-item ${isSelected ? "active" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(task.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect(task.id); }}
              >
                <span className="history-item-icon">
                  <FileGlyph type={task.documentType} />
                </span>
                {!collapsed && (
                  <>
                    <span className="history-item-title">{title}</span>
                    <StatusDot tone={statusTone(task.status)} />
                    <button
                      className="history-item-delete"
                      onClick={(e) => handleDelete(e, task.id)}
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
