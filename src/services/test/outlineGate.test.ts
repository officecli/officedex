import { beforeEach, describe, expect, it } from "vitest";
import { createDesktopUiPort } from "../createDesktopUiPort";
import { createFakeDesktopApi } from "./fakeDesktopApi";
import type { BridgeEvent } from "../../shared/types";
import { OUTLINE_GATE_KIND } from "../../shared/uiPort";
import type { WindowControls } from "../window";

function stubWindow(): WindowControls {
  return {
    close() {},
    minimize() {},
    toggleFullscreen() {},
    isFullscreen: () => false,
    onFullscreenChange: () => () => {},
  };
}

let seq = 0;
const event = (type: BridgeEvent["type"], payload: Record<string, unknown>): BridgeEvent => ({
  event_id: `task-1-${(seq += 1)}`,
  task_id: "task-1",
  type,
  ts: `2026-09-28T10:00:${String(seq).padStart(2, "0")}Z`,
  payload,
});

/**
 * The outline gate as the progressive pipeline delivers it: a question with
 * the runtime's kind on it and `allow_freeform: true` — its degradation path
 * for clients that have no gate UI and would type "approve".
 */
function deckAtTheGate(api: ReturnType<typeof createFakeDesktopApi>) {
  api.emitBridgeEvent(event("task.started", { document_type: "pptx" }));
  api.emitBridgeEvent(event("task.vibe_outline", {
    outline: {
      title: "Product Launch Brief",
      slides: [
        { slide: 1, headline: "Positioning" },
        { slide: 2, headline: "Timeline" },
        { slide: 3, headline: "Next steps" },
      ],
    },
  }));
  api.emitBridgeEvent(event("task.question", {
    id: "question-gate",
    kind: OUTLINE_GATE_KIND,
    question: "The deck outline is ready. Review it, then start generating.",
    options: [{ id: "approve", label: "Start generating", recommended: true }],
    allow_freeform: true,
  }));
}

describe("the outline gate delivered as a question", () => {
  beforeEach(() => {
    localStorage.clear();
    seq = 0;
  });

  it("keeps the runtime's kind on the question", async () => {
    const api = createFakeDesktopApi();
    const port = createDesktopUiPort({ api, window: stubWindow() });
    deckAtTheGate(api);

    const task = await port.agent.current("folder:default");
    expect(task?.status).toBe("awaiting-review");
    expect(task?.question?.kind).toBe(OUTLINE_GATE_KIND);
    expect(task?.outline?.map((page) => page.title)).toEqual(["Positioning", "Timeline", "Next steps"]);
  });

  it("answers it as an approval carrying the edited outline", async () => {
    const api = createFakeDesktopApi();
    const port = createDesktopUiPort({ api, window: stubWindow() });
    deckAtTheGate(api);

    await port.agent.answer({
      optionId: "approve",
      outline: [
        { slide: 1, title: "Positioning", state: null },
        { slide: 2, title: "Renamed by the gate", state: null },
        { slide: 3, title: "Next steps", state: null },
      ],
    });

    const respond = api.calls.find((entry) => entry.method === "respond");
    expect(respond?.input).toMatchObject({ taskId: "task-1", questionId: "question-gate", optionId: "approve" });
    const decision = JSON.parse(String(respond?.input.answer));
    expect(decision.sections.map((section: { title: string }) => section.title)).toEqual([
      "Positioning",
      "Renamed by the gate",
      "Next steps",
    ]);
  });

  it("approves the outline as proposed when nothing was edited", async () => {
    const api = createFakeDesktopApi();
    const port = createDesktopUiPort({ api, window: stubWindow() });
    deckAtTheGate(api);

    await port.agent.answer({ optionId: "approve" });

    const respond = api.calls.find((entry) => entry.method === "respond");
    expect(respond?.input).toMatchObject({ questionId: "question-gate", optionId: "approve" });
    expect(respond?.input.answer).toBeUndefined();
  });
});
