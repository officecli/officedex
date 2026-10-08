import type { BridgeEvent, VibeOp } from "../../shared/types";

/** The user-visible phases before and during progressive PPTX production. */
export type PptxProgressPhase =
  | "brief"
  | "outline"
  | "draft"
  | "drawing"
  | "completed"
  | "failed"
  | "cancelled";

export type PptxPageProgressStatus = "pending" | "active" | "completed";

export interface PptxPageProgress {
  slide: number;
  status: PptxPageProgressStatus;
  opCount: number;
}

export interface PptxImageProgress {
  total: number;
  placed: number;
  pending: number;
  failed: number;
}

export interface PptxProgressState {
  phase: PptxProgressPhase;
  message?: string;
  currentSlide?: number;
  completedSlides: number;
  totalSlides?: number;
  pages: PptxPageProgress[];
  outline?: unknown;
  appliedEventIds: string[];
  appliedEventCount: number;
  lastEventType?: string;
  lastEventAt?: string;
  opCount: number;
  images: PptxImageProgress;
  imageOps: VibeOp[];
}

const TERMINAL_PHASES = new Set<PptxProgressPhase>(["completed", "failed", "cancelled"]);

export function createInitialPptxProgress(): PptxProgressState {
  return {
    phase: "brief",
    completedSlides: 0,
    pages: [],
    appliedEventIds: [],
    appliedEventCount: 0,
    opCount: 0,
    images: { total: 0, placed: 0, pending: 0, failed: 0 },
    imageOps: [],
  };
}

/**
 * Reduce one bridge event into the state that the progressive PPTX stage can
 * render. This deliberately does not perform I/O or know about React.
 * Unknown payload fields are ignored so older OfficeCLI versions remain
 * renderable while newer page/op fields can be adopted without another UI
 * protocol.
 */
export function reducePptxProgress(
  previous: PptxProgressState,
  event: BridgeEvent,
): PptxProgressState {
  if (event.event_id && previous.appliedEventIds.includes(event.event_id)) return previous;

  const payload = event.payload ?? {};
  const next: PptxProgressState = {
    ...previous,
    pages: previous.pages.map((page) => ({ ...page })),
    appliedEventIds: event.event_id
      ? [...previous.appliedEventIds, event.event_id]
      : previous.appliedEventIds,
    appliedEventCount: previous.appliedEventCount + 1,
    lastEventType: event.type,
    lastEventAt: event.ts,
  };

  switch (event.type) {
    case "task.started":
      next.phase = "brief";
      next.message = stringValue(payload, ["message", "brief", "summary"]);
      setTotal(next, payload);
      break;
    case "task.plan":
      next.phase = "outline";
      next.outline = payload.outline ?? payload.plan ?? payload;
      next.message = stringValue(payload, ["message", "summary", "title"]);
      setTotal(next, payload);
      break;
    case "task.progress": {
      const explicitPhase = normalizePhase(payload.phase ?? payload.stage ?? payload.status);
      const slide = slideNumber(payload);
      next.phase = explicitPhase ?? (slide !== undefined ? "drawing" : "draft");
      next.message = stringValue(payload, ["message", "content", "step", "stage"]);
      setTotal(next, payload);
      if (slide !== undefined) {
        next.currentSlide = slide;
        ensurePage(next, slide).status = "active";
      }
      break;
    }
    case "task.output": {
      next.phase = "drawing";
      next.message = stringValue(payload, ["message", "content", "summary"]);
      setTotal(next, payload);
      const slide = slideNumber(payload);
      if (slide !== undefined) {
        next.currentSlide = slide;
        ensurePage(next, slide).status = "completed";
      }
      break;
    }
    case "task.reslide_tail":
    case "task.vibe_ops": {
      next.phase = "drawing";
      next.message = stringValue(payload, ["message", "content", "summary"]);
      const ops = payload.ops ?? payload.primitives;
      const count = Array.isArray(ops) ? ops.length : numberValue(payload, ["op_count", "primitive_count"]);
      if (count !== undefined) next.opCount += count;
      if (Array.isArray(ops)) {
        next.imageOps = [...previous.imageOps, ...(ops as VibeOp[])];
        next.images = imageProgressFromOps(next.imageOps);
      }
      setTotal(next, payload);
      const slide = slideNumber(payload);
      if (slide !== undefined) {
        next.currentSlide = slide;
        ensurePage(next, slide).status = "active";
      }
      break;
    }
    case "task.completed":
      next.phase = "completed";
      next.message = stringValue(payload, ["message", "summary"]);
      setTotal(next, payload);
      completeKnownPages(next);
      break;
    case "task.failed":
      next.phase = "failed";
      next.message = stringValue(payload, ["message", "error"]) ?? "Generation failed";
      break;
    case "task.cancelled":
      next.phase = "cancelled";
      next.message = stringValue(payload, ["message", "reason"]) ?? "Generation cancelled";
      break;
    default:
      // Non-PPTX task events are retained in the event count but do not move
      // the progressive production phase backwards.
      break;
  }

  next.completedSlides = next.pages.filter((page) => page.status === "completed").length;
  return next;
}

/** Derive image placement from the same ordered op stream the live editor uses. */
export function imageProgressFromOps(ops: readonly VibeOp[]): PptxImageProgress {
  const slots = new Map<string, "pending" | "placed">();
  const pendingBySlide = new Map<number, string[]>();
  const slotKey = (op: VibeOp, ref: Record<string, unknown>) => (
    `${op.slide ?? 0}:${String(ref.kind ?? "primary")}:${String(ref.visualIndex ?? 0)}`
  );
  for (const op of ops) {
    if (op.op === "shape.add" && op.shape?.kind === "picture" && op.shape.imageRef) {
      const ref = op.shape.imageRef as Record<string, unknown>;
      const key = slotKey(op, ref);
      if (ref.digest) slots.set(key, "placed");
      else {
        slots.set(key, "pending");
        const slide = op.slide ?? 0;
        pendingBySlide.set(slide, [...(pendingBySlide.get(slide) ?? []), key]);
      }
    }
    if (op.op === "shape.update" && op.fill?.imageRef?.digest) {
      const ref = op.fill.imageRef as Record<string, unknown>;
      const exact = slotKey(op, ref);
      const fallback = pendingBySlide.get(op.slide ?? 0)?.find((key) => slots.get(key) === "pending");
      const key = slots.has(exact) ? exact : fallback;
      if (key) slots.set(key, "placed");
    }
  }
  const total = slots.size;
  const placed = [...slots.values()].filter((state) => state === "placed").length;
  return { total, placed, pending: total - placed, failed: 0 };
}


export function reducePptxProgressEvents(
  events: readonly BridgeEvent[],
  initial: PptxProgressState = createInitialPptxProgress(),
): PptxProgressState {
  return events.reduce(reducePptxProgress, initial);
}

function ensurePage(state: PptxProgressState, slide: number): PptxPageProgress {
  const existing = state.pages.find((page) => page.slide === slide);
  if (existing) return existing;
  const page: PptxPageProgress = { slide, status: "pending", opCount: 0 };
  state.pages.push(page);
  state.pages.sort((a, b) => a.slide - b.slide);
  return page;
}

function completeKnownPages(state: PptxProgressState) {
  for (const page of state.pages) page.status = "completed";
  if (state.totalSlides !== undefined) {
    for (let slide = 1; slide <= state.totalSlides; slide += 1) ensurePage(state, slide);
    for (const page of state.pages) page.status = "completed";
  }
}

function setTotal(state: PptxProgressState, payload: Record<string, unknown>) {
  const total = numberValue(payload, ["total_slides", "slide_count", "total", "pages"]);
  if (total !== undefined && total > 0) state.totalSlides = Math.floor(total);
}

function slideNumber(payload: Record<string, unknown>): number | undefined {
  const value = numberValue(payload, ["slide", "slide_number", "slide_index", "current_slide", "page"]);
  if (value === undefined) return undefined;
  // OfficeCLI historically used a zero-based slide_index; the public state is
  // intentionally one-based for display and page identity.
  return payload.slide_index !== undefined && payload.slide === undefined && value === 0
    ? 1
    : Math.max(1, Math.floor(value));
}

function normalizePhase(value: unknown): PptxProgressPhase | undefined {
  if (typeof value !== "string") return undefined;
  const phase = value.toLowerCase().replace(/[ -]/g, "_");
  if (phase === "brief" || phase === "understanding" || phase === "submitted") return "brief";
  if (phase === "outline" || phase === "outlining" || phase === "plan") return "outline";
  if (phase === "draft" || phase === "draft_ready" || phase === "preparing") return "draft";
  if (phase === "drawing" || phase === "rendering" || phase === "slide") return "drawing";
  if (phase === "completed" || phase === "complete" || phase === "done") return "completed";
  if (phase === "failed" || phase === "error") return "failed";
  if (phase === "cancelled" || phase === "canceled") return "cancelled";
  return undefined;
}

function stringValue(payload: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) if (typeof payload[key] === "string" && payload[key].trim()) return payload[key] as string;
  return undefined;
}

function numberValue(payload: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return undefined;
}

export function isPptxProgressTerminal(state: PptxProgressState): boolean {
  return TERMINAL_PHASES.has(state.phase);
}
