import { useMemo } from "react";
import type { ReactNode } from "react";
import type { CreditStatus, DesktopTask, GenerateInput, RecentFile } from "../../shared/types";
import { officecli } from "../bridge";
import { useT } from "../i18n";
import type { NavKey } from "../defaults";
import { SpreadsheetCatalogCleanupPanel } from "./SpreadsheetCatalogCleanupPanel";
import { SpreadsheetJiraPanel } from "./SpreadsheetJiraPanel";
import { SpreadsheetLiquipediaPanel } from "./SpreadsheetLiquipediaPanel";
import { SpreadsheetMarketingPanel } from "./SpreadsheetMarketingPanel";
import type { MarketingSheetRow } from "./marketingWorkflow";
import type { SpreadsheetAgentTool } from "./SpreadsheetAgentPanel";
import type { SpreadsheetWorkspaceHandle } from "./SpreadsheetWorkspace";
import type { useSpreadsheetSession } from "./useSpreadsheetSession";

type SpreadsheetSession = ReturnType<typeof useSpreadsheetSession>;

export interface VerticalPanelsDeps {
  spreadsheet: SpreadsheetSession;
  spreadsheetWorkspaceRef: React.RefObject<SpreadsheetWorkspaceHandle | null>;
  spreadsheetPreferredTool: SpreadsheetAgentTool;
  catalogAutoScanFile: string | undefined;
  tasks: Record<string, DesktopTask>;
  recentFiles: RecentFile[];
  creditStatus: CreditStatus | null | undefined;
  bridgeInterruptionKey: number;
  refreshRecentFiles: (workspaceId?: string) => Promise<void>;
  setActiveNav: (nav: NavKey) => void;
  startSpreadsheetMarketingImage: (row: MarketingSheetRow, ratio: NonNullable<GenerateInput["imageRatio"]>) => Promise<{ taskId: string }>;
}

export interface VerticalPanels {
  catalogPanel: ReactNode;
  jiraPanel: ReactNode;
  liquipediaPanel: ReactNode;
  marketingPanel: ReactNode;
}

/**
 * useVerticalPanels builds the four connector panels the spreadsheet workspace
 * shows: catalog cleanup, Jira, Liquipedia and marketing images.
 *
 * These are separate products sharing one workbook, and what they share is
 * this wiring: each reaches the open workbook through the same imperative
 * handle, each has to refuse the same way when that handle is not mounted, and
 * two of them create a workbook from scratch by the same route. A hundred
 * lines of it were inline in App.tsx's render, between the shell and the
 * spreadsheet panel, so adding a connector meant editing the app's layout.
 *
 * Nothing here decides anything; it is the wiring, kept where the four
 * versions of it can be compared.
 */
export function useVerticalPanels({
  spreadsheet,
  spreadsheetWorkspaceRef,
  spreadsheetPreferredTool,
  catalogAutoScanFile,
  tasks,
  recentFiles,
  creditStatus,
  bridgeInterruptionKey,
  refreshRecentFiles,
  setActiveNav,
  startSpreadsheetMarketingImage,
}: VerticalPanelsDeps): VerticalPanels {
  const t = useT();
  return useMemo(
    () => ({
      catalogPanel: spreadsheet.session.artifact ? (
        <SpreadsheetCatalogCleanupPanel
          fileName={spreadsheet.session.artifact.fileName}
          filePath={spreadsheet.session.artifact.filePath}
          workspaceId={spreadsheet.session.workspaceId}
          autoScan={spreadsheetPreferredTool === "catalog"
            && catalogAutoScanFile === spreadsheet.session.artifact.filePath
            && (spreadsheet.session.phase === "ready" || spreadsheet.session.phase === "dirty")}
          onInspect={() => {
            if (!spreadsheetWorkspaceRef.current) throw new Error(t("tasks.runtime.workbookLoading"));
            return spreadsheetWorkspaceRef.current.inspectCatalogSheets();
          }}
          onPreview={(batch) => spreadsheetWorkspaceRef.current?.previewCatalogCleanup(batch)}
          onApply={(batch) => {
            if (!spreadsheetWorkspaceRef.current) return Promise.reject(new Error(t("tasks.runtime.workbookClosed")));
            return spreadsheetWorkspaceRef.current.applyCatalogCleanup(batch);
          }}
          onSave={() => spreadsheetWorkspaceRef.current?.save() ?? Promise.resolve(false)}
        />
      ) : undefined,
      jiraPanel: (
        <SpreadsheetJiraPanel
          workbookReady={Boolean(spreadsheet.session.artifact)}
          workbookPath={spreadsheet.session.artifact?.filePath}
          workspaceId={spreadsheet.session.workspaceId}
          onOpenSettings={() => setActiveNav("settings")}
          onCreateWorkbook={async (result) => {
            const artifact = await officecli.createWorkbookFromSheet({
              fileName: "Jira Issues.xlsx",
              sheetName: result.sheetName,
              headers: result.headers,
              rows: result.rows,
              workspaceId: spreadsheet.session.workspaceId,
            });
            await spreadsheet.openArtifact(artifact);
            void refreshRecentFiles(spreadsheet.session.workspaceId);
          }}
          onWriteSheet={(result) => {
            if (!spreadsheetWorkspaceRef.current) return Promise.reject(new Error(t("tasks.runtime.workbookClosed")));
            return spreadsheetWorkspaceRef.current.replaceManagedSheet({ ...result, keyColumn: "Issue Key", preserveColumns: ["OfficeDex Notes"] });
          }}
          onSave={() => spreadsheetWorkspaceRef.current?.save() ?? Promise.resolve(false)}
        />
      ),
      liquipediaPanel: (
        <SpreadsheetLiquipediaPanel
          workbookReady={Boolean(spreadsheet.session.artifact)}
          workbookPath={spreadsheet.session.artifact?.filePath}
          workspaceId={spreadsheet.session.workspaceId}
          onOpenSettings={() => setActiveNav("settings")}
          onCreateWorkbook={async (result) => {
            const artifact = await officecli.createWorkbookFromSheet({
              fileName: result.sheetName === "Liquipedia Updates" ? "Liquipedia Updates.xlsx" : "Liquipedia Tournaments.xlsx",
              sheetName: result.sheetName,
              headers: result.headers,
              rows: result.rows,
              workspaceId: spreadsheet.session.workspaceId,
            });
            await spreadsheet.openArtifact(artifact);
            void refreshRecentFiles(spreadsheet.session.workspaceId);
          }}
          onWriteSheet={(result) => {
            if (!spreadsheetWorkspaceRef.current) return Promise.reject(new Error(t("tasks.runtime.workbookClosed")));
            return spreadsheetWorkspaceRef.current.replaceManagedSheet({ ...result, keyColumn: "Source URL" });
          }}
          onSave={() => spreadsheetWorkspaceRef.current?.save() ?? Promise.resolve(false)}
        />
      ),
      marketingPanel: (
        <SpreadsheetMarketingPanel
          tasks={tasks}
          workbookPath={spreadsheet.session.artifact?.filePath}
          workspaceId={spreadsheet.session.workspaceId}
          creditBalance={creditStatus?.mode === "api_key"
            ? creditStatus.paidKeyRemaining
            : creditStatus?.mode !== "anonymous"
              ? creditStatus?.hostedCreditBalance ?? null
              : creditStatus?.anonymousCreditAvailable ?? null}
          bridgeInterruptionKey={bridgeInterruptionKey}
          existingImages={recentFiles}
          onInspect={(assetKind) => {
            if (!spreadsheetWorkspaceRef.current) throw new Error(t("tasks.runtime.workbookLoading"));
            return spreadsheetWorkspaceRef.current.inspectMarketingSelection(assetKind);
          }}
          onAnalyze={(batch) => officecli.planSpreadsheetFields({
            ...(spreadsheet.session.workspaceId
              ? { workspaceId: spreadsheet.session.workspaceId }
              : { noProject: true }),
            sheetName: batch.sheetName,
            headerRowIndex: batch.headerRowIndex,
            headers: batch.source.headers,
            sampleRows: batch.source.rows.slice(0, 5),
          })}
          onMappingChange={(mapping) => spreadsheetWorkspaceRef.current?.setMarketingMapping(mapping)}
          mappingStorageKey={spreadsheet.session.artifact?.filePath}
          onPrepare={(batch) => spreadsheetWorkspaceRef.current?.prepareMarketingBatch(batch)}
          onSetStatus={(batch, rowIndex, status) => {
            if (!spreadsheetWorkspaceRef.current) return Promise.reject(new Error(t("tasks.runtime.workbookClosed")));
            return spreadsheetWorkspaceRef.current.setMarketingStatus(batch, rowIndex, status);
          }}
          onInsertImage={(batch, rowIndex, filePath) => {
            if (!spreadsheetWorkspaceRef.current) return Promise.reject(new Error(t("tasks.runtime.workbookClosed")));
            return spreadsheetWorkspaceRef.current.insertMarketingImage(batch, rowIndex, filePath);
          }}
          onGenerate={startSpreadsheetMarketingImage}
          onSave={() => spreadsheetWorkspaceRef.current?.save() ?? Promise.resolve(false)}
        />
      ),
    }),
    [
      spreadsheet,
      spreadsheetWorkspaceRef,
      spreadsheetPreferredTool,
      catalogAutoScanFile,
      tasks,
      recentFiles,
      creditStatus,
      bridgeInterruptionKey,
      refreshRecentFiles,
      setActiveNav,
      startSpreadsheetMarketingImage,
      t,
    ],
  );
}
