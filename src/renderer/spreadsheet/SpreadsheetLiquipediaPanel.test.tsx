import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { officecli } from "../bridge";
import { SpreadsheetLiquipediaPanel } from "./SpreadsheetLiquipediaPanel";

const result = { sheetName: "Liquipedia Tournaments", headers: ["Tournament", "Source URL"], rows: [["Future Cup", "https://liquipedia.net/dota2/Future"]], total: 20, fetched: 1, truncated: true, syncedAt: "2026-08-13T00:00:00Z", querySummary: "获取即将开始的 1 场赛事", attribution: "Source: Liquipedia (CC BY-SA 3.0)" };
const runtimeTime = "2026-08-13T00:00:00Z";

function mockLiquipediaRun(includeSave = true) {
  const response = { status: "completed" as const, result };
  const start = vi.spyOn(officecli, "startAgentRun").mockResolvedValue({ id: "run-liquipedia", workflow: "liquipedia.sync.v1", status: "running", created_at: runtimeTime, updated_at: runtimeTime });
  const states = [
    { id: "run-liquipedia", workflow: "liquipedia.sync.v1", status: "waiting_client_tool" as const, created_at: runtimeTime, updated_at: runtimeTime, events: [{ event_id: "write", type: "client-tool.requested", payload: { call_id: "write", tool: "workbook.write_managed_sheet", arguments: { workflow_result: response } } }] },
    ...(includeSave ? [{ id: "run-liquipedia", workflow: "liquipedia.sync.v1", status: "waiting_client_tool" as const, created_at: runtimeTime, updated_at: runtimeTime, events: [{ event_id: "save", type: "client-tool.requested", payload: { call_id: "save", tool: "workbook.save", arguments: { workflow_result: response } } }] }] : []),
    { id: "run-liquipedia", workflow: "liquipedia.sync.v1", status: "completed" as const, created_at: runtimeTime, updated_at: runtimeTime, result: { result: response }, events: [] },
  ];
  vi.spyOn(officecli, "getAgentRun").mockImplementation(async () => states.shift()!);
  vi.spyOn(officecli, "completeAgentClientTool").mockResolvedValue();
  return start;
}

describe("SpreadsheetLiquipediaPanel", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => cleanup());

  it("uses natural language and saves a managed Sheet", async () => {
    vi.spyOn(officecli, "getLiquipediaConnection").mockResolvedValue({ configured: true, baseUrl: "https://liquipedia.net/dota2", contact: "dev@example.com" });
		const start = mockLiquipediaRun();
    const onWriteSheet = vi.fn(async () => undefined); const onSave = vi.fn(async () => true);
    render(<SpreadsheetLiquipediaPanel onWriteSheet={onWriteSheet} onSave={onSave} />);
    expect(await screen.findByText("已连接 Liquipedia")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Liquipedia 数据需求"), { target: { value: "获取即将开始的 1 场赛事" } });
    fireEvent.click(screen.getByRole("button", { name: "获取数据并写入 Sheet" }));
		await waitFor(() => expect(start).toHaveBeenCalledWith(expect.objectContaining({ workflow: "liquipedia.sync.v1", input: expect.objectContaining({ parameters: { prompt: "获取即将开始的 1 场赛事", maxRows: 100 } }) })));
		expect(await screen.findByText("已获取并保存 1 条数据")).toBeInTheDocument();
    expect(onWriteSheet).toHaveBeenCalledWith(result); expect(onSave).toHaveBeenCalledOnce();
    expect(screen.getByText(/CC BY-SA 3.0/)).toBeInTheDocument();
  });

  it("creates a workbook when none is open", async () => {
    vi.spyOn(officecli, "getLiquipediaConnection").mockResolvedValue({ configured: true, baseUrl: "https://liquipedia.net/dota2" });
		mockLiquipediaRun(false);
    const onCreateWorkbook = vi.fn(async () => undefined); const onSave = vi.fn(async () => true);
    render(<SpreadsheetLiquipediaPanel workbookReady={false} onCreateWorkbook={onCreateWorkbook} onWriteSheet={vi.fn()} onSave={onSave} />);
    expect(await screen.findByText("将自动创建工作簿")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Liquipedia 数据需求"), { target: { value: "获取即将开始的 1 场赛事" } });
    fireEvent.click(screen.getByRole("button", { name: "获取数据并创建工作簿" }));
    await waitFor(() => expect(onCreateWorkbook).toHaveBeenCalledWith(result)); expect(onSave).not.toHaveBeenCalled();
  });

  it("opens connection settings when not configured", async () => {
    vi.spyOn(officecli, "getLiquipediaConnection").mockResolvedValue({ configured: false, baseUrl: "https://liquipedia.net/dota2" });
    const onOpenSettings = vi.fn(); render(<SpreadsheetLiquipediaPanel onWriteSheet={vi.fn()} onSave={vi.fn(async () => true)} onOpenSettings={onOpenSettings} />);
    expect(await screen.findByText("尚未配置 Liquipedia 连接")).toBeInTheDocument(); fireEvent.click(screen.getByRole("button", { name: "打开连接设置" })); expect(onOpenSettings).toHaveBeenCalledOnce();
  });
});
