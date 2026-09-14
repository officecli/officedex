import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { AppWindow, FileSpreadsheet, MonitorPlay } from "lucide-react";
import { Button } from "../ui";
import { OfficeWorkbenchLayout, type WorkbenchSaveState } from "../workbench/OfficeWorkbenchLayout";
import { officecli } from "../bridge";
import { SpreadsheetCanvas, type SpreadsheetCanvasHandle, type SpreadsheetCanvasState } from "./SpreadsheetCanvas";
import type { SpreadsheetSessionState } from "./types";
import { useT } from "../i18n";
import { WorkbookAppBuilder } from "../appBuilder/WorkbookAppBuilder";
import { PublishedWorkbookAppPage } from "../appBuilder/PublishedWorkbookAppPage";
import type { PublishedWorkbookApp } from "../appBuilder/types";
import type { MarketingAssetKind, MarketingBatchDraft, MarketingFieldMapping } from "./marketingWorkflow";
import type { CatalogCleanupBatch, CatalogInspection } from "./catalogCleanupWorkflow";
import type {
  WorkbookAddChartRequest,
  WorkbookAddChartResult,
  WorkbookSelectionSnapshot,
  WorkbookSnapshot,
  WorkbookSnapshotRequest,
  WorkbookStageMediaRequest,
  WorkbookStageMediaResult,
  WorkbookFormatCellsRequest,
  WorkbookWriteCellsRequest,
} from "./workbookClientTools";
import { delay } from "../utils/timing";
import { workbookFingerprint } from "./workbookFingerprint";

export interface SpreadsheetWorkspaceHandle {
  save(): Promise<boolean>;
  focus(): void;
  openAppBuilder(): void;
  previewApp(app: PublishedWorkbookApp): void;
  snapshot(request: WorkbookSnapshotRequest): Promise<WorkbookSnapshot>;
  readSelection(): Promise<WorkbookSelectionSnapshot>;
  readSelectionAddress(): Promise<Omit<WorkbookSelectionSnapshot, "values">>;
  writeCells(request: WorkbookWriteCellsRequest): Promise<{ written: number; sheetId: string; sheetName: string }>;
  formatCells(request: WorkbookFormatCellsRequest): Promise<{ formatted: number; sheetId: string; sheetName: string }>;
  stageMedia(request: WorkbookStageMediaRequest): Promise<WorkbookStageMediaResult>;
  inspectMarketingSelection(assetKind: MarketingAssetKind): MarketingBatchDraft;
  prepareMarketingBatch(batch: MarketingBatchDraft): void;
  setMarketingStatus(batch: MarketingBatchDraft, rowIndex: number, status: string): Promise<void>;
  insertMarketingImage(batch: MarketingBatchDraft, rowIndex: number, filePath: string): Promise<void>;
  setMarketingMapping(mapping?: MarketingFieldMapping): void;
  inspectCatalogSheets(): Promise<CatalogInspection>;
  previewCatalogCleanup(batch?: CatalogCleanupBatch): void;
  applyCatalogCleanup(batch: CatalogCleanupBatch): Promise<void>;
  replaceManagedSheet(input: { sheetName: string; headers: string[]; rows: string[][]; keyColumn?: string; preserveColumns?: string[] }): Promise<void>;
  addChart(request: WorkbookAddChartRequest): Promise<WorkbookAddChartResult>;
}

export interface SpreadsheetWorkspaceProps {
  session: SpreadsheetSessionState;
  workspaceName?: string;
  onBack: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onCanvasStateChange?: (state: SpreadsheetCanvasState) => void;
  onCanvasError?: (error?: string) => void;
  onCanvasSaveError?: (error?: string) => void;
  onCanvasSessionClosed?: (previewToken: string) => void;
  onCreateDeck?: (sourceFilePath: string) => Promise<void>;
  onWorkbookSaved?: (input: { filePath: string; sourceRevision: number; fingerprint: string }) => void;
  agentPanel?: React.ReactNode;
}

function saveStateFor(session: SpreadsheetSessionState): WorkbenchSaveState {
  if (!session.artifact) return "unopened";
  if (session.phase === "saving") return "saving";
  if (session.saveError) return "error";
  if (session.phase === "error") return "error";
  if (session.dirty || session.phase === "dirty") return "dirty";
  return "saved";
}

export const SpreadsheetWorkspace = forwardRef<SpreadsheetWorkspaceHandle, SpreadsheetWorkspaceProps>(
  function SpreadsheetWorkspace({ session, workspaceName, onBack, onDirtyChange, onCanvasStateChange, onCanvasError, onCanvasSaveError, onCanvasSessionClosed, onCreateDeck, onWorkbookSaved, agentPanel }, ref) {
    const canvasRef = useRef<SpreadsheetCanvasHandle>(null);
    const t = useT();
    const [agentOpen, setAgentOpen] = useState(true);
    const [appBuilderOpen, setAppBuilderOpen] = useState(false);
    const [creatingDeck, setCreatingDeck] = useState(false);
    const [publishedApp, setPublishedApp] = useState<PublishedWorkbookApp>();
    const [sourceRevision, setSourceRevision] = useState(0);
    const editorStateRef = useRef<SpreadsheetCanvasState | "closed">("closed");
    const fileName = session.artifact?.fileName ?? t("spreadsheet.untitled");
    const saveState = saveStateFor(session);

    useEffect(() => {
      setAppBuilderOpen(false);
      setPublishedApp(undefined);
      setSourceRevision(0);
    }, [session.artifact?.filePath]);

    const ensureEditorReady = useCallback(async (): Promise<SpreadsheetCanvasHandle> => {
      if (canvasRef.current && editorStateRef.current !== "closed" && editorStateRef.current !== "loading" && editorStateRef.current !== "error") {
        return canvasRef.current;
      }
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        if (editorStateRef.current === "error") {
          throw new Error(t("spreadsheet.error.loadFailed"));
        }
        if (canvasRef.current && editorStateRef.current !== "closed" && editorStateRef.current !== "loading") {
          return canvasRef.current;
        }
        await delay(50);
      }
      throw new Error(t("spreadsheet.error.loadTimeout"));
    }, []);
    const save = useCallback(async () => {
      if (!session.artifact || !session.grant) return false;
      const canvas = await ensureEditorReady();
      const saved = await canvas.save();
      if (saved && session.artifact) {
        let fingerprint = "";
        try {
          const snapshot = await canvas.snapshot({ maxRows: 500, maxColumns: 100 });
          if (snapshot?.sheets) fingerprint = workbookFingerprint(snapshot);
        } catch {
          // Saving the workbook remains successful when an older editor does
          // not expose snapshot data; refresh lineage can be populated later.
        }
        setSourceRevision((revision) => {
          const next = revision + 1;
          onWorkbookSaved?.({ filePath: session.artifact?.filePath ?? "", sourceRevision: next, fingerprint });
          return next;
        });
      }
      return saved;
    }, [ensureEditorReady, onWorkbookSaved, session.artifact, session.grant]);
    useImperativeHandle(ref, () => ({
      save,
      focus: () => canvasRef.current?.focus(),
      openAppBuilder: () => setAppBuilderOpen(true),
      previewApp: (app) => {
        setPublishedApp(app);
        setAppBuilderOpen(false);
      },
      snapshot: async (request) => (await ensureEditorReady()).snapshot(request),
      readSelection: async () => (await ensureEditorReady()).readSelection(),
      readSelectionAddress: async () => (await ensureEditorReady()).readSelectionAddress(),
      writeCells: async (request) => (await ensureEditorReady()).writeCells(request),
      formatCells: async (request) => (await ensureEditorReady()).formatCells(request),
      stageMedia: async (request) => (await ensureEditorReady()).stageMedia(request),
      inspectMarketingSelection: (assetKind) => {
        if (!canvasRef.current) throw new Error(t("spreadsheet.error.loading"));
        return canvasRef.current.inspectMarketingSelection(assetKind);
      },
      prepareMarketingBatch: (batch) => canvasRef.current?.prepareMarketingBatch(batch),
      setMarketingStatus: async (batch, rowIndex, status) => {
        const canvas = await ensureEditorReady();
        return canvas.setMarketingStatus(batch, rowIndex, status);
      },
      insertMarketingImage: async (batch, rowIndex, filePath) => {
        const canvas = await ensureEditorReady();
        await canvas.insertMarketingImage(batch, rowIndex, filePath);
      },
      setMarketingMapping: (mapping) => canvasRef.current?.setMarketingMapping(mapping),
      inspectCatalogSheets: async () => {
        const canvas = await ensureEditorReady();
        return canvas.inspectCatalogSheets();
      },
      previewCatalogCleanup: (batch) => canvasRef.current?.previewCatalogCleanup(batch),
      applyCatalogCleanup: async (batch) => {
        const canvas = await ensureEditorReady();
        return canvas.applyCatalogCleanup(batch);
      },
      replaceManagedSheet: async (input) => {
        const canvas = await ensureEditorReady();
        await canvas.replaceManagedSheet(input);
      },
      addChart: async (request) => (await ensureEditorReady()).addChart(request),
    }), [ensureEditorReady, save]);

    return (
      <OfficeWorkbenchLayout
        documentType="xlsx"
        fileName={fileName}
        context={workspaceName}
        saveState={saveState}
        onBack={onBack}
        backLabel={t("spreadsheet.topbar.back")}
        onSave={() => void save()}
        canSave={Boolean(session.artifact && session.grant && session.dirty)}
        onOpenExternal={session.artifact ? () => void officecli.openPath(session.artifact!.filePath) : undefined}
        panelOpen={agentOpen}
        onPanelOpenChange={setAgentOpen}
        panel={{
          title: t("spreadsheet.agent.title"),
          children: agentPanel ?? <p>{t("spreadsheet.agent.empty")}</p>,
        }}
        actions={
          <>
            {session.artifact && onCreateDeck ? (
              <Button
                variant="secondary"
                size="small"
                icon={<MonitorPlay />}
                disabled={creatingDeck}
                loading={creatingDeck}
                onClick={() => {
                  const artifact = session.artifact;
                  if (!artifact || creatingDeck) return;
                  setCreatingDeck(true);
                  // The deck is built from the file on disk, so pending edits — the
                  // charts included — have to be flushed before handing off the path.
                  void (async () => {
                    try {
                      if (session.dirty && !await save()) return;
                      await onCreateDeck(artifact.filePath);
                    } finally {
                      setCreatingDeck(false);
                    }
                  })();
                }}
              >
                {t("spreadsheet.topbar.createDeck")}
              </Button>
            ) : null}
            {session.artifact && session.grant ? (
              <Button variant="secondary" size="small" icon={<AppWindow />} onClick={() => setAppBuilderOpen(true)}>
                {t("spreadsheet.topbar.appBuilder")}
              </Button>
            ) : null}
          </>
        }
        overlay={
          publishedApp && session.grant ? (
            <PublishedWorkbookAppPage app={publishedApp} grant={session.grant} sourceRevision={sourceRevision} onBack={() => {
              setPublishedApp(undefined);
              setAppBuilderOpen(true);
            }} />
          ) : appBuilderOpen && session.artifact && session.grant ? (
            <WorkbookAppBuilder
              artifact={session.artifact}
              grant={session.grant}
              sourceRevision={sourceRevision}
              onClose={() => setAppBuilderOpen(false)}
              onOpenPublished={(app) => {
                setPublishedApp(app);
                setAppBuilderOpen(false);
              }}
            />
          ) : undefined
        }
      >
        <main className="spreadsheet-workspace__canvas" role="region" aria-label={session.artifact ? t("spreadsheet.workbook.aria", { file: fileName }) : t("spreadsheet.workbook.untitledAria")}>
          {session.artifact && session.grant ? (
            <SpreadsheetCanvas
              ref={canvasRef}
              artifact={session.artifact}
              grant={session.grant}
              onDirtyChange={onDirtyChange}
              onStateChange={(state) => {
                editorStateRef.current = state;
                onCanvasStateChange?.(state);
                if (state === "saved") setSourceRevision((current) => current + 1);
              }}
              onError={onCanvasError}
              onSaveError={onCanvasSaveError}
              onSessionClosed={onCanvasSessionClosed}
            />
          ) : (
            <div className="spreadsheet-workspace__empty">
              <FileSpreadsheet aria-hidden="true" />
              <strong>{t("spreadsheet.workbook.emptyTitle")}</strong>
              <span>{t("spreadsheet.workbook.emptyBody")}</span>
            </div>
          )}
        </main>
      </OfficeWorkbenchLayout>
    );
  },
);
