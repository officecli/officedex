import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import type {
  Artifact,
  PreviewGrant,
  TimelineDeck,
  TimelineNode,
} from "../../shared/types";
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
  ImageViewer,
} from "../preview/viewers/previewViewers";
import "../preview/PreviewApp.css";
import { isImagePreview } from "../preview/viewers/imageViewport";

interface PreviewPanelProps {
  grant: PreviewGrant | null;
  onClose: () => void;
  /** The artifact behind the grant — drives the footer reveal action. */
  artifact?: Artifact | null;
  live?: VibeReplayFeed;
  /**
   * Debug: replay the deck's generation from a blank draft. The host supplies
   * it only when the task on screen still has its op stream in this session.
   */
  onReplayDemo?: () => void;
  timelineTaskId?: string;
  timelineNodeId?: string | null;
  onOpenTimelineNode?: (
    deck: TimelineDeck,
    node: TimelineNode,
  ) => void | Promise<void>;
  onTimelineNodeSwapped?: (node: TimelineNode) => void;
  onTimelineNodeReturned?: () => void;
  onReturnToLatestDeck?: () => void;
  catalogPanel?: React.ReactNode;
}

// Kept in step with the overlay's close animation in shell.css: the panel
// unmounts when the fade has finished, not before.
const PREVIEW_PANEL_FADE_MS = 180;

export function PreviewPanel({
  grant,
  onClose,
  artifact,
  live,
  onReplayDemo,
}: PreviewPanelProps) {
  const t = useT();
  const [closing, setClosing] = useState(false);
  const [documentDirty, setDocumentDirty] = useState(false);
  const pptxFlushRef = useRef<(() => Promise<void>) | null>(null);
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
    }, PREVIEW_PANEL_FADE_MS);
  }, [closing, onClose]);

  const flushAndClose = useCallback(() => {
    const flush = pptxFlushRef.current;
    if (!flush) {
      beginClose();
      return;
    }
    void flush().then(beginClose).catch(() => {
      // Keep the preview open when the final save fails.
    });
  }, [beginClose]);

  const requestClose = useCallback(() => {
    if (closing) return;
    if (documentDirty) {
      dialog.confirm({
        title: t("preview.closeDirtyTitle"),
        content: t("preview.closeDirtyBody"),
        okText: t("preview.closeDirtyConfirm"),
        cancelText: t("preview.closeDirtyCancel"),
        tone: "danger",
        onOk: () => {
          void beginClose();
        },
      });
      return;
    }
    flushAndClose();
  }, [beginClose, closing, documentDirty, flushAndClose, t]);

  const viewer = (() => {
    if (!grant) return null;
    const { token, fileName, documentType } = grant;
    if (isImagePreview(documentType)) return <ImageViewer previewToken={token} fileName={fileName} documentType={documentType} artifact={artifact ?? undefined} onRequestClose={requestClose} />;
    switch (documentType) {
      case "pptx":
        return (
          <PptxViewer
            previewToken={token}
            fileName={fileName}
            documentType={documentType}
            filePath={artifact?.filePath}
            live={live}
            onReplayDemo={onReplayDemo}
            onDirtyChange={setDocumentDirty}
            onFlushReady={(flush) => {
              pptxFlushRef.current = flush;
            }}
            onRequestClose={requestClose}
          />
        );
      case "docx":
        return (
          <DocxViewer
            previewToken={token}
            fileName={fileName}
            documentType={documentType}
            filePath={artifact?.filePath}
            onDirtyChange={setDocumentDirty}
            onRequestClose={requestClose}
          />
        );
      case "xlsx":
        return (
          <XlsxViewer
            previewToken={token}
            fileName={fileName}
            documentType={documentType}
            artifact={artifact}
            grant={grant}
            onDirtyChange={setDocumentDirty}
            onRequestClose={requestClose}
          />
        );
      case "pdf":
        return (
          <PdfViewer
            previewToken={token}
            fileName={fileName}
            documentType={documentType}
            onRequestClose={requestClose}
          />
        );
      case "html":
      case "htm":
        return (
          <HtmlViewer
            previewToken={token}
            fileName={fileName}
            documentType={documentType}
            onRequestClose={requestClose}
          />
        );
      default:
        return (
          <UnsupportedViewer
            fileName={fileName}
            documentType={documentType}
            onOpenExternal={() => {}}
          />
        );
    }
  })();

  const fallbackName = grant?.fileName ?? "";

  return (
    <div className={`preview-panel-root${closing ? " is-closing" : ""}`}>
      <div className="preview-panel-body">
        <Suspense fallback={<LoadingState fileName={fallbackName} />}>
          {viewer}
        </Suspense>
      </div>
      {grant && artifact && grant.documentType !== "pptx" && grant.documentType !== "docx" && !isImagePreview(grant.documentType) ? (
        <PreviewReadyNotice grant={grant} artifact={artifact} />
      ) : null}
    </div>
  );
}
