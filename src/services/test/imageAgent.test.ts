import { describe, expect, it } from "vitest";

import { createDesktopUiPort } from "../createDesktopUiPort";
import type { WindowControls } from "../window";
import type { AgentTask, ImageGenerationInput, SendInput } from "../../shared/uiPort";
import { createFakeDesktopApi } from "./fakeDesktopApi";

/**
 * The image half of the agent service: what an image message turns into on
 * the wire, and how the runs it starts come back as one picture's versions.
 */

function stubWindow(): WindowControls {
  return {
    close() {},
    minimize() {},
    toggleFullscreen() {},
    isFullscreen: () => false,
    onFullscreenChange: () => () => {},
  };
}

function setup(seed: Parameters<typeof createFakeDesktopApi>[0] = {}) {
  const api = createFakeDesktopApi(seed);
  const port = createDesktopUiPort({ api, window: stubWindow() });
  const tasks: AgentTask[] = [];
  port.agent.subscribe((event) => {
    if (event.kind === "task") tasks.push(event.task);
  });
  return { api, port, tasks };
}

const IMAGE: ImageGenerationInput = {
  modelId: "auto",
  ratio: "16:9",
  resolution: "2K",
  count: 1,
  style: "auto",
  prompt: "",
};

function imageMessage(text: string, image: Partial<ImageGenerationInput> = {}, extra: Partial<SendInput> = {}): SendInput {
  return {
    text,
    folderId: "folder:default",
    mentions: [],
    attachments: [],
    activeFileId: null,
    modelId: "",
    permission: "full",
    documentType: "img",
    imageGeneration: { ...IMAGE, ...image, prompt: text },
    ...extra,
  };
}

const generateCalls = (api: ReturnType<typeof createFakeDesktopApi>) =>
  api.calls.filter((call) => call.method === "generate").map((call) => call.input);

describe("image messages", () => {
  it("send the size, the look and the user's words untouched", async () => {
    const { api, port } = setup();
    await port.agent.send(
      imageMessage("A desk lamp on warm white", {
        style: "cinematic",
        camera: { body: "Arri Alexa 35", lens: "Cooke S4", focal: "50mm", aperture: "f/2" },
        references: ["/refs/a.png"],
      }),
    );

    const [input] = generateCalls(api);
    expect(input).toMatchObject({
      documentType: "img",
      prompt: "A desk lamp on warm white",
      imageSize: "2048x1152",
      imageRatio: "landscape",
      imageStyle: "Cinematic, shot on Arri Alexa 35 with Cooke S4, 50mm, f/2",
      referenceImages: ["/refs/a.png"],
      noProject: true,
    });
    // No settings sentence appended to the prompt any more.
    expect(String(input.prompt)).not.toMatch(/settings/i);
  });

  it("leaves the shape to the model when the ratio is Auto", async () => {
    const { api, port } = setup();
    await port.agent.send(imageMessage("Anything", { ratio: "auto" }));
    const [input] = generateCalls(api);
    expect(input.imageSize).toBeUndefined();
    expect(input.imageRatio).toBeUndefined();
  });

  it("runs once per requested picture, all in the first run's conversation", async () => {
    const { api, port } = setup();
    await port.agent.send(imageMessage("Three takes", { count: 3 }));

    const inputs = generateCalls(api);
    expect(inputs).toHaveLength(3);
    // The first run names the conversation; the desktop defaults it to its own id.
    expect(inputs[0].conversationId).toBeUndefined();
    expect(inputs[1].conversationId).toBe("task-1");
    expect(inputs[2].conversationId).toBe("task-1");
  });

  it("changes a version by starting from its picture, in its series", async () => {
    const { api, port } = setup({
      documents: [{ id: "doc-v1", fileName: "Lamp.png", documentType: "img", currentArtifactTaskId: "task-v1" }],
    });
    await port.agent.send(imageMessage("Make it warmer", { baseFileId: "doc-v1", references: ["/refs/b.png"] }));

    const [input] = generateCalls(api);
    expect(input.referenceImages).toEqual(["/tmp/officedex/Lamp.png", "/refs/b.png"]);
    // Named after the picture, not the instruction.
    expect(input.topic).toBe("Lamp");
    expect(input.parentTaskId).toBe("task-v1");
    // The base run is not in live state here, so its own id is the conversation.
    expect(input.conversationId).toBe("task-v1");
  });

  it("takes mentioned pictures as references and says what it left out", async () => {
    const { api, port } = setup({
      documents: [
        { id: "doc-pic", fileName: "Mood.png", documentType: "img" },
        { id: "doc-plan", fileName: "Plan.docx", documentType: "docx" },
      ],
    });
    const notices: string[] = [];
    port.agent.subscribe((event) => {
      if (event.kind === "notice") notices.push(event.message);
    });
    await port.agent.send(
      imageMessage("Use the mood", {}, {
        mentions: [
          { kind: "file", id: "doc-pic", label: "Mood.png" },
          { kind: "file", id: "doc-plan", label: "Plan.docx" },
        ],
      }),
    );

    expect(generateCalls(api)[0].referenceImages).toEqual(["/tmp/officedex/Mood.png"]);
    expect(notices.join(" ")).toMatch(/@Plan\.docx/);
  });

  it("reports the runs of one conversation as one picture's versions, oldest first", async () => {
    const { api, port, tasks } = setup();
    await port.agent.send(imageMessage("Two takes", { count: 2 }));

    api.emitBridgeEvent({ event_id: "e1", task_id: "task-1", type: "task.started", ts: "2026-09-23T10:00:00Z", payload: { document_type: "img" } });
    api.emitBridgeEvent({ event_id: "e2", task_id: "task-2", type: "task.started", ts: "2026-09-23T10:00:01Z", payload: { document_type: "img" } });
    api.emitBridgeEvent({ event_id: "e3", task_id: "task-1", type: "task.completed", ts: "2026-09-23T10:00:05Z", payload: {} });

    const latest = tasks.at(-1)!;
    expect(latest.documentType).toBe("img");
    expect(latest.image?.runs.map((run) => [run.taskId, run.status, run.prompt])).toEqual([
      ["task-1", "done", "Two takes"],
      ["task-2", "running", "Two takes"],
    ]);
  });
});

describe("stopping an image batch", () => {
  it("cancels every picture still being made, not just the last", async () => {
    const { api, port } = setup();
    await port.agent.send(imageMessage("Three takes", { count: 3 }));
    for (const id of ["task-1", "task-2", "task-3"]) {
      api.emitBridgeEvent({ event_id: `${id}-s`, task_id: id, type: "task.started", ts: "2026-09-23T10:00:00Z", payload: { document_type: "img" } });
    }
    api.emitBridgeEvent({ event_id: "done-1", task_id: "task-1", type: "task.completed", ts: "2026-09-23T10:00:05Z", payload: {} });

    // Recorded here rather than read off the fake's call log, which does not
    // track cancels in every version of it.
    const cancelled: string[] = [];
    api.cancel = async (taskId: string) => {
      cancelled.push(taskId);
    };

    await port.agent.finish();

    expect(cancelled.sort()).toEqual(["task-2", "task-3"]);
  });
});

describe("Home's task list", () => {
  it("lists a picture once, however many runs it took", async () => {
    const { api, port } = setup();
    await port.agent.send(imageMessage("Two takes", { count: 2 }));
    api.emitBridgeEvent({ event_id: "s1", task_id: "task-1", type: "task.started", ts: "2026-09-23T10:00:00Z", payload: { document_type: "img" } });
    api.emitBridgeEvent({ event_id: "s2", task_id: "task-2", type: "task.started", ts: "2026-09-23T10:00:01Z", payload: { document_type: "img" } });
    api.emitBridgeEvent({ event_id: "d1", task_id: "task-1", type: "task.completed", ts: "2026-09-23T10:00:05Z", payload: {} });

    const rows = await port.agent.list();
    expect(rows).toHaveLength(1);
    // Keyed by the series' first run, and still working while one run draws.
    expect(rows[0]).toMatchObject({ id: "task-1", status: "writing" });
    expect(rows[0].image?.runs.map((run) => run.taskId)).toEqual(["task-1", "task-2"]);
  });
});
