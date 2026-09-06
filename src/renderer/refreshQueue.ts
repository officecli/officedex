import type { OfficeRefreshPlan } from "../shared/officeProduct";

export type RefreshQueueStatus = "queued" | "awaiting_confirmation" | "running" | "succeeded" | "failed";

export interface RefreshQueueItem {
  id: string;
  plan: OfficeRefreshPlan;
  status: RefreshQueueStatus;
  error?: string;
  attempts: number;
}

export function createRefreshQueue(plans: OfficeRefreshPlan[]): RefreshQueueItem[] {
  return plans.map((plan) => ({ id: `${plan.outputId}:${plan.strategy}`, plan, status: plan.requiresApproval ? "awaiting_confirmation" : "queued", attempts: 0 }));
}

export function approveRefresh(queue: RefreshQueueItem[], outputId: string): RefreshQueueItem[] {
  return queue.map((item) => item.plan.outputId === outputId && item.status === "awaiting_confirmation" ? { ...item, status: "queued" } : item);
}

export function startRefresh(queue: RefreshQueueItem[], outputId: string): RefreshQueueItem[] {
  return queue.map((item) => item.plan.outputId === outputId && (item.status === "queued" || item.status === "failed")
    ? { ...item, status: "running", error: undefined, attempts: item.attempts + 1 }
    : item);
}

export function finishRefresh(queue: RefreshQueueItem[], outputId: string, error?: string): RefreshQueueItem[] {
  return queue.map((item) => item.plan.outputId === outputId && item.status === "running"
    ? { ...item, status: error ? "failed" : "succeeded", error }
    : item);
}

export function isRefreshQueueComplete(queue: RefreshQueueItem[]): boolean {
  return queue.length > 0 && queue.every((item) => item.status === "succeeded");
}
