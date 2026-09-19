import { useEffect, useRef, useState } from "react";

import type { DesktopAPI } from "../shared/types";
import type { FileMeta } from "../shared/uiPort";
import {
  PRESENTATION_SELECTION_SOURCE,
  PRESENTATION_SELECTION_TEXT_SOURCE,
  presentationSelectionLabel,
  type PresentationSelection,
} from "../shared/presentationSelection";
import type { CanvasSelection } from "../shell/editor/canvasContract";
import { DesktopApiProvider } from "../renderer/services/desktopApi";
import { PresentationEditorFrame, type PresentationEditorController } from "../renderer/presentation/PresentationEditorFrame";
import { logShellEvent } from "../shell/port/shellLog";

/**
 * One open presentation, rendered by the real embedded editor.
 *
 * The editor needs a preview token, and a token is issued against a path —
 * which `FileMeta` deliberately does not carry. That is the whole reason this
 * layer exists rather than the shell doing it: the shell's contract describes a
 * document by id, and resolving an id to somewhere on disk is a desktop
 * concern. `getDocument` is the only place that translation happens.
 *
 * Switching to another deck changes `previewToken`, which the frame keys its
 * session effect on, so the component is reused in place. Remounting it would
 * boot the whole presentation runtime again for what is a document change.
 */
export interface PresentationCanvasProps {
  api: DesktopAPI;
  file: FileMeta;
  onDirtyChange: (dirty: boolean) => void;
  /** Something was selected in the editor. Carries a label only. */
  onSelectionChange: (selection: CanvasSelection | null) => void;
  /** Reports how to read the selected shapes' text, once the editor is up. */
  onResolveSelection: (resolve: (() => Promise<CanvasSelection | null>) | null) => void;
  onController: (controller: PresentationEditorController | null) => void;
  /** The editor could not load at all — the caller falls back to a skeleton. */
  onUnavailable: (reason: string) => void;
}

interface Session {
  fileId: string;
  token: string;
  fileName: string;
}

export function PresentationCanvas({
  api,
  file,
  onDirtyChange,
  onSelectionChange,
  onResolveSelection,
  onController,
  onUnavailable,
}: PresentationCanvasProps) {
  const [session, setSession] = useState<Session | null>(null);
  const controllerRef = useRef<PresentationEditorController | null>(null);
  const labelRef = useRef<string>(file.name);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        logShellEvent("presentation.session.start", { fileId: file.id, name: file.name });
        const record = await api.getDocument(file.id);
        const grant = await api.issuePreviewToken({
          filePath: record.filePath,
          fileName: record.fileName,
          documentType: record.documentType,
          ...(record.currentArtifactTaskId ? { taskId: record.currentArtifactTaskId } : {}),
        });
        if (!cancelled) {
          logShellEvent("presentation.session.token", { fileId: file.id, path: record.filePath });
          setSession({ fileId: file.id, token: grant.token, fileName: record.fileName });
        }
      } catch (reason) {
        if (!cancelled) {
          onUnavailable(reason instanceof Error ? reason.message : String(reason));
          setSession(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // onUnavailable is stable per adapter; including it would re-issue a token
    // on every render of the host.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, file.id]);

  /**
   * When to ask the editor what is selected.
   *
   * PowerPoint has no selection event to subscribe to — the contract's own
   * note says so — and the obvious alternative, polling, is what kept this
   * unwired: every poll is a script into the iframe, forever, for a chip that
   * may never be used.
   *
   * So the trigger is the gesture instead: the window regains focus when the
   * user comes back *out* of the editor, which is precisely the moment they
   * are about to say something to the agent about what they were looking at.
   * One script per look-away, zero while they work.
   */
  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    const read = async () => {
      const controller = controllerRef.current;
      if (!controller) return;
      try {
        const { result } = await controller.executeScript(PRESENTATION_SELECTION_SOURCE, {
          awaitSnapshotMs: 0,
        });
        if (cancelled) return;
        const label = presentationSelectionLabel(result as PresentationSelection);
        if (!label) {
          onSelectionChange(null);
          return;
        }
        labelRef.current = `${session.fileName} · ${label}`;
        onSelectionChange({ fileId: session.fileId, label: labelRef.current, text: "" });
      } catch {
        // The editor is busy, gone, or mid-swap. Not knowing the selection is
        // not an error the user needs to hear about.
        if (!cancelled) onSelectionChange(null);
      }
    };

    const onFocus = () => void read();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [session, onSelectionChange]);

  // Nothing to show until the token is in. The host keeps its skeleton visible
  // underneath, so this is a gap of a few hundred milliseconds, not a blank.
  if (!session) return null;

  return (
    <DesktopApiProvider api={api}>
      <PresentationEditorFrame
        previewToken={session.token}
        fileName={session.fileName}
        onDirtyChange={onDirtyChange}
        onController={(controller) => {
          controllerRef.current = controller;
          onController(controller);
          onResolveSelection(
            controller
              ? async () => {
                  const { result } = await controller.executeScript(
                    PRESENTATION_SELECTION_TEXT_SOURCE,
                    { awaitSnapshotMs: 0 },
                  );
                  const selection = result as PresentationSelection;
                  const label = presentationSelectionLabel(selection);
                  if (!label || !selection.text?.trim()) return null;
                  return {
                    fileId: file.id,
                    label: `${session.fileName} · ${label}`,
                    text: selection.text,
                  };
                }
              : null,
          );
        }}
        onReady={() => logShellEvent("presentation.editor.ready", { fileId: file.id })}
        onUnavailable={(error) => {
          // The editor's own failures never reached anywhere a packaged build
          // could be read from. A deck that will not open now leaves a line.
          logShellEvent("presentation.editor.unavailable", { fileId: file.id, error: error || "" });
          onUnavailable(error || "The presentation editor could not start.");
        }}
      />
    </DesktopApiProvider>
  );
}
