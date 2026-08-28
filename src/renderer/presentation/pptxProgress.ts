import type { BridgeEvent } from "../../shared/types";

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
    case "task.vibe_primitives":
    case "task.vibe_ops":
    case "task.vibe_op": {
      next.phase = "drawing";
      next.message = stringValue(payload, ["message", "content", "summary"]);
      const ops = payload.ops ?? payload.primitives;
      const count = Array.isArray(ops) ? ops.length : numberValue(payload, ["op_count", "primitive_count"]);
      if (count !== undefined) next.opCount += count;
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
