import { useState, useEffect, useCallback, useRef } from "react";
import JSZip from "jszip";
import { PreviewToolbar } from "../components/PreviewToolbar";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { officecli } from "../../bridge";

interface PptxViewerProps {
  previewToken: string;
  fileName: string;
  documentType?: string;
}

interface SlideContent {
  index: number;
  texts: string[];
}

const ZOOM_STEP = 0.15;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;

export default function PptxViewer({ previewToken, fileName, documentType }: PptxViewerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [sidecarHtml, setSidecarHtml] = useState<string | null>(null);
  const [slides, setSlides] = useState<SlideContent[]>([]);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await officecli.renderPreviewHtml(previewToken);
      if (result?.html) {
        setSidecarHtml(result.html);
        return;
      }

      const { data } = await officecli.readArtifactFile(previewToken);
      const arrayBuf = data instanceof ArrayBuffer ? data : new Uint8Array(data as Uint8Array).buffer;
      const zip = await JSZip.loadAsync(arrayBuf);

      const slideFiles = Object.keys(zip.files)
        .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort((a, b) => {
          const na = parseInt(a.match(/slide(\d+)/)?.[1] || "0", 10);
          const nb = parseInt(b.match(/slide(\d+)/)?.[1] || "0", 10);
          return na - nb;
        });

      const parsed: SlideContent[] = [];
      const parser = new DOMParser();

      for (const path of slideFiles) {
        const file = zip.file(path);
        if (!file) continue;
        const xml = await file.async("string");
        const doc = parser.parseFromString(xml, "application/xml");
        const textNodes = doc.getElementsByTagNameNS("http://schemas.openxmlformats.org/drawingml/2006/main", "t");
        const paragraphs: string[] = [];
        let currentParagraph = "";

        for (let i = 0; i < textNodes.length; i++) {
          const node = textNodes[i];
          const text = node.textContent || "";
          const parentP = findAncestorByLocalName(node, "p");
          if (parentP && i > 0) {
            const prevParentP = findAncestorByLocalName(textNodes[i - 1], "p");
            if (prevParentP !== parentP) {
              if (currentParagraph.trim()) paragraphs.push(currentParagraph.trim());
              currentParagraph = "";
            }
          }
          currentParagraph += text;
        }
        if (currentParagraph.trim()) paragraphs.push(currentParagraph.trim());

        const idx = parseInt(path.match(/slide(\d+)/)?.[1] || "0", 10);
        parsed.push({ index: idx, texts: paragraphs });
      }

      if (parsed.length === 0) {
        setError("Could not extract preview content from PPTX file. Please open with system application.");
        return;
      }
      setSlides(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [previewToken]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!sidecarHtml) return;
    const doc = iframeRef.current?.contentDocument;
    if (!doc?.body) return;
    doc.body.style.transform = `scale(${zoom})`;
    doc.body.style.transformOrigin = "top center";
  }, [zoom, sidecarHtml]);

  const zoomIn = () => setZoom((z) => Math.min(z + ZOOM_STEP, ZOOM_MAX));
  const zoomOut = () => setZoom((z) => Math.max(z - ZOOM_STEP, ZOOM_MIN));
  const zoomReset = () => setZoom(1);

  const openExternal = () => {
    officecli.openPath(fileName).catch(() => {});
  };

  if (loading) return <LoadingState fileName={fileName} />;
  if (error) return <ErrorState message={error} fileName={fileName} onRetry={load} onOpenExternal={openExternal} />;

  if (sidecarHtml) {
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
        />
        <div className="preview-office-container">
          <iframe
            ref={iframeRef}
            srcDoc={sidecarHtml}
            sandbox="allow-same-origin allow-scripts"
            className="preview-office-iframe"
            title={fileName}
            onLoad={() => {
              const doc = iframeRef.current?.contentDocument;
              if (doc?.body) {
                doc.body.style.transform = `scale(${zoom})`;
                doc.body.style.transformOrigin = "top center";
              }
            }}
          />
        </div>
      </>
    );
  }

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
      />
      <div className="preview-pptx-gallery">
        {slides.map((slide) => (
          <div key={slide.index} className="preview-pptx-slide-card" style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}>
            <div className="preview-pptx-slide-number">Slide {slide.index}</div>
            <div className="preview-pptx-slide-body">
              {slide.texts.map((text, i) => (
                <p key={i} className={i === 0 ? "preview-pptx-slide-title" : ""}>{text}</p>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function findAncestorByLocalName(node: Node, localName: string): Element | null {
  let current: Node | null = node.parentNode;
  while (current) {
    if (current.nodeType === 1 && (current as Element).localName === localName) {
      return current as Element;
    }
    current = current.parentNode;
  }
  return null;
}
