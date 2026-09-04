import { useCallback, useMemo, useRef } from "react";
import type { RefObject } from "react";
import type { AgentRun, Artifact, PreviewGrant, RecentFile } from "../shared/types";
import type { ConfiguredJiraSyncResult, ConfiguredLiquipediaSyncResult, JiraSyncResult, LiquipediaSyncResult } from "../shared/verticals";
import { AgentClientToolDeferredError, type AgentClientToolSurfaces } from "./AgentClientToolHost";
import {
  executeActiveEditorClientTool,
  waitForActiveEditorSurface,
  type ActiveEditorSurface,
} from "./activeEditorClientTools";
import { loadPublishedWorkbookApps, savePublishedWorkbookApp } from "./appBuilder/appStore";
import type { PublishedWorkbookApp } from "./appBuilder/types";
import { officecli } from "./bridge";
import { useT } from "./i18n";
import type { NavKey } from "./defaults";
import type { CatalogCleanupBatch } from "./spreadsheet/catalogCleanupWorkflow";
import type { MarketingBatchDraft } from "./spreadsheet/marketingWorkflow";
import type { SpreadsheetAgentTool } from "./spreadsheet/SpreadsheetAgentPanel";
import type { SpreadsheetWorkspaceHandle } from "./spreadsheet/SpreadsheetWorkspace";
import type { SpreadsheetEntry } from "./spreadsheet/types";
import type { useSpreadsheetSession } from "./spreadsheet/useSpreadsheetSession";
import {
  parseWorkbookAddChartRequest,
  parseWorkbookFormatCellsRequest,
  parseWorkbookSnapshotRequest,
  parseWorkbookStageMediaRequest,
  parseWorkbookWriteCellsRequest,
} from "./spreadsheet/workbookClientTools";
import { toast as message } from "./ui";
import { fileNameFromPath } from "./utils/path";
import { delay } from "./utils/timing";
import { recordValue, trimmedStringValue as stringValue } from "./utils/values";

type SpreadsheetSession = ReturnType<typeof useSpreadsheetSession>;

export interface AgentClientToolsDeps {
  spreadsheet: SpreadsheetSession;
  previewArtifact: Artifact | null;
  previewGrant: PreviewGrant | null;
  spreadsheetWorkspaceRef: RefObject<SpreadsheetWorkspaceHandle | null>;
  refreshRecentFiles: (workspaceId?: string) => Promise<void>;
  setSpreadsheetEntry: (entry: SpreadsheetEntry | null) => void;
  setPreviewArtifact: (artifact: Artifact | null) => void;
  setPreviewGrant: (grant: PreviewGrant | null) => void;
  setSpreadsheetPreferredTool: (tool: SpreadsheetAgentTool) => void;
  setCatalogAutoScanFile: (filePath: string | undefined) => void;
  setActiveNav: (nav: NavKey) => void;
}

/**
 * useAgentClientTools is everything the agent runtime can ask this window to do
 * on its behalf: write cells, stage media, save an open editor.
 *
 * A client tool runs against whatever the user currently has open, so most of
 * this is refusing politely -- the wrong document type is showing, another
 * workbook has unsaved edits, the editor has not mounted yet. Those refusals
 * throw AgentClientToolDeferredError, which tells the runtime to retry rather
 * than fail the run, and getting one of them wrong means either a silent write
 * into the wrong file or a run that gives up on a condition that was about to
 * clear.
 *
 * The hook returns exactly the props AgentClientToolHost takes, which is the
 * seam it was pulled out along.
 */
export function useAgentClientTools({
  spreadsheet,
  previewArtifact,
  previewGrant,
  spreadsheetWorkspaceRef,
  refreshRecentFiles,
  setSpreadsheetEntry,
  setPreviewArtifact,
  setPreviewGrant,
  setSpreadsheetPreferredTool,
  setCatalogAutoScanFile,
  setActiveNav,
}: AgentClientToolsDeps) {
  const t = useT();
  const agentClientToolReportedErrorsRef = useRef(new Set<string>());

const waitForSpreadsheetWorkspace = useCallback(async () => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (spreadsheetWorkspaceRef.current) return spreadsheetWorkspaceRef.current;
    await delay(50);
  }
  throw new AgentClientToolDeferredError(t("tasks.runtime.restoreTimeout"));
}, [t]);

// What this page currently has open, for the client-tool host's pre-write check.
const currentAgentDocumentPath = useCallback(
  () => spreadsheet.session.artifact?.filePath ?? previewArtifact?.filePath,
  [spreadsheet.session.artifact?.filePath, previewArtifact?.filePath],
);

const routeAgentClientToolSurface = useCallback(async (surface: string, run: AgentRun) => {
  if (surface === "pptx-editor" || surface === "docx-editor") {
    const expectedType = surface === "pptx-editor" ? "pptx" : "docx";
    const sourcePath = run.metadata?.source_path;
    if (previewArtifact && previewArtifact.documentType !== expectedType) {
      throw new AgentClientToolDeferredError(t("tasks.runtime.previewTypeMismatch", { type: expectedType.toUpperCase() }));
    }
    if (sourcePath && previewArtifact?.filePath !== sourcePath) {
      if (previewArtifact || previewGrant) {
        throw new AgentClientToolDeferredError(t("tasks.runtime.otherDocumentOpen"));
      }
      const file: RecentFile = {
        filePath: sourcePath,
        fileName: fileNameFromPath(sourcePath),
        documentType: expectedType,
        source: "local",
        lastOpenedAt: new Date().toISOString(),
      };
      const artifact = await officecli.openRecentFile(file);
      const grant = await officecli.issuePreviewToken(artifact);
      setPreviewArtifact(artifact);
      setPreviewGrant(grant);
    } else if (!sourcePath && !previewArtifact) {
      throw new AgentClientToolDeferredError(t("tasks.runtime.sourcePathMissing", { runId: run.id }));
    }
    if (!await waitForActiveEditorSurface(surface as ActiveEditorSurface)) {
      throw new AgentClientToolDeferredError(t("tasks.runtime.editorNotReady", { type: expectedType.toUpperCase() }));
    }
    return;
  }
  const preferredTool: SpreadsheetAgentTool = surface === "spreadsheet.catalog-cleanup"
    ? "catalog"
    : surface === "spreadsheet.marketing"
      ? "campaign"
      : surface === "spreadsheet.jira"
        ? "jira"
        : surface === "spreadsheet.liquipedia"
          ? "liquipedia"
          : "assistant";
  const workbookPath = run.metadata?.workbook_path || run.metadata?.source_path;
  const currentPath = spreadsheet.session.artifact?.filePath;
  const requiresExistingWorkbook = surface === "spreadsheet"
    || surface === "spreadsheet.catalog-cleanup"
    || surface === "spreadsheet.marketing"
    || surface === "app-builder";
  if (
    workbookPath
    && (workbookPath !== currentPath || !spreadsheet.session.grant)
  ) {
    if (spreadsheet.session.dirty) {
      throw new AgentClientToolDeferredError(t("tasks.runtime.otherWorkbookDirty"));
    }
    const artifact = await officecli.openRecentFile({
      filePath: workbookPath,
      fileName: fileNameFromPath(workbookPath),
      documentType: "xlsx",
      source: "local",
      ...(run.metadata?.workspace_id ? { workspaceId: run.metadata.workspace_id } : {}),
      lastOpenedAt: new Date().toISOString(),
    });
    const grant = await officecli.issuePreviewToken(artifact);
    const previousToken = spreadsheet.session.grant?.token;
    setSpreadsheetEntry({
      kind: "artifact",
      artifact,
      grant,
      ...(run.metadata?.workspace_id ? { workspaceId: run.metadata.workspace_id } : {}),
    });
    if (previousToken && previousToken !== grant.token) {
      void officecli.revokePreviewToken(previousToken).catch(() => undefined);
    }
  } else if (!workbookPath && !currentPath && requiresExistingWorkbook) {
    throw new AgentClientToolDeferredError(t("tasks.runtime.workbookPathMissing", { runId: run.id }));
  }
  setSpreadsheetPreferredTool(preferredTool);
  setCatalogAutoScanFile(undefined);
  setActiveNav("spreadsheet");
  const workspace = await waitForSpreadsheetWorkspace();
  if (surface === "app-builder") workspace.openAppBuilder();
}, [previewArtifact, previewGrant, spreadsheet.session.artifact?.filePath, spreadsheet.session.dirty, spreadsheet.session.grant?.token, t, waitForSpreadsheetWorkspace]);

const agentClientToolSurfaces = useMemo<AgentClientToolSurfaces>(() => {
  const workspace = () => {
    if (!spreadsheetWorkspaceRef.current) {
      throw new AgentClientToolDeferredError(t("tasks.runtime.workspaceNotReady"));
    }
    return spreadsheetWorkspaceRef.current;
  };
  const saveWorkbook = async () => {
    if (!await workspace().save()) throw new Error(t("tasks.runtime.workbookSaveFailed"));
    return { saved: true };
  };
  const genericWorkbookTools = {
    "workbook.snapshot": async (request: Parameters<NonNullable<AgentClientToolSurfaces[string][string]>>[0]) => (
      workspace().snapshot(parseWorkbookSnapshotRequest(request.arguments))
    ),
    "workbook.read_selection": async () => workspace().readSelection(),
    "workbook.write_cells": async (request: Parameters<NonNullable<AgentClientToolSurfaces[string][string]>>[0]) => (
      workspace().writeCells(parseWorkbookWriteCellsRequest(request.arguments))
    ),
    "workbook.format_cells": async (request: Parameters<NonNullable<AgentClientToolSurfaces[string][string]>>[0]) => (
      workspace().formatCells(parseWorkbookFormatCellsRequest(request.arguments))
    ),
    "workbook.stage_media": async (request: Parameters<NonNullable<AgentClientToolSurfaces[string][string]>>[0]) => (
      workspace().stageMedia(parseWorkbookStageMediaRequest(request.arguments))
    ),
    "workbook.add_chart": async (request: Parameters<NonNullable<AgentClientToolSurfaces[string][string]>>[0]) => (
      workspace().addChart(parseWorkbookAddChartRequest(request.arguments))
    ),
  };
  const writeJiraSheet = async (response: ConfiguredJiraSyncResult | undefined) => {
    if (response?.status !== "completed" || !response.result) throw new Error(response?.message || "Jira Runtime did not return Sheet data.");
    const result: JiraSyncResult = response.result;
    if (spreadsheet.session.artifact) {
      await workspace().replaceManagedSheet({ ...result, keyColumn: "Issue Key", preserveColumns: ["OfficeDex Notes"] });
    } else {
      const artifact = await officecli.createWorkbookFromSheet({
        fileName: "Jira Issues.xlsx", sheetName: result.sheetName, headers: result.headers, rows: result.rows,
        workspaceId: spreadsheet.session.workspaceId,
      });
      await spreadsheet.openArtifact(artifact);
      void refreshRecentFiles(spreadsheet.session.workspaceId);
    }
    return { sheetName: result.sheetName, rows: result.fetched };
  };
  const writeLiquipediaSheet = async (response: ConfiguredLiquipediaSyncResult | undefined) => {
    if (response?.status !== "completed" || !response.result) throw new Error(response?.message || "Liquipedia Runtime did not return Sheet data.");
    const result: LiquipediaSyncResult = response.result;
    if (spreadsheet.session.artifact) {
      await workspace().replaceManagedSheet({ ...result, keyColumn: "Source URL" });
    } else {
      const artifact = await officecli.createWorkbookFromSheet({
        fileName: result.sheetName === "Liquipedia Updates" ? "Liquipedia Updates.xlsx" : "Liquipedia Tournaments.xlsx",
        sheetName: result.sheetName, headers: result.headers, rows: result.rows,
        workspaceId: spreadsheet.session.workspaceId,
      });
      await spreadsheet.openArtifact(artifact);
      void refreshRecentFiles(spreadsheet.session.workspaceId);
    }
    return { sheetName: result.sheetName, rows: result.fetched };
  };
  return {
    "spreadsheet": {
      ...genericWorkbookTools,
      "workbook.save": saveWorkbook,
    },
    "spreadsheet.catalog-cleanup": {
      ...genericWorkbookTools,
      "workbook.catalog_cleanup.apply": async (request) => {
        const batch = request.arguments.batch as CatalogCleanupBatch | undefined;
        if (!batch) throw new Error("Catalog cleanup Runtime did not provide a batch for writeback.");
        await workspace().applyCatalogCleanup(batch);
        return { applied: true, sheet_id: batch.sheetId };
      },
      "workbook.save": saveWorkbook,
    },
    "spreadsheet.marketing": {
      ...genericWorkbookTools,
      "workbook.insert_image": async (request) => {
        const batch = request.arguments.batch as MarketingBatchDraft | undefined;
        const rowIndex = numberValue(request.arguments.row_index);
        const workflowResult = recordValue(request.arguments.workflow_result);
        const filePath = stringValue(workflowResult.filePath) || stringValue(request.arguments.file_path);
        if (!batch || rowIndex < 0 || !filePath) throw new Error("Marketing Runtime did not persist enough workbook context to insert the image.");
        await workspace().insertMarketingImage(batch, rowIndex, filePath);
        return { inserted: true, file_path: filePath, row_index: rowIndex };
      },
      "workbook.set_status": async (request) => {
        const batch = request.arguments.batch as MarketingBatchDraft | undefined;
        const rowIndex = numberValue(request.arguments.row_index);
        const status = stringValue(request.arguments.status);
        if (!batch || rowIndex < 0 || !status) throw new Error("Marketing Runtime did not persist enough workbook context to update status.");
        await workspace().setMarketingStatus(batch, rowIndex, status);
        return { updated: true, status };
      },
      "workbook.save": saveWorkbook,
    },
    "spreadsheet.jira": {
      ...genericWorkbookTools,
      "workbook.write_managed_sheet": (request) => writeJiraSheet(request.arguments.workflow_result as ConfiguredJiraSyncResult | undefined),
      "workbook.save": saveWorkbook,
    },
    "spreadsheet.liquipedia": {
      ...genericWorkbookTools,
      "workbook.write_managed_sheet": (request) => writeLiquipediaSheet(request.arguments.workflow_result as ConfiguredLiquipediaSyncResult | undefined),
      "workbook.save": saveWorkbook,
    },
    "app-builder": {
      ...genericWorkbookTools,
      "app.preview": async (request) => {
        const inline = request.arguments.app as PublishedWorkbookApp | undefined;
        const appId = stringValue(request.arguments.app_id);
        const app = inline ?? loadPublishedWorkbookApps().find((candidate) => candidate.id === appId);
        if (!app) throw new Error("app.preview requires an app payload or an existing app_id.");
        workspace().previewApp(app);
        return { app_id: app.id, previewed: true };
      },
      "app.publish": async (request) => {
        const app = request.arguments.app as PublishedWorkbookApp | undefined;
        if (!app) throw new Error("App Builder Runtime did not provide the App payload.");
        savePublishedWorkbookApp(app);
        return { app_id: app.id, published_at: app.publishedAt };
      },
    },
    "pptx-editor": {
      "pptx.editor.save": (request) => executeActiveEditorClientTool("pptx-editor", request.tool, request.arguments),
    },
    "docx-editor": {
      "docx.editor.save": (request) => executeActiveEditorClientTool("docx-editor", request.tool, request.arguments),
    },
  };
}, [refreshRecentFiles, spreadsheet.openArtifact, spreadsheet.session.artifact, spreadsheet.session.workspaceId, t]);

const reportAgentClientToolError = useCallback((error: Error, run: AgentRun) => {
  const key = `${run.id}:${error.message}`;
  if (agentClientToolReportedErrorsRef.current.has(key)) return;
  agentClientToolReportedErrorsRef.current.add(key);
  void message.error(error.message);
}, []);

  return useMemo(
    () => ({
      surfaces: agentClientToolSurfaces,
      routeToSurface: routeAgentClientToolSurface,
      onError: reportAgentClientToolError,
      currentDocumentPath: currentAgentDocumentPath,
    }),
    [agentClientToolSurfaces, routeAgentClientToolSurface, reportAgentClientToolError, currentAgentDocumentPath],
  );
}

// numberValue mirrors App.tsx's helper: a value off the wire is unknown until
// it has been checked.
function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
