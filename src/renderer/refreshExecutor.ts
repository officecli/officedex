import type { OfficeOutputRef, OfficeRefreshPlan } from "../shared/officeProduct";
import { createRefreshQueue, finishRefresh, startRefresh, type RefreshQueueItem } from "./refreshQueue";

export interface RefreshHandlers {
  presentation?: (output: OfficeOutputRef, plan: OfficeRefreshPlan) => Promise<void>;
  document?: (output: OfficeOutputRef, plan: OfficeRefreshPlan) => Promise<void>;
  "html-app"?: (output: OfficeOutputRef, plan: OfficeRefreshPlan) => Promise<void>;
  image?: (output: OfficeOutputRef, plan: OfficeRefreshPlan) => Promise<void>;
}

export interface RefreshPlanPersistence {
  save(plan: OfficeRefreshPlan & { id?: string; status: string; attempts: number; error?: string }): Promise<void>;
}

export async function executeRefreshQueue(items: RefreshQueueItem[], outputs: OfficeOutputRef[], handlers: RefreshHandlers, onQueue?: (queue: RefreshQueueItem[]) => void): Promise<RefreshQueueItem[]> {
  let queue = items;
  for (const item of items) {
    if (item.status !== "queued") continue;
    const output = outputs.find((candidate) => candidate.id === item.plan.outputId);
    if (!output) {
      queue = finishRefresh(startRefresh(queue, item.plan.outputId), item.plan.outputId, "Output no longer exists");
      onQueue?.(queue);
      continue;
    }
    queue = startRefresh(queue, output.id);
    onQueue?.(queue);
    try {
      const handler = output.type === "presentation" || output.type === "document" || output.type === "html-app" || output.type === "image"
        ? handlers[output.type]
        : undefined;
      if (!handler) throw new Error(`No refresh handler for ${output.type}`);
      await handler(output, item.plan);
      queue = finishRefresh(queue, output.id);
    } catch (error) {
      queue = finishRefresh(queue, output.id, error instanceof Error ? error.message : String(error));
    }
    onQueue?.(queue);
  }
  return queue;
}

export async function executeAndPersistRefreshQueue(items: RefreshQueueItem[], outputs: OfficeOutputRef[], handlers: RefreshHandlers, persistence: RefreshPlanPersistence, onQueue?: (queue: RefreshQueueItem[]) => void): Promise<RefreshQueueItem[]> {
  let queue = items;
  const persistQueue = async (next: RefreshQueueItem[]) => {
    queue = next;
    onQueue?.(queue);
    await Promise.all(queue.map((item) => persistence.save({ ...item.plan, id: item.id, status: item.status, attempts: item.attempts, error: item.error })));
  };
  for (const item of items) {
    if (item.status !== "queued") continue;
    const output = outputs.find((candidate) => candidate.id === item.plan.outputId);
    if (!output) { await persistQueue(finishRefresh(startRefresh(queue, item.plan.outputId), item.plan.outputId, "Output no longer exists")); continue; }
    await persistQueue(startRefresh(queue, output.id));
    try {
      const handler = output.type === "presentation" || output.type === "document" || output.type === "html-app" || output.type === "image" ? handlers[output.type] : undefined;
      if (!handler) throw new Error(`No refresh handler for ${output.type}`);
      await handler(output, item.plan);
      await persistQueue(finishRefresh(queue, output.id));
    } catch (error) {
      await persistQueue(finishRefresh(queue, output.id, error instanceof Error ? error.message : String(error)));
    }
  }
  return queue;
}

export { createRefreshQueue };
