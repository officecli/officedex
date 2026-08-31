import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, X } from "lucide-react";
import type { Artifact, PreviewGrant, TimelineDeck, TimelineNode } from "../../shared/types";
import type { VibeReplayFeed } from "../presentation/vibeReplay";
import { useT } from "../i18n";
import { LoadingState } from "../preview/components/LoadingState";
import { UnsupportedViewer } from "../preview/viewers/UnsupportedViewer";
import { dialog } from "../ui";
import { PreviewReadyNotice } from "./PreviewReadyNotice";
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
  /** The artifact behind the grant — drives the footer reveal action. */
  artifact?: Artifact | null;
  live?: VibeReplayFeed;
  timelineTaskId?: string;
  timelineNodeId?: string | null;
  onOpenTimelineNode?: (deck: TimelineDeck, node: TimelineNode) => void | Promise<void>;
  onTimelineNodeSwapped?: (node: TimelineNode) => void;
  onTimelineNodeReturned?: () => void;
  onReturnToLatestDeck?: () => void;
  catalogPanel?: React.ReactNode;
}

const PREVIEW_PANEL_SLIDE_MS = 420;

export function PreviewPanel({ grant, onClose, artifact, live }: PreviewPanelProps) {
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

  const beginClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      onClose();
    }, PREVIEW_PANEL_SLIDE_MS);
  }, [closing, onClose]);

  const requestClose = useCallback(() => {
    if (closing) return;
    if (documentDirty) {
      dialog.confirm({
        title: t("preview.closeDirtyTitle"),
        content: t("preview.closeDirtyBody"),
        okText: t("preview.closeDirtyConfirm"),
        cancelText: t("preview.closeDirtyCancel"),
        tone: "danger",
        onOk: beginClose,
      });
      return;
    }
    beginClose();
  }, [beginClose, closing, documentDirty, t]);

  const viewer = (() => {
    if (!grant) return null;
    const { token, fileName, documentType } = grant;
    switch (documentType) {
      case "pptx":
        return (
          <PptxViewer
            previewToken={token}
            fileName={fileName}
            documentType={documentType}
            filePath={artifact?.filePath}
            live={live}
          />
        );
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
      {grant && artifact ? <PreviewReadyNotice grant={grant} artifact={artifact} /> : null}
    </div>
  );
}
