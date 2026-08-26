import type { DesktopTask } from "../shared/types";

export const SEEN_FAILURES_STORAGE_KEY = "officedex.tasks.seenFailures";

export interface TaskSignals {
  /** Tasks waiting on the user (question / plan review). */
  attention: number;
  /** Tasks currently executing. */
  running: number;
  /** Failed tasks the user has not acknowledged by opening the tasks page. */
  unseenFailures: number;
}

export function readSeenFailures(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(SEEN_FAILURES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function writeSeenFailures(ids: string[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    // Cap the list so an old, long-lived install cannot grow it without bound.
    localStorage.setItem(SEEN_FAILURES_STORAGE_KEY, JSON.stringify(ids.slice(-200)));
  } catch {
    // Storage failures only cost a repeated red dot; never break task handling.
  }
}

export function failedTaskIds(tasks: DesktopTask[]): string[] {
  return tasks.filter((task) => task.status === "failed").map((task) => task.id);
}

export function computeTaskSignals(tasks: DesktopTask[], seenFailures: readonly string[]): TaskSignals {
  const seen = new Set(seenFailures);
  let attention = 0;
  let running = 0;
  let unseenFailures = 0;
  for (const task of tasks) {
    if (task.status === "question" || task.status === "plan_review") attention += 1;
    else if (task.status === "starting" || task.status === "running") running += 1;
    else if (task.status === "failed" && !seen.has(task.id)) unseenFailures += 1;
  }
  return { attention, running, unseenFailures };
}

/** The one signal the sidebar shows, highest urgency first. */
export type SidebarSignal =
  | { kind: "attention"; count: number }
  | { kind: "running"; count: number }
  | { kind: "failed"; count: number }
  | undefined;

export function sidebarSignal(signals: TaskSignals): SidebarSignal {
  if (signals.attention > 0) return { kind: "attention", count: signals.attention };
  if (signals.running > 0) return { kind: "running", count: signals.running };
  if (signals.unseenFailures > 0) return { kind: "failed", count: signals.unseenFailures };
  return undefined;
}

/** Notification body for a finished task — says which one, not just "a task". */
export function taskNotificationBody(task: DesktopTask | undefined, fallback: string): string {
  const name = task?.topic?.trim() || task?.artifact?.fileName?.trim();
  return name ? `${fallback} · ${name}` : fallback;
}
