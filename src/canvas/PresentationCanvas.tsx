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
import { createPptxEditRunner } from "./pptxEditRun";
import { SLIDES_CHROME, useEditorChrome } from "./editorChrome";
import type { DocumentEditRunner } from "./DocxCanvas";

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
  /**
   * How to carry out an instruction against this deck in place, or null when
   * nothing is mounted.
   *
   * The same channel Word uses, and the reason editing an open deck does not
   * regenerate it: the instruction goes to the deck's own planner
   * (`office.pptx.plan_js`) and the script it returns is run by this editor.
   */
  onEditRunner: (edit: DocumentEditRunner | null) => void;
  /** The editor could not load at all — the caller falls back to a skeleton. */
  onUnavailable: (reason: string) => void;
}

interface Session {
  fileId: string;
  token: string;
  fileName: string;
  /** Where the deck lives; metadata for an in-place edit run. */
  filePath: string;
}

export function PresentationCanvas({
  api,
  file,
  onDirtyChange,
  onSelectionChange,
  onResolveSelection,
  onController,
  onEditRunner,
  onUnavailable,
}: PresentationCanvasProps) {
  const [session, setSession] = useState<Session | null>(null);
  const controllerRef = useRef<PresentationEditorController | null>(null);
  const labelRef = useRef<string>(file.name);
  /**
   * How to re-read the selection, published by the effect that owns the read.
   *
   * A ref rather than a callback prop straight into the frame: the frame is
   * mounted below, the reader is set up in an effect above, and the hint
   * arrives from the embed at any moment in between. The ref is the one thing
   * both ends can name without either of them re-rendering the other.
   */
  const selectionHintRef = useRef<(() => void) | null>(null);

  /*
   * The deck editor's own status bar, told to the shell. Only once there is a
   * session — before that the host's skeleton is what is on screen and it has
   * no status bar. See `editorChrome.ts`.
   */
  useEditorChrome(session ? SLIDES_CHROME : null);

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
          setSession({
            fileId: file.id,
            token: grant.token,
            fileName: record.fileName,
            filePath: record.filePath,
          });
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
   * So the trigger is the gesture instead, and there are two of them. The
   * embed reports that the user clicked or typed inside the editor
   * (`presentation:selection-changed`, debounced there), which is what makes
   * picking a shape open the agent *while the user is still looking at the
   * shape*. The window regaining focus is the other, and still matters: it
   * covers the user coming back from somewhere the embed never saw.
   *
   * One script per gesture, none while nothing is happening.
   */
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    /** One read at a time; a click during a read is served by `again`. */
    let reading = false;
    let again = false;

    const read = async () => {
      const controller = controllerRef.current;
      if (!controller) return;
      if (reading) {
        again = true;
        return;
      }
      reading = true;
      try {
        const { result } = await controller.executeScript(PRESENTATION_SELECTION_SOURCE, {
          awaitSnapshotMs: 0,
        });
        if (cancelled) return;
        const selection = result as PresentationSelection;
        const label = presentationSelectionLabel(selection);
        if (!label) {
          onSelectionChange(null);
          return;
        }
        labelRef.current = `${session.fileName} · ${label}`;
        onSelectionChange({
          fileId: session.fileId,
          label: labelRef.current,
          text: "",
          // Shapes are what the user picks out; a bare slide selection is what
          // is left over after clicking past everything, and opening the agent
          // for that would fire on every click into empty canvas.
          block: selection.shapes.length > 0,
        });
      } catch {
        // The editor is busy, gone, or mid-swap. Not knowing the selection is
        // not an error the user needs to hear about.
        if (!cancelled) onSelectionChange(null);
      } finally {
        reading = false;
        if (again && !cancelled) {
          again = false;
          void read();
        }
      }
    };

    selectionHintRef.current = () => void read();
    const onFocus = () => void read();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      selectionHintRef.current = null;
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
        onSelectionChanged={() => selectionHintRef.current?.()}
        onController={(controller) => {
          controllerRef.current = controller;
          onController(controller);
          onEditRunner(
            controller
              ? createPptxEditRunner({
                  api,
                  controller,
                  filePath: session.filePath,
                })
              : null,
          );
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
                    block: selection.shapes.length > 0,
                  };
                }
              : null,
          );
        }}
        onReady={() => logShellEvent("presentation.editor.ready", { fileId: file.id })}
        onUnavailable={(error) => {
          // The frame already names missing assets and handshake timeouts. An
          // empty reason is not a start failure.
          if (!error?.trim()) return;
          // The editor's own failures never reached anywhere a packaged build
          // could be read from. A deck that will not open now leaves a line.
          logShellEvent("presentation.editor.unavailable", { fileId: file.id, error });
          onUnavailable(error);
        }}
      />
    </DesktopApiProvider>
  );
}
