import { useEffect, useRef } from "react";

import type { AgentTask } from "../../shared/uiPort";
import type { CanvasAdapter } from "../editor/canvasContract";

/**
 * Puts the agent's proposal in the document it is about.
 *
 * The suggestion card in the panel says *that* there is a change; this says
 * *where*. The prototype inserted the draft after the referenced paragraph and
 * put Apply on it, so accepting a change never meant reading a summary on one
 * side of the window and trusting it applied to the right place on the other.
 *
 * Nothing implements `showDraft` yet — see the note on `CanvasDraft`. This
 * hook is the shell's half: it decides when a draft exists, which file it
 * belongs to, and what Apply from inside the document means. An adapter
 * without the methods is served by the panel alone, which is the current
 * behaviour for every editor.
 */
export function useDocumentDraft(
  canvas: CanvasAdapter | null,
  task: AgentTask | null,
  activeFileId: string | null,
  onApply: (suggestionId: string) => void,
): void {
  const suggestion = task?.suggestion;
  const visible =
    suggestion && !suggestion.applied && activeFileId !== null && suggestion.targetFileId === activeFileId
      ? suggestion
      : null;

  // The apply callback changes identity on every render of its owner; keeping
  // it in a ref stops that from re-subscribing the adapter each time.
  const applyRef = useRef(onApply);
  applyRef.current = onApply;
  const pendingId = useRef<string | null>(null);
  pendingId.current = visible?.id ?? null;

  useEffect(() => {
    if (!canvas?.onDraftAction) return;
    return canvas.onDraftAction((action) => {
      const id = pendingId.current;
      if (action === "apply" && id) applyRef.current(id);
    });
  }, [canvas]);

  useEffect(() => {
    if (!canvas?.showDraft) return;
    if (!visible) {
      canvas.showDraft(null);
      return;
    }
    canvas.showDraft({
      suggestionId: visible.id,
      fileId: visible.targetFileId,
      text: visible.summary,
    });
    // Leaving a draft behind when the run ends, the file closes or the
    // suggestion is applied would leave the document showing a proposal that
    // no longer exists anywhere else.
    return () => canvas.showDraft?.(null);
  }, [canvas, visible]);
}
