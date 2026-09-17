import { useState, useMemo, lazy, Suspense } from "react";
import { LoadingState } from "../components/LoadingState";
import { useDesktopApi } from "../../services/desktopApi";
import { useT } from "../../i18n";
import {
  EMBEDDED_PRESENTATION_PATH,
  resolvePresentationEditorBaseUrl,
} from "./presentation/presentationPptxUrl";
import type { VibeReplayFeed } from "../../presentation/vibeReplay";

const PresentationPptxWorkbench = lazy(
  () => import("./presentation/PresentationPptxWorkbench"),
);

interface PptxViewerProps {
  previewToken: string;
  fileName: string;
  documentType?: string;
  /** Absolute path of the artifact. When present, AI edits are saved back to it. */
  filePath?: string;
  /** Overrides the presentation editor URL (tests); `null` forces the read-only fallback. */
  editorBaseUrl?: string | null;
  /** Ordered generation ops to draw live in the same presentation editor. */
  live?: VibeReplayFeed;
  /** Debug: redraw the deck from a blank draft. Absent when there is nothing to replay. */
  onReplayDemo?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** Forwarded to the workbench's autosave idle window; tests only. */
  autosaveIdleMs?: number;
  onFlushReady?: (flush: (() => Promise<void>) | null) => void;
  onRequestClose?: () => void;
}

/**
 * PPTX viewer. When the presentation editor URL is configured the deck opens in
 * the editable MOP workbench with the AI conversation panel; otherwise (or when
 * the editor fails to start) it falls back to the Presentation embedded-preview mode.
 */
export default function PptxViewer({
  previewToken,
  fileName,
  filePath,
  editorBaseUrl,
  live,
  onReplayDemo,
  onDirtyChange,
  autosaveIdleMs,
  onFlushReady,
  onRequestClose,
}: PptxViewerProps) {
  const api = useDesktopApi();
  const t = useT();
  const resolvedEditorUrl = useMemo(
    () =>
      editorBaseUrl === undefined ? resolvePresentationEditorBaseUrl() : editorBaseUrl,
    [editorBaseUrl],
  );
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [useReadOnly, setUseReadOnly] = useState(false);

  const openExternal = () => {
    api.openPath(filePath || fileName).catch(() => {});
  };

  const showWorkbench = Boolean(resolvedEditorUrl) && !useReadOnly;

  if (showWorkbench && resolvedEditorUrl) {
    return (
      <Suspense fallback={<LoadingState fileName={fileName} />}>
        <PresentationPptxWorkbench
          key={`${previewToken}:${fileName}`}
          editorBaseUrl={resolvedEditorUrl}
          previewToken={previewToken}
          fileName={fileName}
          filePath={filePath}
          live={live}
          onReplayDemo={onReplayDemo}
          onDirtyChange={onDirtyChange}
          autosaveIdleMs={autosaveIdleMs}
          onFlushReady={onFlushReady}
          onRequestClose={onRequestClose}
          onOpenExternal={openExternal}
          onEditorReady={() => setFallbackReason(null)}
          onEditorUnavailable={(reason) => setFallbackReason(reason)}
          notice={
            fallbackReason ? (
              <div className="wb-notice pptx-workbench-fallback-bar" role="note">
                <span>{t("pptx.agent.editorUnavailableTitle")}</span>
                <span className="wb-notice__spacer" />
                <button type="button" onClick={() => setUseReadOnly(true)}>
                  {t("pptx.agent.readOnlyFallback")}
                </button>
              </div>
            ) : undefined
          }
        />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<LoadingState fileName={fileName} />}>
      <PresentationPptxWorkbench
        editorBaseUrl={EMBEDDED_PRESENTATION_PATH}
        previewToken={previewToken}
        fileName={fileName}
        readOnly
        onReplayDemo={onReplayDemo}
        onRequestClose={onRequestClose}
        onOpenExternal={openExternal}
        notice={
          <div className="wb-notice pptx-readonly-notice" role="note">
            {t("pptx.agent.editorUnavailableTitle")} —{" "}
            {t("pptx.agent.editorUnavailableNotConfigured")}
          </div>
        }
      />
    </Suspense>
  );
}
