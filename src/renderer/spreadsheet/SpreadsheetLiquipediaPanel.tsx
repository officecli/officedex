import { useEffect, useState } from "react";
import { CheckCircle2, Globe2, Send, Settings } from "lucide-react";
import type { ConfiguredLiquipediaSyncResult, LiquipediaConnectionSummary, LiquipediaSyncResult } from "../../shared/verticals";
import { confirmAgentApproval, restorePendingAgentInput, unwrapAgentRunResult, waitForAgentRun } from "../agentRuntime";
import { officecli } from "../bridge";
import { Button, TextArea } from "../ui";
import { useT } from "../i18n";

export interface SpreadsheetLiquipediaPanelProps {
  workbookReady?: boolean;
  workbookPath?: string;
  workspaceId?: string;
  onWriteSheet: (result: LiquipediaSyncResult) => Promise<void>;
  onSave: () => Promise<boolean>;
  onCreateWorkbook?: (result: LiquipediaSyncResult) => Promise<void>;
  onOpenSettings?: () => void;
}

export function SpreadsheetLiquipediaPanel({ workbookReady = true, workbookPath, workspaceId, onWriteSheet, onSave, onCreateWorkbook, onOpenSettings }: SpreadsheetLiquipediaPanelProps) {
  const t = useT();
  const [connection, setConnection] = useState<LiquipediaConnectionSummary>();
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<LiquipediaSyncResult>();
  const [clarification, setClarification] = useState<string>();
  const [pendingRun, setPendingRun] = useState<{ runId: string; requestId: string }>();
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string>();

  const loadConnection = async () => {
    setLoading(true); setError(undefined);
    try { setConnection(await officecli.getLiquipediaConnection()); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    void loadConnection();
    const refresh = () => void loadConnection();
    window.addEventListener("officedex:liquipedia-connection-updated", refresh);
    return () => window.removeEventListener("officedex:liquipedia-connection-updated", refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
	useEffect(() => {
		void restorePendingAgentInput("liquipedia.sync.v1", "spreadsheet.liquipedia")
			.then((pending) => {
				if (!pending) return;
				setPendingRun({ runId: pending.runId, requestId: pending.requestId });
				setClarification(pending.question);
			})
			.catch(() => undefined);
	}, []);

  const sync = async () => {
    if (!connection?.configured || !prompt.trim() || syncing) return;
    setSyncing(true); setError(undefined);
    try {
      const userMessage = prompt.trim();
      let runId = pendingRun?.runId;
      if (pendingRun) {
        await officecli.respondAgentRun({ run_id: pendingRun.runId, request_id: pendingRun.requestId, value: userMessage });
        setPendingRun(undefined);
      } else {
        const run = await officecli.startAgentRun({ workflow: "liquipedia.sync.v1", metadata: {
          surface: "spreadsheet.liquipedia",
          ...(workbookPath ? { workbook_path: workbookPath } : {}),
          ...(workspaceId ? { workspace_id: workspaceId } : {}),
        }, input: {
          parameters: { prompt: userMessage, maxRows: 100 },
          client_tools: [
            { tool: "workbook.write_managed_sheet", resource_ref: "active-workbook", risk: "bounded_write" },
            ...(workbookReady ? [{ tool: "workbook.save", resource_ref: "active-workbook", risk: "bounded_write" }] : []),
          ],
        } });
        runId = run.id;
      }
      if (!runId) throw new Error("Liquipedia Runtime did not return a run ID.");
      let writtenResult: LiquipediaSyncResult | undefined;
      const outcome = await waitForAgentRun(runId, { approve: confirmAgentApproval, clientTools: {
        "workbook.write_managed_sheet": async (request) => {
          const response = request.arguments.workflow_result as ConfiguredLiquipediaSyncResult | undefined;
          if (response?.status !== "completed" || !response.result) throw new Error(response?.message || "Liquipedia Runtime did not return Sheet data.");
          writtenResult = response.result;
          if (workbookReady) await onWriteSheet(response.result);
          else {
            if (!onCreateWorkbook) throw new Error(t("settings.connector.createWorkbookError", { name: "Liquipedia" }));
            await onCreateWorkbook(response.result);
          }
          return { sheetName: response.result.sheetName, rows: response.result.fetched };
        },
        "workbook.save": async () => {
          if (!await onSave()) throw new Error(t("settings.connector.saveErrorLiquipedia"));
          return { saved: true };
        },
      } });
      if (outcome.kind === "input") { setPendingRun({ runId: outcome.run.id, requestId: outcome.requestId }); setClarification(outcome.question); setPrompt(""); return; }
      const response = unwrapAgentRunResult<ConfiguredLiquipediaSyncResult>(outcome.run);
      if (response.status !== "completed" || !response.result) throw new Error(response.message || t("settings.connector.requestErrorLiquipedia"));
      setResult(writtenResult ?? response.result); setPendingRun(undefined); setClarification(undefined);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setSyncing(false); }
  };

  return <section className="spreadsheet-jira-panel" aria-label={t("settings.connector.liquipedia.aria")}>
    <div className="spreadsheet-jira-panel__heading"><div><Globe2 aria-hidden="true" /><strong>Liquipedia Dota 2</strong></div><span>MediaWiki API</span></div>
    <p>{t("settings.row.liquipedia.desc")}</p>
    {!loading && !connection?.configured ? <div className="spreadsheet-jira-panel__empty"><strong>{t("settings.connector.liquipediaNotConfigured")}</strong><span>{t("settings.connector.liquipediaConnectionHint")}</span>{onOpenSettings ? <Button size="small" variant="secondary" icon={<Settings />} onClick={onOpenSettings}>{t("settings.connector.openConnection")}</Button> : null}</div> : null}
    {connection?.configured ? <>
      <div className="spreadsheet-jira-panel__connected"><CheckCircle2 aria-hidden="true" /><div><strong>{t("settings.connector.connected", { name: "Liquipedia" })}</strong><span>{connection.baseUrl}</span></div></div>
      {clarification ? <div className="spreadsheet-jira-panel__workbook-required" role="status"><strong>{t("settings.connector.needsInfo")}</strong><span>{clarification}</span></div> : null}
      <label className="spreadsheet-jira-panel__request"><span>{clarification ? t("settings.connector.answerQuestion") : t("settings.connector.liquipedia.requestLabel")}</span><TextArea aria-label={t("settings.connector.liquipedia.requestAria")} rows={4} value={prompt} placeholder={clarification ? t("settings.connector.answerPlaceholder") : t("settings.connector.liquipedia.requestPlaceholder")} onChange={(event) => setPrompt(event.target.value)} onSubmit={() => void sync()} /></label>
      {!workbookReady ? <div className="spreadsheet-jira-panel__workbook-required"><strong>{t("settings.connector.autoCreateWorkbook", { name: "Liquipedia" })}</strong><span>{t("settings.connector.workbookCreated", { name: "Liquipedia" })}</span></div> : null}
      <Button size="small" variant="primary" icon={<Send />} loading={syncing} disabled={!prompt.trim()} onClick={() => void sync()}>{workbookReady ? t("settings.connector.fetchAndWrite") : t("settings.connector.fetchAndCreate")}</Button>
    </> : null}
    {loading ? <small>{t("settings.connector.loading", { name: "Liquipedia" })}</small> : null}
    {result ? <div className="spreadsheet-jira-panel__result"><strong>{t("settings.connector.resultLiquipedia", { count: result.fetched })}</strong><span>{result.querySummary ? `${result.querySummary}. ` : ""}{t("settings.connector.resultSummaryGeneric", { total: result.total, count: result.fetched })} {result.attribution}</span></div> : null}
    {error ? <div className="spreadsheet-jira-panel__error" role="alert">{error}</div> : null}
  </section>;
}
