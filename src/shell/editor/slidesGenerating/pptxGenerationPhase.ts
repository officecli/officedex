import type { DesktopTask, VibeOp } from "../../../shared/types";
import { pptxPageStates, pptxRuntimeActivity } from "../../../renderer/presentation/pptxRuntimeActivity";

/**
 * What the generating canvas is showing. Driven by the run's own events, not
 * by a timer — the demo's 14s loop is not this.
 */
export type GenerationCanvasPhase = "research" | "outline" | "writing" | "drawing" | "polish";

const LIVE = new Set(["starting", "running", "question", "plan_review"]);

/** After this the generating canvas keeps the status pill and an idle square. */
export const GENERATION_QUIET_AFTER_MS = 30_000;

export function lastContentOpKind(ops: readonly VibeOp[] = []): "writing" | "drawing" | null {
  for (let index = ops.length - 1; index >= 0; index -= 1) {
    const op = ops[index];
    if (op.op === "diagram.add") return "drawing";
    if (op.op !== "shape.add" && op.op !== "shape.update") continue;
    const kind = typeof op.shape?.kind === "string" ? op.shape.kind : "";
    if (kind === "picture" || kind === "chart" || kind === "sparkline" || op.fill?.imageRef || op.shape?.imageRef) {
      return "drawing";
    }
    if (kind === "text" || typeof op.shape?.text === "string") return "writing";
  }
  return null;
}

function readyPageCount(task: DesktopTask): { ready: number; total: number } {
  const states = pptxPageStates(task);
  const ready = [...states.values()].filter((state) => state === "ready").length;
  const outlined = task.vibeOutline?.slides?.length ?? 0;
  const total = Math.max(states.size, outlined, typeof task.vibeOps?.find((op) => op.op === "deck.begin")?.slides === "number"
    ? Number(task.vibeOps?.find((op) => op.op === "deck.begin")?.slides)
    : 0);
  return { ready, total };
}

/**
 * Map a live PPTX run onto the five generating-canvas phases.
 *
 * Returns null when the canvas should not be animating: the run failed or was
 * cancelled (the existing failure panel owns that), or it is no longer a live
 * deck.
 */
export function generationCanvasPhase(task: DesktopTask): GenerationCanvasPhase | null {
  if (task.status === "failed" || task.status === "cancelled") return null;
  if (!LIVE.has(task.status) && task.status !== "completed") return null;

  const runtime = pptxRuntimeActivity(task);
  const step = runtime.step ?? "";

  if (
    step === "export" ||
    step === "write_file" ||
    step === "publish" ||
    step === "finalize"
  ) {
    return "polish";
  }

  const pages = readyPageCount(task);
  if (pages.total > 0 && pages.ready >= pages.total && LIVE.has(task.status)) return "polish";

  const opKind = lastContentOpKind(task.vibeOps);
  if (opKind === "drawing" || runtime.image) return "drawing";
  if (opKind === "writing") return "writing";

  if (step === "plan.expand" || step === "generate" || step === "generate_llm") return "writing";
  if (step.startsWith("skill.") || step === "assemble" || step === "render") return "drawing";

  if (step === "plan.research" || step === "research") return "research";
  if (
    step.startsWith("plan.outline") ||
    step === "plan.style" ||
    step === "plan_prepare" ||
    step === "plan" ||
    step === "outline" ||
    runtime.phase === "outline"
  ) {
    return "outline";
  }

  if (task.vibeOutline || task.vibeTree || task.plan) return "outline";
  if (task.status === "question" || task.status === "plan_review") return "outline";

  // A live run with no research step is waiting on the outline, not searching
  // the web. Research is opt-in now; inventing that phase here is what made a
  // no-search generation still say "正在检索资料".
  if (LIVE.has(task.status)) return "outline";

  return null;
}

export function generationElapsedMs(task: DesktopTask, now = Date.now()): number {
  const started = task.createdAt ? Date.parse(task.createdAt) : NaN;
  if (Number.isFinite(started)) return Math.max(0, now - started);
  const first = task.events[0]?.ts ? Date.parse(task.events[0].ts) : NaN;
  if (Number.isFinite(first)) return Math.max(0, now - first);
  return 0;
}

export function generationMotionQuiet(task: DesktopTask, now = Date.now()): boolean {
  return generationElapsedMs(task, now) >= GENERATION_QUIET_AFTER_MS;
}
