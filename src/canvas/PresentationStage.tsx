import { useCallback } from "react";

import type { DesktopAPI, DesktopTask } from "../shared/types";
import { DesktopApiProvider } from "../renderer/services/desktopApi";
import { LocaleProvider } from "../renderer/i18n";
import { PresentationEditorFrame } from "../renderer/presentation/PresentationEditorFrame";
import { CanvasPlaceholder } from "../shell/editor/CanvasPlaceholder";
import { useCanvasLocale } from "../shell/editor/canvasLocale";
import { usePptxLiveDraft } from "../renderer/controllers/usePptxLiveDraft";
import { useCanvasSession } from "./useCanvasSession";

/**
 * A presentation while it is being drawn.
 *
 * This is the other thing a deck can be on screen. An existing .pptx is a file
 * and gets an editor; a deck that does not exist yet is a *run*, and the file
 * it is being written into has no library entry to route by. So the task is
 * what puts it here — but what goes on screen is still just the deck.
 *
 * **A drawing deck is not a file.** `CreateLivePptxDraft` writes to
 * `workspaceDir/live/` and registers the path with the preview registry only —
 * it never touches `documents` or `artifacts`, so nothing about it reaches the
 * file library. That is right: the draft is scratch, replaced on every redraw
 * and deleted when the next one starts, and a library full of `live-task-3.pptx`
 * would be worse than useless.
 *
 * Everything *about* the run — the outline, each page's progress, the controls
 * over it — belongs to the task panel, not here. This file used to render all
 * of it (`ProgressivePptxStage`) with the deck as one panel inside its own
 * commentary; see the note in `StageBody`.
 *
 * `usePptxLiveDraft` is what remains, mounted rather than reimplemented: it
 * owns the draft lifecycle and every rule in it was a bug first (R-E-01 through
 * R-E-07), so rewriting it for a new IA would be re-earning them.
 */

export interface PresentationStageProps {
  api: DesktopAPI;
  task: DesktopTask;
  onError: (message: string) => void;
}

export function PresentationStage({ api, task, onError }: PresentationStageProps) {
  /*
   * The shell's language, read from the channel rather than pinned.
   *
   * This stage is the one piece of the old renderer the new shell mounts
   * whole, and it brought that renderer's i18n with it: on a Chinese system
   * `LocaleProvider` resolved to `zh` on its own, so the canvas said
   * 「正在撰写页面正文」 and 「内容预览」 while the panel beside it, the ribbon
   * above it and the generated slides were all English. One screen, two
   * languages, neither chosen (S4-009).
   *
   * It was pinned to `value="en"` because `src/shell` had no i18n and English
   * was what the rest of the window spoke. It has one now, and this reads it —
   * through `canvasLocale` and not through context, because the canvas is a
   * separate React root and the shell's provider does not reach in.
   *
   * `?? "en"` is the same pin, kept for the case the channel is silent: a
   * canvas root mounted by something that is not this shell. Falling back to
   * `navigator.language` there is precisely the bug above.
   */
  const locale = useCanvasLocale() ?? "en";

  return (
    <LocaleProvider value={locale}>
      <DesktopApiProvider api={api}>
        <StageBody api={api} task={task} onError={onError} />
      </DesktopApiProvider>
    </LocaleProvider>
  );
}

function StageBody({ api, task, onError }: PresentationStageProps) {
  const session = useCanvasSession(api);
  const recordError = useCallback((text: string) => onError(text), [onError]);

  // The stage's copy comes from `pptxFlowCopy`; this `t` is only what
  // usePptxLiveDraft uses for the one message it raises itself.
  const t = useCallback((key: string) => key, []);

  usePptxLiveDraft({ session, recordError, t });

  /*
   * The deck, and nothing else.
   *
   * This used to render the whole `ProgressivePptxStage`: the request echoed
   * back, the outline with a status line per page, the elapsed timer, follow
   * and cancel — with the deck being written tucked inside it. So the one
   * surface meant for the document was mostly *about* the document, and the
   * document itself was a panel within its own commentary.
   *
   * All of that moved to the task panel, where a plan is something to read and
   * discuss. What is left is what a canvas is for. The run's own controls went
   * with it: pause and finish are the panel's buttons, steering is the
   * composer, and the outline gate is answered through `agent.answer` (see
   * `toQuestion` in services/agent.ts).
   *
   * `usePptxLiveDraft` stays exactly where it was. It owns the draft's whole
   * lifecycle — spotting the moment drawing starts, creating the file,
   * registering it for replay, issuing its token, adopting the session — and
   * every rule in it was a bug first (R-E-01 through R-E-07).
   */
  const editorReady = Boolean(session.grant && session.artifact?.taskId === task.id);

  /*
   * A skeleton until there is a deck to show.
   *
   * Drawing does not start the moment a run does: the outline, the design pass
   * and the first page all happen before `usePptxLiveDraft` has a file to hand
   * the editor. This returned null through that window, so the canvas was a
   * blank rectangle for a minute or more while the panel beside it listed work
   * going on — which reads as broken, not as pending.
   *
   * The shell's own slides skeleton is the honest thing to show: a deck is
   * coming, and this is its shape.
   */
  if (!editorReady) return <CanvasPlaceholder type="slides" />;

  /*
   * Visible, but not editable yet.
   *
   * The deck on screen is `workspaceDir/live/` scratch: every redraw replaces
   * it and the next run deletes it. Anything typed into it is gone by the next
   * page, so letting it accept edits would be offering a change the app cannot
   * keep.
   *
   * The embedded editor owns its own ribbon and has no read-only mode to ask
   * for, so Insert, Draw, Design, Transitions and Animations sit there looking
   * live the whole time. Blocking the clicks is not enough on its own — a
   * toolbar that looks live and does nothing is worse than one that is plainly
   * not yours yet. The note says so across the top, above the ribbon, because
   * that band is the only part of this surface the shell can reach.
   *
   * It lifts itself: once the run leaves LIVE_STATUSES the canvas routes to the
   * finished file's editor and this component is gone, so there is no state to
   * unwind and no way to be left locked.
   */
  return (
    <div className="shell-live-deck">
      <p className="shell-live-deck-note" role="status">
        Being drawn — the toolbar below is inactive until this deck is finished
      </p>
      <div className="shell-live-deck-frame">
        <PresentationEditorFrame
          previewToken={session.grant!.token}
          fileName={session.artifact!.fileName}
          onUnavailable={(error) => onError(error || "The presentation editor could not start.")}
        />
        <div className="shell-live-deck-lock" aria-hidden="true" />
      </div>
    </div>
  );
}


/** Statuses where a run still owns the canvas. */
const LIVE_STATUSES = ["starting", "running", "question", "plan_review"];

/**
 * The run the canvas should be showing, if any.
 *
 * Only presentations, and only while the run is still going: a finished deck is
 * a file, and the file is what the user edits. Among several, the most recent —
 * `taskOrder` is newest-first.
 */
export function liveDeckTask(tasks: Record<string, DesktopTask>, order: readonly string[]): DesktopTask | null {
  for (const id of order) {
    const task = tasks[id];
    if (!task || task.documentType !== "pptx") continue;
    if (LIVE_STATUSES.includes(task.status)) return task;
  }
  return null;
}
