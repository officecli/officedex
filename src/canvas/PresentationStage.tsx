import { useCallback } from "react";

import type { DesktopAPI, DesktopTask, GenerateInput } from "../shared/types";
import { DesktopApiProvider } from "../renderer/services/desktopApi";
import { LocaleProvider } from "../renderer/i18n";
import { ProgressivePptxStage } from "../renderer/presentation/ProgressivePptxStage";
import { usePptxLiveDraft } from "../renderer/controllers/usePptxLiveDraft";
import { usePptxRunControls } from "../renderer/controllers/usePptxRunControls";
import { useCanvasSession } from "./useCanvasSession";

/**
 * A presentation while it is being drawn.
 *
 * This is the other thing a deck can be on screen. An existing .pptx is a file
 * and gets an editor; a deck that does not exist yet is a *run*, and what the
 * user watches is the outline gate, the page-by-page drawing and the controls
 * over it. The two are different enough that the old app had a separate stage
 * for it, which is reused here whole.
 *
 * **A drawing deck is not a file.** `CreateLivePptxDraft` writes to
 * `workspaceDir/live/` and registers the path with the preview registry only —
 * it never touches `documents` or `artifacts`, so nothing about it reaches the
 * file library. That is right: the draft is scratch, replaced on every redraw
 * and deleted when the next one starts, and a library full of `live-task-3.pptx`
 * would be worse than useless. It also means this cannot be routed to by active
 * file the way an editor is; the task is what puts it on screen.
 *
 * Almost none of the behaviour lives here. `usePptxLiveDraft` owns the whole
 * draft lifecycle — spotting the moment drawing actually starts, creating the
 * file, registering it for replay, issuing its token and adopting the session —
 * and `usePptxRunControls` owns the gate, the steering and the pause/resume
 * distinction. Both depend only on a desktop API and a task store, both of which
 * this layer already has, so they are mounted rather than reimplemented. The
 * rules they encode were each a bug first (R-E-01 through R-E-07); rewriting
 * them for a new IA would be re-earning them.
 */

export interface PresentationStageProps {
  api: DesktopAPI;
  task: DesktopTask;
  onError: (message: string) => void;
}

export function PresentationStage({ api, task, onError }: PresentationStageProps) {
  return (
    <LocaleProvider>
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

  /**
   * An instruction that arrives after the run is over.
   *
   * Steering only exists while something is drawing. Once it is not, the same
   * words are an ordinary follow-up modification of the deck this run produced —
   * including one it only got part-way through (R-E-04).
   */
  const modifyDeck = useCallback(
    async (instruction: string, sourceTaskId: string) => {
      const source = task.id === sourceTaskId ? task : undefined;
      const filePath = source?.artifact?.filePath ?? session.artifact?.filePath;
      if (!filePath) {
        onError("There is no deck to change yet.");
        return;
      }
      await api.modify({
        documentType: "pptx" as GenerateInput["documentType"],
        sourceFile: filePath,
        prompt: instruction,
        ...(task.workspaceId ? { workspaceId: task.workspaceId } : { noProject: true }),
      });
    },
    [api, onError, session.artifact, task],
  );

  const controls = usePptxRunControls({ modifyDeck });

  const editorReady = Boolean(session.grant && session.artifact?.taskId === task.id);

  return (
    <ProgressivePptxStage
      task={task}
      draftReady={editorReady}
      editor={
        editorReady
          ? {
              previewToken: session.grant!.token,
              fileName: session.artifact!.fileName,
              onUnavailable: (error) => onError(error || "The presentation editor could not start."),
            }
          : undefined
      }
      onCheckStatus={api.getPptxTaskStatus ? () => controls.checkStatus(task.id) : undefined}
      onSkipResearch={api.skipPptxResearch ? () => api.skipPptxResearch!(task.id) : undefined}
      // The outline gate and a question are the same call with different
      // payloads; the stage decides which one it is showing.
      onContinue={gated(task) ? (outline) => controls.resume(task, outline) : undefined}
      onStartDrawing={gated(task) ? (outline) => controls.resume(task, outline) : undefined}
      onQuestionAnswer={(answer) => controls.resume(task, undefined, answer)}
      productionProps={{
        onCancel: () => void api.cancel(task.id),
        onSteer: (instruction) => controls.steer(task, instruction),
        onPause: api.pausePptx ? () => void controls.pause(task) : undefined,
        livePaused: controls.livePausedTaskIds.includes(task.id),
        onResumeLive: api.resumePptxLive ? () => void controls.resumeLive(task) : undefined,
        onResume: () => void controls.resume(task),
      }}
    />
  );
}

function gated(task: DesktopTask): boolean {
  return task.status === "question" || task.status === "plan_review";
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
