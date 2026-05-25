import type { Artifact, BridgeEvent, DesktopTask, ProviderSnapshot, StageState, TaskQuestion, TaskRuntimeSnapshot, TaskUserInput } from "../shared/types";

export interface TaskState {
  tasks: Record<string, DesktopTask>;
  taskOrder: string[];
  artifacts: Artifact[];
}

export function createInitialTaskState(): TaskState {
  return { tasks: {}, taskOrder: [], artifacts: [] };
}

export function attachUserInput(state: TaskState, taskID: string, input: TaskUserInput): TaskState {
  const previous = state.tasks[taskID] || {
    id: taskID,
    status: "starting" as const,
    events: [],
  };
  const tasks = { ...state.tasks, [taskID]: { ...previous, userInput: input } };
  const taskOrder = state.taskOrder.includes(taskID) ? state.taskOrder : [taskID, ...state.taskOrder];
  return { ...state, tasks, taskOrder };
}

export function applyTaskEvent(state: TaskState, event: BridgeEvent): TaskState {
  if (!event.task_id) return state;
  const taskID = event.task_id;
  const previous = state.tasks[taskID] || {
    id: taskID,
    status: "starting",
    events: [],
  };
  if (event.event_id && previous.events.some((existing) => existing.event_id === event.event_id)) {
    return state;
  }
  const events = [...previous.events, event];
  const { stages, activeStageId } = reduceStages(events);
  const nextTask: DesktopTask = {
    ...previous,
    status: statusFromEvent(event.type, previous.status),
    documentType: stringPayload(event, "document_type") || previous.documentType,
    topic: stringPayload(event, "topic") || previous.topic,
    events,
    stages,
    activeStageId,
  };
  if (event.type === "task.progress") {
    nextTask.lastProgressAt = Date.now();
    nextTask.stalledSince = undefined;
  }
  if (event.type === "task.started") {
    const mode = stringPayload(event, "runtime_mode");
    if (mode === "external" || mode === "hosted") {
      nextTask.runtimeMode = mode;
      const snapshot = runtimeSnapshotFromPayload(mode, event.payload);
      if (snapshot) {
        nextTask.runtimeSnapshot = snapshot;
      }
    }
  }
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
    nextTask.stalledSince = undefined;
    applyCreditPayload(nextTask, event.payload);
  }
  if (event.type === "task.failed") {
    nextTask.error = stringPayload(event, "message") || stringPayload(event, "error") || "Task failed";
    nextTask.question = undefined;
    nextTask.stalledSince = undefined;
    applyCreditPayload(nextTask, event.payload);
  }
  if (event.type === "task.cancelled") {
    nextTask.question = undefined;
    nextTask.stalledSince = undefined;
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

function applyCreditPayload(task: DesktopTask, payload: BridgeEvent["payload"]): void {
  if (!payload) return;
  const charged = payload.credits_charged;
  if (typeof charged !== "number") return;
  task.creditCharged = charged;
  task.creditMode = typeof payload.credit_mode === "string" ? payload.credit_mode : "";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function runtimeSnapshotFromPayload(
  mode: "external" | "hosted",
  payload: BridgeEvent["payload"],
): TaskRuntimeSnapshot | undefined {
  const snapshot: TaskRuntimeSnapshot = { mode };
  if (!payload) return snapshot;
  const provider = providerSnapshotFromUnknown(payload.runtime_provider);
  if (provider) snapshot.provider = provider;
  const appliedAt = stringValue(payload.runtime_applied_at);
  if (appliedAt) snapshot.appliedAt = appliedAt;
  return snapshot;
}

function providerSnapshotFromUnknown(raw: unknown): ProviderSnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const t = obj.type;
  if (t !== "openai" && t !== "anthropic" && t !== "azure" && t !== "custom") return undefined;
  return {
    type: t,
    baseUrlHost: stringValue(obj.base_url_host),
    model: stringValue(obj.model),
    apiKeyMasked: stringValue(obj.api_key_masked),
    apiKeyLength: typeof obj.api_key_length === "number" ? obj.api_key_length : 0,
  };
}

const DEFAULT_STAGE_DEFS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "analyze", label: "Analyzing request" },
  { id: "outline", label: "Drafting outline" },
  { id: "writing", label: "Writing content" },
  { id: "format", label: "Formatting & export" },
];

export function reduceStages(events: BridgeEvent[]): { stages: StageState[]; activeStageId?: string } {
  const stageMap = new Map<string, StageState>();
  const order: string[] = [];
  let nativeMode = false;
  let activeId: string | undefined;
  let derivedIndex = -1;

  function upsert(id: string, label: string, status: StageState["status"], ts?: string) {
    const existing = stageMap.get(id);
    if (!existing) {
      const stage: StageState = { id, label, status };
      if (status === "active" && ts) stage.startedAt = ts;
      if ((status === "completed" || status === "failed") && ts) {
        stage.startedAt = ts;
        stage.completedAt = ts;
      }
      stageMap.set(id, stage);
      order.push(id);
      return;
    }
    if (label && label !== existing.label) existing.label = label;
    if (status === "active") {
      existing.startedAt = existing.startedAt || ts;
    } else if (status === "completed" || status === "failed") {
      existing.startedAt = existing.startedAt || ts;
      existing.completedAt = ts || existing.completedAt;
    }
    existing.status = status;
  }

  function ensureDerivedDefaults() {
    for (const def of DEFAULT_STAGE_DEFS) {
      if (!stageMap.has(def.id)) {
        stageMap.set(def.id, { id: def.id, label: def.label, status: "pending" });
        order.push(def.id);
      }
    }
  }

  for (const event of events) {
    const payload = (event.payload || {}) as Record<string, unknown>;
    const stageId = stringValue(payload.stage_id);
    const stageLabel = stringValue(payload.stage_label) || stringValue(payload.stage);
    const ts = event.ts;

    if (stageId) {
      nativeMode = true;
      for (const id of order) {
        const stage = stageMap.get(id);
        if (stage && id !== stageId && stage.status === "active") {
          upsert(id, stage.label, "completed", ts);
        }
      }
      if (event.type === "task.failed") {
        upsert(stageId, stageLabel || stageId, "failed", ts);
        activeId = undefined;
      } else if (event.type === "task.completed") {
        upsert(stageId, stageLabel || stageId, "completed", ts);
        activeId = undefined;
      } else {
        upsert(stageId, stageLabel || stageId, "active", ts);
        activeId = stageId;
      }
      continue;
    }

    if (nativeMode) {
      if (event.type === "task.completed") {
        for (const id of order) {
          const stage = stageMap.get(id);
          if (stage && stage.status !== "failed") {
            upsert(id, stage.label, "completed", ts);
          }
        }
        activeId = undefined;
      } else if (event.type === "task.failed" && activeId) {
        const cur = stageMap.get(activeId);
        if (cur) upsert(activeId, cur.label, "failed", ts);
        activeId = undefined;
      }
      continue;
    }

    switch (event.type) {
      case "task.started":
        break;
      case "task.progress": {
        ensureDerivedDefaults();
        derivedIndex = Math.min(derivedIndex + 1, DEFAULT_STAGE_DEFS.length - 1);
        for (let i = 0; i < derivedIndex; i++) {
          const def = DEFAULT_STAGE_DEFS[i];
          const stage = stageMap.get(def.id);
          if (stage && stage.status !== "completed") {
            upsert(def.id, stage.label, "completed", ts);
          }
        }
        const def = DEFAULT_STAGE_DEFS[derivedIndex];
        upsert(def.id, stageLabel || def.label, "active", ts);
        activeId = def.id;
        break;
      }
      case "task.completed": {
        ensureDerivedDefaults();
        for (const def of DEFAULT_STAGE_DEFS) {
          const stage = stageMap.get(def.id);
          if (stage && stage.status !== "failed") {
            upsert(def.id, stage.label, "completed", ts);
          }
        }
        activeId = undefined;
        break;
      }
      case "task.failed": {
        if (activeId) {
          const cur = stageMap.get(activeId);
          if (cur) upsert(activeId, cur.label, "failed", ts);
        } else {
          ensureDerivedDefaults();
          const def = DEFAULT_STAGE_DEFS[Math.max(derivedIndex, 0)];
          const stage = stageMap.get(def.id);
          if (stage) upsert(def.id, stage.label, "failed", ts);
        }
        activeId = undefined;
        break;
      }
    }
  }

  const stages = order.map((id) => stageMap.get(id)).filter((s): s is StageState => Boolean(s));
  return { stages, activeStageId: activeId };
}
