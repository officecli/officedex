import type { AgentImageRun, AgentTask, FileMeta } from "../../shared/uiPort";
import { SEED_FOLDER_ID } from "../port/fake/seed";
import { renderShell, type RenderShellOptions } from "../test/renderShell";

/**
 * A picture's conversation, seeded and opened — shared by the image tests.
 *
 * The image surfaces themselves are unchanged in r10 ("AI image 保留既有图像创作
 * 界面"); the way in is what moved. There is no Agent/Editor mode and no
 * "Create an image" on Home any more, so a seeded picture task is reached the
 * way the sidebar reaches any conversation: `open-chat`. That is what puts
 * `ImageTranscript` in the second column, and opening one of its versions is
 * what puts `ImageWorkspace` over the canvas.
 */

export function imageRun(partial: Partial<AgentImageRun> & { taskId: string }): AgentImageRun {
  return { status: "done", prompt: "A warm desk lamp", ...partial };
}

export function picture(id: string, taskId: string, folderId = SEED_FOLDER_ID): FileMeta {
  return {
    id,
    name: `${id}.png`,
    type: "image",
    folderId,
    createdAt: 0,
    updatedAt: 0,
    lastOpenedAt: null,
    dirty: false,
    pinned: false,
    artifactTaskId: taskId,
  };
}

/** A finished picture task, named after its first run the way the fake does. */
export function imageTask(runs: AgentImageRun[], extra: Partial<AgentTask> = {}): AgentTask {
  const running = runs.some((entry) => entry.status === "running");
  return {
    id: runs[0].taskId,
    title: "A warm desk lamp",
    folderId: SEED_FOLDER_ID,
    documentType: "img",
    status: running ? "writing" : "done",
    phase: running ? "Creating image" : "Image ready",
    steps: [],
    messages: [],
    suggestion: null,
    question: null,
    image: { runs },
    ...extra,
  };
}

/**
 * The shell with that task's conversation open in the second column.
 *
 * The fake names a seeded conversation after the task, so the task's id is also
 * the conversation id the sidebar would open it by.
 */
export async function openImageChat(
  options: RenderShellOptions & { task: AgentTask },
): Promise<Awaited<ReturnType<typeof renderShell>>> {
  const { task, ...rest } = options;
  const shell = await renderShell({ fastAgent: true, tasks: [task], ...rest });
  await shell.dispatch({
    type: "open-chat",
    chat: { folderId: task.folderId, conversationId: task.id },
  });
  return shell;
}
