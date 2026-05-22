import { useState, useEffect, useCallback, useRef } from "react";
import { renderAsync } from "docx-preview";
import { PreviewToolbar } from "../components/PreviewToolbar";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { officecli } from "../../bridge";

interface DocxViewerProps {
  previewToken: string;
  fileName: string;
  documentType?: string;
  onClose?: () => void;
}

const ZOOM_STEP = 0.15;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;

export default function DocxViewer({ previewToken, fileName, documentType, onClose }: DocxViewerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fitZoomRef = useRef(1);

  const calcFitZoom = useCallback(() => {
    const container = containerRef.current;
    const iframeDoc = iframeRef.current?.contentDocument;
    if (!container || !iframeDoc) return;
    const page = iframeDoc.querySelector(".docx-wrapper > section.docx") as HTMLElement;
    if (!page) return;
    const pageWidth = page.offsetWidth;
    const containerWidth = container.clientWidth;
    if (pageWidth > 0 && containerWidth > 0) {
      const fit = Math.min(containerWidth / pageWidth, 1);
      fitZoomRef.current = fit;
      setZoom(fit);
    }
  }, []);

  const loadDocx = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await officecli.readArtifactFile(previewToken);
      const arrayBuf = data instanceof ArrayBuffer ? data : new Uint8Array(data as Uint8Array).buffer;
      const blob = new Blob([new Uint8Array(arrayBuf as ArrayBuffer)], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      const iframe = iframeRef.current;
      if (!iframe) return;

      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!iframeDoc) {
        setError("Could not access preview container");
        return;
      }

      iframeDoc.open();
      iframeDoc.write("<!DOCTYPE html><html><head><style>body{margin:0;padding:0;background:#e8e9eb;}</style></head><body></body></html>");
      iframeDoc.close();

      await renderAsync(blob, iframeDoc.body, iframeDoc.head, {
        className: "docx-preview-body",
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: true,
        ignoreFonts: false,
        breakPages: true,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderEndnotes: true,
      });

      setLoading(false);
      setTimeout(calcFitZoom, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }, [previewToken, calcFitZoom]);

  useEffect(() => {
    loadDocx();
  }, [loadDocx]);

  useEffect(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc?.body) return;
    doc.body.style.zoom = `${zoom}`;
  }, [zoom]);

  const zoomIn = () => setZoom((z) => Math.min(z + ZOOM_STEP, ZOOM_MAX));
  const zoomOut = () => setZoom((z) => Math.max(z - ZOOM_STEP, ZOOM_MIN));
  const zoomReset = () => setZoom(fitZoomRef.current);

  const openExternal = () => {
    officecli.openPath(fileName).catch(() => {});
  };

  if (error) return <ErrorState message={error} fileName={fileName} onRetry={loadDocx} onOpenExternal={openExternal} />;

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
      <div className="preview-docx-container" ref={containerRef}>
        {loading && <LoadingState fileName={fileName} />}
        <iframe
          ref={iframeRef}
          sandbox="allow-same-origin"
          className="preview-office-iframe"
          title={fileName}
          style={{ display: loading ? "none" : "block" }}
        />
      </div>
    </>
  );
}
