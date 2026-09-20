import { useEffect, useRef } from "react";

import type { DesktopAPI } from "../shared/types";
import type { PresentationEditorController } from "../renderer/presentation/PresentationEditorFrame";
import { VibeReplaySequencer, type VibeReplayFeed } from "../renderer/presentation/vibeReplay";

/**
 * Draws the run's op stream into the live deck.
 *
 * This is how a deck is drawn while it is being written, and it had gone
 * missing from the new shell. The runtime streams drawing ops as the MOP worker
 * authors each slide (`pptx_mop_skill.go`, on by default), the bridge forwards
 * them, and `usePptxLiveDraft` turns them into a `VibeReplayFeed` aimed at a
 * blank scratch file. Nothing consumed that feed here, so the ops arrived and
 * stopped: the canvas showed an editor with an empty deck in it for the whole
 * run — measured at 10111 bytes, byte-for-byte a blank deck, against a finished
 * file of 1.6MB.
 *
 * The legacy renderer does consume it, four layers up: `PreviewPanel` →
 * `PptxViewer` → `PresentationPptxWorkbench`, which builds the sequencer inside
 * itself. The shell mounts `PresentationEditorFrame` directly — one layer below
 * where the drawing was wired — which is the whole of the bug.
 *
 * Mounting the workbench instead would have brought its toolbars, tooltips and
 * replay-demo controls back onto a canvas that was deliberately emptied of
 * them, so what moves here is only the wiring: the frame already hands out a
 * `PresentationEditorController` (`onController`), and the sequencer only ever
 * needed that plus the feed.
 *
 * **The drawing runs through the controller, not the DOM**, so the read-only
 * overlay over the deck does not block it. The two are independent: the overlay
 * stops the *user* typing into scratch that is about to be replaced; this keeps
 * the *runtime* drawing into it.
 */
export function useLiveDeckReplay(
  api: DesktopAPI,
  controller: PresentationEditorController | null,
  feed: VibeReplayFeed | undefined,
): void {
  const sequencerRef = useRef<VibeReplaySequencer | null>(null);
  const identityRef = useRef<string | undefined>(undefined);
  const controllerRef = useRef<PresentationEditorController | null>(null);

  useEffect(() => {
    if (!controller || !feed) return;

    /*
     * One sequencer belongs to one (task, document, editor session).
     *
     * Any of the three changing invalidates the controller this was built
     * with, and mixing two tasks' op streams in one sequencer draws the wrong
     * deck — the rule is the workbench's, and it was a bug there first.
     */
    const identity = `${feed.taskId}::${feed.filePath ?? ""}`;
    if (
      sequencerRef.current &&
      (identityRef.current !== identity || controllerRef.current !== controller)
    ) {
      sequencerRef.current.dispose();
      sequencerRef.current = null;
    }

    if (!sequencerRef.current) {
      identityRef.current = identity;
      controllerRef.current = controller;
      sequencerRef.current = new VibeReplaySequencer({
        api,
        controller,
        // The packaged build has no console to watch, and a deck that stops
        // drawing looks exactly like a deck that is still thinking.
        onStatus: (status) => {
          void api
            .recordRendererLog({
              source: "shell-live-deck-replay",
              event: status.state,
              details: {
                taskId: feed.taskId,
                slide: status.slide,
                total: status.total,
                error: status.error,
              },
            })
            .catch(() => {});
        },
      });
    }

    sequencerRef.current.update(feed);
  }, [api, controller, feed]);

  useEffect(
    () => () => {
      sequencerRef.current?.dispose();
      sequencerRef.current = null;
      identityRef.current = undefined;
      controllerRef.current = null;
    },
    [],
  );
}
