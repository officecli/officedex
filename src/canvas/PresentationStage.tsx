import { useCallback, useEffect, useRef, useState } from "react";

import type { DesktopAPI, DesktopTask } from "../shared/types";
import { DesktopApiProvider } from "../renderer/services/desktopApi";
import { LocaleProvider } from "../renderer/i18n";
import { CanvasPlaceholder } from "../shell/editor/CanvasPlaceholder";
import { useCanvasLocale } from "../shell/editor/canvasLocale";
import { usePptxLiveDraft } from "../renderer/controllers/usePptxLiveDraft";
import {
  PresentationEditorFrame,
  type PresentationEditorController,
} from "../renderer/presentation/PresentationEditorFrame";
import { hasPptxDrawingContent } from "../renderer/presentation/vibeReplay";
import { SLIDES_CHROME, useEditorChrome } from "./editorChrome";
import { useCanvasSession } from "./useCanvasSession";
import { useLiveDeckReplay } from "./useLiveDeckReplay";

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
  /**
   * Run the bundled NexaEdge recording instead of waiting for a run's own op
   * stream.
   *
   * This is the legacy **Watch PPT generation** demo carried into the shell: a
   * real 141-op recording of a real generation (`demos/nexaedge/ops.json`), so
   * the live-drawing path can be exercised on demand — no model calls, no
   * credits, and no three-minute wait to reach the state under test. It drives
   * exactly the same sequencer, controller, draft and editor as a real run, so
   * what it proves about the drawing path applies to the real one.
   */
  demo?: boolean;
}

export function PresentationStage({ api, task, onError, demo }: PresentationStageProps) {
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
        <StageBody api={api} task={task} onError={onError} demo={demo} />
      </DesktopApiProvider>
    </LocaleProvider>
  );
}

function StageBody({ api, task, onError, demo }: PresentationStageProps) {
  const session = useCanvasSession(api);
  const recordError = useCallback((text: string) => onError(text), [onError]);

  // The stage's copy comes from `pptxFlowCopy`; this `t` is only what
  // usePptxLiveDraft uses for the one message it raises itself.
  const t = useCallback((key: string) => key, []);

  const live = usePptxLiveDraft({ session, recordError, t });

  /*
   * The bundled recording, started once the stage has somewhere to put it.
   *
   * `replayBundledDemo` creates its own blank draft, registers it, issues its
   * token and adopts the session — the same `startReplay` a recovered op stream
   * uses — so everything downstream of here is the ordinary live path.
   *
   * Guarded by a ref, not by state: a second call would revoke the first
   * draft's token and start over, which is exactly the redraw loop this demo is
   * used to watch for.
   */
  const demoStartedRef = useRef(false);
  const replayBundledDemo = live.replayBundledDemo;
  useEffect(() => {
    if (!demo || demoStartedRef.current) return;
    demoStartedRef.current = true;
    void replayBundledDemo().catch((error: unknown) => {
      demoStartedRef.current = false;
      onError(error instanceof Error ? error.message : String(error));
    });
  }, [demo, onError, replayBundledDemo]);

  /*
   * Is there anything to draw?
   *
   * `hasPptxDrawingContent` is the runtime's own test, and the same one
   * `usePptxLiveDraft` uses to decide whether a draft is worth creating. The
   * editor is mounted when there is something to put in it and not otherwise:
   * a whole-deck editor over an empty scratch file is the state this stage was
   * once in for three and a half minutes, under a banner claiming it was being
   * drawn.
   *
   * The demo branch is separate on purpose. A demo is an op stream with no run
   * behind it, so between "the demo started" and "the first feed exists" there
   * is a window where `drawing` is still false — mounting on `drawing` alone
   * would unmount the editor the moment the draft it is drawing into arrives,
   * and the sequencer would be holding a controller for a frame that is gone.
   */
  const drawing = hasPptxDrawingContent(live.replayFeed?.ops);

  /*
   * The editor's own handle, so the run can draw into it.
   *
   * Held as state rather than a ref so the hook re-runs when the editor hands
   * over a new controller: a new editor session has to get a new sequencer, or
   * the old one draws into a document that is gone.
   *
   * This is the half that was missing. The ops reached the renderer and stopped
   * because the thing that executes them lives inside the workbench, a layer
   * above what this stage mounts; `useLiveDeckReplay` is the wiring, and it
   * needs nothing from the workbench but the controller the frame already
   * hands out.
   */
  const [controller, setController] = useState<PresentationEditorController | null>(null);
  useLiveDeckReplay(api, controller, live.replayFeed);

  /*
   * The editor draws; the user does not.
   *
   * The deck on screen is `workspaceDir/live/` scratch: every redraw replaces
   * it and the next run deletes it. Text typed into it is gone by the next
   * page, so the overlay stops the *user* — it does not stop the runtime, whose
   * drawing goes through the controller rather than the DOM.
   *
   * The editor has no read-only mode to ask for, so Insert/Draw/Design sit
   * there looking live. The lock is what makes them inert.
   */
  const drawingOrDemo = demo ? Boolean(live.liveDraft) || drawing : drawing;
  const editorReady = Boolean(
    session.grant && session.artifact?.taskId === task.id && drawingOrDemo,
  );

  /*
   * The deck's own status bar, reported like the file editor's.
   *
   * `editorChrome.ts` says the stages report nothing because they mount no
   * editor — true when this stage was a skeleton, and false since it draws
   * through `PresentationEditorFrame`, which renders the same 32px status bar
   * ("Slide 2 / 8") the file editor does. Without this the agent's attention
   * frame sits on it, because the frame insets by what the editor reports.
   *
   * Called before the early return below, like every hook here: the stage
   * renders the skeleton on the same commits it renders the editor.
   */
  useEditorChrome(editorReady ? SLIDES_CHROME : null);

  if (!editorReady) return <CanvasPlaceholder type="slides" />;

  return (
    <div className="shell-live-deck" data-testid="shell-live-deck">
      <div className="shell-live-deck-frame">
        <PresentationEditorFrame
          previewToken={session.grant!.token}
          fileName={session.artifact!.fileName}
          onController={setController}
          onUnavailable={(error) => onError(error || "The presentation editor could not start.")}
        />
        <div className="shell-live-deck-lock" aria-hidden="true" data-testid="shell-live-deck-lock" />
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
