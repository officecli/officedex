import { useState, useEffect, useCallback } from "react";
import { Button } from "antd";
import * as XLSX from "xlsx";
import { PreviewToolbar } from "../components/PreviewToolbar";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { officecli } from "../../bridge";

interface XlsxViewerProps {
  previewToken: string;
  fileName: string;
  documentType?: string;
  onClose?: () => void;
}

const ZOOM_STEP = 0.15;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;

export default function XlsxViewer({ previewToken, fileName, documentType, onClose }: XlsxViewerProps) {
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [htmlContent, setHtmlContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);

  const loadXlsx = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await officecli.readArtifactFile(previewToken);
      const wb = XLSX.read(data, { type: "array" });
      setWorkbook(wb);
      setSheetNames(wb.SheetNames);
      setActiveSheet(0);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      setHtmlContent(XLSX.utils.sheet_to_html(sheet, { id: "xlsx-table" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [previewToken]);

  useEffect(() => {
    loadXlsx();
  }, [loadXlsx]);

  useEffect(() => {
    if (!workbook || sheetNames.length === 0) return;
    const sheet = workbook.Sheets[sheetNames[activeSheet]];
    if (sheet) {
      setHtmlContent(XLSX.utils.sheet_to_html(sheet, { id: "xlsx-table" }));
    }
  }, [workbook, activeSheet, sheetNames]);

  const zoomIn = () => setZoom((z) => Math.min(z + ZOOM_STEP, ZOOM_MAX));
  const zoomOut = () => setZoom((z) => Math.max(z - ZOOM_STEP, ZOOM_MIN));
  const zoomReset = () => setZoom(1);

  const openExternal = () => {
    officecli.openPath(fileName).catch(() => {});
  };

  if (loading) return <LoadingState fileName={fileName} />;
  if (error) return <ErrorState message={error} fileName={fileName} onRetry={loadXlsx} onOpenExternal={openExternal} />;

  return (
    <>
      <PreviewToolbar
        fileName={fileName}
        documentType={documentType}
        zoom={zoom}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onZoomReset={zoomReset}
        onOpenExternal={openExternal}
        onClose={onClose}
        center={
          sheetNames.length > 1 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {sheetNames.map((name, idx) => (
                <Button
                  key={name}
                  size="small"
                  type={idx === activeSheet ? "primary" : "default"}
                  onClick={() => setActiveSheet(idx)}
                  style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {name}
                </Button>
              ))}
            </div>
          ) : undefined
        }
      />
      <div className="preview-xlsx-container">
        <div
          className="preview-xlsx-content"
          style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
          dangerouslySetInnerHTML={{ __html: htmlContent }}
        />
      </div>
    </>
  );
}
