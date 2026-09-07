import {
  useState,
  useMemo,
  lazy,
  Suspense,
} from "react";
import { PreviewToolbar } from "../components/PreviewToolbar";
import { LoadingState } from "../components/LoadingState";
import { officecli } from "../../bridge";
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
  onDirtyChange?: (dirty: boolean) => void;
  onFlushReady?: (flush: (() => Promise<void>) | null) => void;
}

/**
 * PPTX viewer. When the presentation editor URL is configured the deck opens in
 * the editable MOP workbench with the AI conversation panel; otherwise (or when
 * the editor fails to start) it falls back to the Presentation embedded-preview mode.
 */
export default function PptxViewer({
  previewToken,
  fileName,
  documentType,
  filePath,
  editorBaseUrl,
  live,
  onDirtyChange,
  onFlushReady,
}: PptxViewerProps) {
  const t = useT();
  const resolvedEditorUrl = useMemo(
    () =>
      editorBaseUrl === undefined ? resolvePresentationEditorBaseUrl() : editorBaseUrl,
    [editorBaseUrl],
  );
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [useReadOnly, setUseReadOnly] = useState(false);

  const openExternal = () => {
    officecli.openPath(filePath || fileName).catch(() => {});
  };

  const showWorkbench = Boolean(resolvedEditorUrl) && !useReadOnly;

  return (
    <>
      <PreviewToolbar
        fileName={fileName}
        documentType={documentType}
        onOpenExternal={openExternal}
      />
      {showWorkbench && resolvedEditorUrl ? (
        <div className="pptx-deck-layout pptx-deck-layout-workbench">
          <Suspense fallback={<LoadingState fileName={fileName} />}>
            <PresentationPptxWorkbench
              key={`${previewToken}:${fileName}`}
              editorBaseUrl={resolvedEditorUrl}
              previewToken={previewToken}
              fileName={fileName}
              filePath={filePath}
              live={live}
              onDirtyChange={onDirtyChange}
              onFlushReady={onFlushReady}
              onEditorReady={() => setFallbackReason(null)}
              onEditorUnavailable={(reason) => setFallbackReason(reason)}
            />
          </Suspense>
          {fallbackReason && (
            <div className="pptx-workbench-fallback-bar" role="note">
              <span>{t("pptx.agent.editorUnavailableTitle")}</span>
              <button type="button" onClick={() => setUseReadOnly(true)}>
                {t("pptx.agent.readOnlyFallback")}
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="pptx-readonly-notice" role="note">
            {t("pptx.agent.editorUnavailableTitle")} —{" "}
            {t("pptx.agent.editorUnavailableNotConfigured")}
          </div>
          <PresentationReadOnlyViewer
            previewToken={previewToken}
            fileName={fileName}
          />
        </>
      )}
    </>
  );
}

function PresentationReadOnlyViewer({
  previewToken,
  fileName,
}: {
  previewToken: string;
  fileName: string;
}) {
  const editorBaseUrl = EMBEDDED_PRESENTATION_PATH;
  return (
    <div className="pptx-deck-layout pptx-deck-layout-workbench">
      <Suspense fallback={<LoadingState fileName={fileName} />}>
        <PresentationPptxWorkbench
          editorBaseUrl={editorBaseUrl}
          previewToken={previewToken}
          fileName={fileName}
          readOnly
        />
      </Suspense>
    </div>
  );
}
