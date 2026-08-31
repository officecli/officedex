import { useEffect, useState } from "react";
import { CheckCircle2, DatabaseZap, Send, Settings } from "lucide-react";
import type { ConfiguredJiraSyncResult, JiraConnectionSummary, JiraSyncResult } from "../../shared/types";
import { confirmAgentApproval, restorePendingAgentInput, unwrapAgentRunResult, waitForAgentRun } from "../agentRuntime";
import { officecli } from "../bridge";
import { Button, TextArea } from "../ui";
import { useT } from "../i18n";

export interface SpreadsheetJiraPanelProps {
  workbookReady?: boolean;
  workbookPath?: string;
  workspaceId?: string;
  onWriteSheet: (result: JiraSyncResult) => Promise<void>;
  onSave: () => Promise<boolean>;
  onCreateWorkbook?: (result: JiraSyncResult) => Promise<void>;
  onOpenSettings?: () => void;
}

export function SpreadsheetJiraPanel({ workbookReady = true, workbookPath, workspaceId, onWriteSheet, onSave, onCreateWorkbook, onOpenSettings }: SpreadsheetJiraPanelProps) {
  const t = useT();
  const [connection, setConnection] = useState<JiraConnectionSummary>();
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<JiraSyncResult>();
	const [clarification, setClarification] = useState<string>();
	const [pendingRun, setPendingRun] = useState<{ runId: string; requestId: string }>();
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string>();

  const loadConnection = async () => {
    setLoading(true);
    setError(undefined);
    try {
      const summary = await officecli.getJiraConnection();
      setConnection(summary);
      if (!summary.configured) {
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConnection();
    const handleSettingsUpdated = () => void loadConnection();
    window.addEventListener("officedex:jira-connection-updated", handleSettingsUpdated);
    return () => window.removeEventListener("officedex:jira-connection-updated", handleSettingsUpdated);
    // Load once on mount; explicit connection events refresh the panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

	useEffect(() => {
		void restorePendingAgentInput("jira.sync.v1", "spreadsheet.jira")
			.then((pending) => {
				if (!pending) return;
				setPendingRun({ runId: pending.runId, requestId: pending.requestId });
				setClarification(pending.question);
			})
			.catch(() => undefined);
	}, []);

  const sync = async () => {
    if (!connection?.configured || !prompt.trim() || syncing) return;
    setSyncing(true);
    setError(undefined);
	try {
	  const userMessage = prompt.trim();
	  let runId = pendingRun?.runId;
	  if (pendingRun) {
		await officecli.respondAgentRun({ run_id: pendingRun.runId, request_id: pendingRun.requestId, value: userMessage });
		setPendingRun(undefined);
	  } else {
		const run = await officecli.startAgentRun({
		  workflow: "jira.sync.v1",
			  metadata: {
				surface: "spreadsheet.jira",
				...(workbookPath ? { workbook_path: workbookPath } : {}),
				...(workspaceId ? { workspace_id: workspaceId } : {}),
			  },
		  input: {
			parameters: { prompt: userMessage, maxIssues: 500 },
			client_tools: [
			  { tool: "workbook.write_managed_sheet", resource_ref: "active-workbook", risk: "bounded_write" },
			  ...(workbookReady ? [{ tool: "workbook.save", resource_ref: "active-workbook", risk: "bounded_write" }] : []),
			],
		  },
		});
		runId = run.id;
	  }
	  if (!runId) throw new Error("Jira Runtime did not return a run ID.");
	  let writtenResult: JiraSyncResult | undefined;
	  const outcome = await waitForAgentRun(runId, {
		approve: confirmAgentApproval,
		clientTools: {
		  "workbook.write_managed_sheet": async (request) => {
			const response = request.arguments.workflow_result as ConfiguredJiraSyncResult | undefined;
			if (response?.status !== "completed" || !response.result) throw new Error(response?.message || "Jira Runtime did not return Sheet data.");
			writtenResult = response.result;
			if (workbookReady) await onWriteSheet(response.result);
			else {
			  if (!onCreateWorkbook) throw new Error(t("settings.connector.createWorkbookError", { name: "Jira" }));
			  await onCreateWorkbook(response.result);
			}
			return { sheetName: response.result.sheetName, rows: response.result.fetched };
		  },
		  "workbook.save": async () => {
			if (!await onSave()) throw new Error(t("settings.connector.saveErrorJira"));
			return { saved: true };
		  },
		},
	  });
	  if (outcome.kind === "input") {
		setPendingRun({ runId: outcome.run.id, requestId: outcome.requestId });
		setClarification(outcome.question);
		setPrompt("");
		return;
	  }
	  const response = unwrapAgentRunResult<ConfiguredJiraSyncResult>(outcome.run);
	  if (response.status !== "completed" || !response.result) throw new Error(response.message || t("settings.connector.requestErrorJira"));
	  const next = writtenResult ?? response.result;
	  setResult(next);
	  setPendingRun(undefined);
	  setClarification(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <section className="spreadsheet-jira-panel" aria-label={t("settings.connector.jira.aria")}>
      <div className="spreadsheet-jira-panel__heading">
        <div><DatabaseZap aria-hidden="true" /><strong>Jira Connector</strong></div>
        <span>Server / Data Center</span>
      </div>
      <p>{t("settings.row.jira.desc")}</p>

      {!loading && !connection?.configured ? (
        <div className="spreadsheet-jira-panel__empty">
          <strong>{t("settings.connector.notConfigured")}</strong>
          <span>{t("settings.connector.connectionHint")}</span>
          {onOpenSettings ? <Button size="small" variant="secondary" icon={<Settings />} onClick={onOpenSettings}>{t("settings.connector.openConnection")}</Button> : null}
        </div>
      ) : null}

      {connection?.configured ? <>
        <div className="spreadsheet-jira-panel__connected">
          <CheckCircle2 aria-hidden="true" />
          <div><strong>{t("settings.connector.connected", { name: "Jira" })}</strong><span>{connection.baseUrl}</span></div>
        </div>
		{clarification ? <div className="spreadsheet-jira-panel__workbook-required" role="status"><strong>{t("settings.connector.needsInfo")}</strong><span>{clarification}</span></div> : null}
		        <label className="spreadsheet-jira-panel__request"><span>{clarification ? t("settings.connector.answerQuestion") : t("settings.connector.jira.requestLabel")}</span><TextArea aria-label={t("settings.connector.jira.requestAria")} rows={4} value={prompt} placeholder={clarification ? t("settings.connector.answerPlaceholder") : t("settings.connector.jira.requestPlaceholder")} onChange={(event) => setPrompt(event.target.value)} onSubmit={() => void sync()} /></label>
        {!workbookReady ? <div className="spreadsheet-jira-panel__workbook-required">
          <strong>{t("settings.connector.autoCreateWorkbook", { name: "Jira" })}</strong>
          <span>{t("settings.connector.workbookCreated", { name: "Jira Issues" })}</span>
        </div> : null}
        <Button size="small" variant="primary" icon={<Send />} loading={syncing} disabled={!prompt.trim()} onClick={() => void sync()}>{workbookReady ? t("settings.connector.fetchAndWrite") : t("settings.connector.fetchAndCreate")}</Button>
      </> : null}

      {loading ? <small>{t("settings.connector.loading", { name: "Jira" })}</small> : null}
      {result ? <div className="spreadsheet-jira-panel__result">
        <strong>{t("settings.connector.resultJira", { count: result.fetched })}</strong>
        <span>{result.querySummary ? `${result.querySummary}. ` : ""}{t("settings.connector.resultSummaryJira", { total: result.total, count: result.fetched })}</span>
      </div> : null}
      {error ? <div className="spreadsheet-jira-panel__error" role="alert">{error}</div> : null}
    </section>
  );
}
