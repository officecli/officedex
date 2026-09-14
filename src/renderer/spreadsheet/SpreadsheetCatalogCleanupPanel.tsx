import { useT } from "../i18n";
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
  const t = useT();
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
    ["title", t("catalog.ui.producttitle")],
    ...(intent === "create" ? [] : [["handle", t("catalog.ui.URLhandle")]]),
  ].flatMap(([role, label]) => batch && !batch.mapping.some((column) => column.role === role) ? [label] : []), [batch, intent, t]);

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
      if (nextBatches.length === 0) throw new Error(nextSkipped[0]?.reason || t("catalog.ui.NoShopifyproductcatalogwasfoundinthisworkbook"));
      setBatches(nextBatches);
      setSkippedSheets(nextSkipped);
      setActiveSheetId(nextBatches[0].sheetId);
      onPreview?.(nextBatches[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setWorking(false); }
  }, [intent, onInspect, onPreview, runtimeMetadata, t]);

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
              if (!currentBatch) throw new Error(t("catalog.ui.CatalogcleanupRuntimedidnotprovideabatchforwriteback"));
              await onApply(currentBatch);
              return { applied: true, sheet_id: currentBatch.sheetId };
            },
            "workbook.save": async () => {
              if (!await onSave()) throw new Error(t("catalog.ui.Cleanedresultswerewrittenbuttheworkbookcouldnotbesaved"));
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
    <section className="spreadsheet-catalog-panel" aria-label={t("catalog.ui.SupplierCatalogCleanupImport")}>
      <div className="spreadsheet-catalog-panel__heading"><div><TableProperties aria-hidden="true" /><strong>{t("catalog.ui.SupplierCatalogCleanup")}</strong></div><span>{t("catalog.ui.Shopifyimport")}</span></div>
      <p>{t("catalog.ui.OfficeDexscanseveryvisiblesheetandcleanseachdetectedsuppliercatalogManuallyselectmultiplec")}</p>
      <label className="spreadsheet-catalog-panel__intent"><span>{t("catalog.ui.Importintent")}</span><Select size="small" ariaLabel={t("catalog.ui.Shopifyimportintent")} value={intent} options={[
        { value: "create", label: t("catalog.ui.Createnewproducts") },
        { value: "update", label: t("catalog.ui.Updateexistingproducts") },
        { value: "mixed", label: t("catalog.ui.Mixedcreateandupdate") },
      ]} onChange={changeIntent} /></label>
      <Button size="small" variant="secondary" icon={<ScanSearch />} loading={working} onClick={() => void scan()}>{t("catalog.ui.Detectproductcatalog")}</Button>
      {batch ? <>
        <label className="spreadsheet-catalog-panel__intent"><span>{t("catalog.ui.Detectedsheet")}</span><Select size="small" ariaLabel={t("catalog.ui.DetectedShopifysheet")} value={batch.sheetId} options={batches.map((item) => ({ value: item.sheetId, label: t("catalog.ui.namecountrows", { name: item.sheetName, count: item.rows.length }) }))} onChange={(sheetId) => { setActiveSheetId(sheetId); onPreview?.(batches.find((item) => item.sheetId === sheetId)); }} /></label>
        <small>{t("catalog.ui.sheetscatalogsheetsdetectedskippednoncatalogsheetsskippedrowstotalrows", { sheets: batches.length, skipped: skippedSheets.length, rows: batches.reduce((sum, item) => sum + item.rows.length, 0) })}</small>
        <Button size="small" variant="primary" loading={working} disabled={batches.some((item) => item.rows.length === 0 || item.batchFindings.some((finding) => finding.severity === "error") || !item.mapping.some((column) => column.role === "title") || (intent !== "create" && !item.mapping.some((column) => column.role === "handle")))} onClick={() => void apply()}>{applied ? t("catalog.ui.Validateandwriteallsheetsagain") : t("catalog.ui.Validaterowsrowsacrosssheetssheets", { rows: batches.reduce((sum, item) => sum + item.rows.length, 0), sheets: batches.length })}</Button>
        <div className="spreadsheet-catalog-panel__summary">
          <strong>{t("catalog.ui.countproductsfound", { count: batch.rows.length })}</strong>
          <div className="spreadsheet-catalog-panel__outcomes">
            <span data-status="ready"><b>{summary.ready}</b>{t("catalog.ui.Readytoimport")}</span>
            <span data-status="attention"><b>{summary.attention}</b>{t("catalog.ui.Needsattention")}</span>
            <span data-status="blocked"><b>{summary.blocked}</b>{t("catalog.ui.Cantimport")}</span>
          </div>
          <p>{t("catalog.ui.errorsblockingerrorswarningswarningssuggestionssuggestionsChecksincludeShopifyidentityfiel", { ...findingSummary })}</p>
          <p>{t("catalog.ui.actionssafecleanupactionsacrossrowsrowsdefaultsconservativedefaultsfornewproductsSupplierc", { ...cleanupSummary })}</p>
          <small>{t("catalog.ui.Noestimateorbalancecheckpreviewisfreeactualusageisbilledafterapplycompletes")}</small>
        </div>
        {missingRequiredFields.length > 0 ? <div className="spreadsheet-catalog-panel__required" role="alert"><TriangleAlert aria-hidden="true" /><div><strong>{t("catalog.ui.Requiredfieldnotrecognized")}</strong><span>{t("catalog.ui.Choosethecolumnforfieldsbeforecleaning", { fields: missingRequiredFields.join(", ") })}</span></div></div> : null}
        {batch.batchFindings.some((item) => item.severity === "error") ? <div className="spreadsheet-catalog-panel__required" role="alert"><TriangleAlert aria-hidden="true" /><div><strong>{t("catalog.ui.Filestructureneedsattention")}</strong><span>{batch.batchFindings.filter((item) => item.severity === "error").map((item) => item.message).join("; ")}</span></div></div> : null}
        {uncertainMappings.length > 0 ? <div className="spreadsheet-catalog-panel__mapping">
          <strong>{t("catalog.ui.countcolumnsneedyourconfirmation", { count: uncertainMappings.length })}</strong>
          <span>{t("catalog.ui.TellOfficeDexwhatthesesuppliercolumnsmeanorleaveunrelatedcolumnsasIgnore")}</span>
          <div>{uncertainMappings.map((column) => <label key={column.column}><span>{column.header || t("catalog.ui.Columncount", { count: column.column + 1 })}</span><Select size="small" ariaLabel={t("catalog.ui.Mapheader", { header: column.header })} value={column.role as CatalogFieldRole} options={CATALOG_FIELD_ROLE_OPTIONS.map((option) => ({ ...option, label: t(`catalog.field.${option.value}`) }))} onChange={(value) => changeRole(column.column, value)} /></label>)}</div>
        </div> : <div className="spreadsheet-catalog-panel__recognized"><CheckCircle2 aria-hidden="true" /><span>{t("catalog.ui.Requiredfieldsrecognizedautomatically")}</span></div>}
        <button type="button" className="spreadsheet-catalog-panel__mapping-toggle" aria-expanded={showAllMappings} onClick={() => setShowAllMappings((shown) => !shown)}>{t("catalog.ui.Reviewrecognizedfields")} <ChevronDown className={showAllMappings ? "is-open" : ""} aria-hidden="true" /></button>
        {showAllMappings ? <div className="spreadsheet-catalog-panel__mapping spreadsheet-catalog-panel__mapping--all"><div>{batch.mapping.map((column) => <label key={column.column}><span>{column.header || t("catalog.ui.Columncount", { count: column.column + 1 })}</span><Select size="small" ariaLabel={t("catalog.ui.Mapheader", { header: column.header })} value={column.role as CatalogFieldRole} options={CATALOG_FIELD_ROLE_OPTIONS.map((option) => ({ ...option, label: t(`catalog.field.${option.value}`) }))} onChange={(value) => changeRole(column.column, value)} /></label>)}</div></div> : null}
        <div className="spreadsheet-catalog-panel__scope"><TriangleAlert aria-hidden="true" /><span>{intent === "create" ? t("catalog.ui.NewproductsreceiveconservativeShopifydefaultsandremaindraftunpublished") : t("catalog.ui.Updateexportsincludeonlymappedfieldssomissingsuppliercolumnsarenotexportedasblankoverwrite")}{t("catalog.ui.RulesversionrulestaxonomytaxonomyLocalchecksdonotcoverstorehandlesimagereachabilitylocatio", { rules: batch.ruleVersion, taxonomy: batch.taxonomyVersion })}</span></div>
        {applied ? <><div className="spreadsheet-catalog-panel__done"><CheckCircle2 aria-hidden="true" />{t("catalog.ui.ValidationresultsweresavedinsixnewcolumnsOriginalsupplierdatawasnotchanged")}</div><Button size="small" variant="secondary" icon={<Download />} disabled={summary.blocked === batch.rows.length} onClick={() => downloadCsv(batch, fileName)}>{t("catalog.ui.DownloadShopifydraftCSV")}</Button><Button size="small" variant="secondary" icon={<Download />} onClick={() => downloadFindingsCsv(batch, fileName)}>{t("catalog.ui.Downloadfindingsreport")}</Button></> : null}
      </> : null}
      {error ? <div className="spreadsheet-catalog-panel__error" role="alert">{error}</div> : null}
    </section>
  );
}
