import type { Artifact, BridgeEvent, DesktopTask, TaskQuestion } from "../shared/types";

export interface TaskState {
  tasks: Record<string, DesktopTask>;
  taskOrder: string[];
  artifacts: Artifact[];
}

export function createInitialTaskState(): TaskState {
  return { tasks: {}, taskOrder: [], artifacts: [] };
}

export function applyTaskEvent(state: TaskState, event: BridgeEvent): TaskState {
  const taskID = event.task_id || "unknown";
  const previous = state.tasks[taskID] || {
    id: taskID,
    status: "starting",
    events: [],
  };
  const nextTask: DesktopTask = {
    ...previous,
    status: statusFromEvent(event.type, previous.status),
    documentType: stringPayload(event, "document_type") || previous.documentType,
    topic: stringPayload(event, "topic") || previous.topic,
    events: [...previous.events, event],
  };
  if (event.type === "task.question") {
    nextTask.question = questionFromPayload(event.payload);
    nextTask.status = "question";
  }
  if (event.type === "task.completed") {
    const artifact = artifactFromPayload(taskID, event.payload);
    if (artifact) {
      nextTask.artifact = artifact;
    }
    nextTask.question = undefined;
  }
  if (event.type === "task.failed") {
    nextTask.error = stringPayload(event, "message") || stringPayload(event, "error") || "Task failed";
    nextTask.question = undefined;
  }
  if (event.type === "task.cancelled") {
    nextTask.question = undefined;
  }

  const tasks = { ...state.tasks, [taskID]: nextTask };
  const taskOrder = state.taskOrder.includes(taskID) ? state.taskOrder : [taskID, ...state.taskOrder];
  const artifact = nextTask.artifact;
  const artifacts = artifact && !state.artifacts.some((item) => item.filePath === artifact.filePath) ? [artifact, ...state.artifacts] : state.artifacts;
  return { tasks, taskOrder, artifacts };
}

function statusFromEvent(type: string, fallback: DesktopTask["status"]): DesktopTask["status"] {
  switch (type) {
    case "task.started":
    case "task.progress":
    case "task.output":
      return "running";
    case "task.question":
      return "question";
    case "task.completed":
      return "completed";
    case "task.failed":
      return "failed";
    case "task.cancelled":
      return "cancelled";
    default:
      return fallback;
  }
}

function questionFromPayload(payload: BridgeEvent["payload"]): TaskQuestion | undefined {
  if (!payload) {
    return undefined;
  }
  const options = Array.isArray(payload.options)
    ? payload.options
        .map((option) => {
          if (!option || typeof option !== "object") {
            return null;
          }
          const value = option as Record<string, unknown>;
          return { id: String(value.id || value.label || ""), label: String(value.label || value.id || "") };
        })
        .filter((option): option is { id: string; label: string } => Boolean(option?.id && option.label))
    : [];
  return {
    id: String(payload.id || ""),
    question: String(payload.question || ""),
    options,
    allowFreeform: Boolean(payload.allow_freeform),
  };
}

function artifactFromPayload(taskID: string, payload: BridgeEvent["payload"]): Artifact | undefined {
  const result = payload?.result && typeof payload.result === "object" ? (payload.result as Record<string, unknown>) : payload;
  if (!result) {
    return undefined;
  }
  const filePath = stringValue(result.file_path) || stringValue(result.filePath);
  if (!filePath) {
    return undefined;
  }
  const fileName = stringValue(result.file_name) || stringValue(result.fileName) || filePath.split(/[\\/]/).pop() || filePath;
  return {
    taskId: taskID,
    fileID: stringValue(result.file_id) || stringValue(result.fileID) || undefined,
    filePath,
    fileName,
    documentType: stringValue(result.document_type) || stringValue(result.documentType) || "",
    previewUrl: stringValue(result.access_url) || stringValue(result.preview_url) || undefined,
  };
}

function stringPayload(event: BridgeEvent, key: string): string {
  return event.payload ? stringValue(event.payload[key]) : "";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
