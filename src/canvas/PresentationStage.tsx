import { useCallback } from "react";

import type { DesktopAPI, DesktopTask } from "../shared/types";
import { DesktopApiProvider } from "../renderer/services/desktopApi";
import { LocaleProvider } from "../renderer/i18n";
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

  const live = usePptxLiveDraft({ session, recordError, t });

  /*
   * A run does not get an editor, because nothing can be drawn into one.
   *
   * The premise of this surface was progressive disclosure: watch the deck
   * appear page by page. It does not work here, and the reason is not timing.
   *
   * The runtime does stream drawing ops (`pptx_mop_skill.go`, on by default)
   * and `usePptxLiveDraft` does turn them into a feed. What is missing is the
   * far end. Wiring the sequencer to this stage's editor was tried and failed
   * at the editor itself: it reported `drawing slide 1 of 3` and then threw
   * "Editing is not permitted" (`access-policy.ts`). There are two embed stacks
   * against the same editor and only one of them may write — the workbench's
   * `?officedexEmbed=1&channel=…` boot is granted `documentWrite`
   * (`officedex-embed-bridge.ts`), the `?mode=embed` one this stage uses is
   * not. Mounting the workbench instead was tried too: it failed to import the
   * deck and brought its own agent panel back onto a canvas that was emptied of
   * exactly that.
   *
   * So until that boot is sorted out, an editor here can only ever show an
   * empty document. Measured: the live draft stayed 10111 bytes, byte-for-byte
   * a blank deck, against a finished file of 1.6MB — three and a half minutes
   * of a live PowerPoint ribbon over nothing, under a banner claiming it was
   * being drawn.
   *
   * The skeleton is what is true: a deck is coming, and this is its shape. The
   * run's progress is next door in the task panel, which has the outline and a
   * mark per page. When the run finishes, the canvas routes to the finished
   * file and a real editor opens on it.
   *
   * The full trace is in `docs/ui-audit-2026-09-19/findings-pptx-track.md`.
   */
  usePptxLiveDraft({ session, recordError, t });
  return <CanvasPlaceholder type="slides" />;
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
