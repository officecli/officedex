import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, ExternalLink, FolderOpen, X } from "lucide-react";
import type { Artifact, PreviewGrant } from "../../shared/types";
import { officecli } from "../bridge";
import { useT } from "../i18n";
import { LoadingState } from "../preview/components/LoadingState";
import { UnsupportedViewer } from "../preview/viewers/UnsupportedViewer";
import {
  PptxViewer,
  DocxViewer,
  XlsxViewer,
  PdfViewer,
  HtmlViewer,
} from "../preview/viewers/previewViewers";
import "../preview/PreviewApp.css";

interface PreviewPanelProps {
  grant: PreviewGrant | null;
  onClose: () => void;
  /** The artifact behind the grant — drives the footer actions (reveal / open externally). */
  artifact?: Artifact | null;
}

const PREVIEW_PANEL_SLIDE_MS = 420;

export function PreviewPanel({ grant, onClose, artifact }: PreviewPanelProps) {
  const t = useT();
  const [closing, setClosing] = useState(false);
  const [documentDirty, setDocumentDirty] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  // The preview is a full-screen overlay, but the cockpit underneath keeps auto-opening its
  // node-confirmation Popover (portaled to <body>, above us). Flag the body while we're mounted so
  // those floating cockpit overlays stay hidden — nothing from the covered cockpit should bleed over.
  useEffect(() => {
    document.body.classList.add("preview-overlay-active");
    return () => {
      document.body.classList.remove("preview-overlay-active");
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const requestClose = useCallback(() => {
    if (closing) return;
    if (documentDirty && !window.confirm("文档还有未保存的修改，确认关闭吗？")) return;
    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      onClose();
    }, PREVIEW_PANEL_SLIDE_MS);
  }, [closing, documentDirty, onClose]);

  const viewer = (() => {
    if (!grant) return null;
    const { token, fileName, documentType } = grant;
    switch (documentType) {
      case "pptx":
        return <PptxViewer previewToken={token} fileName={fileName} documentType={documentType} />;
      case "docx":
        return <DocxViewer previewToken={token} fileName={fileName} documentType={documentType} onDirtyChange={setDocumentDirty} />;
      case "xlsx":
        return <XlsxViewer previewToken={token} fileName={fileName} documentType={documentType} />;
      case "pdf":
        return <PdfViewer previewToken={token} fileName={fileName} documentType={documentType} />;
      case "html":
      case "htm":
        return <HtmlViewer previewToken={token} fileName={fileName} documentType={documentType} />;
      default:
        return <UnsupportedViewer fileName={fileName} documentType={documentType} onOpenExternal={() => {}} />;
    }
  })();

  const fallbackName = grant?.fileName ?? "";

  return (
    <div className={`preview-panel-root${closing ? " is-closing" : ""}`}>
      {grant ? (
        <header className="preview-panel-header">
          <button type="button" className="preview-panel-back" onClick={requestClose}>
            <ArrowLeft size={16} strokeWidth={1.8} />
            <span>{t("preview.back")}</span>
          </button>
          <span className="preview-panel-title-tag">{t("preview.label")}</span>
          <button
            type="button"
            className="preview-panel-close"
            onClick={requestClose}
            title={t("preview.close")}
            aria-label={t("preview.close")}
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        </header>
      ) : null}
      <div className="preview-panel-body">
        <Suspense fallback={<LoadingState fileName={fallbackName} />}>
          {viewer}
        </Suspense>
      </div>
      {grant && artifact ? (
        <footer className="preview-panel-footer">
          <div className="preview-panel-footer-status">
            <CheckCircle2 size={15} strokeWidth={1.8} />
            <span>{t("preview.ready")}</span>
            <span className="preview-footer-filename" title={grant.fileName}>
              {grant.fileName}
            </span>
          </div>
          <div className="preview-panel-footer-actions">
            <button
              type="button"
              className="preview-action-btn"
              onClick={() => officecli.showItemInFolder(artifact.filePath).catch(() => {})}
            >
              <FolderOpen size={15} strokeWidth={1.8} />
              <span>{t("dialogue.completed.showInFolder")}</span>
            </button>
            <button
              type="button"
              className="preview-action-btn primary"
              onClick={() => officecli.openPath(artifact.filePath).catch(() => {})}
            >
              <ExternalLink size={15} strokeWidth={1.8} />
              <span>{t("preview.openExternal")}</span>
            </button>
          </div>
        </footer>
      ) : null}
    </div>
  );
}
