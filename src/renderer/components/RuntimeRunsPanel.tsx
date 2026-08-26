import { useCallback, useEffect, useState } from "react";
import { Button, Empty, Table, Tag, Tooltip, type TableColumn } from "../ui";
import type { AgentRun } from "../../shared/types";
import { officecli } from "../bridge";
import { useT } from "../i18n";
import { isExternalAgentRuntimeRun, isHistoricalRuntimeRun, runtimeStatusColor } from "../runtimeRuns";

// Historical (legacy.*) runs are the oldest entries in the append-only store, so
// a small fetch window silently pushes them out of reach. Keep it wide enough
// that history stays reachable instead of being quietly truncated away.
const AGENT_RUN_FETCH_LIMIT = 500;

/**
 * Diagnostics view of workflow runs: observe, cancel, retry. Deliberately does
 * NOT answer prompts or approvals — those are the user's work, and they live in
 * the Tasks page's "needs your attention" group where the user can act on them
 * without visiting a debug surface.
 */
export function RuntimeRunsPanel() {
  const t = useT();
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [error, setError] = useState<string>();
  const [busyRun, setBusyRun] = useState<string>();
  const [showHistorical, setShowHistorical] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setRuns(await officecli.listAgentRuns(AGENT_RUN_FETCH_LIMIT));
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const actOnRun = async (run: AgentRun, action: "cancel" | "retry") => {
    setBusyRun(run.id);
    setError(undefined);
    try {
      if (action === "cancel") await officecli.cancelAgentRun(run.id);
      else await officecli.retryAgentRun(run.id);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyRun(undefined);
    }
  };

  const historicalCount = runs.filter(isHistoricalRuntimeRun).length;
  const visibleRuns = showHistorical ? runs : runs.filter((run) => !isHistoricalRuntimeRun(run));

  const columns: TableColumn<AgentRun>[] = [
    {
      title: t("tasks.runtime.column.workflow"),
      dataIndex: "workflow",
      render: (workflow, run) => (
        <span className="task-title-button">
          <span className="runtime-run-workflow">
            <Tooltip title={run.id}><strong>{workflow}</strong></Tooltip>
            {isHistoricalRuntimeRun(run) ? (
              <Tooltip title={t("tasks.runtime.historical.tooltip")}><Tag color="gray">{t("tasks.runtime.historical.label")}</Tag></Tooltip>
            ) : null}
            {isExternalAgentRuntimeRun(run) ? (
              <Tooltip title={t("tasks.runtime.externalAgent.tooltip")}><Tag color="blue">{t("tasks.runtime.externalAgent.label")}</Tag></Tooltip>
            ) : null}
          </span>
        </span>
      ),
    },
    {
      title: t("tasks.runtime.column.status"),
      dataIndex: "status",
      render: (status: AgentRun["status"]) => <Tag color={runtimeStatusColor(status)}>{status}</Tag>,
    },
    { title: t("tasks.runtime.column.step"), dataIndex: "current_step", render: (step) => step || "—" },
    {
      title: t("tasks.runtime.column.actions"),
      dataIndex: "id",
      render: (_, run) => (
        <div className="runtime-run-actions">
          {["created", "running", "waiting_input", "waiting_approval", "waiting_client_tool", "review_ready"].includes(run.status) ? (
            <Button size="small" loading={busyRun === run.id} onClick={() => void actOnRun(run, "cancel")}>{t("tasks.runtime.cancel")}</Button>
          ) : null}
          {["failed", "cancelled"].includes(run.status) && !isHistoricalRuntimeRun(run) ? (
            <Button size="small" variant="secondary" loading={busyRun === run.id} onClick={() => void actOnRun(run, "retry")}>{t("tasks.runtime.retry")}</Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <section className="runtime-runs" aria-label={t("tasks.runtime.title")}>
      <div className="runtime-runs__header">
        <p>{t("tasks.runtime.subtitle")}</p>
        {historicalCount > 0 ? (
          <Button size="small" variant="secondary" onClick={() => setShowHistorical((current) => !current)}>
            {showHistorical ? t("tasks.runtime.historical.hide") : t("tasks.runtime.historical.show", { count: historicalCount })}
          </Button>
        ) : null}
      </div>
      {visibleRuns.length > 0
        ? <Table rowKey="id" columns={columns} dataSource={visibleRuns} pagination={{ pageSize: 8, showSizeChanger: false }} className="flat-table" />
        : <div className="empty-card"><Empty description={t("tasks.runtime.empty")} /></div>}
      {error ? <div className="runtime-runs__error" role="alert">{error}</div> : null}
    </section>
  );
}
