import { describe, expect, it, vi } from "vitest";

import type { AgentEvent, AgentTask, UiPort } from "../../../shared/uiPort";
import { createFakePort } from "./createFakePort";
import { SEED_FOLDER_ID } from "./seed";

/** Runs every queued fake timer until the agent script is exhausted. */
async function drain() {
  for (let i = 0; i < 12; i += 1) {
    await vi.advanceTimersByTimeAsync(1500);
  }
}

describe("createFakePort", () => {
  it("satisfies UiPort and boots the prototype's workspace", async () => {
    const port: UiPort = createFakePort();

    const folders = await port.folders.list();
    const files = await port.files.list();

    expect(folders.map((folder) => folder.name)).toContain("MO product launch");
    // Decision 3: exactly one default folder, and every file sits in a real one.
    expect(folders.filter((folder) => folder.isDefault)).toHaveLength(1);
    const folderIds = new Set(folders.map((folder) => folder.id));
    for (const file of files) {
      expect(folderIds.has(file.folderId)).toBe(true);
    }
  });

  it("keeps files when their folder is removed", async () => {
    const port = createFakePort();
    await port.folders.remove("folder-research");

    const folders = await port.folders.list();
    const files = await port.files.list();
    const fallback = folders.find((folder) => folder.isDefault);

    expect(folders.some((folder) => folder.id === "folder-research")).toBe(false);
    expect(files.some((file) => file.id === "file-interviews")).toBe(true);
    expect(files.find((file) => file.id === "file-interviews")?.folderId).toBe(fallback?.id);
  });

  it("will not remove the default folder", async () => {
    const port = createFakePort();
    const before = await port.folders.list();
    const fallback = before.find((folder) => folder.isDefault);
    await port.folders.remove(fallback?.id ?? "");
    expect((await port.folders.list()).some((folder) => folder.id === fallback?.id)).toBe(true);
  });

  it("names new files by type and keeps the extension on rename", async () => {
    const port = createFakePort();
    const created = await port.files.create("sheet", SEED_FOLDER_ID);
    expect(created.name).toMatch(/^Untitled workbook \d+\.xlsx$/);

    await port.files.rename(created.id, "Q3 forecast");
    const renamed = (await port.files.list()).find((file) => file.id === created.id);
    expect(renamed?.name).toBe("Q3 forecast.xlsx");
  });

  it("routes a new file to the default folder when the folder is unknown", async () => {
    const port = createFakePort();
    const created = await port.files.create("doc", "folder-that-does-not-exist");
    const fallback = (await port.folders.list()).find((folder) => folder.isDefault);
    expect(created.folderId).toBe(fallback?.id);
  });

  it("never returns internal state by reference", async () => {
    const port = createFakePort();
    const files = await port.files.list();
    files[0].name = "mutated";
    expect((await port.files.list())[0].name).not.toBe("mutated");
  });
});

describe("fake agent script", () => {
  it("runs to a reviewable suggestion and applies it", async () => {
    vi.useFakeTimers();
    try {
      const port = createFakePort();
      const events: AgentEvent[] = [];
      port.agent.subscribe((event) => events.push(event));

      await port.agent.send({
        text: "Prepare the launch plan, forecast and deck.",
        folderId: SEED_FOLDER_ID,
        mentions: [],
        attachments: [],
        modelId: "gpt-6-astra",
        permission: "review",
        activeFileId: "file-plan",
      });
      await drain();

      const task = await port.agent.current(SEED_FOLDER_ID);
      expect(task?.status).toBe("awaiting-review");
      expect(task?.suggestion?.targetFileId).toBe("file-plan");
      expect(task?.steps.every((step) => step.state === "done")).toBe(true);
      expect(task?.title).toBe("Prepare the launch plan, forecast and deck.");

      await port.agent.applySuggestion(task?.suggestion?.id ?? "");
      const applied = await port.agent.current(SEED_FOLDER_ID);
      expect(applied?.suggestion?.applied).toBe(true);
      expect(applied?.suggestion?.undoable).toBe(true);
      // Applying marks the target file dirty, which drives the tab dot.
      expect((await port.files.list()).find((file) => file.id === "file-plan")?.dirty).toBe(true);

      await port.agent.undoSuggestion(applied?.suggestion?.id ?? "");
      expect((await port.files.list()).find((file) => file.id === "file-plan")?.dirty).toBe(false);
      expect(events.length).toBeGreaterThan(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops advancing while paused and continues on resume", async () => {
    vi.useFakeTimers();
    try {
      const port = createFakePort();
      await port.agent.send({
        text: "Summarise the research.",
        folderId: SEED_FOLDER_ID,
        mentions: [],
        attachments: [],
        modelId: "gpt-6-astra",
        permission: "review",
        activeFileId: null,
      });

      await port.agent.pause();
      const paused = await port.agent.current(SEED_FOLDER_ID);
      expect(paused?.status).toBe("paused");

      await drain();
      const stillPaused = await port.agent.current(SEED_FOLDER_ID);
      expect(stillPaused?.status).toBe("paused");
      expect(stillPaused?.suggestion).toBeNull();

      await port.agent.resume();
      await drain();
      expect((await port.agent.current(SEED_FOLDER_ID))?.status).toBe("awaiting-review");
    } finally {
      vi.useRealTimers();
    }
  });

  it("scopes the task to a folder", async () => {
    vi.useFakeTimers();
    try {
      const port = createFakePort();
      await port.agent.send({
        text: "Tidy the research folder.",
        folderId: "folder-research",
        mentions: [],
        attachments: [],
        modelId: "gpt-6-astra",
        permission: "review",
        activeFileId: null,
      });
      await drain();

      const research = (await port.agent.current("folder-research")) as AgentTask;
      expect(research.folderId).toBe("folder-research");
      // The suggestion targets a file inside the scope, not the active file.
      const files = await port.files.list();
      const target = files.find((file) => file.id === research.suggestion?.targetFileId);
      expect(target?.folderId).toBe("folder-research");

      expect(await port.agent.current(SEED_FOLDER_ID)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("model and settings ports", () => {
  it("adds a custom model without retaining the API key", async () => {
    const port = createFakePort();
    const model = await port.models.addCustom({
      name: "Local Qwen",
      modelId: "qwen3-max",
      provider: "Custom",
      baseUrl: "http://127.0.0.1:11434/v1",
      apiKey: "secret-value",
    });

    expect(model.custom).toBe(true);
    const serialised = JSON.stringify(await port.models.list());
    expect(serialised).not.toContain("secret-value");
  });

  it("falls back to another model when the selected custom one is removed", async () => {
    const port = createFakePort();
    const model = await port.models.addCustom({
      name: "Temporary",
      modelId: "temp-1",
      provider: "Custom",
      baseUrl: "",
    });
    await port.settings.patch({ selectedModelId: model.id });
    await port.models.removeCustom(model.id);

    const settings = await port.settings.get();
    expect(settings.selectedModelId).not.toBe(model.id);
    expect((await port.models.list()).some((entry) => entry.id === settings.selectedModelId)).toBe(true);
  });
});
