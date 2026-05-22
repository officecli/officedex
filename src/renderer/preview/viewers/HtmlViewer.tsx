import { useCallback, useEffect, useRef, useState } from "react";
import { PreviewToolbar } from "../components/PreviewToolbar";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { officecli } from "../../bridge";

interface HtmlViewerProps {
  previewToken: string;
  fileName: string;
  documentType?: string;
  onClose?: () => void;
}

const ZOOM_STEP = 0.15;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;

export default function HtmlViewer({ previewToken, fileName, documentType, onClose }: HtmlViewerProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const loadHtml = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await officecli.readArtifactFile(previewToken);
      const arrayBuf = data instanceof ArrayBuffer ? data : new Uint8Array(data as Uint8Array).buffer;
      const bytes = new Uint8Array(arrayBuf as ArrayBuffer);
      const decoder = new TextDecoder("utf-8");
      setHtml(decoder.decode(bytes));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [previewToken]);

  useEffect(() => {
    loadHtml();
  }, [loadHtml]);

  useEffect(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc?.body) return;
    doc.body.style.zoom = `${zoom}`;
  }, [zoom, html]);

  const zoomIn = () => setZoom((z) => Math.min(z + ZOOM_STEP, ZOOM_MAX));
  const zoomOut = () => setZoom((z) => Math.max(z - ZOOM_STEP, ZOOM_MIN));
  const zoomReset = () => setZoom(1);

  const openExternal = () => {
    officecli.openPath(fileName).catch(() => {});
  };

  if (loading) return <LoadingState fileName={fileName} />;
  if (error) return <ErrorState message={error} fileName={fileName} onRetry={loadHtml} onOpenExternal={openExternal} />;

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
      />
      <div className="preview-html-container">
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
          }}
        />
      </div>
    </>
  );
}
