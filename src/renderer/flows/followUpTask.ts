// Starting a follow-up task in the current conversation: "continue with this
// instruction" (a new generation) and "modify the last document" (a modify
// request) share everything except the bridge call. Both used to be
// 70-line callbacks in App.tsx that had drifted apart in small ways; the
// shared shape lives here, and the two callers only build the request.

import type { DesktopTask, GenerateInput, WorkspaceSummary } from "../../shared/types";
import { classifyError, extractStderr, type FailureKind } from "../failureKind";
import { discardLocalTask, promoteLocalTask, startLocalTask, type TaskContextPatch, type TaskState } from "../taskState";
import { errorMessage } from "../utils/values";

export interface PendingGenerate {
  localTaskId: string;
  context?: TaskContextPatch;
  input: {
    prompt: string;
    generationMode?: GenerateInput["generationMode"];
    sourceFile?: string;
    referenceImages?: string[];
    imageRatio?: GenerateInput["imageRatio"];
    fps?: number;
  };
  parentTaskId?: string;
}

export interface FollowUpTarget {
  parentTaskId?: string;
  /** The workspace the new task belongs to; undefined for a no-project task. */
  targetWorkspace?: WorkspaceSummary;
  /** True when the parent task itself ran outside any project. */
  noProject: boolean;
  context: TaskContextPatch;
}

/**
 * A follow-up inherits its parent's workspace: the parent's own workspace
 * when it had one, no project when the parent ran without one, and the
 * active workspace only when there is no parent at all.
 */
export function resolveFollowUpTarget(
  parentTask: DesktopTask | undefined,
  workspaces: WorkspaceSummary[],
  activeWorkspace: WorkspaceSummary | undefined,
  conversationId: string | undefined,
): FollowUpTarget {
  const targetWorkspace = parentTask?.workspaceId
    ? workspaces.find((workspace) => workspace.id === parentTask.workspaceId)
    : (!parentTask ? activeWorkspace : undefined);
  const parentTaskId = parentTask?.id;
  return {
    parentTaskId,
    targetWorkspace,
    noProject: Boolean(parentTask && !parentTask.workspaceId),
    context: {
      conversationId,
      parentTaskId,
      ...(targetWorkspace ? { workspaceId: targetWorkspace.id, workspacePath: targetWorkspace.path } : {}),
    },
  };
}

export interface FollowUpDeps {
  /** Requests in flight, keyed by local task id; a cancel removes its entry. */
  pending: Map<string, PendingGenerate>;
  setState: (update: (current: TaskState) => TaskState) => void;
  /** Focus a task in the document view. */
  showTask: (taskId: string) => void;
  setBusy: (busy: boolean) => void;
  recordError: (text: string, kind: FailureKind, stderr?: string) => void;
  refreshProjectLists: () => void;
  /** Called once the request settled either way. */
  onSettled: () => void;
}

export interface FollowUpPlan {
  localTaskId: string;
  documentType: string;
  topic: string;
  input: PendingGenerate["input"];
  target: FollowUpTarget;
}

/**
 * Shows the task optimistically under a local id, sends the request, and
 * promotes the local task to the bridge's id or discards it on failure.
 * A local task that was removed from `pending` while the request was in
 * flight (the user cancelled) is left alone whatever the outcome.
 */
export async function runFollowUpTask(deps: FollowUpDeps, plan: FollowUpPlan, send: () => Promise<{ taskId?: string }>): Promise<void> {
  const { localTaskId, documentType, topic, input, target } = plan;
  const pending: PendingGenerate = { localTaskId, context: target.context, input, parentTaskId: target.parentTaskId };
  deps.pending.set(localTaskId, pending);
  deps.setState((current) => startLocalTask(current, localTaskId, input, { documentType, topic }, target.parentTaskId, target.context));
  deps.showTask(localTaskId);
  deps.setBusy(false);
  try {
    const result = await send();
    if (deps.pending.delete(localTaskId) && result.taskId) {
      const { taskId } = result;
      deps.setState((current) => promoteLocalTask(current, localTaskId, taskId, input, target.parentTaskId, target.context));
      deps.showTask(taskId);
      deps.refreshProjectLists();
    }
  } catch (error) {
    if (!deps.pending.delete(localTaskId)) return;
    deps.setState((current) => discardLocalTask(current, localTaskId));
    const text = errorMessage(error);
    deps.recordError(text, classifyError(text), extractStderr(text));
  } finally {
    deps.setBusy(false);
    deps.onSettled();
  }
}
