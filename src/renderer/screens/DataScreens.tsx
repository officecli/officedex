import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button, Empty, Input, Table, Tag, Tooltip, Typography, type TableColumn } from "../ui";
import { PlusOutlined } from "../ui/icons";
import type { AgentRun, Artifact, DesktopTask } from "../../shared/types";
import { officecli } from "../bridge";
import { DocTypeIcon } from "../components/DocTypeIcon";
import { isClientToolForThisHost, pendingAgentClientToolEvents, resumeAgentClientTools } from "../AgentClientToolHost";
import { agentClientId } from "../agentClientIdentity";
import { useT } from "../i18n";
import { isExternalAgentRuntimeRun, isHistoricalRuntimeRun } from "../runtimeRuns";

export { isExternalAgentRuntimeRun, isHistoricalRuntimeRun } from "../runtimeRuns";
import { recordValue, trimmedStringValue as stringValue } from "../utils/values";

type Translator = (key: string, vars?: Record<string, string | number>) => string;

type CreditCellState = "empty" | "legacy" | "zero" | "value";

export interface CreditCellModel {
  state: CreditCellState;
  charged: number;
  mode: string;
}

interface TaskRow {
  id: string;
  title: string;
  type: string;
  status: DesktopTask["status"];
  updatedAt: string;
  updatedAtRaw: string;
  credit: CreditCellModel;
  artifact?: Artifact;
  error?: string;
  hint?: string;
}

function formatRelativeTime(iso: string | undefined, t: Translator): { label: string; raw: string } {
  // No timestamp → no meta text at all; "unknown" placeholders are noise.
  if (!iso) return { label: "", raw: "" };
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { label: "", raw: iso };
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return { label: t("tasks.time.justNow"), raw: iso };
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return { label: t("tasks.time.minutesAgo", { count: diffMin }), raw: iso };
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return { label: t("tasks.time.hoursAgo", { count: diffHr }), raw: iso };
  const diffDay = Math.floor(diffHr / 24);
  return { label: t("tasks.time.daysAgo", { count: diffDay }), raw: iso };
}

/**
 * Activity archive: what already happened, plus the credit each run cost.
 * Work that still needs the user lives in the home inbox — this panel is
 * deliberately read-mostly (open a deliverable, clean up failures).
 */
export function ActivityPanel({ tasks, onSelectTask, onOpenArtifact, onViewed }: { tasks: DesktopTask[]; onSelectTask: (taskID: string) => void; onOpenArtifact?: (artifact: Artifact) => void; onViewed?: (visible: boolean) => void }) {
  const t = useT();
  // This panel is mounted only while its settings section is open, so its
  // lifetime *is* "the user is looking at the activity list" — the signal that
  // acknowledges failures. Opening settings for anything else must not clear
  // the sidebar's unseen-failure dot.
  useEffect(() => {
    onViewed?.(true);
    return () => onViewed?.(false);
  }, [onViewed]);
	const [showSettled, setShowSettled] = useState(false);
  const rows = tasks.map((task) => taskToRow(task, t));
  const activeRows = rows.filter((row) => row.status === "starting" || row.status === "running");
  const failedRows = rows.filter((row) => row.status === "failed");
  const settledRows = rows.filter((row) => row.status === "completed" || row.status === "cancelled");
  const rowMeta = (row: TaskRow): string => {
    const parts: string[] = [];
    if (row.hint) parts.push(row.hint);
    if (row.status === "failed" && row.error) parts.push(row.error);
    if (row.updatedAt) parts.push(row.updatedAt);
    if (row.credit.state === "value") parts.push(t("tasks.credit.meta", { amount: row.credit.charged }));
    return parts.join(" · ");
  };
  const renderRows = (groupRows: TaskRow[], options?: { showArtifact?: boolean }) => (
    <div className="task-list">
      {groupRows.map((row) => (
        <div className="task-item" key={row.id}>
          <button type="button" className="task-item__open" onClick={() => onSelectTask(row.id)}>
            <DocTypeIcon type={row.type} chip />
            <span className="task-item__copy">
              <strong>{row.title}</strong>
              {rowMeta(row) ? <small title={row.error ?? undefined}>{rowMeta(row)}</small> : null}
            </span>
          </button>
          <div className="task-item__actions">
            {options?.showArtifact && row.artifact ? (
              <button
                type="button"
                className="task-artifact-link"
                title={row.artifact.filePath}
                onClick={() => onOpenArtifact?.(row.artifact as Artifact)}
              >
                <DocTypeIcon type={row.artifact.documentType} />
                <span>{row.artifact.fileName}</span>
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
  const renderGroup = (title: string, groupRows: TaskRow[], options?: { showArtifact?: boolean; allowDelete?: boolean; headerExtra?: ReactNode }) => groupRows.length === 0 ? null : (
    <section className="task-group" aria-label={title}>
      <div className="task-group__header">
        <h3>{title} <span>{groupRows.length}</span></h3>
        {options?.headerExtra}
      </div>
      {renderRows(groupRows, options)}
    </section>
  );
  return (
    <div className="page-stack">
      {rows.length > 0 ? (
        <>
          {renderGroup(t("tasks.group.active"), activeRows)}
          {renderGroup(t("tasks.group.failed"), failedRows)}
          {settledRows.length > 0 ? (
            <section className="task-group" aria-label={t("tasks.group.settled")}>
              <div className="task-group__header">
                <h3>{t("tasks.group.settled")} <span>{settledRows.length}</span></h3>
                <Button variant="ghost-normal" size="small" onClick={() => setShowSettled((visible) => !visible)}>
                  {showSettled ? t("tasks.group.hide") : t("tasks.group.show")}
                </Button>
              </div>
              {showSettled ? renderRows(settledRows, { showArtifact: true }) : null}
            </section>
          ) : null}
        </>
      ) : (
        <div className="empty-card">
          <Empty description={t("tasks.empty")} />
        </div>
      )}
    </div>
  );
}


function taskToRow(task: DesktopTask, t: Translator): TaskRow {
  const latestEvent = task.events.at(-1);
  const { label, raw } = formatRelativeTime(latestEvent?.ts, t);
  const hint = task.status === "question"
    ? (task.question?.question || t("home.answerRequired"))
    : task.status === "plan_review" ? t("home.planReview") : undefined;
  return {
    id: task.id,
    // Raw task ids are meaningless to people — fall back to a label instead.
    title: task.topic || task.artifact?.fileName || t("tasks.untitled"),
    type: task.documentType || task.artifact?.documentType || "",
    status: task.status,
    updatedAt: label,
    updatedAtRaw: raw,
    credit: creditModel(task),
    artifact: task.artifact,
    error: task.error,
    hint,
  };
}

function creditModel(task: DesktopTask): CreditCellModel {
  if (task.status !== "completed" && task.status !== "failed") {
    return { state: "empty", charged: 0, mode: "" };
  }
  const charged = task.creditCharged;
  const mode = task.creditMode || "";
  if (typeof charged !== "number") {
    return { state: "legacy", charged: 0, mode };
  }
  if (charged === 0) {
    return { state: "zero", charged: 0, mode };
  }
  return { state: "value", charged, mode };
}


function CreditModeBadge({ mode, t }: { mode: string; t: Translator }) {
  const key = `tasks.credit.mode.${mode}`;
  const label = t(key);
  const display = label === key ? mode : label;
  return (
    <Tag className="task-credit-mode" color="default">
      {display}
    </Tag>
  );
}
