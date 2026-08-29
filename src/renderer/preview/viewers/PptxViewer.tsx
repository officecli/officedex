import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from "react";
import { PreviewToolbar } from "../components/PreviewToolbar";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { officecli } from "../../bridge";
import { useT } from "../../i18n";
import { resolveLearnofPptxBaseUrl } from "./learnof/learnofPptxUrl";
import type { VibeReplayFeed } from "../../presentation/vibeReplay";

const LearnofPptxWorkbench = lazy(() => import("./learnof/LearnofPptxWorkbench"));

interface PptxViewerProps {
  previewToken: string;
  fileName: string;
  documentType?: string;
  /** Absolute path of the artifact. When present, AI edits are saved back to it. */
  filePath?: string;
  /** Overrides the learnof/pptx editor URL (tests); `null` forces the read-only fallback. */
  editorBaseUrl?: string | null;
  /** Ordered generation ops to draw live in the same learnof editor. */
  live?: VibeReplayFeed;
}

// PPTist is a standalone Vue SPA vendored under public/pptist. We embed it in `?mode=embed`,
// where it boots empty and waits for the host to inject the raw .pptx bytes over postMessage;
// it then parses the file client-side (pptxtojson) and renders a read-only presentation view.
const PPTIST_URL = "/pptist/index.html?mode=embed";

// Messages exchanged with the embedded PPTist app.
const MSG_PREVIEW_READY = "pptist:embed-ready"; // PPTist → host: container booted, send the file
const MSG_LOAD_PPTX = "pptist:load-pptx"; // host → PPTist: here is the .pptx ArrayBuffer

/**
 * PPTX viewer. When a learnof/pptx editor URL is configured the deck opens in
 * the editable MOP workbench with the AI conversation panel; otherwise (or when
 * the editor fails to start) it falls back to the read-only PPTist preview and
 * says so explicitly — no AI entry point is shown in that case.
 */
export default function PptxViewer({ previewToken, fileName, documentType, filePath, editorBaseUrl, live }: PptxViewerProps) {
  const t = useT();
  const resolvedEditorUrl = useMemo(
    () => (editorBaseUrl === undefined ? resolveLearnofPptxBaseUrl() : editorBaseUrl),
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
      <PreviewToolbar fileName={fileName} documentType={documentType} onOpenExternal={openExternal} />
      {showWorkbench && resolvedEditorUrl ? (
        <div className="pptx-deck-layout pptx-deck-layout-workbench">
          <Suspense fallback={<LoadingState fileName={fileName} />}>
            <LearnofPptxWorkbench
              key={`${previewToken}:${fileName}`}
              editorBaseUrl={resolvedEditorUrl}
              previewToken={previewToken}
              fileName={fileName}
              filePath={filePath}
              live={live}
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
            {t("pptx.agent.editorUnavailableTitle")} — {t("pptx.agent.editorUnavailableNotConfigured")}
          </div>
          <PptistReadOnlyViewer previewToken={previewToken} fileName={fileName} onOpenExternal={openExternal} />
        </>
      )}
    </>
  );
}

function PptistReadOnlyViewer({
  previewToken,
  fileName,
  onOpenExternal,
}: {
  previewToken: string;
  fileName: string;
  onOpenExternal: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // The decoded .pptx bytes, kept until PPTist signals it's ready to receive them.
  const bufferRef = useRef<ArrayBuffer | null>(null);
  // Both gates must flip before we hand over the buffer: PPTist's listener is attached
  // (it posts MSG_PREVIEW_READY) AND we've fetched the bytes. The buffer is transferred
  // (neutered) on send, so sending into a not-yet-listening frame would lose it for good.
  const pptistReadyRef = useRef(false);
  const sentRef = useRef(false);

  // Deliver the .pptx bytes — only once both the frame and the bytes are ready.
  const sendToPptist = useCallback(() => {
    if (sentRef.current || !pptistReadyRef.current) return;
    const win = iframeRef.current?.contentWindow;
    const buffer = bufferRef.current;
    if (!win || !buffer) return;
    sentRef.current = true;
    win.postMessage({ type: MSG_LOAD_PPTX, buffer, fileName }, "*", [buffer]);
    setLoading(false);
  }, [fileName]);

  // Fetch the raw artifact bytes from the backend (same channel DOCX/PDF use).
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    sentRef.current = false;
    bufferRef.current = null;
    try {
      const result = await officecli.readArtifactFile(previewToken);
      const data = result?.data;
      if (!data || data.byteLength === 0) {
        setError("Preview not available for this slide deck. Open it with your system application instead.");
        return;
      }
      // Copy into a fresh, standalone, transferable ArrayBuffer (data may be a Uint8Array view).
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      bufferRef.current = copy.buffer;
      // If PPTist already announced readiness while we were fetching, hand over now.
      sendToPptist();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [previewToken, sendToPptist]);

  useEffect(() => {
    load();
  }, [load]);

  // Wait for PPTist's "ready" handshake (fired after it attaches its message listener),
  // then deliver the bytes. This is the only reliable send trigger.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (e.data?.type === MSG_PREVIEW_READY) {
        pptistReadyRef.current = true;
        sendToPptist();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [sendToPptist]);

  if (error) {
    return <ErrorState message={error} fileName={fileName} onRetry={load} onOpenExternal={onOpenExternal} />;
  }

  return (
    <div className="pptx-deck-layout">
      <div className="pptx-embed-stage">
        {loading && <LoadingState fileName={fileName} />}
        <iframe
          ref={iframeRef}
          src={PPTIST_URL}
          className="pptx-embed-frame"
          title={fileName}
          // PPTist renders images/media from blob: URLs and runs its own scripts.
          sandbox="allow-same-origin allow-scripts"
        />
      </div>
    </div>
  );
}
