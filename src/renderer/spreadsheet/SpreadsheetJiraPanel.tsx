import { useEffect, useState } from "react";
import { CheckCircle2, DatabaseZap, Send, Settings } from "lucide-react";
import type { ConfiguredJiraSyncResult, JiraConnectionSummary, JiraSyncResult } from "../../shared/types";
import { confirmAgentApproval, restorePendingAgentInput, unwrapAgentRunResult, waitForAgentRun } from "../agentRuntime";
import { officecli } from "../bridge";
import { Button, TextArea } from "../ui";

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
			  if (!onCreateWorkbook) throw new Error("无法创建 Jira 工作簿，请更新 OfficeDex 后重试。");
			  await onCreateWorkbook(response.result);
			}
			return { sheetName: response.result.sheetName, rows: response.result.fetched };
		  },
		  "workbook.save": async () => {
			if (!await onSave()) throw new Error("Jira 数据已经写入，但工作簿保存失败。请保留当前窗口并重试保存。");
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
	  if (response.status !== "completed" || !response.result) throw new Error(response.message || "当前无法完成这次 Jira 数据请求。");
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
    <section className="spreadsheet-jira-panel" aria-label="Jira Connector">
      <div className="spreadsheet-jira-panel__heading">
        <div><DatabaseZap aria-hidden="true" /><strong>Jira Connector</strong></div>
        <span>Server / Data Center</span>
      </div>
      <p>把 Jira Issue 同步到托管 Sheet，供 App Builder、公式和自动化继续使用。</p>

      {!loading && !connection?.configured ? (
        <div className="spreadsheet-jira-panel__empty">
          <strong>尚未配置 Jira 连接</strong>
          <span>请先在设置 → 连接中保存并测试 Jira。</span>
          {onOpenSettings ? <Button size="small" variant="secondary" icon={<Settings />} onClick={onOpenSettings}>打开连接设置</Button> : null}
        </div>
      ) : null}

      {connection?.configured ? <>
        <div className="spreadsheet-jira-panel__connected">
          <CheckCircle2 aria-hidden="true" />
          <div><strong>已连接 Jira</strong><span>{connection.baseUrl}</span></div>
        </div>
		{clarification ? <div className="spreadsheet-jira-panel__workbook-required" role="status"><strong>需要补充信息</strong><span>{clarification}</span></div> : null}
        <label className="spreadsheet-jira-panel__request"><span>{clarification ? "回答上面的问题" : "告诉我你想获取什么 Jira 数据"}</span><TextArea aria-label="Jira 数据需求" rows={4} value={prompt} placeholder={clarification ? "输入你的回答，OfficeDex 会结合上一轮请求继续处理" : "例如：获取 BUSINESS 项目最近更新的 100 条未完成需求，优先显示高优先级"} onChange={(event) => setPrompt(event.target.value)} onSubmit={() => void sync()} /></label>
        {!workbookReady ? <div className="spreadsheet-jira-panel__workbook-required">
          <strong>将自动创建 Jira 工作簿</strong>
          <span>获取完成后，OfficeDex 会创建并打开一个包含 Jira Issues 的 XLSX 工作簿。</span>
        </div> : null}
        <Button size="small" variant="primary" icon={<Send />} loading={syncing} disabled={!prompt.trim()} onClick={() => void sync()}>{workbookReady ? "获取数据并写入 Sheet" : "获取数据并创建工作簿"}</Button>
      </> : null}

      {loading ? <small>正在读取 Jira 连接……</small> : null}
      {result ? <div className="spreadsheet-jira-panel__result">
        <strong>已获取并保存 {result.fetched} 条 Issue</strong>
        <span>{result.querySummary ? `${result.querySummary}。` : ""}Jira 共匹配 {result.total} 条，本次获取 {result.fetched} 条。现在可直接用此表创建 App。</span>
      </div> : null}
      {error ? <div className="spreadsheet-jira-panel__error" role="alert">{error}</div> : null}
    </section>
  );
}
