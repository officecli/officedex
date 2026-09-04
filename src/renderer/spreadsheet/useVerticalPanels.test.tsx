import { render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreditStatus } from "../../shared/types";
import { LocaleProvider } from "../i18n";
import { useVerticalPanels, type VerticalPanelsDeps } from "./useVerticalPanels";

// The four panels are separate products; this hook is only their wiring, so
// the panels are replaced by prop recorders.
const captured: Record<string, Record<string, unknown>> = {};
vi.mock("./SpreadsheetCatalogCleanupPanel", () => ({ SpreadsheetCatalogCleanupPanel: (props: Record<string, unknown>) => { captured.catalog = props; return null; } }));
vi.mock("./SpreadsheetJiraPanel", () => ({ SpreadsheetJiraPanel: (props: Record<string, unknown>) => { captured.jira = props; return null; } }));
vi.mock("./SpreadsheetLiquipediaPanel", () => ({ SpreadsheetLiquipediaPanel: (props: Record<string, unknown>) => { captured.liquipedia = props; return null; } }));
vi.mock("./SpreadsheetMarketingPanel", () => ({ SpreadsheetMarketingPanel: (props: Record<string, unknown>) => { captured.marketing = props; return null; } }));
vi.mock("../bridge", () => ({
  officecli: {
    createWorkbookFromSheet: vi.fn(async () => ({ filePath: "/ws/Jira Issues.xlsx", fileName: "Jira Issues.xlsx", documentType: "xlsx" })),
    planSpreadsheetFields: vi.fn(async () => ({})),
  },
}));

const { officecli } = await import("../bridge");
const createWorkbookFromSheet = officecli.createWorkbookFromSheet as unknown as ReturnType<typeof vi.fn>;

const wrapper = ({ children }: { children: ReactNode }) => <LocaleProvider value="en">{children}</LocaleProvider>;

function deps(overrides: Partial<VerticalPanelsDeps> = {}, session: Partial<VerticalPanelsDeps["spreadsheet"]["session"]> = {}): VerticalPanelsDeps {
  return {
    spreadsheet: {
      session: { artifact: undefined, workspaceId: "ws-1", phase: "idle", grant: undefined, dirty: false, ...session },
      openArtifact: vi.fn(async () => undefined),
    } as unknown as VerticalPanelsDeps["spreadsheet"],
    spreadsheetWorkspaceRef: { current: null },
    spreadsheetPreferredTool: "assistant",
    catalogAutoScanFile: undefined,
    tasks: {},
    recentFiles: [],
    creditStatus: null,
    bridgeInterruptionKey: 0,
    refreshRecentFiles: vi.fn(async () => undefined),
    setActiveNav: vi.fn(),
    startSpreadsheetMarketingImage: vi.fn(async () => ({ taskId: "t" })),
    ...overrides,
  };
}

function mountPanels(d: VerticalPanelsDeps) {
  const { result } = renderHook(() => useVerticalPanels(d), { wrapper });
  render(<>{result.current.catalogPanel}{result.current.jiraPanel}{result.current.liquipediaPanel}{result.current.marketingPanel}</>, { wrapper });
  return result.current;
}

describe("useVerticalPanels", () => {
  beforeEach(() => { for (const key of Object.keys(captured)) delete captured[key]; createWorkbookFromSheet.mockClear(); });
  afterEach(() => vi.clearAllMocks());

  it("shows the catalog panel only once a workbook is open", () => {
    const panels = mountPanels(deps());
    expect(panels.catalogPanel).toBeUndefined();
    expect(captured.jira?.workbookReady).toBe(false);

    mountPanels(deps({}, { artifact: { filePath: "/ws/a.xlsx", fileName: "a.xlsx", documentType: "xlsx" } as never, phase: "ready" }));
    expect(captured.catalog?.filePath).toBe("/ws/a.xlsx");
    expect(captured.jira?.workbookReady).toBe(true);
  });

  it("auto-scans the catalog only for the file the user asked to clean, once the workbook is ready", () => {
    const artifact = { filePath: "/ws/a.xlsx", fileName: "a.xlsx", documentType: "xlsx" } as never;
    mountPanels(deps({ spreadsheetPreferredTool: "catalog", catalogAutoScanFile: "/ws/a.xlsx" }, { artifact, phase: "ready" }));
    expect(captured.catalog?.autoScan).toBe(true);
    mountPanels(deps({ spreadsheetPreferredTool: "catalog", catalogAutoScanFile: "/ws/other.xlsx" }, { artifact, phase: "ready" }));
    expect(captured.catalog?.autoScan).toBe(false);
    mountPanels(deps({ spreadsheetPreferredTool: "catalog", catalogAutoScanFile: "/ws/a.xlsx" }, { artifact, phase: "loading" }));
    expect(captured.catalog?.autoScan).toBe(false);
  });

  it("refuses workbook writes while the editor is not mounted, with the same message for every connector", async () => {
    mountPanels(deps({}, { artifact: { filePath: "/ws/a.xlsx", fileName: "a.xlsx", documentType: "xlsx" } as never, phase: "ready" }));
    const result = { sheetName: "Issues", headers: [], rows: [], fetched: 0 };
    const jira = (captured.jira.onWriteSheet as (r: unknown) => Promise<unknown>)(result);
    const liquipedia = (captured.liquipedia.onWriteSheet as (r: unknown) => Promise<unknown>)(result);
    const marketing = (captured.marketing.onSetStatus as (b: unknown, i: number, s: string) => Promise<unknown>)({}, 0, "done");
    const messages = await Promise.all([jira, liquipedia, marketing].map((p) => p.then(() => "resolved", (e: Error) => e.message)));
    expect(new Set(messages).size).toBe(1);
    expect(messages[0]).not.toBe("resolved");
    expect(await (captured.jira.onSave as () => Promise<boolean>)()).toBe(false);
  });

  it("creates a workbook from a synced sheet and then opens it", async () => {
    const d = deps();
    mountPanels(d);
    await (captured.jira.onCreateWorkbook as (r: unknown) => Promise<void>)({ sheetName: "Issues", headers: ["Key"], rows: [["A-1"]] });
    expect(createWorkbookFromSheet).toHaveBeenCalledWith({ fileName: "Jira Issues.xlsx", sheetName: "Issues", headers: ["Key"], rows: [["A-1"]], workspaceId: "ws-1" });
    expect(d.spreadsheet.openArtifact).toHaveBeenCalledWith(expect.objectContaining({ fileName: "Jira Issues.xlsx" }));
    expect(d.refreshRecentFiles).toHaveBeenCalledWith("ws-1");

    await (captured.liquipedia.onCreateWorkbook as (r: unknown) => Promise<void>)({ sheetName: "Liquipedia Updates", headers: [], rows: [] });
    expect(createWorkbookFromSheet).toHaveBeenLastCalledWith(expect.objectContaining({ fileName: "Liquipedia Updates.xlsx" }));
  });

  it("shows the credit balance that applies to the account mode", () => {
    const balance = (creditStatus: unknown) => {
      mountPanels(deps({ creditStatus: creditStatus as CreditStatus | null }));
      return captured.marketing?.creditBalance;
    };
    expect(balance(null)).toBeNull();
    expect(balance({ mode: "api_key", paidKeyRemaining: 12 })).toBe(12);
    expect(balance({ mode: "hosted", hostedCreditBalance: 7 })).toBe(7);
    expect(balance({ mode: "anonymous", anonymousCreditAvailable: 3 })).toBe(3);
  });
});
