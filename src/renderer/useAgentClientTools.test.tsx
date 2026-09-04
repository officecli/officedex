import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRun, Artifact } from "../shared/types";
import { AgentClientToolDeferredError } from "./AgentClientToolHost";
import { LocaleProvider } from "./i18n";
import { useAgentClientTools, type AgentClientToolsDeps } from "./useAgentClientTools";

vi.mock("./bridge", () => ({
  officecli: {
    openRecentFile: vi.fn(async (file: { filePath: string; documentType: string }) => ({ filePath: file.filePath, fileName: file.filePath, documentType: file.documentType })),
    issuePreviewToken: vi.fn(async () => ({ token: "grant-2" })),
    revokePreviewToken: vi.fn(async () => undefined),
    createWorkbookFromSheet: vi.fn(),
  },
}));
vi.mock("./activeEditorClientTools", () => ({
  waitForActiveEditorSurface: vi.fn(async () => true),
  executeActiveEditorClientTool: vi.fn(async () => ({ saved: true })),
}));
vi.mock("./ui", () => ({ toast: { error: vi.fn(async () => undefined) } }));

const { officecli } = await import("./bridge");
const { toast } = await import("./ui");
const { waitForActiveEditorSurface } = await import("./activeEditorClientTools");

const wrapper = ({ children }: { children: ReactNode }) => <LocaleProvider value="en">{children}</LocaleProvider>;
const run = (metadata: Record<string, string> = {}): AgentRun => ({ id: "run-1", metadata } as unknown as AgentRun);
const pptx: Artifact = { filePath: "/docs/deck.pptx", fileName: "deck.pptx", documentType: "pptx" } as Artifact;

function mount(overrides: Partial<AgentClientToolsDeps> = {}, session: Record<string, unknown> = {}) {
  const deps: AgentClientToolsDeps = {
    spreadsheet: { session: { artifact: undefined, grant: undefined, dirty: false, workspaceId: "ws-1", ...session }, openArtifact: vi.fn() } as unknown as AgentClientToolsDeps["spreadsheet"],
    previewArtifact: null,
    previewGrant: null,
    spreadsheetWorkspaceRef: { current: null },
    refreshRecentFiles: vi.fn(async () => undefined),
    setSpreadsheetEntry: vi.fn(),
    setPreviewArtifact: vi.fn(),
    setPreviewGrant: vi.fn(),
    setSpreadsheetPreferredTool: vi.fn(),
    setCatalogAutoScanFile: vi.fn(),
    setActiveNav: vi.fn(),
    ...overrides,
  };
  const { result } = renderHook(() => useAgentClientTools(deps), { wrapper });
  return { tools: result.current, deps };
}

describe("useAgentClientTools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("defers an editor tool while a different document type is showing", async () => {
    const { tools } = mount({ previewArtifact: { ...pptx, documentType: "docx", filePath: "/docs/a.docx" } as Artifact });
    await expect(tools.routeToSurface("pptx-editor", run({ source_path: "/docs/deck.pptx" }))).rejects.toBeInstanceOf(AgentClientToolDeferredError);
    expect(officecli.openRecentFile).not.toHaveBeenCalled();
  });

  it("opens the editor's source document when nothing is open, and defers when another one is", async () => {
    const { tools, deps } = mount();
    await tools.routeToSurface("pptx-editor", run({ source_path: "/docs/deck.pptx" }));
    expect(officecli.openRecentFile).toHaveBeenCalledWith(expect.objectContaining({ filePath: "/docs/deck.pptx", documentType: "pptx" }));
    expect(deps.setPreviewArtifact).toHaveBeenCalledWith(expect.objectContaining({ filePath: "/docs/deck.pptx" }));
    expect(deps.setPreviewGrant).toHaveBeenCalledWith({ token: "grant-2" });
    expect(waitForActiveEditorSurface).toHaveBeenCalledWith("pptx-editor");

    const other = mount({ previewArtifact: { ...pptx, filePath: "/docs/other.pptx" } });
    await expect(other.tools.routeToSurface("pptx-editor", run({ source_path: "/docs/deck.pptx" }))).rejects.toBeInstanceOf(AgentClientToolDeferredError);
  });

  it("defers a spreadsheet surface that names no workbook when none is open", async () => {
    const { tools, deps } = mount();
    await expect(tools.routeToSurface("spreadsheet", run())).rejects.toBeInstanceOf(AgentClientToolDeferredError);
    expect(deps.setActiveNav).not.toHaveBeenCalled();
  });

  it("lets a connector that creates its own workbook start from an empty page", async () => {
    const { tools, deps } = mount({ spreadsheetWorkspaceRef: { current: {} as never } });
    await tools.routeToSurface("spreadsheet.jira", run());
    expect(deps.setSpreadsheetPreferredTool).toHaveBeenCalledWith("jira");
    expect(deps.setCatalogAutoScanFile).toHaveBeenCalledWith(undefined);
    expect(deps.setActiveNav).toHaveBeenCalledWith("spreadsheet");
  });

  it("refuses to switch away from a workbook with unsaved edits", async () => {
    const { tools } = mount({}, { artifact: { filePath: "/ws/a.xlsx" }, grant: { token: "g1" }, dirty: true });
    await expect(tools.routeToSurface("spreadsheet", run({ workbook_path: "/ws/b.xlsx" }))).rejects.toBeInstanceOf(AgentClientToolDeferredError);
    expect(officecli.openRecentFile).not.toHaveBeenCalled();
  });

  it("swaps to the requested workbook and revokes the previous grant", async () => {
    const workspace = { openAppBuilder: vi.fn() };
    const { tools, deps } = mount({ spreadsheetWorkspaceRef: { current: workspace as never } }, { artifact: { filePath: "/ws/a.xlsx" }, grant: { token: "g1" }, dirty: false });
    await tools.routeToSurface("app-builder", run({ workbook_path: "/ws/b.xlsx", workspace_id: "ws-9" }));
    expect(deps.setSpreadsheetEntry).toHaveBeenCalledWith(expect.objectContaining({ kind: "artifact", workspaceId: "ws-9", grant: { token: "grant-2" } }));
    expect(officecli.revokePreviewToken).toHaveBeenCalledWith("g1");
    expect(workspace.openAppBuilder).toHaveBeenCalled();
  });

  it("routes workbook tools to the mounted editor and defers them before it mounts", async () => {
    const workspace = { readSelection: vi.fn(async () => ({ range: "A1" })), save: vi.fn(async () => false) };
    const { tools } = mount({ spreadsheetWorkspaceRef: { current: workspace as never } });
    const request = { tool: "workbook.read_selection", arguments: {} } as never;
    await expect(tools.surfaces["spreadsheet"]["workbook.read_selection"]!(request)).resolves.toEqual({ range: "A1" });
    await expect(tools.surfaces["spreadsheet"]["workbook.save"]!(request)).rejects.toThrow();

    const unmounted = mount();
    await expect(unmounted.tools.surfaces["spreadsheet"]["workbook.read_selection"]!(request)).rejects.toBeInstanceOf(AgentClientToolDeferredError);
  });

  it("reports each distinct error of a run once", () => {
    const { tools } = mount();
    tools.onError(new Error("boom"), run());
    tools.onError(new Error("boom"), run());
    tools.onError(new Error("other"), run());
    expect(toast.error).toHaveBeenCalledTimes(2);
  });

  it("reports the spreadsheet's document before the preview's", () => {
    expect(mount({ previewArtifact: pptx }).tools.currentDocumentPath()).toBe("/docs/deck.pptx");
    expect(mount({ previewArtifact: pptx }, { artifact: { filePath: "/ws/a.xlsx" } }).tools.currentDocumentPath()).toBe("/ws/a.xlsx");
  });
});
