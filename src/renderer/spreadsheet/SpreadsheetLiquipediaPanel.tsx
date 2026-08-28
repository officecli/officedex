import { useEffect, useState } from "react";
import { CheckCircle2, Globe2, Send, Settings } from "lucide-react";
import type { ConfiguredLiquipediaSyncResult, LiquipediaConnectionSummary, LiquipediaSyncResult } from "../../shared/types";
import { confirmAgentApproval, restorePendingAgentInput, unwrapAgentRunResult, waitForAgentRun } from "../agentRuntime";
import { officecli } from "../bridge";
import { Button, TextArea } from "../ui";

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
            if (!onCreateWorkbook) throw new Error("无法创建 Liquipedia 工作簿，请更新 OfficeDex 后重试。");
            await onCreateWorkbook(response.result);
          }
          return { sheetName: response.result.sheetName, rows: response.result.fetched };
        },
        "workbook.save": async () => {
          if (!await onSave()) throw new Error("Liquipedia 数据已经写入，但工作簿保存失败。请保留当前窗口并重试保存。");
          return { saved: true };
        },
      } });
      if (outcome.kind === "input") { setPendingRun({ runId: outcome.run.id, requestId: outcome.requestId }); setClarification(outcome.question); setPrompt(""); return; }
      const response = unwrapAgentRunResult<ConfiguredLiquipediaSyncResult>(outcome.run);
      if (response.status !== "completed" || !response.result) throw new Error(response.message || "当前无法完成这次 Liquipedia 数据请求。");
      setResult(writtenResult ?? response.result); setPendingRun(undefined); setClarification(undefined);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setSyncing(false); }
  };

  return <section className="spreadsheet-jira-panel" aria-label="Liquipedia Connector">
    <div className="spreadsheet-jira-panel__heading"><div><Globe2 aria-hidden="true" /><strong>Liquipedia Dota 2</strong></div><span>MediaWiki API</span></div>
    <p>用自然语言获取 Dota 2 赛事与版本更新，写入托管 Sheet 作为后续 App、公式和自动化的数据源。</p>
    {!loading && !connection?.configured ? <div className="spreadsheet-jira-panel__empty"><strong>尚未配置 Liquipedia 连接</strong><span>请先在设置 → 连接中填写合规联系方式并测试 API。</span>{onOpenSettings ? <Button size="small" variant="secondary" icon={<Settings />} onClick={onOpenSettings}>打开连接设置</Button> : null}</div> : null}
    {connection?.configured ? <>
      <div className="spreadsheet-jira-panel__connected"><CheckCircle2 aria-hidden="true" /><div><strong>已连接 Liquipedia</strong><span>{connection.baseUrl}</span></div></div>
      {clarification ? <div className="spreadsheet-jira-panel__workbook-required" role="status"><strong>需要补充信息</strong><span>{clarification}</span></div> : null}
      <label className="spreadsheet-jira-panel__request"><span>{clarification ? "回答上面的问题" : "告诉我你想获取什么 Dota 2 数据"}</span><TextArea aria-label="Liquipedia 数据需求" rows={4} value={prompt} placeholder={clarification ? "输入回答，OfficeDex 会结合上一轮请求继续处理" : "例如：获取正在进行和即将开始的 20 场 Dota 2 赛事"} onChange={(event) => setPrompt(event.target.value)} onSubmit={() => void sync()} /></label>
      {!workbookReady ? <div className="spreadsheet-jira-panel__workbook-required"><strong>将自动创建工作簿</strong><span>获取完成后，OfficeDex 会创建并打开包含 Liquipedia 托管 Sheet 的 XLSX。</span></div> : null}
      <Button size="small" variant="primary" icon={<Send />} loading={syncing} disabled={!prompt.trim()} onClick={() => void sync()}>{workbookReady ? "获取数据并写入 Sheet" : "获取数据并创建工作簿"}</Button>
    </> : null}
    {loading ? <small>正在读取 Liquipedia 连接……</small> : null}
    {result ? <div className="spreadsheet-jira-panel__result"><strong>已获取并保存 {result.fetched} 条数据</strong><span>{result.querySummary ? `${result.querySummary}。` : ""}共匹配 {result.total} 条，本次获取 {result.fetched} 条。{result.attribution}</span></div> : null}
    {error ? <div className="spreadsheet-jira-panel__error" role="alert">{error}</div> : null}
  </section>;
}
