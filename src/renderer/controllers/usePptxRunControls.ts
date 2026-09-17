import { useCallback, useState } from "react";
import type { DesktopTask, TaskQuestionAnswer } from "../../shared/types";
import { useDesktopApi } from "../services/desktopApi";
import { useTaskStore } from "../store/taskStore";
import { reconcilePptxTaskStatus } from "../presentation/pptxStatusReconciliation";
import { resumeInteractiveTask, type OutlineSection } from "../flows/resumeTask";

export interface PptxRunControlsDeps {
  /**
   * Turns an instruction into a follow-up modification of the deck a task
   * produced. Used when there is no live run left to absorb it.
   */
  readonly modifyDeck: (instruction: string, sourceTaskId: string) => Promise<void>;
}

export interface PptxRunControlsController {
  /** Tasks the user is holding at a page boundary. */
  readonly livePausedTaskIds: string[];
  /** Steers a live run, or modifies the finished deck. See the note below. */
  readonly steer: (task: DesktopTask, instruction: string) => Promise<void>;
  readonly pause: (task: DesktopTask) => Promise<void>;
  readonly resumeLive: (task: DesktopTask) => Promise<void>;
  /** Answers the interactive gate: an outline review or a question. */
  readonly resume: (task: DesktopTask, outline?: OutlineSection[], questionAnswer?: TaskQuestionAnswer) => Promise<void>;
  readonly answer: (task: DesktopTask, answer: TaskQuestionAnswer) => Promise<void>;
  readonly checkStatus: (taskId: string) => Promise<void>;
}

/**
 * The controls over a pptx run: the live gears, the interactive gate, and the
 * status probe.
 *
 * Two distinctions this keeps straight, both easy to collapse by accident:
 *
 * - Steering versus modifying. While the deck is still being drawn there is a
 *   live run to steer and the instruction lands at its next page boundary,
 *   which is what the bar promises. Once the run is over nothing can absorb it
 *   and the same instruction becomes an ordinary follow-up modification — of
 *   the deck this task produced, including one it only got part-way through
 *   (R-E-04).
 *
 * - Live gears versus the interactive gate. `pause`/`resumeLive` hold a drawing
 *   run at a page boundary; answering a question or approving an outline goes
 *   through `resume` instead. The runtime blocks rather than reporting a paused
 *   state, so the acknowledgement of the pause call is the only evidence the UI
 *   has — and it is enough to show the right control (R-E-05).
 */
export function usePptxRunControls({ modifyDeck }: PptxRunControlsDeps): PptxRunControlsController {
  const api = useDesktopApi();
  const { update } = useTaskStore();
  const [livePausedTaskIds, setLivePausedTaskIds] = useState<string[]>([]);

  const steer = useCallback(async (task: DesktopTask, instruction: string) => {
    const steeringLive = ["starting", "running"].includes(task.status) && api.intervenePptx;
    if (steeringLive) {
      await api.intervenePptx!(task.id, instruction);
      return;
    }
    await modifyDeck(instruction, task.id);
  }, [api, modifyDeck]);

  const pause = useCallback(async (task: DesktopTask) => {
    if (!api.pausePptx) return;
    await api.pausePptx(task.id);
    setLivePausedTaskIds((current) => current.includes(task.id) ? current : [...current, task.id]);
  }, [api]);

  const resumeLive = useCallback(async (task: DesktopTask) => {
    if (!api.resumePptxLive) return;
    await api.resumePptxLive(task.id);
    setLivePausedTaskIds((current) => current.filter((id) => id !== task.id));
  }, [api]);

  const resume = useCallback(async (task: DesktopTask, outline?: OutlineSection[], questionAnswer?: TaskQuestionAnswer) => {
    await resumeInteractiveTask({ task, outline, questionAnswer }, { api, setState: update });
  }, [api, update]);

  const answer = useCallback(async (task: DesktopTask, value: TaskQuestionAnswer) => {
    await api.respond({
      taskId: task.id,
      answer: value.answer,
      ...(value.optionId ? { optionId: value.optionId } : {}),
      ...(value.questionId ? { questionId: value.questionId } : {}),
    });
  }, [api]);

  const checkStatus = useCallback(async (taskId: string) => {
    if (!api.getPptxTaskStatus) return;
    const snapshot = await api.getPptxTaskStatus(taskId);
    update((current) => reconcilePptxTaskStatus(current, taskId, snapshot));
  }, [api, update]);

  return { livePausedTaskIds, steer, pause, resumeLive, resume, answer, checkStatus };
}
