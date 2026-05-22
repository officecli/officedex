import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "antd";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { PreviewToolbar } from "../components/PreviewToolbar";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { officecli } from "../../bridge";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.js",
  import.meta.url,
).toString();

interface PdfViewerProps {
  previewToken: string;
  fileName: string;
  documentType?: string;
  onClose?: () => void;
}

const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const DEFAULT_SCALE = 1.5;

export default function PdfViewer({ previewToken, fileName, documentType, onClose }: PdfViewerProps) {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);

  const loadPdf = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await officecli.readArtifactFile(previewToken);
      const doc = await pdfjsLib.getDocument({ data }).promise;
      setPdfDoc(doc);
      setTotalPages(doc.numPages);
      setCurrentPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [previewToken]);

  useEffect(() => {
    loadPdf();
  }, [loadPdf]);

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    let cancelled = false;

    (async () => {
      renderTaskRef.current?.cancel();
      const page = await pdfDoc.getPage(currentPage);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d")!;
      const task = page.render({ canvasContext: ctx, viewport });
      renderTaskRef.current = task;
      try {
        await task.promise;
      } catch {
        // render cancelled
      }
    })();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
    };
  }, [pdfDoc, currentPage, scale]);

  const zoomIn = () => setScale((s) => Math.min(s + ZOOM_STEP, ZOOM_MAX));
  const zoomOut = () => setScale((s) => Math.max(s - ZOOM_STEP, ZOOM_MIN));
  const zoomReset = () => setScale(DEFAULT_SCALE);
  const prevPage = () => setCurrentPage((p) => Math.max(p - 1, 1));
  const nextPage = () => setCurrentPage((p) => Math.min(p + 1, totalPages));

  const openExternal = () => {
    officecli.openPath(fileName).catch(() => {});
  };

  if (loading) return <LoadingState fileName={fileName} />;
  if (error) return <ErrorState message={error} fileName={fileName} onRetry={loadPdf} onOpenExternal={openExternal} />;

  return (
    <>
      <PreviewToolbar
        fileName={fileName}
        documentType={documentType}
        zoom={scale / DEFAULT_SCALE}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onZoomReset={zoomReset}
        onOpenExternal={openExternal}
        onClose={onClose}
        center={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Button size="small" disabled={currentPage <= 1} onClick={prevPage}>
              Previous
            </Button>
            <span style={{ fontSize: 13, whiteSpace: "nowrap" }}>
              {currentPage} / {totalPages}
            </span>
            <Button size="small" disabled={currentPage >= totalPages} onClick={nextPage}>
              Next
            </Button>
          </div>
        }
      />
      <div className="preview-pdf-container">
        <canvas ref={canvasRef} className="preview-pdf-canvas" />
      </div>
    </>
  );
}
