import type { DesktopTask } from "../../shared/types";

export interface PptxQuestionResponse {
  taskId: string;
  questionId?: string;
  optionId?: string;
  answer?: string;
}

/**
 * Translate the visible progressive PPTX step into the bridge protocol that
 * owns that gate. Vibe stages are typed actions: sending the literal word
 * "continue" is treated as a rewrite instruction and reopens the same gate.
 */
export function responseForPptxQuestion(task: DesktopTask, fallbackQuestionId?: string): PptxQuestionResponse {
  const questionId = task.question?.id ?? fallbackQuestionId;
  const stage = task.vibeTree?.stage;
  const nodes = task.vibeTree?.tree.nodes ?? [];

  if (stage === "story_ready") {
    const hasGeneratedStory = nodes.some((node) => node.kind === "branch");
    if (!hasGeneratedStory) {
      return {
        taskId: task.id,
        questionId,
        answer: JSON.stringify({
          kind: "vibe_node_confirmed",
          nodeId: task.vibeTree?.tree.rootId || "root",
        }),
      };
    }
    return { taskId: task.id, questionId, optionId: "generate_chapters" };
  }
  if (stage === "outline_ready") return { taskId: task.id, questionId, optionId: "generate_outline" };
  if (stage === "refined_ready") return { taskId: task.id, questionId, optionId: "generate_slides" };
  if (stage === "slides_ready") return { taskId: task.id, questionId, optionId: "finish_deck" };

  // The one-tap inferred brief and older plain questions accept a freeform
  // response. Keep the compatibility value for runtimes without typed gates.
  return { taskId: task.id, questionId, answer: "continue" };
}
