import type { DesktopTask } from "../../shared/types";

/** The MOP runtime reports work through task.progress before slides exist. */
export function pptxRuntimeActivity(task: DesktopTask) {
  const event = [...task.events].reverse().find(event => event.type === "task.progress" && !event.payload?.heartbeat && (typeof event.payload?.content === "string" || typeof event.payload?.step === "string"));
  const payload = event?.payload;
  const step = typeof payload?.step === "string" ? payload.step : task.assembleProgress?.step;
  const message = typeof payload?.content === "string" ? payload.content.trim() : task.assembleProgress?.content;
  const latestActivity = [...task.events].reverse().find(event => !event.payload?.heartbeat && ["task.progress", "task.vibe_ops", "task.vibe_slide", "task.vibe_outline"].includes(event.type));
  const timestamp = latestActivity?.ts ? Date.parse(latestActivity.ts) : task.lastProgressAt;
  const started = task.createdAt ? Date.parse(task.createdAt) : task.events[0]?.ts ? Date.parse(task.events[0].ts) : undefined;
  const elapsed = typeof payload?.elapsed_ms === "number" && Number.isFinite(payload.elapsed_ms) ? Math.max(0, payload.elapsed_ms) : 0;
  const image = /image (?:asset|provider)|配图|图片/.test(message?.toLowerCase() ?? "");
  const phase: "drawing" | "outline" | undefined = step === "plan.expand" || step?.startsWith("skill.") || step === "assemble" || step === "render" || step === "export" || step === "publish" ? "drawing"
    : step?.startsWith("plan.outline") || step === "plan.style" || step === "plan_prepare" || step === "plan" || step === "outline" ? "outline" : undefined;
  const heartbeat = [...task.events].reverse().find(event => event.payload?.heartbeat === true);
  const eventHeartbeatAt = heartbeat?.ts ? Date.parse(heartbeat.ts) : undefined;
  const heartbeatAt = task.lastStatusCheckAt !== undefined ? Math.max(task.lastStatusCheckAt, eventHeartbeatAt || 0) : eventHeartbeatAt;
  return { heartbeatAt, phase, image, message, step, timestamp: timestamp !== undefined && Number.isFinite(timestamp) ? timestamp : undefined, started: started !== undefined && Number.isFinite(started) ? started : undefined, elapsed };
}

/** Content previews are independent of ordered rendering, so page 2 can appear first. */
export function pptxContentPreviews(task: DesktopTask) {
  const pages = new Map<number, { slide: number; headline: string; takeaway: string; details: string[] }>();
  for (const event of task.events) {
    const p = event.payload?.slide_preview as Record<string, unknown> | undefined;
    if (!p || !Number.isInteger(p.slide) || Number(p.slide) < 1 || typeof p.headline !== "string") continue;
    const details: string[] = [];
    const collect = (value: unknown): void => {
      if (Array.isArray(value)) { value.forEach(collect); return; }
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        if (["heading", "detail", "text"].includes(key) && typeof child === "string") details.push(child);
        else if (typeof child === "object") collect(child);
      }
    };
    collect(p.blocks);
    pages.set(Number(p.slide), { slide: Number(p.slide), headline: p.headline, takeaway: typeof p.takeaway === "string" ? p.takeaway : "", details });
  }
  return [...pages.values()].sort((a, b) => a.slide - b.slide);
}

export function pptxPageStates(task: DesktopTask) {
  const states = new Map<number, "queued" | "generating" | "repairing" | "ready" | "failed" | "canceled">();
  for (const event of task.events) {
    const p = event.payload?.slide_state as Record<string, unknown> | undefined;
    if (p && Number.isInteger(p.slide) && Number(p.slide) > 0 && ["queued", "generating", "repairing", "ready", "failed", "canceled"].includes(String(p.state))) {
      states.set(Number(p.slide), p.state as "ready");
    }
  }
  if (["failed", "cancelled"].includes(task.status)) {
    for (const [page, state] of states) if (!["ready", "failed"].includes(state)) states.set(page, "canceled");
  }
  return states;
}

/**
 * The page facts a failed run's panel reports.
 *
 * Content readiness comes from the backend's structured failure — read from
 * `task.partial` when the event reducer has materialised it, and from
 * `task.failure.retained` otherwise, so a task assembled by a test or restored
 * from history reports the same thing as a live one. How much actually reached
 * the user's document is this side's own op stream to say, because the process
 * that failed never saw the editor. The two used to be conflated into "8 of 12"
 * printed inside an error sentence.
 */
export function pptxPartialWork(task: DesktopTask): {
  drawnPages: number;
  readyPages?: number;
  totalPages?: number;
  failedPages?: number[];
} {
  const slides = task.vibeSlides ?? [];
  const drawnPages = slides.reduce((count, slide) => count + (slide ? 1 : 0), 0);
  const readyPages = task.partial?.readyPages ?? task.failure?.retained?.ready_pages;
  const totalPages = task.partial?.totalPages ?? task.failure?.retained?.total_pages;
  const failedPages = task.partial?.failedPages ?? task.failure?.retained?.failed_pages;
  return {
    drawnPages,
    ...(readyPages === undefined ? {} : { readyPages }),
    ...(totalPages === undefined ? {} : { totalPages }),
    ...(failedPages?.length ? { failedPages } : {}),
  };
}
