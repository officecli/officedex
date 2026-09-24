import type { DesktopTask, VibeOp } from "../../../shared/types";
import type { GenerationCanvasPhase } from "./pptxGenerationPhase";

function base(overrides: Partial<DesktopTask> = {}): DesktopTask {
  return {
    id: "gen-1",
    conversationId: "c-1",
    status: "running",
    documentType: "pptx",
    createdAt: new Date(Date.now() - 1_000).toISOString(),
    events: [],
    ...overrides,
  };
}

const OUTLINE = {
  slides: [
    { slide: 1, headline: "OfficeDex as an AI office" },
    { slide: 2, headline: "From desktop suite to a running workspace" },
    { slide: 3, headline: "Core modules and what they change" },
    { slide: 4, headline: "Industry scenes that already pay" },
    { slide: 5, headline: "Where this goes next" },
  ],
};

const TEXT_OPS: VibeOp[] = [
  { seq: 1, op: "slide.begin", slide: 1 },
  { seq: 2, op: "shape.add", slide: 1, shape: { kind: "text", role: "title", text: "OfficeDex as an AI office" } },
  { seq: 3, op: "shape.add", slide: 1, shape: { kind: "text", role: "subtitle", text: "Let the desk run itself, from a suite to a workspace" } },
  { seq: 4, op: "shape.add", slide: 1, shape: { kind: "text", role: "bullet", text: "Core modules and differentiated capability" } },
  { seq: 5, op: "shape.add", slide: 1, shape: { kind: "text", role: "bullet", text: "Industry scenes with a path to value" } },
  { seq: 6, op: "shape.add", slide: 1, shape: { kind: "text", role: "bullet", text: "An ecosystem that compounds" } },
];

const DRAW_OPS: VibeOp[] = [
  ...TEXT_OPS,
  { seq: 7, op: "shape.add", slide: 1, shape: { kind: "picture" } },
];

/** Fixture tasks that land each generating-canvas phase. */
export function fixtureGenerationTask(phase: GenerationCanvasPhase): DesktopTask {
  if (phase === "research") {
    return base({ events: [{ type: "task.progress", payload: { step: "plan.research", content: "Searching the web" } }] });
  }
  if (phase === "outline") {
    return base({
      vibeOutline: OUTLINE,
      events: [{ type: "task.progress", payload: { step: "plan.outline", content: "Structuring" } }],
    });
  }
  if (phase === "writing") {
    return base({
      vibeOutline: OUTLINE,
      vibeOps: TEXT_OPS,
      events: [{ type: "task.progress", payload: { step: "plan.expand", content: "Writing slide 1" } }],
    });
  }
  if (phase === "drawing") {
    return base({
      vibeOutline: OUTLINE,
      vibeOps: DRAW_OPS,
      events: [{ type: "task.progress", payload: { step: "skill.images", content: "Drawing the chart" } }],
    });
  }
  return base({
    vibeOutline: OUTLINE,
    vibeOps: DRAW_OPS,
    events: [
      { type: "task.progress", payload: { step: "finalize", content: "Laying out" } },
      { type: "task.progress", payload: { slide_state: { slide: 1, state: "ready" } } },
      { type: "task.progress", payload: { slide_state: { slide: 2, state: "ready" } } },
      { type: "task.progress", payload: { slide_state: { slide: 3, state: "ready" } } },
      { type: "task.progress", payload: { slide_state: { slide: 4, state: "ready" } } },
      { type: "task.progress", payload: { slide_state: { slide: 5, state: "ready" } } },
    ],
  });
}
