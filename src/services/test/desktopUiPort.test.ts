import { beforeEach, describe, expect, it } from "vitest";
import { createDesktopUiPort } from "../createDesktopUiPort";
import { createFakeDesktopApi } from "./fakeDesktopApi";
import { describeUiPortContract } from "./uiPortContract";
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

function createPort() {
  return createDesktopUiPort({
    api: createFakeDesktopApi({
      folders: [{ id: "folder-research", name: "Research", path: "/tmp/officedex/Research" }],
      documents: [
        { fileName: "launch deck.pptx", documentType: "pptx", lastOpenedAt: "2026-09-10T09:00:00Z" },
        { fileName: "interviews.docx", documentType: "docx", workspaceId: "folder-research" },
        { fileName: "budget.xlsx", documentType: "xlsx", pinned: true },
      ],
    }),
    window: stubWindow(),
  });
}

// The same suite the in-memory fake runs. One contract, two implementations.
describeUiPortContract("desktop services", createPort);

describe("desktop file service", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // The desktop produces img, gif and report too. They have no FileType, and a
  // GIF shown as a "document" would open an editor that cannot read it.
  it("leaves out document types the new IA has no place for", async () => {
    const port = createDesktopUiPort({
      api: createFakeDesktopApi({
        documents: [
          { fileName: "deck.pptx", documentType: "pptx" },
          { fileName: "poster.png", documentType: "img" },
          { fileName: "loop.gif", documentType: "gif" },
          { fileName: "summary.docx", documentType: "docx" },
        ],
      }),
      window: stubWindow(),
    });

    const files = await port.files.list();

    expect(files.map((file) => file.type).sort()).toEqual(["doc", "slides"]);
  });

  it("maps document types onto the three the shell knows", async () => {
    const files = await createPort().files.list();
    const byName = new Map(files.map((file) => [file.name, file.type]));
    expect(byName.get("launch deck.pptx")).toBe("slides");
    expect(byName.get("interviews.docx")).toBe("doc");
    expect(byName.get("budget.xlsx")).toBe("sheet");
  });

  // Documents filed nowhere belong to the default folder, which is a real
  // directory their files already sit in.
  it("puts unfiled documents in the default folder", async () => {
    const port = createPort();
    const [folders, files] = await Promise.all([port.folders.list(), port.files.list()]);
    const fallback = folders.find((folder) => folder.isDefault)!;
    const unfiled = files.find((file) => file.name === "launch deck.pptx");
    expect(unfiled?.folderId).toBe(fallback.id);
  });

  // lastOpenedAt lives in the recent-files list, not on the document row, so it
  // is null until something has actually opened the file.
  it("reports lastOpenedAt only for files that have been opened", async () => {
    const port = createPort();
    const files = await port.files.list();
    expect(files.find((file) => file.name === "launch deck.pptx")?.lastOpenedAt).toBeGreaterThan(0);
    expect(files.find((file) => file.name === "budget.xlsx")?.lastOpenedAt).toBeNull();

    const target = files.find((file) => file.name === "budget.xlsx")!;
    const opened = await port.files.open(target.id);
    expect(opened.lastOpenedAt).toBeGreaterThan(0);
  });

  // dirty is a property of an open editor, not of a file on disk: persisting it
  // would leave every file permanently marked after a crash.
  it("tracks dirty in memory and clears it on save", async () => {
    const port = createDesktopUiPort({
      api: createFakeDesktopApi({ documents: [{ fileName: "deck.pptx", documentType: "pptx" }] }),
      window: stubWindow(),
    });
    const files = port.files as ReturnType<typeof createDesktopUiPort>["files"] & {
      setDirty(id: string, dirty: boolean): void;
    };
    const file = (await port.files.list())[0];
    expect(file.dirty).toBe(false);

    files.setDirty(file.id, true);
    expect((await port.files.list())[0].dirty).toBe(true);

    await port.files.save(file.id);
    expect((await port.files.list())[0].dirty).toBe(false);
  });

  it("refuses to create a document, naming the reason", async () => {
    await expect(createPort().files.create("doc", "folder:default")).rejects.toThrow(/not implemented/i);
  });
});

describe("desktop settings service", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // Four of the five fields have no home in the desktop's settings file, which
  // is synced state a running task reads. A checkbox must not invalidate a
  // provider probe.
  it("keeps shell-only preferences out of the desktop settings", async () => {
    const api = createFakeDesktopApi();
    const port = createDesktopUiPort({ api, window: stubWindow() });

    await port.settings.patch({ reduceMotion: true, customInstructions: "Be brief" });

    const desktop = await api.getSettings();
    expect(JSON.stringify(desktop)).not.toContain("Be brief");
    expect(localStorage.getItem("officedex.shell.settings")).toContain("Be brief");
  });

  it("survives a corrupt local value", async () => {
    localStorage.setItem("officedex.shell.settings", "{not json");
    const settings = await createPort().settings.get();
    expect(settings.permission).toBe("review");
  });
});

describe("desktop model service", () => {
  // The desktop stores one provider, so the list is the built-in model plus at
  // most one custom entry — adding a second replaces the first.
  it("lists the built-in model, and the custom one when configured", async () => {
    const api = createFakeDesktopApi();
    const port = createDesktopUiPort({ api, window: stubWindow() });

    expect(await port.models.list()).toHaveLength(1);

    await port.models.addCustom({
      name: "House model",
      modelId: "gpt-6-astra",
      provider: "openai",
      baseUrl: "https://api.example.com",
      apiKey: "secret",
    });

    const models = await port.models.list();
    expect(models).toHaveLength(2);
    expect(models[1].custom).toBe(true);
    expect(models[1].name).toBe("gpt-6-astra");
    // The contract says the port decides where a key lives; it never comes back
    // out through the model list.
    expect(JSON.stringify(models)).not.toContain("secret");
  });

  it("keeps the stored key when an edit does not supply one", async () => {
    const api = createFakeDesktopApi();
    const port = createDesktopUiPort({ api, window: stubWindow() });
    await port.models.addCustom({
      name: "House", modelId: "m1", provider: "openai", baseUrl: "https://a", apiKey: "secret",
    });

    await port.models.updateCustom("custom", {
      name: "Renamed", modelId: "m1", provider: "openai", baseUrl: "https://a",
    });

    expect((await api.getSettings()).llmProvider?.apiKey).toBe("secret");
  });

  it("will not edit or remove the built-in model", async () => {
    const port = createPort();
    await expect(port.models.updateCustom("official", {
      name: "x", modelId: "x", provider: "openai", baseUrl: "https://a",
    })).rejects.toThrow();
    await expect(port.models.removeCustom("official")).rejects.toThrow();
  });
});

describe("desktop agent service", () => {
  // A skeleton until S4, and it says so rather than failing silently.
  it("reports no task and refuses to send", async () => {
    const port = createPort();
    expect(await port.agent.current("folder:default")).toBeNull();
    await expect(port.agent.send({
      text: "hello",
      folderId: "folder:default",
      mentions: [],
      attachments: [],
      modelId: "official",
      permission: "review",
      activeFileId: null,
    })).rejects.toThrow(/S4/);
  });

  it("returns a working unsubscribe", async () => {
    const unsubscribe = createPort().agent.subscribe(() => {});
    expect(() => unsubscribe()).not.toThrow();
  });
});
