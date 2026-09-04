import type { AbstractedSheetSDK, SheetCellData, SheetWritableCellData } from "@shimo/sdk-sheet";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { AlertCircle, FileSpreadsheet } from "lucide-react";
import type { Artifact, PreviewGrant } from "../../shared/types";
import { officecli } from "../bridge";
import { useT } from "../i18n";
import { Button } from "../ui";
import {
  findMarketingHeaderRow,
  marketingFieldRoleLabel,
  parseMarketingSelection,
  type MarketingAssetKind,
  type MarketingBatchDraft,
  type MarketingFieldMapping,
} from "./marketingWorkflow";
import { createOfflineSheetEditor, cellsLoadingMessages, registerOfflineImage } from "./sheetSdk";
import type { CatalogCleanupBatch, CatalogInspection, CatalogSelection } from "./catalogCleanupWorkflow";
import type {
  WorkbookAddChartRequest,
  WorkbookAddChartResult,
  WorkbookCellStyle,
  WorkbookFormatCellsRequest,
  WorkbookSelectionSnapshot,
  WorkbookSnapshot,
  WorkbookSnapshotRequest,
  WorkbookStageMediaRequest,
  WorkbookStageMediaResult,
  WorkbookWriteCellsRequest,
} from "./workbookClientTools";
import { uint8ArrayToBase64 } from "../utils/bytes";
import { errorMessage } from "../utils/values";
import { delay } from "../utils/timing";

export type SpreadsheetCanvasState = "loading" | "clean" | "dirty" | "saving" | "saved" | "error";

export interface SpreadsheetCanvasHandle {
  save(): Promise<boolean>;
  focus(): void;
  snapshot(request: WorkbookSnapshotRequest): Promise<WorkbookSnapshot>;
  readSelection(): WorkbookSelectionSnapshot;
  readSelectionAddress(): Omit<WorkbookSelectionSnapshot, "values">;
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

export interface SpreadsheetCanvasProps {
  artifact: Artifact;
  grant: PreviewGrant;
  onDirtyChange?: (dirty: boolean) => void;
  onStateChange?: (state: SpreadsheetCanvasState) => void;
  onError?: (error?: string) => void;
  onSaveError?: (error?: string) => void;
  onSessionClosed?: (previewToken: string) => void;
}

// The sheet SDK hydrates a worksheet's cell text lazily. Right after
// setActiveWorksheet the freshly activated sheet still reads back as an
// all-empty matrix, so any synchronous read of a previously inactive sheet
// loses its data. Poll a small probe range until text shows up (or the sheet is
// genuinely empty) so multi-sheet scans see real content.
const WORKSHEET_HYDRATION_TIMEOUT_MS = 2_000;

// The Chart plugin installs after the editor renders, and
// addChartFromSelection silently returns undefined until that finishes. Wait
// for the plugin rather than reporting a confusing "no chart was created".
const CHART_PLUGIN_TIMEOUT_MS = 15_000;
const CHART_PLUGIN_POLL_MS = 100;

async function waitForChartPlugin(editor: AbstractedSheetSDK, timeoutMs = CHART_PLUGIN_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (typeof editor.charts?.addChartFromSelection === "function") return;
    if (Date.now() >= deadline) throw new Error("表格图表引擎尚未加载完成。");
    await delay(CHART_PLUGIN_POLL_MS);
  }
}

async function waitForWorksheetHydration(
  worksheet: { rowCount: number; columnCount: number; getRange: (range: { type: "cells"; row: number; rowCount: number; column: number; columnCount: number }) => { getText: (mode: "matrix") => string[][] } | null | undefined },
  timeoutMs = WORKSHEET_HYDRATION_TIMEOUT_MS,
): Promise<void> {
  const rowCount = Math.min(Math.max(worksheet.rowCount, 1), 50);
  const columnCount = Math.min(Math.max(worksheet.columnCount, 1), 32);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const probe = worksheet.getRange({ type: "cells", row: 0, rowCount, column: 0, columnCount });
    if (probe?.getText("matrix").some((row) => row.some((value) => value.trim()))) return;
    if (Date.now() >= deadline) return;
    await new Promise((resolve) => { setTimeout(resolve, 25); });
  }
}

interface HeaderMarkerPosition {
  column: number;
  left: number;
  top: number;
  width: number;
  height: number;
  label: string;
  status: "suggested" | "confirmed";
  confidence: number;
  reason: string;
}

interface CatalogRangePosition {
  left: number;
  top: number;
  width: number;
  height: number;
  rowCount: number;
}

interface CatalogRangeTarget {
  sheetId: string;
  headerRowIndex: number;
  firstRowIndex: number;
  rowCount: number;
  columnCount: number;
}

export function imageBytesToFile(data: Uint8Array, mime: string, fileName: string): File {
  if (data.byteLength === 0) throw new Error("生成图片文件为空，无法回写表格。");
  if (!mime.startsWith("image/")) throw new Error(`生成结果不是受支持的图片格式：${mime || "unknown"}`);
  const copied = new Uint8Array(data.byteLength);
  copied.set(data);
  return new File([copied.buffer], fileName, { type: mime });
}

function imageBytesToDataUrl(data: Uint8Array, mime: string): string {
  if (data.byteLength === 0) throw new Error("生成图片文件为空，无法回写表格。");
  if (!mime.startsWith("image/")) throw new Error(`生成结果不是受支持的图片格式：${mime || "unknown"}`);
  return `data:${mime};base64,${uint8ArrayToBase64(data)}`;
}

async function imageFileToBytes(file: File): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => reader.result instanceof ArrayBuffer
      ? resolve(new Uint8Array(reader.result))
      : reject(new Error("无法读取剪贴板图片。"));
    reader.onerror = () => reject(reader.error ?? new Error("无法读取剪贴板图片。"));
    reader.readAsArrayBuffer(file);
  });
}

async function waitForChange(
  changeVersionRef: { current: number },
  versionBeforeInsert: number,
  timeoutMs = 500,
): Promise<boolean> {
  const timeoutAt = Date.now() + timeoutMs;
  while (changeVersionRef.current <= versionBeforeInsert) {
    if (Date.now() >= timeoutAt) return false;
    await delay(16);
  }
  return true;
}

async function waitForChangeVersionQuiet(
  changeVersionRef: { current: number },
  quietMs = 200,
  timeoutMs = 1500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let observedVersion = changeVersionRef.current;
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    await delay(25);
    if (changeVersionRef.current !== observedVersion) {
      observedVersion = changeVersionRef.current;
      quietSince = Date.now();
      continue;
    }
    if (Date.now() - quietSince >= quietMs) return;
  }
}

function isCellsLoadingError(error: unknown): boolean {
  const message = errorMessage(error).trim();
  if (!message) return false;
  return cellsLoadingMessages().some((loading) => message.includes(loading));
}

export async function retryWhenSheetCellsReady<T>(action: () => T, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      return action();
    } catch (error) {
      if (!isCellsLoadingError(error) || Date.now() >= deadline) throw error;
      await delay(50);
    }
  }
}

// SheetWritableCellData requires exactly one content branch, so restyling a
// cell means rewriting its content too. Prefer the formula, fall back to the
// primitive value, and only then to text — writing text back over a number or
// a formula would silently degrade the cell.
const WORKBOOK_STYLE_KEYS = [
  "background", "color", "bold", "italic", "underline", "strike",
  "fontFamily", "fontSize", "align", "vertical", "wrap",
  "formatCategory", "precision",
  "borderTop", "borderRight", "borderBottom", "borderLeft",
] as const;

function preservedCellStyle(existing: SheetCellData | undefined): WorkbookCellStyle {
  const preserved: Record<string, unknown> = {};
  if (!existing) return preserved;
  for (const key of WORKBOOK_STYLE_KEYS) {
    const value = (existing as unknown as Record<string, unknown>)[key];
    if (value !== undefined && value !== null) preserved[key] = value;
  }
  return preserved as WorkbookCellStyle;
}

function primitiveCellValue(value: SheetCellData["value"] | undefined): string | number | boolean | null | undefined {
  if (!value) return undefined;
  if (value.type === "primitive" || value.type === "date") return value.value;
  return undefined;
}

export function styledCellData(existing: SheetCellData | undefined, style: WorkbookCellStyle): SheetWritableCellData {
  const meta = { ...preservedCellStyle(existing), ...style };
  if (existing?.formula) return { formula: existing.formula, ...meta };
  const value = primitiveCellValue(existing?.value);
  if (value !== undefined) return { value, ...meta };
  return { text: existing?.text ?? "", ...meta };
}

export const SpreadsheetCanvas = forwardRef<SpreadsheetCanvasHandle, SpreadsheetCanvasProps>(
  function SpreadsheetCanvas({ artifact, grant, onDirtyChange, onStateChange, onError, onSaveError, onSessionClosed }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const t = useT();
    const editorRef = useRef<AbstractedSheetSDK | null>(null);
    const sessionIdRef = useRef("");
    const focusedRef = useRef(false);
    const lifecycleVersionRef = useRef(0);
    const latestGrantTokenRef = useRef(grant.token);
    const changeVersionRef = useRef(0);
    const dirtyRef = useRef(false);
    const stagedImagePendingRef = useRef(false);
    const stagedImageVersionRef = useRef(0);
    const managedSheetsRef = useRef(new Map<string, string[][]>());
    const savePromiseRef = useRef<Promise<boolean> | null>(null);
    const saveHandlerRef = useRef<() => Promise<boolean>>(async () => false);
    const marketingMutationQueueRef = useRef<Promise<void>>(Promise.resolve());
    const marketingMappingRef = useRef<MarketingFieldMapping | undefined>(undefined);
    const catalogRangeTargetRef = useRef<CatalogRangeTarget | undefined>(undefined);
    const catalogSelectionChangedRef = useRef(false);
    const catalogProgrammaticSelectionUntilRef = useRef(0);
    const markerFrameRef = useRef<number | undefined>(undefined);
    const callbacksRef = useRef({ onDirtyChange, onStateChange, onError, onSaveError, onSessionClosed });
    const [state, setState] = useState<SpreadsheetCanvasState>("loading");
    const [prepareError, setPrepareError] = useState<string | null>(null);
    const [loadAttempt, setLoadAttempt] = useState(0);
    const [headerMarkers, setHeaderMarkers] = useState<HeaderMarkerPosition[]>([]);
    const [catalogRange, setCatalogRange] = useState<CatalogRangePosition>();

    callbacksRef.current = { onDirtyChange, onStateChange, onError, onSaveError, onSessionClosed };
    latestGrantTokenRef.current = grant.token;

    const publishState = useCallback((nextState: SpreadsheetCanvasState) => {
      setState(nextState);
      callbacksRef.current.onStateChange?.(nextState);
    }, []);

    const publishDirty = useCallback((dirty: boolean) => {
      dirtyRef.current = dirty;
      callbacksRef.current.onDirtyChange?.(dirty);
    }, []);

    const scheduleHeaderMarkerLayout = useCallback(() => {
      if (markerFrameRef.current !== undefined) cancelAnimationFrame(markerFrameRef.current);
      markerFrameRef.current = requestAnimationFrame(() => {
        markerFrameRef.current = undefined;
        const editor = editorRef.current;
        const container = containerRef.current;
        const mapping = marketingMappingRef.current;
        if (!editor || !container || !mapping || editor.activeSheet.id !== mapping.sheetId) {
          setHeaderMarkers([]);
          return;
        }
        const containerBounds = container.getBoundingClientRect();
        const next = mapping.columns.flatMap((column): HeaderMarkerPosition[] => {
          if (column.role === "ignored") return [];
          const range = editor.activeSheet.getRange({
            type: "cells",
            row: mapping.headerRowIndex,
            rowCount: 1,
            column: column.column,
            columnCount: 1,
          });
          const bounds = range?.getBounding();
          if (!bounds) return [];
          return [{
            column: column.column,
            left: bounds.left - containerBounds.left,
            top: bounds.top - containerBounds.top,
            width: bounds.width,
            height: bounds.height,
            label: marketingFieldRoleLabel(column.role),
            status: column.status,
            confidence: column.confidence,
            reason: column.reason,
          }];
        });
        setHeaderMarkers(next);
      });
    }, []);

    const scheduleCatalogRangeLayout = useCallback(() => {
      requestAnimationFrame(() => {
        const editor = editorRef.current;
        const container = containerRef.current;
        const target = catalogRangeTargetRef.current;
        if (!editor || !container || !target || editor.activeSheet.id !== target.sheetId) {
          setCatalogRange(undefined);
          return;
        }
        const range = editor.activeSheet.getRange({
          type: "cells",
          row: target.headerRowIndex,
          rowCount: Math.max(1, target.firstRowIndex + target.rowCount - target.headerRowIndex),
          column: 0,
          columnCount: target.columnCount,
        });
        const bounds = range?.getBounding();
        if (!bounds) {
          setCatalogRange(undefined);
          return;
        }
        const containerBounds = container.getBoundingClientRect();
        setCatalogRange({
          left: bounds.left - containerBounds.left,
          top: bounds.top - containerBounds.top,
          width: bounds.width,
          height: bounds.height,
          rowCount: target.rowCount,
        });
      });
    }, []);

    const openExternal = useCallback(() => {
      void officecli.openPath(artifact.filePath).catch(() => undefined);
    }, [artifact.filePath]);

    useLayoutEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const lifecycleVersion = ++lifecycleVersionRef.current;
      let disposed = false;
      let prepareSettled = false;
      let uiTornDown = false;
      let editorTornDown = false;
      let backendSessionClosed = false;
      let sessionClosedNotified = false;
      let sessionId = "";
      let editor: AbstractedSheetSDK | null = null;
      let unsubscribe: (() => void) | undefined;
      const viewUnsubscribers: Array<() => void> = [];
      let observer: ResizeObserver | undefined;

      const notifySessionClosed = () => {
        if (sessionClosedNotified) return;
        const replacedBySameTokenLifecycle = lifecycleVersionRef.current > lifecycleVersion + 1
          && latestGrantTokenRef.current === grant.token;
        if (replacedBySameTokenLifecycle) return;
        sessionClosedNotified = true;
        callbacksRef.current.onSessionClosed?.(grant.token);
      };

      const teardown = async () => {
        if (!uiTornDown) {
          uiTornDown = true;
          unsubscribe?.();
          for (const unsubscribeView of viewUnsubscribers) unsubscribeView();
          observer?.disconnect();
          if (markerFrameRef.current !== undefined) {
            cancelAnimationFrame(markerFrameRef.current);
            markerFrameRef.current = undefined;
          }
        }
        if (editor && !editorTornDown) {
          editorTornDown = true;
          await editor.unmount().catch(() => undefined);
          await editor.destroy().catch(() => undefined);
        }
        if (sessionId && !backendSessionClosed) {
          backendSessionClosed = true;
          await officecli.closeXlsxEditor({ previewToken: grant.token, sessionId }).catch(() => undefined);
          notifySessionClosed();
        } else if (disposed && prepareSettled && !sessionId) {
          notifySessionClosed();
        }
      };

      publishState("loading");
      publishDirty(false);
      setPrepareError(null);
      callbacksRef.current.onError?.(undefined);
      callbacksRef.current.onSaveError?.(undefined);
      editorRef.current = null;
      sessionIdRef.current = "";
      savePromiseRef.current = null;
      managedSheetsRef.current = new Map();
      marketingMutationQueueRef.current = Promise.resolve();
      marketingMappingRef.current = undefined;
      catalogRangeTargetRef.current = undefined;
      catalogSelectionChangedRef.current = false;
      catalogProgrammaticSelectionUntilRef.current = 0;
      setHeaderMarkers([]);
      setCatalogRange(undefined);
      changeVersionRef.current = 0;

      void (async () => {
        try {
          const prepared = await officecli.prepareXlsxEditor(grant.token);
          prepareSettled = true;
          sessionId = prepared.sessionId;
          if (disposed) {
            await teardown();
            return;
          }
          editor = await createOfflineSheetEditor(
            container,
            prepared.modocContent,
            prepared.imageAssets ?? [],
            async (file) => {
              const currentSessionId = sessionId || prepared.sessionId;
              const staged = await officecli.stageXlsxEditorImage({
                previewToken: grant.token,
                sessionId: currentSessionId,
                data: await imageFileToBytes(file),
                mime: file.type,
                sheetName: "clipboard",
                row: 0,
                column: 0,
                statusColumn: 0,
              });
              return { assetUrl: staged.url };
            },
          );
          if (disposed) {
            await teardown();
            return;
          }
          observer = new ResizeObserver(() => window.dispatchEvent(new Event("resize")));
          observer.observe(container);
          unsubscribe = editor.content.addChangeListener(() => {
            changeVersionRef.current += 1;
            publishDirty(true);
            callbacksRef.current.onError?.(undefined);
            callbacksRef.current.onSaveError?.(undefined);
            publishState("dirty");
            scheduleHeaderMarkerLayout();
            scheduleCatalogRangeLayout();
          });
          editorRef.current = editor;
          sessionIdRef.current = sessionId;
          const scheduleOverlays = () => {
            scheduleHeaderMarkerLayout();
            scheduleCatalogRangeLayout();
          };
          const handleRangeChanged = () => {
            if (Date.now() > catalogProgrammaticSelectionUntilRef.current) {
              catalogSelectionChangedRef.current = true;
            }
            scheduleOverlays();
          };
          viewUnsubscribers.push(
            editor.eventSubscription.addHorizontalScrollListener(scheduleOverlays),
            editor.eventSubscription.addVerticalScrollListener(scheduleOverlays),
            editor.eventSubscription.addViewportSizeChangedListener(scheduleOverlays),
            editor.eventSubscription.addUrlChangedListener(scheduleOverlays),
            editor.activeSheet.addRangeListener(handleRangeChanged),
          );
          publishState("clean");
          scheduleHeaderMarkerLayout();
        } catch (error) {
          prepareSettled = true;
          await teardown();
          if (!disposed) {
            const message = errorMessage(error);
            setPrepareError(message);
            callbacksRef.current.onError?.(message);
            publishState("error");
          }
        }
      })();

      return () => {
        disposed = true;
        if (lifecycleVersionRef.current === lifecycleVersion) {
          lifecycleVersionRef.current += 1;
          savePromiseRef.current = null;
        }
        editorRef.current = null;
        sessionIdRef.current = "";
        focusedRef.current = false;
        void teardown();
      };
    }, [artifact.filePath, grant.token, loadAttempt, publishDirty, publishState, scheduleCatalogRangeLayout, scheduleHeaderMarkerLayout]);

    const save = useCallback((): Promise<boolean> => {
      if (savePromiseRef.current) {
        const versionWhenQueued = changeVersionRef.current;
        const stagedVersionWhenQueued = stagedImageVersionRef.current;
        return savePromiseRef.current.then((saved) => {
          if (!saved) return false;
          if (
            changeVersionRef.current !== versionWhenQueued
            || stagedImageVersionRef.current !== stagedVersionWhenQueued
            || dirtyRef.current
            || stagedImagePendingRef.current
          ) {
            return saveHandlerRef.current();
          }
          return true;
        });
      }
      const editor = editorRef.current;
      const sessionId = sessionIdRef.current;
      if (!editor || !sessionId) return Promise.resolve(false);
      if (!dirtyRef.current && !stagedImagePendingRef.current && state !== "error") return Promise.resolve(true);

      const lifecycleVersion = lifecycleVersionRef.current;
      const versionAtSaveStart = changeVersionRef.current;
      const stagedImageVersionAtSaveStart = stagedImageVersionRef.current;
      const hadStagedImageAtSaveStart = stagedImagePendingRef.current;
      publishState("saving");
      callbacksRef.current.onError?.(undefined);
      callbacksRef.current.onSaveError?.(undefined);

      const pending = (async () => {
        try {
          // A staged marketing image is persisted as a native XLSX drawing by
          // the backend. Do not ask the Sheet SDK to serialize its cell-image
          // operator here: getContent() can wait forever while that SDK upload
          // remains in-flight, and the backend does not need it for this save.
          const modocContent = hadStagedImageAtSaveStart
            ? ""
            : (await editor.content.getContent()).stringify();
          await officecli.saveXlsxEditor({
            previewToken: grant.token,
            sessionId,
            modocContent,
            managedSheets: Array.from(managedSheetsRef.current, ([sheetName, rows]) => ({ sheetName, rows })),
          });
          if (lifecycleVersionRef.current !== lifecycleVersion) return false;
          if (stagedImageVersionRef.current === stagedImageVersionAtSaveStart) {
            stagedImagePendingRef.current = false;
          }
          const changedDuringSave = changeVersionRef.current !== versionAtSaveStart;
          publishDirty(changedDuringSave);
          publishState(changedDuringSave ? "dirty" : "saved");
          return true;
        } catch (error) {
          if (lifecycleVersionRef.current === lifecycleVersion) {
            const message = errorMessage(error);
            publishDirty(true);
            callbacksRef.current.onSaveError?.(message);
            publishState("error");
          }
          return false;
        } finally {
          if (lifecycleVersionRef.current === lifecycleVersion) {
            savePromiseRef.current = null;
          }
        }
      })();
      savePromiseRef.current = pending;
      return pending;
    }, [grant.token, publishDirty, publishState, state]);

    const enqueueMarketingMutation = useCallback(function enqueue<T>(operation: () => Promise<T>): Promise<T> {
      const pending = marketingMutationQueueRef.current.then(operation, operation);
      marketingMutationQueueRef.current = pending.then(() => undefined, () => undefined);
      return pending;
    }, []);
    saveHandlerRef.current = save;

    useImperativeHandle(ref, () => ({
      save,
      focus() {
        focusedRef.current = true;
        containerRef.current?.focus();
      },
      async snapshot(request) {
        const editor = editorRef.current;
        if (!editor) throw new Error("表格仍在加载，请稍后重试。");
        const worksheets = request.sheetId
          ? [editor.workbook.getWorksheetById(request.sheetId)].filter(Boolean)
          : editor.workbook.getWorksheets().filter((worksheet) => worksheet.visible);
        if (worksheets.length === 0) throw new Error(request.sheetId ? `找不到工作表 ${request.sheetId}。` : "当前工作簿没有可读取的工作表。");
        const originalSheetId = editor.activeSheet.id;
        const sheets = [];
        for (const worksheet of worksheets) {
          const rowCount = Math.min(worksheet!.rowCount, request.maxRows);
          const columnCount = Math.min(worksheet!.columnCount, request.maxColumns);
          // The SDK hydrates cell text lazily, so a worksheet the user never
          // opened reads back as an all-empty matrix. Activate it and wait before
          // reading, or a multi-sheet snapshot silently hands the model blank
          // data for every sheet except the one on screen.
          if (rowCount > 0 && columnCount > 0 && !worksheet!.isActive) {
            catalogProgrammaticSelectionUntilRef.current = Date.now() + 250;
            editor.workbook.setActiveWorksheet(worksheet!.id);
            await waitForWorksheetHydration(worksheet!);
          }
          const range = rowCount > 0 && columnCount > 0
            ? worksheet!.getRange({ type: "cells", row: 0, rowCount, column: 0, columnCount })
            : undefined;
          sheets.push({
            id: worksheet!.id,
            name: worksheet!.name,
            rowCount: worksheet!.rowCount,
            columnCount: worksheet!.columnCount,
            rows: range?.getText("matrix") ?? [],
            truncated: worksheet!.rowCount > rowCount || worksheet!.columnCount > columnCount,
          });
        }
        if (editor.activeSheet.id !== originalSheetId) editor.workbook.setActiveWorksheet(originalSheetId);
        return { activeSheetId: originalSheetId, sheets };
      },
      readSelection() {
        const editor = editorRef.current;
        if (!editor) throw new Error("表格仍在加载，请稍后重试。");
        const worksheet = editor.activeSheet;
        const selection = editor.selections?.[0]?.getRange();
        if (!selection || (selection.type !== "cells" && selection.type !== "rows")) {
          throw new Error("当前表格没有可读取的单元格选区。");
        }
        const column = selection.type === "rows" ? 0 : selection.column;
        const columnCount = selection.type === "rows" ? worksheet.columnCount : selection.columnCount;
        if (selection.rowCount * columnCount > 10_000) {
          throw new Error("当前选区超过 10000 个单元格，请缩小选区后重试。");
        }
        const range = worksheet.getRange({ type: "cells", row: selection.row, rowCount: selection.rowCount, column, columnCount });
        if (!range) throw new Error("无法读取当前单元格选区。");
        return {
          sheetId: worksheet.id,
          sheetName: worksheet.name,
          range: { row: selection.row, column, rowCount: selection.rowCount, columnCount },
          values: range.getText("matrix"),
        };
      },
      readSelectionAddress() {
        const editor = editorRef.current;
        if (!editor) throw new Error("表格仍在加载，请稍后重试。");
        const worksheet = editor.activeSheet;
        const selection = editor.selections?.[0]?.getRange();
        if (!selection || (selection.type !== "cells" && selection.type !== "rows")) {
          throw new Error("当前表格没有可读取的单元格选区。");
        }
        const column = selection.type === "rows" ? 0 : selection.column;
        const columnCount = selection.type === "rows" ? worksheet.columnCount : selection.columnCount;
        return {
          sheetId: worksheet.id,
          sheetName: worksheet.name,
          range: { row: selection.row, column, rowCount: selection.rowCount, columnCount },
        };
      },
      writeCells(request) {
        return enqueueMarketingMutation(async () => {
          const editor = editorRef.current;
          if (!editor) throw new Error("表格编辑器已关闭。");
          const worksheet = request.sheetId
            ? editor.workbook.getWorksheetById(request.sheetId)
            : request.sheetName
              ? editor.workbook.getWorksheets().find((sheet) => sheet.name === request.sheetName)
              : editor.activeSheet;
          if (!worksheet) throw new Error("workbook.write_cells 指定的工作表不存在。");
          const requiredRows = request.startRow + request.values.length;
          const requiredColumns = request.startColumn + request.values[0].length;
          const versionBeforeMutation = changeVersionRef.current;
          editor.workbook.setActiveWorksheet(worksheet.id);
          worksheet.setActiveCell({ row: request.startRow, column: request.startColumn });
          worksheet.locateCell(request.startRow, request.startColumn);
          await editor.batchChanges(async () => {
            await retryWhenSheetCellsReady(() => {
              if (worksheet.rowCount < requiredRows) worksheet.addRows(worksheet.rowCount, requiredRows - worksheet.rowCount);
              if (worksheet.columnCount < requiredColumns) worksheet.addColumns(worksheet.columnCount, requiredColumns - worksheet.columnCount);
            });
            for (let row = 0; row < request.values.length; row += 1) {
              for (let column = 0; column < request.values[row].length; column += 1) {
                await retryWhenSheetCellsReady(() => worksheet.getCell(request.startRow + row, request.startColumn + column)?.setCellText(request.values[row][column]));
              }
            }
          });
          await waitForChangeVersionQuiet(changeVersionRef);
          if (changeVersionRef.current === versionBeforeMutation) {
            changeVersionRef.current += 1;
            publishDirty(true);
            callbacksRef.current.onError?.(undefined);
            callbacksRef.current.onSaveError?.(undefined);
            publishState("dirty");
          }
          return { written: request.values.length * request.values[0].length, sheetId: worksheet.id, sheetName: worksheet.name };
        });
      },
      formatCells(request) {
        return enqueueMarketingMutation(async () => {
          const editor = editorRef.current;
          if (!editor) throw new Error("表格编辑器已关闭。");
          const worksheet = request.sheetId
            ? editor.workbook.getWorksheetById(request.sheetId)
            : request.sheetName
              ? editor.workbook.getWorksheets().find((sheet) => sheet.name === request.sheetName)
              : editor.activeSheet;
          if (!worksheet) throw new Error("workbook.format_cells 指定的工作表不存在。");
          const versionBeforeMutation = changeVersionRef.current;
          editor.workbook.setActiveWorksheet(worksheet.id);
          let formatted = 0;
          await editor.batchChanges(async () => {
            for (const target of request.ranges) {
              // Formatting never grows the sheet: a range that runs past the
              // last row or column is clamped so an over-wide request styles
              // the real data instead of materializing empty cells.
              const rowCount = Math.min(target.rowCount, worksheet.rowCount - target.startRow);
              const columnCount = Math.min(target.columnCount, worksheet.columnCount - target.startColumn);
              if (rowCount <= 0 || columnCount <= 0) continue;
              await retryWhenSheetCellsReady(() => {
                const range = worksheet.getRange({ type: "cells", row: target.startRow, rowCount, column: target.startColumn, columnCount });
                if (!range) throw new Error("workbook.format_cells 无法定位目标区域。");
                const existing = range.getData();
                range.setData(Array.from({ length: rowCount }, (_, row) => (
                  Array.from({ length: columnCount }, (_, column) => styledCellData(existing[row]?.[column], request.style))
                )));
              });
              formatted += rowCount * columnCount;
            }
          });
          if (formatted === 0) throw new Error("workbook.format_cells 的目标区域超出了工作表范围。");
          await waitForChangeVersionQuiet(changeVersionRef);
          if (changeVersionRef.current === versionBeforeMutation) {
            changeVersionRef.current += 1;
            publishDirty(true);
            callbacksRef.current.onError?.(undefined);
            callbacksRef.current.onSaveError?.(undefined);
            publishState("dirty");
          }
          return { formatted, sheetId: worksheet.id, sheetName: worksheet.name };
        });
      },
      stageMedia(request) {
        return enqueueMarketingMutation(async () => {
          const editor = editorRef.current;
          if (!editor) throw new Error("表格编辑器已关闭。");
          const sessionId = sessionIdRef.current;
          if (!sessionId) throw new Error("表格编辑会话已关闭。");
          const worksheet = request.sheetId
            ? editor.workbook.getWorksheetById(request.sheetId)
            : request.sheetName
              ? editor.workbook.getWorksheets().find((sheet) => sheet.name === request.sheetName)
              : editor.activeSheet;
          if (!worksheet) throw new Error("workbook.stage_media 指定的工作表不存在。");
          if (request.row >= worksheet.rowCount || request.column >= worksheet.columnCount) {
            throw new Error("workbook.stage_media 的目标单元格超出当前工作表范围。");
          }
          const staged = await officecli.stageXlsxEditorImage({
            previewToken: grant.token,
            sessionId,
            filePath: request.filePath,
            data: request.data,
            mime: request.mime,
            sheetName: worksheet.name,
            row: request.row,
            column: request.column,
            statusColumn: request.statusColumn,
          });
          stagedImagePendingRef.current = true;
          stagedImageVersionRef.current += 1;
          changeVersionRef.current += 1;
          publishDirty(true);
          callbacksRef.current.onError?.(undefined);
          callbacksRef.current.onSaveError?.(undefined);
          publishState("dirty");
          return { url: staged.url, sheetId: worksheet.id, sheetName: worksheet.name, row: request.row, column: request.column };
        });
      },
      inspectMarketingSelection(assetKind) {
        const editor = editorRef.current;
        if (!editor) throw new Error("表格仍在加载，请稍后重试。");
        const worksheet = editor.activeSheet;
        const selection = editor.selections?.[0]?.getRange();
        if (!selection || (selection.type !== "cells" && selection.type !== "rows")) {
          throw new Error("请先选中包含商品的单元格或整行。");
        }
        // The Sheet SDK reports a merged A1 title cell as one row spanning
        // multiple columns. Treat only a multi-row range as an explicit
        // product selection; otherwise scan the product rows below the
        // detected header.
        const hasAdvancedSelection = selection.rowCount > 1;
        // Header discovery is a sheet-level concern. Tying the scan window to
        // the current selection made name-box selections intermittently miss a
        // header that was visibly above the selected product rows.
        const headerScanRowCount = Math.min(worksheet.rowCount, 50);
        const columnCount = Math.min(Math.max(worksheet.columnCount, 1), 64);
        const headerScanRange = worksheet.getRange({
          type: "cells",
          row: 0,
          rowCount: headerScanRowCount,
          column: 0,
          columnCount,
        });
        const headerCandidates = headerScanRange?.getText("matrix") ?? [];
        const headerRowIndex = findMarketingHeaderRow(headerCandidates, assetKind);
        if (headerRowIndex < 0) {
          throw new Error("找不到商品表头。请确保表格包含“商品名称”以及对应的生图提示词列。");
        }
        const firstRowIndex = hasAdvancedSelection
          ? Math.max(selection.row, headerRowIndex + 1)
          : headerRowIndex + 1;
        const selectionEndRow = hasAdvancedSelection
          ? selection.row + selection.rowCount
          : Math.min(worksheet.rowCount, firstRowIndex + 50);
        const rowCount = selectionEndRow - firstRowIndex;
        if (rowCount <= 0) throw new Error("请选择表头下方至少一行商品数据。");
        if (rowCount > 50) throw new Error("单次最多生成 50 行，请缩小选区后重试。");

        const dataRange = worksheet.getRange({ type: "cells", row: firstRowIndex, rowCount, column: 0, columnCount });
        if (!dataRange) throw new Error("无法读取当前商品选区。");
        const headers = headerCandidates[headerRowIndex] ?? [];
        const rows = dataRange.getText("matrix");
        const batch = parseMarketingSelection({
          sheetId: worksheet.id,
          sheetName: worksheet.name,
          headers,
          rows,
          firstRowIndex,
          existingColumnCount: columnCount,
          headerRowIndex,
          assetKind,
        });
        if (batch.rows.length === 0) {
          throw new Error("选区中没有可生成的商品。请至少提供商品名称或生图提示词。");
        }
        return batch;
      },
      prepareMarketingBatch(batch) {
        const editor = editorRef.current;
        if (!editor) throw new Error("表格仍在加载，请稍后重试。");
        const worksheet = editor.workbook.getWorksheetById(batch.sheetId);
        if (!worksheet) throw new Error("生成任务对应的工作表已不存在。");
        if (!worksheet.getCell(batch.headerRowIndex, batch.outputColumn)) throw new Error("模板图片位置不存在。");
        if (!worksheet.getCell(batch.headerRowIndex, batch.statusColumn)) throw new Error("模板状态列不存在。");
      },
      setMarketingStatus(batch, rowIndex, status) {
        return enqueueMarketingMutation(async () => {
          const editor = editorRef.current;
          if (!editor) throw new Error("表格编辑器已关闭。");
          const cell = editor.workbook.getWorksheetById(batch.sheetId)?.getCell(rowIndex, batch.statusColumn);
          if (!cell) throw new Error("找不到营销图状态单元格。");
          const versionBeforeStatus = changeVersionRef.current;
          cell.setCellText(status);
          if (cell.getCellText() !== status) {
            throw new Error(`状态“${status}”不符合当前单元格规则，无法写入。`);
          }
          await Promise.resolve();
          if (changeVersionRef.current === versionBeforeStatus) {
            changeVersionRef.current += 1;
            publishDirty(true);
            callbacksRef.current.onError?.(undefined);
            callbacksRef.current.onSaveError?.(undefined);
            publishState("dirty");
          }
        });
      },
      insertMarketingImage(batch, rowIndex, filePath) {
        return enqueueMarketingMutation(async () => {
          const editor = editorRef.current;
          if (!editor) throw new Error("表格编辑器已关闭。");
          const sessionId = sessionIdRef.current;
          if (!sessionId) throw new Error("表格编辑会话已关闭。");
          const worksheet = editor.workbook.getWorksheetById(batch.sheetId);
          const cell = worksheet?.getCell(rowIndex, batch.outputColumn);
          if (!worksheet || !cell) throw new Error("找不到营销图回写单元格。");
          const { data, mime } = await officecli.readLocalImage(filePath);
          const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
          const versionBeforeInsert = changeVersionRef.current;
          const fileName = filePath.split(/[\\/]/).pop() || "officedex-marketing-image";
          const staged = await officecli.stageXlsxEditorImage({
            previewToken: grant.token,
            sessionId,
            filePath,
            sheetName: batch.sheetName,
            row: rowIndex,
            column: batch.outputColumn,
            statusColumn: batch.statusColumn,
          });
          stagedImagePendingRef.current = true;
          stagedImageVersionRef.current += 1;
          const dataUrl = imageBytesToDataUrl(bytes, mime);
          const previousActiveCell = editor.activeCell;
          // Sheet SDK's image command uses the active selection even when invoked
          // from a SheetCell instance, so point it at the output cell first.
          worksheet.setActiveCell({ row: rowIndex, column: batch.outputColumn });
          try {
            // The SDK must serialize the MODoc asset URL itself. Replacing a data
            // URL after delta.stringify() corrupts MODoc's encoded segment lengths.
            const imageFile = registerOfflineImage(
              imageBytesToFile(bytes, mime, fileName),
              staged.url,
              dataUrl,
            );
            cell.insertImage(imageFile);
            const emittedChange = await waitForChange(changeVersionRef, versionBeforeInsert);
            if (!emittedChange) {
              // Some Sheet SDK builds apply insertImage successfully without
              // notifying content change listeners. Treat the completed SDK
              // command as the mutation so writeback can continue to save.
              changeVersionRef.current += 1;
              publishDirty(true);
              callbacksRef.current.onError?.(undefined);
              callbacksRef.current.onSaveError?.(undefined);
              publishState("dirty");
            }
          } finally {
            if (previousActiveCell?.sheetId === worksheet.id) {
              worksheet.setActiveCell({ row: previousActiveCell.row, column: previousActiveCell.column });
            }
          }
        });
      },
      setMarketingMapping(mapping) {
        marketingMappingRef.current = mapping;
        scheduleHeaderMarkerLayout();
      },
      async inspectCatalogSheets() {
        const editor = editorRef.current;
        if (!editor) throw new Error("表格仍在加载，请稍后重试。");
        const originalSheet = editor.activeSheet;
        const selection = editor.selections?.[0]?.getRange();
        const hasAdvancedSelection = Boolean(
          catalogSelectionChangedRef.current
          &&
          selection
          && (selection.type === "cells" || selection.type === "rows")
          && (selection.rowCount > 1 || selection.columnCount > 1),
        );
        const worksheets = hasAdvancedSelection
          ? [originalSheet]
          : editor.workbook.getWorksheets().filter((worksheet) => worksheet.visible);
        const selections: CatalogSelection[] = [];
        for (const worksheet of worksheets) {
          if (!hasAdvancedSelection) {
            catalogProgrammaticSelectionUntilRef.current = Date.now() + 250;
            containerRef.current?.focus();
            editor.workbook.setActiveWorksheet(worksheet.id);
            worksheet.setActiveCell({ row: 0, column: 0 });
            worksheet.getSelections()?.[0]?.setRange({ type: "cells", row: 0, rowCount: 1, column: 0, columnCount: 1 });
            // The SDK hydrates cell text lazily: a worksheet that was not active
            // returns an all-empty matrix until activation settles. Without this
            // wait every inactive sheet reads as blank and is silently dropped,
            // so a multi-sheet workbook only ever detects the active sheet.
            await waitForWorksheetHydration(worksheet);
          }
          const columnCount = Math.min(Math.max(worksheet.columnCount, 1), 128);
          const scanStart = hasAdvancedSelection ? Math.max(0, selection!.row - 50) : 0;
          const scanEnd = hasAdvancedSelection
            ? Math.min(worksheet.rowCount, selection!.row + selection!.rowCount)
            : Math.min(worksheet.rowCount, 550);
          if (scanEnd <= scanStart) continue;
          const range = worksheet.getRange({ type: "cells", row: scanStart, rowCount: scanEnd - scanStart, column: 0, columnCount });
          if (!range) continue;
          let rows = range.getText("matrix");
          if (!hasAdvancedSelection) {
          let lastRow = rows.length - 1;
          while (lastRow >= 0 && rows[lastRow].every((value) => !value.trim())) lastRow -= 1;
          if (lastRow < 0) continue;
          let lastColumn = 0;
          for (const row of rows.slice(0, lastRow + 1)) {
            for (let column = row.length - 1; column >= 0; column -= 1) {
              if (row[column]?.trim()) {
                lastColumn = Math.max(lastColumn, column);
                break;
              }
            }
          }
          rows = rows.slice(0, lastRow + 1).map((row) => row.slice(0, lastColumn + 1));
          }
          selections.push({
            sheetId: worksheet.id,
            sheetName: worksheet.name,
            rows,
            selectionStartRow: hasAdvancedSelection ? selection!.row - scanStart : 0,
          });
        }
        if (!hasAdvancedSelection) editor.workbook.setActiveWorksheet(originalSheet.id);
        if (selections.length === 0) throw new Error("No product data was found in this workbook.");
        return { selections, advancedSelection: hasAdvancedSelection };
      },
      previewCatalogCleanup(batch) {
        if (!batch) {
          catalogRangeTargetRef.current = undefined;
          setCatalogRange(undefined);
          return;
        }
        catalogRangeTargetRef.current = {
          sheetId: batch.sheetId,
          headerRowIndex: batch.headerRowIndex,
          firstRowIndex: batch.firstRowIndex,
          rowCount: batch.sourceRows.length,
          columnCount: batch.existingColumnCount,
        };
        const worksheet = editorRef.current?.workbook.getWorksheetById(batch.sheetId);
        worksheet?.setActiveCell({ row: batch.firstRowIndex, column: 0 });
        worksheet?.locateCell(batch.headerRowIndex, 0);
        scheduleCatalogRangeLayout();
      },
      applyCatalogCleanup(batch) {
        return enqueueMarketingMutation(async () => {
          const editor = editorRef.current;
          if (!editor) throw new Error("表格编辑器已关闭。");
          const worksheet = editor.workbook.getWorksheetById(batch.sheetId)
            ?? editor.workbook.getWorksheets().find((sheet) => sheet.name === batch.sheetName);
          if (!worksheet) {
            const available = editor.workbook.getWorksheets().map((sheet) => `${sheet.name}(${sheet.id})`).join(", ");
            throw new Error(`The source worksheet no longer exists: ${batch.sheetName}(${batch.sheetId}). Available: ${available || "none"}.`);
          }
          // Writing into a worksheet the user has not opened fails with
          // "单元格加载中" because the SDK has not hydrated its cells yet. Activate
          // the target and wait for it before mutating, so a multi-sheet cleanup
          // can write every sheet instead of only the one on screen.
          if (!worksheet.isActive) {
            catalogProgrammaticSelectionUntilRef.current = Date.now() + 250;
            editor.workbook.setActiveWorksheet(worksheet.id);
            await waitForWorksheetHydration(worksheet);
          }
          if (worksheet.columnCount < batch.existingColumnCount + 7) worksheet.addColumns(worksheet.columnCount, batch.existingColumnCount + 7 - worksheet.columnCount);
          const headers: Array<[number, string]> = [
            [batch.resultColumns.status, "OfficeDex Status"],
            [batch.resultColumns.issues, "OfficeDex Findings"],
            [batch.resultColumns.cleanup, "OfficeDex Cleanup"],
            [batch.resultColumns.handle, "Shopify URL Handle"],
            [batch.resultColumns.sku, "Clean SKU"],
            [batch.resultColumns.title, "Clean Title"],
            [batch.resultColumns.price, "Clean Price"],
          ];
          headers.forEach(([column, value]) => worksheet.getCell(batch.headerRowIndex, column)?.setCellText(value));
          for (const row of batch.rows) {
            worksheet.getCell(row.rowIndex, batch.resultColumns.status)?.setCellText(row.status);
            worksheet.getCell(row.rowIndex, batch.resultColumns.issues)?.setCellText(row.findings.map((item) => `[${item.severity.toUpperCase()}] ${item.message}`).join("; "));
            worksheet.getCell(row.rowIndex, batch.resultColumns.cleanup)?.setCellText(row.cleanupActions.map((item) => `[${item.safety.toUpperCase()}] ${item.message}: “${item.before}” → “${item.after}”`).join("; "));
            worksheet.getCell(row.rowIndex, batch.resultColumns.handle)?.setCellText(row.values.handle);
            worksheet.getCell(row.rowIndex, batch.resultColumns.sku)?.setCellText(row.values.sku);
            worksheet.getCell(row.rowIndex, batch.resultColumns.title)?.setCellText(row.values.title);
            worksheet.getCell(row.rowIndex, batch.resultColumns.price)?.setCellText(row.values.price);
          }
          await Promise.resolve();
          publishDirty(true);
          callbacksRef.current.onError?.(undefined);
          callbacksRef.current.onSaveError?.(undefined);
          publishState("dirty");
        });
      },
      replaceManagedSheet(input) {
        return enqueueMarketingMutation(async () => {
          const editor = editorRef.current;
          if (!editor) throw new Error("表格编辑器已关闭。");
          const sheetName = input.sheetName.trim();
          if (!sheetName) throw new Error("托管工作表名称不能为空。");
          if (input.headers.length === 0) throw new Error("托管工作表必须至少包含一列。");
          const workbook = editor.workbook;
          let worksheet = workbook.getWorksheets().find((sheet) => sheet.name === sheetName);
          if (!worksheet) {
            workbook.addWorksheet(sheetName);
            worksheet = workbook.getWorksheets().find((sheet) => sheet.name === sheetName);
          }
          if (!worksheet) throw new Error(`无法创建工作表“${sheetName}”。`);
          // Sheet SDK lazily hydrates cell models for inactive worksheets. Make
          // the managed sheet visible before reading or mutating ranges; retrying
          // writes alone cannot make an inactive sheet finish loading.
          workbook.setActiveWorksheet(worksheet.id);
          worksheet.setActiveCell({ row: 0, column: 0 });
          worksheet.locateCell(0, 0);

          const preservedByKey = new Map<string, Map<string, string>>();
          let existingMatrix: string[][] = [];
          const keyHeader = input.keyColumn?.trim();
          const preserveHeaders = (input.preserveColumns ?? []).map((header) => header.trim()).filter(Boolean);
          if (keyHeader && preserveHeaders.length > 0 && worksheet.rowCount > 1 && worksheet.columnCount > 0) {
            existingMatrix = await retryWhenSheetCellsReady(() => (
              worksheet!.getRange({ type: "cells", row: 0, rowCount: worksheet!.rowCount, column: 0, columnCount: worksheet!.columnCount })?.getText("matrix") ?? []
            ));
            const existingHeaders = existingMatrix[0] ?? [];
            const keyIndex = existingHeaders.indexOf(keyHeader);
            const preserveIndexes = preserveHeaders.map((header) => ({ header, index: existingHeaders.indexOf(header) })).filter((item) => item.index >= 0);
            if (keyIndex >= 0 && preserveIndexes.length > 0) {
              for (const row of existingMatrix.slice(1)) {
                const key = row[keyIndex]?.trim();
                if (!key) continue;
                const values = new Map<string, string>();
                preserveIndexes.forEach(({ header, index }) => values.set(header, row[index] ?? ""));
                preservedByKey.set(key, values);
              }
            }
          }

          const requiredRows = Math.max(1, input.rows.length + 1);
          const requiredColumns = input.headers.length;
          const targetKeyIndex = keyHeader ? input.headers.indexOf(keyHeader) : -1;
          const targetPreserveIndexes = preserveHeaders.map((header) => ({ header, index: input.headers.indexOf(header) })).filter((item) => item.index >= 0);
          const matrix = [input.headers, ...input.rows.map((row) => {
            const next = input.headers.map((_, column) => row[column] ?? "");
            const key = targetKeyIndex >= 0 ? next[targetKeyIndex]?.trim() : "";
            const preserved = key ? preservedByKey.get(key) : undefined;
            if (preserved) targetPreserveIndexes.forEach(({ header, index }) => { next[index] = preserved.get(header) ?? next[index]; });
            return next;
          })];
          const versionBeforeMutation = changeVersionRef.current;
          await editor.batchChanges(async () => {
            await retryWhenSheetCellsReady(() => {
              if (worksheet!.rowCount < requiredRows) worksheet!.addRows(worksheet!.rowCount, requiredRows - worksheet!.rowCount);
              if (worksheet!.columnCount < requiredColumns) worksheet!.addColumns(worksheet!.columnCount, requiredColumns - worksheet!.columnCount);
            });
            // Range.setText can update the rendered grid without reliably
            // hydrating inactive cells. Use cell commands for the visible editor;
            // the exact managed matrix is persisted separately during save.
            for (let row = 0; row < existingMatrix.length; row += 1) {
              for (let column = 0; column < existingMatrix[row].length; column += 1) {
                if (!existingMatrix[row][column] || (row < matrix.length && column < input.headers.length)) continue;
                await retryWhenSheetCellsReady(() => worksheet!.getCell(row, column)?.setCellText(""));
              }
            }
            for (let row = 0; row < matrix.length; row += 1) {
              for (let column = 0; column < input.headers.length; column += 1) {
                await retryWhenSheetCellsReady(() => worksheet!.getCell(row, column)?.setCellText(matrix[row][column] ?? ""));
              }
            }
            await retryWhenSheetCellsReady(() => {
              worksheet!.setColumnsWidth(input.headers.map((header, column) => ({ column, width: Math.min(320, Math.max(96, header.length * 12)) })));
            });
          });
          managedSheetsRef.current.set(sheetName, matrix.map((row) => [...row]));
          // Programmatic cell edits can emit their final change event after the
          // batch promise resolves. Let that stream become quiet before the Jira
          // panel starts saving, otherwise a late event marks a successful save
          // dirty again.
          await waitForChangeVersionQuiet(changeVersionRef);
          if (changeVersionRef.current === versionBeforeMutation) {
            changeVersionRef.current += 1;
            publishDirty(true);
            callbacksRef.current.onError?.(undefined);
            callbacksRef.current.onSaveError?.(undefined);
            publishState("dirty");
          }
        });
      },
      addChart(request) {
        return enqueueMarketingMutation(async () => {
          const editor = editorRef.current;
          if (!editor) throw new Error("表格编辑器已关闭。");
          await waitForChartPlugin(editor);
          const worksheet = request.sheetId
            ? editor.workbook.getWorksheetById(request.sheetId)
            : request.sheetName
              ? editor.workbook.getWorksheets().find((sheet) => sheet.name === request.sheetName)
              : editor.activeSheet;
          if (!worksheet) throw new Error("workbook.add_chart 指定的工作表不存在。");
          // addChartFromSelection reads the active sheet, so the requested sheet
          // has to be active before the chart is created.
          if (!worksheet.isActive) editor.workbook.setActiveWorksheet(worksheet.id);

          const versionBeforeMutation = changeVersionRef.current;
          const created = editor.charts.addChartFromSelection({
            range: { type: "cells", ...request.range },
            chart: {
              ...(request.title === undefined ? {} : { title: request.title }),
              ...(request.legendVisible === undefined ? {} : { legendVisible: request.legendVisible }),
              ...(request.width === undefined ? {} : { width: request.width }),
              ...(request.height === undefined ? {} : { height: request.height }),
              sheetId: worksheet.id,
            },
            series: {
              orientation: request.orientation ?? "auto",
              trimPaddings: true,
              firstAs: request.firstAs ?? "auto",
            },
            recommendation: { mode: "external", chartType: request.chartType },
          });
          if (!created) throw new Error("表格编辑器未能为该区域创建图表。");

          await waitForChangeVersionQuiet(changeVersionRef);
          if (changeVersionRef.current === versionBeforeMutation) {
            changeVersionRef.current += 1;
            publishDirty(true);
            callbacksRef.current.onError?.(undefined);
            callbacksRef.current.onSaveError?.(undefined);
            publishState("dirty");
          }
          return {
            chartId: created.chartId,
            chartType: created.chartType,
            sheetId: worksheet.id,
            sheetName: worksheet.name,
          };
        });
      },
    }), [enqueueMarketingMutation, publishDirty, publishState, save, scheduleHeaderMarkerLayout]);

    useEffect(() => {
      const handlePointerDown = (event: PointerEvent) => {
        focusedRef.current = Boolean(containerRef.current?.contains(event.target as Node));
      };
      const handleKeyDown = (event: KeyboardEvent) => {
        if (!focusedRef.current || !event.metaKey || event.key.toLowerCase() !== "s") return;
        event.preventDefault();
        void saveHandlerRef.current();
      };
      document.addEventListener("pointerdown", handlePointerDown);
      document.addEventListener("keydown", handleKeyDown);
      return () => {
        document.removeEventListener("pointerdown", handlePointerDown);
        document.removeEventListener("keydown", handleKeyDown);
      };
    }, []);

    useEffect(() => {
      if (!dirtyRef.current) return;
      const handleBeforeUnload = (event: BeforeUnloadEvent) => {
        event.preventDefault();
        event.returnValue = "";
      };
      window.addEventListener("beforeunload", handleBeforeUnload);
      return () => window.removeEventListener("beforeunload", handleBeforeUnload);
    }, [state]);

    useEffect(() => () => {
      callbacksRef.current.onDirtyChange?.(false);
    }, []);

    if (prepareError) {
      return (
        <section className="spreadsheet-canvas spreadsheet-canvas--error" aria-label={artifact.fileName}>
          <div className="spreadsheet-canvas__error">
            <AlertCircle aria-hidden="true" />
            <strong>{t("spreadsheet.error.cannotOpen")}</strong>
            <span>{prepareError}</span>
            <div>
              <Button variant="primary" size="small" onClick={() => {
                setPrepareError(null);
                setLoadAttempt((attempt) => attempt + 1);
              }}>{t("spreadsheet.error.retry")}</Button>
              <Button size="small" onClick={openExternal}>{t("spreadsheet.error.openExternal")}</Button>
            </div>
          </div>
        </section>
      );
    }

    return (
      <section className="spreadsheet-canvas" aria-label={artifact.fileName}>
        <div ref={containerRef} className="spreadsheet-canvas__editor" tabIndex={-1} />
        <div className="spreadsheet-header-markers" aria-hidden="true">
          {headerMarkers.map((marker) => (
            <span
              key={marker.column}
              className="spreadsheet-header-marker"
              data-status={marker.status}
              data-confidence={marker.confidence < 0.6 ? "low" : marker.confidence < 0.85 ? "medium" : "high"}
              title={`${marker.label} · ${marker.reason}`}
              style={{
                left: marker.left,
                top: marker.top,
                width: marker.width,
                height: marker.height,
              }}
            >
              <span>{marker.label}</span>
            </span>
          ))}
        </div>
        {catalogRange ? (
          <div
            className="spreadsheet-catalog-range"
            aria-hidden="true"
            style={{ left: catalogRange.left, top: catalogRange.top, width: catalogRange.width, height: catalogRange.height }}
          >
            <span>OfficeDex detected · {catalogRange.rowCount} product rows</span>
          </div>
        ) : null}
        {state === "loading" ? (
          <div className="spreadsheet-canvas__loading">
            <FileSpreadsheet aria-hidden="true" />
            <span>{t("spreadsheet.loading", { file: artifact.fileName })}</span>
          </div>
        ) : null}
      </section>
    );
  },
);
