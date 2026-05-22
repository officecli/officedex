import { useState, useEffect, useCallback, useRef } from "react";
import { PreviewToolbar } from "../components/PreviewToolbar";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { officecli } from "../../bridge";

interface OfficeHtmlViewerProps {
  previewToken: string;
  fileName: string;
  documentType: string;
  onClose?: () => void;
}

const ZOOM_STEP = 0.15;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;

export default function OfficeHtmlViewer({ previewToken, fileName, documentType, onClose }: OfficeHtmlViewerProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fitZoomRef = useRef(1);

  const calcFitZoom = useCallback(() => {
    const container = containerRef.current;
    const iframeDoc = iframeRef.current?.contentDocument;
    if (!container || !iframeDoc?.body) return;
    const contentWidth = iframeDoc.body.scrollWidth;
    const containerWidth = container.clientWidth;
    if (contentWidth > 0 && containerWidth > 0 && contentWidth > containerWidth) {
      const fit = Math.min(containerWidth / contentWidth, 1);
      fitZoomRef.current = fit;
      setZoom(fit);
    }
  }, []);

  const fetchHtml = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await officecli.renderPreviewHtml(previewToken);
      if (!result) {
        setError("No preview HTML generated for this file. Please open with system application.");
        return;
      }
      setHtml(result.html);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [previewToken]);

  useEffect(() => {
    fetchHtml();
  }, [fetchHtml]);

  useEffect(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc?.body) return;
    doc.body.style.zoom = `${zoom}`;
  }, [zoom, html]);

  const zoomIn = () => setZoom((z) => Math.min(z + ZOOM_STEP, ZOOM_MAX));
  const zoomOut = () => setZoom((z) => Math.max(z - ZOOM_STEP, ZOOM_MIN));
  const zoomReset = () => setZoom(fitZoomRef.current);

  const openExternal = () => {
    officecli.openPath(fileName).catch(() => {});
  };

  if (loading) return <LoadingState fileName={fileName} />;
  if (error) return <ErrorState message={error} fileName={fileName} onRetry={fetchHtml} onOpenExternal={openExternal} />;

  return (
    <>
      <PreviewToolbar
        fileName={fileName}
        documentType={documentType}
        zoom={zoom / fitZoomRef.current}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onZoomReset={zoomReset}
        onOpenExternal={openExternal}
        onClose={onClose}
      />
      <div className="preview-office-container" ref={containerRef}>
        <iframe
          ref={iframeRef}
          srcDoc={html ?? ""}
          sandbox="allow-same-origin allow-scripts"
          className="preview-office-iframe"
          title={fileName}
          onLoad={() => {
            const doc = iframeRef.current?.contentDocument;
            if (doc?.body) {
              doc.body.style.zoom = `${zoom}`;
            }
            requestAnimationFrame(calcFitZoom);
          }}
        />
      </div>
    </>
  );
}
