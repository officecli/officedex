import { beforeEach, describe, expect, it } from "vitest";
import { createDesktopUiPort } from "../createDesktopUiPort";
import { createFakeDesktopApi } from "./fakeDesktopApi";
import type { BridgeEvent } from "../../shared/types";
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

function agentPort() {
  const api = createFakeDesktopApi();
  return { api, port: createDesktopUiPort({ api, window: stubWindow() }) };
}

const PROMPT = "做一份 10 页的季度复盘";
let seq = 0;
const event = (type: BridgeEvent["type"], payload: Record<string, unknown>): BridgeEvent => ({
  event_id: `task-1-${(seq += 1)}`,
  task_id: "task-1",
  type,
  ts: `2026-09-23T10:00:${String(seq).padStart(2, "0")}Z`,
  payload,
});

/** A deck run that stopped with finished pages behind it, the way the bridge reports one. */
function failedDeck(api: ReturnType<typeof createFakeDesktopApi>, failure?: Record<string, unknown>) {
  api.emitBridgeEvent(event("task.started", { document_type: "pptx" }));
  api.emitBridgeEvent(event("task.user_input", { prompt: PROMPT, generation_mode: "fast" }));
  // Content-stage failures announce the checkpoint only here.
  api.emitBridgeEvent(event("task.progress", {
    step: "plan.expand",
    status: "failed",
    resume_checkpoint: "/tmp/run/.mop-assets/officecli-expansion-1/expansion-state.json",
    resume_images: false,
  }));
  api.emitBridgeEvent(event("task.failed", {
    message: "content generation failed: PPTX expansion is incomplete; retained completed pages: 8/10 ready (provider_rejected)",
    ...(failure ? { failure } : {}),
  }));
}

describe("resuming a failed deck", () => {
  beforeEach(() => {
    localStorage.clear();
    seq = 0;
  });

  it("offers recovery with the runtime's page counts", async () => {
    const { api, port } = agentPort();
    failedDeck(api, {
      stage: "render",
      reason: "worker_died",
      retryable: true,
      resume_stage: "expansion",
      resume_checkpoint: "/tmp/run/checkpoint.json",
      retained: { ready_pages: 8, total_pages: 10, failed_pages: [4, 9] },
    });

    const task = await port.agent.current("folder:default");
    expect(task?.status).toBe("done");
    expect(task?.recovery).toEqual({ readyPages: 8, totalPages: 10 });
  });

  it("offers recovery for a content failure that only announced its checkpoint", async () => {
    const { api, port } = agentPort();
    failedDeck(api);

    expect((await port.agent.current("folder:default"))?.recovery).toBeDefined();
  });

  it("offers nothing when the failure says it cannot be retried", async () => {
    const { api, port } = agentPort();
    failedDeck(api, { stage: "content", reason: "license_check_failed", retryable: false });

    expect((await port.agent.current("folder:default"))?.recovery).toBeUndefined();
  });

  it("resumes with the checkpoint, the original prompt and the run's image decision", async () => {
    const { api, port } = agentPort();
    failedDeck(api);

    await port.agent.resumeFailed("task-1");

    const call = api.calls.filter((entry) => entry.method === "generate").at(-1);
    expect(call?.input).toMatchObject({
      documentType: "pptx",
      prompt: PROMPT,
      resumeCheckpoint: "/tmp/run/.mop-assets/officecli-expansion-1/expansion-state.json",
      enableImages: false,
    });
  });

  it("refuses to resume a run that left nothing behind", async () => {
    const { api, port } = agentPort();
    api.emitBridgeEvent(event("task.started", { document_type: "pptx" }));
    api.emitBridgeEvent(event("task.user_input", { prompt: PROMPT }));
    api.emitBridgeEvent(event("task.failed", { message: "ran out of credits" }));

    await expect(port.agent.resumeFailed("task-1")).rejects.toThrow(/nothing to pick up/);
    expect(api.calls.some((entry) => entry.method === "generate")).toBe(false);
  });
});
