import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { officecli } from "../bridge";
import { SpreadsheetJiraPanel } from "./SpreadsheetJiraPanel";

const runtimeTime = "2026-08-13T00:00:00Z";

function mockCompletedJiraRun(response: unknown, includeSave = true) {
  const start = vi.spyOn(officecli, "startAgentRun").mockResolvedValue({ id: "run-jira", workflow: "jira.sync.v1", status: "running", created_at: runtimeTime, updated_at: runtimeTime });
  const states = [
    { id: "run-jira", workflow: "jira.sync.v1", status: "waiting_client_tool" as const, created_at: runtimeTime, updated_at: runtimeTime, events: [{ event_id: "write", type: "client-tool.requested", payload: { call_id: "write", tool: "workbook.write_managed_sheet", arguments: { workflow_result: response } } }] },
    ...(includeSave ? [{ id: "run-jira", workflow: "jira.sync.v1", status: "waiting_client_tool" as const, created_at: runtimeTime, updated_at: runtimeTime, events: [{ event_id: "save", type: "client-tool.requested", payload: { call_id: "save", tool: "workbook.save", arguments: { workflow_result: response } } }] }] : []),
    { id: "run-jira", workflow: "jira.sync.v1", status: "completed" as const, created_at: runtimeTime, updated_at: runtimeTime, result: { result: response, client_tool_results: [] }, events: [] },
  ];
  vi.spyOn(officecli, "getAgentRun").mockImplementation(async () => states.shift() ?? states.at(-1)!);
  vi.spyOn(officecli, "completeAgentClientTool").mockResolvedValue();
  return start;
}

describe("SpreadsheetJiraPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => cleanup());

  it("uses the Jira connection from Settings and writes fetched issues", async () => {
    vi.spyOn(officecli, "getJiraConnection").mockResolvedValue({ configured: true, baseUrl: "https://jira.test", authType: "token" });
    const start = mockCompletedJiraRun({
      status: "completed",
      result: {
      sheetName: "Jira Issues",
      headers: ["Issue Key", "Summary", "OfficeDex Notes"],
      rows: [["OD-1", "Connector MVP", ""]],
      jql: "project = OD ORDER BY updated DESC",
      total: 1,
      fetched: 1,
      truncated: false,
      syncedAt: "2026-08-12T00:00:00Z",
      querySummary: "获取 OD 项目最近更新的 Issue",
      },
    });
    const onWriteSheet = vi.fn(async () => undefined);
    const onSave = vi.fn(async () => true);
    render(<SpreadsheetJiraPanel onWriteSheet={onWriteSheet} onSave={onSave} />);

    expect(await screen.findByText("已连接 Jira")).toBeInTheDocument();
    expect(screen.queryByLabelText("PAT")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Jira 数据需求"), { target: { value: "获取 OD 项目最近更新的 Issue" } });
    fireEvent.click(screen.getByRole("button", { name: "获取数据并写入 Sheet" }));

		await waitFor(() => expect(start).toHaveBeenCalledWith(expect.objectContaining({ workflow: "jira.sync.v1", input: expect.objectContaining({ parameters: { prompt: "获取 OD 项目最近更新的 Issue", maxIssues: 500 } }) })));
		expect(await screen.findByText("已获取并保存 1 条 Issue")).toBeInTheDocument();
    expect(onWriteSheet).toHaveBeenCalledWith(expect.objectContaining({ fetched: 1 }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("starts the sync when Enter is pressed in the prompt", async () => {
    vi.spyOn(officecli, "getJiraConnection").mockResolvedValue({ configured: true, baseUrl: "https://jira.test", authType: "token" });
    const start = mockCompletedJiraRun({
      status: "completed",
      result: {
        sheetName: "Jira Issues",
        headers: ["Issue Key", "Summary"],
        rows: [["OD-1", "Connector MVP"]],
        jql: "project = OD",
        total: 1,
        fetched: 1,
        truncated: false,
        syncedAt: "2026-08-12T00:00:00Z",
      },
    });
    render(<SpreadsheetJiraPanel onWriteSheet={vi.fn(async () => undefined)} onSave={vi.fn(async () => true)} />);

    expect(await screen.findByText("已连接 Jira")).toBeInTheDocument();
    const prompt = screen.getByLabelText("Jira 数据需求");
    fireEvent.change(prompt, { target: { value: "获取我参与的任务" } });
    expect(fireEvent.keyDown(prompt, { key: "Enter" })).toBe(false);

    await waitFor(() => expect(start).toHaveBeenCalledWith(expect.objectContaining({ workflow: "jira.sync.v1" })));
  });

  it("guides users to Settings when Jira is not configured", async () => {
    vi.spyOn(officecli, "getJiraConnection").mockResolvedValue({ configured: false, baseUrl: "", authType: "" });
    const onOpenSettings = vi.fn();
    render(<SpreadsheetJiraPanel onWriteSheet={vi.fn()} onSave={vi.fn(async () => true)} onOpenSettings={onOpenSettings} />);

    expect(await screen.findByText("尚未配置 Jira 连接")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开连接设置" }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("creates a workbook from Jira data when no workbook is open", async () => {
    vi.spyOn(officecli, "getJiraConnection").mockResolvedValue({ configured: true, baseUrl: "https://jira.test", authType: "token" });
    mockCompletedJiraRun({
      status: "completed",
      result: {
      sheetName: "Jira Issues",
      headers: ["Issue Key", "Summary"],
      rows: [["OD-1", "Connector MVP"]],
      jql: "project = OD",
      total: 1,
      fetched: 1,
      truncated: false,
      syncedAt: "2026-08-12T00:00:00Z",
      },
    }, false);
    const onCreateWorkbook = vi.fn(async () => undefined);
    const onWriteSheet = vi.fn(async () => undefined);
    const onSave = vi.fn(async () => true);

    render(<SpreadsheetJiraPanel workbookReady={false} onCreateWorkbook={onCreateWorkbook} onWriteSheet={onWriteSheet} onSave={onSave} />);

    expect(await screen.findByText("将自动创建 Jira 工作簿")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Jira 数据需求"), { target: { value: "获取最近 10 条 open 的 issue" } });
    const syncButton = screen.getByRole("button", { name: "获取数据并创建工作簿" });
    expect(syncButton).toBeEnabled();
    fireEvent.click(syncButton);
    await waitFor(() => expect(onCreateWorkbook).toHaveBeenCalledWith(expect.objectContaining({ fetched: 1 })));
    expect(onWriteSheet).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("reports the requested subset instead of claiming the fixed safety cap", async () => {
	vi.spyOn(officecli, "getJiraConnection").mockResolvedValue({ configured: true, baseUrl: "https://jira.test", authType: "token" });
	mockCompletedJiraRun({
      status: "completed",
      result: {
	  sheetName: "Jira Issues",
	  headers: ["Issue Key", "Summary"],
	  rows: Array.from({ length: 10 }, (_, index) => [`OD-${index + 1}`, `Issue ${index + 1}`]),
	  jql: "assignee = currentUser() ORDER BY updated DESC",
	  total: 247,
	  fetched: 10,
	  truncated: true,
	  syncedAt: "2026-08-13T00:00:00Z",
	  querySummary: "获取我最近更新的 10 条任务",
      },
	});
	render(<SpreadsheetJiraPanel onWriteSheet={vi.fn(async () => undefined)} onSave={vi.fn(async () => true)} />);

	await screen.findByText("已连接 Jira");
	fireEvent.change(screen.getByLabelText("Jira 数据需求"), { target: { value: "获取我最近的 10 条任务" } });
	fireEvent.click(screen.getByRole("button", { name: "获取数据并写入 Sheet" }));

	expect(await screen.findByText("已获取并保存 10 条 Issue")).toBeInTheDocument();
	expect(screen.getByText(/Jira 共匹配 247 条，本次获取 10 条/)).toBeInTheDocument();
	expect(screen.queryByText(/最多写入 500 条/)).not.toBeInTheDocument();
  });

  it("keeps the original request when the validator asks a clarification", async () => {
	vi.spyOn(officecli, "getJiraConnection").mockResolvedValue({ configured: true, baseUrl: "https://jira.test", authType: "token" });
	vi.spyOn(officecli, "startAgentRun").mockResolvedValue({ id: "run-jira-clarify", workflow: "jira.sync.v1", status: "running", created_at: runtimeTime, updated_at: runtimeTime });
	const completedResponse = {
		status: "completed",
		result: {
		  sheetName: "Jira Issues", headers: ["Issue Key"], rows: [["OD-1"]],
		  jql: "assignee = currentUser() ORDER BY updated DESC", total: 1, fetched: 1, truncated: false,
		  syncedAt: "2026-08-13T00:00:00Z", querySummary: "获取我负责的任务",
		},
	};
	const completedRun = {
	  id: "run-jira-clarify", workflow: "jira.sync.v1", status: "completed" as const, created_at: runtimeTime, updated_at: runtimeTime,
	  result: { result: completedResponse },
	  events: [
		{ event_id: "write", type: "client-tool.requested", payload: { call_id: "write", tool: "workbook.write_managed_sheet", arguments: { workflow_result: completedResponse } } },
		{ event_id: "save", type: "client-tool.requested", payload: { call_id: "save", tool: "workbook.save", arguments: { workflow_result: completedResponse } } },
	  ],
	};
	const respond = vi.spyOn(officecli, "respondAgentRun").mockResolvedValue();
	const waitingInputRun = { id: "run-jira-clarify", workflow: "jira.sync.v1", status: "waiting_input" as const, created_at: runtimeTime, updated_at: runtimeTime, events: [{ event_id: "input", type: "input.requested", payload: { request_id: "jira-clarification-1", request: { question: "你说的“我参与的”是指我负责、我创建，还是我关注的任务？" } } }] };
	vi.spyOn(officecli, "getAgentRun").mockImplementation(async () => respond.mock.calls.length ? completedRun : waitingInputRun);
	vi.spyOn(officecli, "completeAgentClientTool").mockResolvedValue();
	const onWriteSheet = vi.fn(async () => undefined);
	render(<SpreadsheetJiraPanel onWriteSheet={onWriteSheet} onSave={vi.fn(async () => true)} />);

	await screen.findByText("已连接 Jira");
	fireEvent.change(screen.getByLabelText("Jira 数据需求"), { target: { value: "获取我参与的任务" } });
	fireEvent.click(screen.getByRole("button", { name: "获取数据并写入 Sheet" }));
	expect(await screen.findByText("需要补充信息")).toBeInTheDocument();
	expect(screen.getByText(/我负责、我创建/)).toBeInTheDocument();
	expect(onWriteSheet).not.toHaveBeenCalled();

	fireEvent.change(screen.getByLabelText("Jira 数据需求"), { target: { value: "我负责的" } });
	fireEvent.click(screen.getByRole("button", { name: "获取数据并写入 Sheet" }));
	await waitFor(() => expect(respond).toHaveBeenCalledWith({ run_id: "run-jira-clarify", request_id: "jira-clarification-1", value: "我负责的" }));
	await waitFor(() => expect(onWriteSheet).toHaveBeenCalledWith(expect.objectContaining({ fetched: 1 })));
  });

  it("stops unsupported requests without turning them into a clarification thread", async () => {
	vi.spyOn(officecli, "getJiraConnection").mockResolvedValue({ configured: true, baseUrl: "https://jira.test", authType: "token" });
	const start = mockCompletedJiraRun({
	  status: "unsupported",
	  message: "当前版本只能搜索 Issue，尚未开放评论读取能力。",
	}, false);
	const onWriteSheet = vi.fn(async () => undefined);
	render(<SpreadsheetJiraPanel onWriteSheet={onWriteSheet} onSave={vi.fn(async () => true)} />);

	await screen.findByText("已连接 Jira");
	fireEvent.change(screen.getByLabelText("Jira 数据需求"), { target: { value: "获取任务以及每条任务的评论" } });
	fireEvent.click(screen.getByRole("button", { name: "获取数据并写入 Sheet" }));

	expect(await screen.findByRole("alert")).toHaveTextContent("尚未开放评论读取能力");
	expect(screen.queryByText("需要补充信息")).not.toBeInTheDocument();
	expect(onWriteSheet).not.toHaveBeenCalled();
	expect(start).toHaveBeenCalledTimes(1);
  });

});
