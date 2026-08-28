import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, Download, ScanSearch, TableProperties, TriangleAlert } from "lucide-react";
import { Button, Select } from "../ui";
import {
  CATALOG_FIELD_ROLE_OPTIONS,
  catalogBatchToFindingsCsv,
  catalogBatchToShopifyCsv,
  type CatalogCleanupBatch,
  type CatalogInspection,
  type CatalogFieldRole,
  type CatalogImportIntent,
} from "./catalogCleanupWorkflow";
import { confirmAgentApproval, executeAgentWorkflow } from "../agentRuntime";

export interface SpreadsheetCatalogCleanupPanelProps {
  fileName?: string;
  filePath?: string;
  workspaceId?: string;
  onInspect: () => CatalogInspection | Promise<CatalogInspection>;
  onPreview?: (batch?: CatalogCleanupBatch) => void;
  onApply: (batch: CatalogCleanupBatch) => Promise<void>;
  onSave: () => Promise<boolean>;
  onCompleted?: () => void;
  autoScan?: boolean;
}

function downloadCsv(batch: CatalogCleanupBatch, fileName?: string) {
  const blob = new Blob([catalogBatchToShopifyCsv(batch)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${(fileName || "supplier-catalog").replace(/\.[^.]+$/, "")}-shopify.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadFindingsCsv(batch: CatalogCleanupBatch, fileName?: string) {
  const blob = new Blob([catalogBatchToFindingsCsv(batch)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${(fileName || "supplier-catalog").replace(/\.[^.]+$/, "")}-shopify-findings.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function isNonCatalogSheetError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("could not find catalog header");
}

async function runCatalogCleanup(parameters: Record<string, unknown>, metadata: Record<string, string> = {}): Promise<CatalogCleanupBatch> {
  const { result } = await executeAgentWorkflow<CatalogCleanupBatch>(
    "catalog.cleanup.v1",
    { parameters },
    {},
    { surface: "spreadsheet.catalog-cleanup", operation: "scan", ...metadata },
  );
  return result;
}

export function SpreadsheetCatalogCleanupPanel({ fileName, filePath, workspaceId, onInspect, onPreview, onApply, onSave, onCompleted, autoScan = false }: SpreadsheetCatalogCleanupPanelProps) {
  const [intent, setIntent] = useState<CatalogImportIntent>("create");
  const [batches, setBatches] = useState<CatalogCleanupBatch[]>([]);
  const [skippedSheets, setSkippedSheets] = useState<Array<{ sheetName: string; reason: string }>>([]);
  const [activeSheetId, setActiveSheetId] = useState("");
  const [working, setWorking] = useState(false);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string>();
  const [showAllMappings, setShowAllMappings] = useState(false);
  const autoScanAttempted = useRef(false);
  const batch = batches.find((item) => item.sheetId === activeSheetId) ?? batches[0];
  const runtimeMetadata = useMemo(() => ({
    ...(filePath ? { workbook_path: filePath } : {}),
    ...(workspaceId ? { workspace_id: workspaceId } : {}),
  }), [filePath, workspaceId]);
  const summary = useMemo(() => ({
    ready: batch?.rows.filter((row) => row.status === "Ready").length ?? 0,
    attention: batch?.rows.filter((row) => row.status === "Review" || row.status === "Missing Asset").length ?? 0,
    blocked: batch?.rows.filter((row) => row.status === "Blocked" || row.status === "Duplicate").length ?? 0,
  }), [batch]);
  const findingSummary = useMemo(() => ({
    errors: batch ? [...batch.batchFindings, ...batch.rows.flatMap((row) => row.findings)].filter((item) => item.severity === "error").length : 0,
    warnings: batch ? [...batch.batchFindings, ...batch.rows.flatMap((row) => row.findings)].filter((item) => item.severity === "warning").length : 0,
    suggestions: batch ? [...batch.batchFindings, ...batch.rows.flatMap((row) => row.findings)].filter((item) => item.severity === "suggestion").length : 0,
  }), [batch]);
  const cleanupSummary = useMemo(() => ({
    rows: batch?.rows.filter((row) => row.cleanupActions.length > 0).length ?? 0,
    actions: batch?.rows.reduce((sum, row) => sum + row.cleanupActions.length, 0) ?? 0,
    defaults: batch?.rows.reduce((sum, row) => sum + row.cleanupActions.filter((item) => item.safety === "conservative-default").length, 0) ?? 0,
  }), [batch]);
  const uncertainMappings = useMemo(() => batch?.mapping.filter((column) => column.role === "ignored" || column.confidence < 0.8) ?? [], [batch]);
  const missingRequiredFields = useMemo(() => [
    ["title", "product title"],
    ...(intent === "create" ? [] : [["handle", "URL handle"]]),
  ].flatMap(([role, label]) => batch && !batch.mapping.some((column) => column.role === role) ? [label] : []), [batch, intent]);

  const scan = useCallback(async () => {
    setError(undefined);
    setApplied(false);
    setBatches([]);
    setSkippedSheets([]);
    setActiveSheetId("");
    onPreview?.(undefined);
    setShowAllMappings(false);
    try {
      setWorking(true);
      const inspected = await onInspect();
      const results = await Promise.all(inspected.selections.map(async (selection) => {
        try {
          return { batch: await runCatalogCleanup({ ...selection, intent }, runtimeMetadata) };
        } catch (err) {
          if (!isNonCatalogSheetError(err)) throw err;
          return { skipped: { sheetName: selection.sheetName, reason: err instanceof Error ? err.message : String(err) } };
        }
      }));
      const nextBatches = results.flatMap((result) => result.batch ? [result.batch] : []);
      const nextSkipped = results.flatMap((result) => result.skipped ? [result.skipped] : []);
      if (nextBatches.length === 0) throw new Error(nextSkipped[0]?.reason || "No Shopify product catalog was found in this workbook.");
      setBatches(nextBatches);
      setSkippedSheets(nextSkipped);
      setActiveSheetId(nextBatches[0].sheetId);
      onPreview?.(nextBatches[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setWorking(false); }
  }, [intent, onInspect, onPreview, runtimeMetadata]);

  useEffect(() => {
    autoScanAttempted.current = false;
  }, [fileName]);

  useEffect(() => {
    if (!autoScan || autoScanAttempted.current) return;
    autoScanAttempted.current = true;
    void scan();
  }, [autoScan, scan]);

  const changeRole = (column: number, role: CatalogFieldRole) => {
    if (!batch) return;
    const mapping = batch.mapping.map((item) => item.column === column ? { ...item, role, confidence: 1, reason: "User confirmed" } : item.role === role && role !== "ignored" ? { ...item, role: "ignored", confidence: 0, reason: "Replaced by user mapping" } : item);
    void runCatalogCleanup({
      sheetId: batch.sheetId, sheetName: batch.sheetName,
      rows: [batch.headers, ...batch.sourceRows], selectionStartRow: 1, intent,
      confirmedMapping: mapping,
    }, runtimeMetadata).then((nextBatch) => { setBatches((current) => current.map((item) => item.sheetId === nextBatch.sheetId ? nextBatch : item)); onPreview?.(nextBatch); }).catch((err) => setError(err instanceof Error ? err.message : String(err)));
    setApplied(false);
  };

  const changeIntent = (nextIntent: CatalogImportIntent) => {
    setIntent(nextIntent);
    if (batches.length > 0) void Promise.all(batches.map((currentBatch) => runCatalogCleanup({
      sheetId: currentBatch.sheetId, sheetName: currentBatch.sheetName,
      rows: [currentBatch.headers, ...currentBatch.sourceRows], selectionStartRow: 1, intent: nextIntent,
      confirmedMapping: currentBatch.mapping,
    }, runtimeMetadata))).then((nextBatches) => { setBatches(nextBatches); const active = nextBatches.find((item) => item.sheetId === activeSheetId) ?? nextBatches[0]; onPreview?.(active); }).catch((err) => setError(err instanceof Error ? err.message : String(err)));
    setApplied(false);
  };

  const apply = async () => {
    if (!batch || working) return;
    setWorking(true);
    setError(undefined);
    try {
      const clientTools = [
        ...batches.map((currentBatch, index) => ({
          call_id: `catalog-cleanup:apply:${currentBatch.sheetId}:${index + 1}`,
          tool: "workbook.catalog_cleanup.apply",
          resource_ref: currentBatch.sheetId,
          risk: "write",
          arguments: { batch: currentBatch },
        })),
        { call_id: "catalog-cleanup:save", tool: "workbook.save", resource_ref: fileName || "workbook", risk: "write" },
      ];
      await executeAgentWorkflow(
        "client-tools.v1",
        { parameters: { sheet_ids: batches.map((item) => item.sheetId) }, client_tools: clientTools },
        {
          approve: confirmAgentApproval,
          clientTools: {
            "workbook.catalog_cleanup.apply": async (request) => {
              const currentBatch = request.arguments.batch as CatalogCleanupBatch | undefined;
              if (!currentBatch) throw new Error("Catalog cleanup Runtime did not provide a batch for writeback.");
              await onApply(currentBatch);
              return { applied: true, sheet_id: currentBatch.sheetId };
            },
            "workbook.save": async () => {
              if (!await onSave()) throw new Error("Cleaned results were written, but the workbook could not be saved.");
              return { saved: true };
            },
          },
        },
        { surface: "spreadsheet.catalog-cleanup", operation: "apply-save", ...runtimeMetadata },
      );
      setApplied(true);
      onCompleted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="spreadsheet-catalog-panel" aria-label="Supplier Catalog Cleanup & Import">
      <div className="spreadsheet-catalog-panel__heading"><div><TableProperties aria-hidden="true" /><strong>Supplier Catalog Cleanup</strong></div><span>Shopify import</span></div>
      <p>OfficeDex scans every visible sheet and cleans each detected supplier catalog. Manually select multiple cells or rows first only when you need an advanced single-sheet override.</p>
      <label className="spreadsheet-catalog-panel__intent"><span>Import intent</span><Select size="small" ariaLabel="Shopify import intent" value={intent} options={[
        { value: "create", label: "Create new products" },
        { value: "update", label: "Update existing products" },
        { value: "mixed", label: "Mixed create and update" },
      ]} onChange={changeIntent} /></label>
      <Button size="small" variant="secondary" icon={<ScanSearch />} loading={working} onClick={() => void scan()}>Detect product catalog</Button>
      {batch ? <>
        <label className="spreadsheet-catalog-panel__intent"><span>Detected sheet</span><Select size="small" ariaLabel="Detected Shopify sheet" value={batch.sheetId} options={batches.map((item) => ({ value: item.sheetId, label: `${item.sheetName} · ${item.rows.length} rows` }))} onChange={(sheetId) => { setActiveSheetId(sheetId); onPreview?.(batches.find((item) => item.sheetId === sheetId)); }} /></label>
        <small>{batches.length} catalog sheets detected{skippedSheets.length ? ` · ${skippedSheets.length} non-catalog sheets skipped` : ""} · {batches.reduce((sum, item) => sum + item.rows.length, 0)} total rows</small>
        <Button size="small" variant="primary" loading={working} disabled={batches.some((item) => item.rows.length === 0 || item.batchFindings.some((finding) => finding.severity === "error") || !item.mapping.some((column) => column.role === "title") || (intent !== "create" && !item.mapping.some((column) => column.role === "handle")))} onClick={() => void apply()}>{applied ? "Validate and write all sheets again" : `Validate ${batches.reduce((sum, item) => sum + item.rows.length, 0)} rows across ${batches.length} sheets`}</Button>
        <div className="spreadsheet-catalog-panel__summary">
          <strong>{batch.rows.length} products found</strong>
          <div className="spreadsheet-catalog-panel__outcomes">
            <span data-status="ready"><b>{summary.ready}</b>Ready to import</span>
            <span data-status="attention"><b>{summary.attention}</b>Needs attention</span>
            <span data-status="blocked"><b>{summary.blocked}</b>Can't import</span>
          </div>
          <p>{findingSummary.errors} blocking errors · {findingSummary.warnings} warnings · {findingSummary.suggestions} suggestions. Checks include Shopify identity fields, numeric formats, option dependencies, duplicate variant combinations, SKU ambiguity, image URL format and standard product taxonomy.</p>
          <p>{cleanupSummary.actions} safe cleanup actions across {cleanupSummary.rows} rows{cleanupSummary.defaults ? ` · ${cleanupSummary.defaults} conservative defaults for new products` : ""}. Supplier columns remain unchanged.</p>
          <small>No estimate or balance check · preview is free · actual usage is billed after apply completes</small>
        </div>
        {missingRequiredFields.length > 0 ? <div className="spreadsheet-catalog-panel__required" role="alert"><TriangleAlert aria-hidden="true" /><div><strong>Required field not recognized</strong><span>Choose the column for {missingRequiredFields.join(", ")} before cleaning.</span></div></div> : null}
        {batch.batchFindings.some((item) => item.severity === "error") ? <div className="spreadsheet-catalog-panel__required" role="alert"><TriangleAlert aria-hidden="true" /><div><strong>File structure needs attention</strong><span>{batch.batchFindings.filter((item) => item.severity === "error").map((item) => item.message).join("; ")}</span></div></div> : null}
        {uncertainMappings.length > 0 ? <div className="spreadsheet-catalog-panel__mapping">
          <strong>{uncertainMappings.length} {uncertainMappings.length === 1 ? "column needs" : "columns need"} your confirmation</strong>
          <span>Tell OfficeDex what these supplier columns mean, or leave unrelated columns as Ignore.</span>
          <div>{uncertainMappings.map((column) => <label key={column.column}><span>{column.header || `Column ${column.column + 1}`}</span><Select size="small" ariaLabel={`Map ${column.header}`} value={column.role as CatalogFieldRole} options={CATALOG_FIELD_ROLE_OPTIONS} onChange={(value) => changeRole(column.column, value)} /></label>)}</div>
        </div> : <div className="spreadsheet-catalog-panel__recognized"><CheckCircle2 aria-hidden="true" /><span>Required fields recognized automatically</span></div>}
        <button type="button" className="spreadsheet-catalog-panel__mapping-toggle" aria-expanded={showAllMappings} onClick={() => setShowAllMappings((shown) => !shown)}>Review recognized fields <ChevronDown className={showAllMappings ? "is-open" : ""} aria-hidden="true" /></button>
        {showAllMappings ? <div className="spreadsheet-catalog-panel__mapping spreadsheet-catalog-panel__mapping--all"><div>{batch.mapping.map((column) => <label key={column.column}><span>{column.header || `Column ${column.column + 1}`}</span><Select size="small" ariaLabel={`Map ${column.header}`} value={column.role as CatalogFieldRole} options={CATALOG_FIELD_ROLE_OPTIONS} onChange={(value) => changeRole(column.column, value)} /></label>)}</div></div> : null}
        <div className="spreadsheet-catalog-panel__scope"><TriangleAlert aria-hidden="true" /><span>{intent === "create" ? "New products receive conservative Shopify defaults and remain draft/unpublished." : "Update exports include only mapped fields, so missing supplier columns are not exported as blank overwrites."} Rules run in the proprietary OfficeCLI channel engine ({batch.ruleVersion}); taxonomy {batch.taxonomyVersion}. Local preflight still cannot check store handles, image reachability, locations, or product-reference metafields.</span></div>
        {applied ? <><div className="spreadsheet-catalog-panel__done"><CheckCircle2 aria-hidden="true" />Validation results were saved in six new columns. Original supplier data was not changed.</div><Button size="small" variant="secondary" icon={<Download />} disabled={summary.blocked === batch.rows.length} onClick={() => downloadCsv(batch, fileName)}>Download Shopify draft CSV</Button><Button size="small" variant="secondary" icon={<Download />} onClick={() => downloadFindingsCsv(batch, fileName)}>Download findings report</Button></> : null}
      </> : null}
      {error ? <div className="spreadsheet-catalog-panel__error" role="alert">{error}</div> : null}
    </section>
  );
}
