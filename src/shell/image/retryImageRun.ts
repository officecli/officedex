import type { AgentTask } from "../../shared/uiPort";
import type { useAgentTask } from "../agent/useAgentTask";

/**
 * "Try again", from either place it is offered.
 *
 * The canvas offers it under a failure with no picture; the transcript offers
 * it inside the error box. Both mean the same thing — send that instruction
 * again — and both have to reach the same run settings, so the wording of a
 * retry cannot drift between the two surfaces.
 *
 * The settings are defaults rather than the ones the failed run used. The task
 * record keeps the prompt and not the options behind it, and the composer's
 * choices are the composer's state; reconstructing "4K, four pictures" from
 * nothing and charging for it again is a worse failure than the first one.
 */
export async function retryImageRun(
  agent: ReturnType<typeof useAgentTask>,
  task: AgentTask | null,
  prompt: string,
): Promise<void> {
  if (!task || !prompt) return;
  await agent.send({
    text: prompt,
    folderId: task.folderId,
    mentions: [],
    attachments: [],
    activeFileId: null,
    documentType: "img",
    imageGeneration: {
      modelId: "auto",
      ratio: "auto",
      resolution: "2K",
      count: 1,
      style: "auto",
      prompt,
    },
  });
}
