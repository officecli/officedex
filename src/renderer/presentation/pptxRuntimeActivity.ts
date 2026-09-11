import type { DesktopTask } from "../../shared/types";

/** The MOP runtime reports work through task.progress before slides exist. */
export function pptxRuntimeActivity(task: DesktopTask) {
  const event = [...task.events].reverse().find(event => event.type === "task.progress" && (typeof event.payload?.content === "string" || typeof event.payload?.step === "string"));
  const payload = event?.payload;
  const step = typeof payload?.step === "string" ? payload.step : task.assembleProgress?.step;
  const message = typeof payload?.content === "string" ? payload.content.trim() : task.assembleProgress?.content;
  const latestActivity = [...task.events].reverse().find(event => ["task.progress", "task.vibe_ops", "task.vibe_slide", "task.vibe_outline"].includes(event.type));
  const timestamp = latestActivity?.ts ? Date.parse(latestActivity.ts) : task.lastProgressAt;
  const started = task.createdAt ? Date.parse(task.createdAt) : task.events[0]?.ts ? Date.parse(task.events[0].ts) : undefined;
  const elapsed = typeof payload?.elapsed_ms === "number" && Number.isFinite(payload.elapsed_ms) ? Math.max(0, payload.elapsed_ms) : 0;
  const image = /image (?:asset|provider)|配图|图片/.test(message?.toLowerCase() ?? "");
  const phase: "drawing" | "outline" | undefined = step?.startsWith("skill.") || step === "assemble" || step === "render" || step === "export" || step === "publish" ? "drawing"
    : step === "plan_prepare" || step === "plan" || step === "outline" ? "outline" : undefined;
  return { phase, image, message, step, timestamp: timestamp !== undefined && Number.isFinite(timestamp) ? timestamp : undefined, started: started !== undefined && Number.isFinite(started) ? started : undefined, elapsed };
}
