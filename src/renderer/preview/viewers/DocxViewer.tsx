import { useState, useEffect, useCallback, useRef } from "react";
import { renderAsync } from "docx-preview";
import { PreviewToolbar } from "../components/PreviewToolbar";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { officecli } from "../../bridge";
import { DocxEditor } from "../../word/DocxEditor";
import "../../word/wordEditor.css";

interface DocxViewerProps {
  previewToken: string;
  fileName: string;
  documentType?: string;
  onDirtyChange?: (dirty: boolean) => void;
}

const ZOOM_STEP = 0.15;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;

type DocxMode = "edit" | "preview";

function DocxLayoutPreview({ previewToken, fileName }: Pick<DocxViewerProps, "previewToken" | "fileName">) {
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

  if (error) return <ErrorState message={error} fileName={fileName} onRetry={loadDocx} />;

  return (
    <div className="preview-docx-container" ref={containerRef}>
      {loading && <LoadingState fileName={fileName} />}
      <iframe
        ref={iframeRef}
        sandbox="allow-same-origin"
        className="preview-office-iframe"
        title={fileName}
        style={{ display: loading ? "none" : "block" }}
      />
      {!loading && (
        <div className="docx-preview-floating-zoom">
          <button type="button" onClick={zoomOut}>−</button>
          <button type="button" onClick={zoomReset}>{Math.round((zoom / fitZoomRef.current) * 100)}%</button>
          <button type="button" onClick={zoomIn}>＋</button>
        </div>
      )}
    </div>
  );
}

export default function DocxViewer({ previewToken, fileName, documentType, onDirtyChange }: DocxViewerProps) {
  const [mode, setMode] = useState<DocxMode>("edit");
  const [previewOpened, setPreviewOpened] = useState(false);
  const openExternal = () => {
    officecli.openPath(fileName).catch(() => {});
  };

  return (
    <div className="docx-workspace">
      <PreviewToolbar
        fileName={fileName}
        documentType={documentType ?? "docx"}
        center={(
          <div className="docx-mode-switch" role="group" aria-label="DOCX 查看模式">
            <button type="button" className={mode === "edit" ? "is-active" : ""} onClick={() => setMode("edit")}>编辑</button>
            <button type="button" className={mode === "preview" ? "is-active" : ""} onClick={() => { setPreviewOpened(true); setMode("preview"); }}>版式预览</button>
          </div>
        )}
        onOpenExternal={openExternal}
      />
      <div className="docx-workspace-body">
        <div className={`docx-mode-pane${mode === "edit" ? " is-active" : ""}`}>
          <DocxEditor previewToken={previewToken} fileName={fileName} onDirtyChange={onDirtyChange} />
        </div>
        {previewOpened && (
          <div className={`docx-mode-pane${mode === "preview" ? " is-active" : ""}`}>
            <DocxLayoutPreview previewToken={previewToken} fileName={fileName} />
          </div>
        )}
      </div>
    </div>
  );
}
