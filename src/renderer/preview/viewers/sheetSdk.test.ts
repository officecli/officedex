import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const editor = {
    init: vi.fn(async () => undefined),
    mount: vi.fn(async () => undefined),
    ready: vi.fn(async () => undefined),
  };
  return {
    editor,
    createSheetSDK: vi.fn(async () => editor),
    getS18n: vi.fn(),
  };
});

vi.mock("@shimo/sdk-sheet", () => ({ createSheetSDK: mocks.createSheetSDK }));
vi.mock("@shimo/simple-i18n", () => ({ getS18n: mocks.getS18n }));

import { createOfflineSheetEditor } from "./sheetSdk";

describe("createOfflineSheetEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete (globalThis as typeof globalThis & { s18n?: unknown }).s18n;
  });

  it("loads Chinese resources before initializing and mounting the editor", async () => {
    const loadedScripts: string[] = [];
    const appendChild = vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
      const script = node as HTMLScriptElement;
      loadedScripts.push(new URL(script.src).pathname);
      queueMicrotask(() => script.onload?.(new Event("load")));
      return node;
    });
    const container = document.createElement("div");

    const editor = await createOfflineSheetEditor(container, "serialized-modoc");

    expect(editor).toBe(mocks.editor);
    expect(loadedScripts).toEqual([
      "/sdk-sheet-locales/fe-common/zh-CN.js",
      "/sdk-sheet-locales/lizard-service-sheet-sdk/zh-CN.js",
    ]);
    expect((globalThis as typeof globalThis & { s18n?: unknown }).s18n).toEqual({ getS18n: mocks.getS18n });
    expect(mocks.createSheetSDK).toHaveBeenCalledTimes(1);
    expect(mocks.createSheetSDK).toHaveBeenCalledWith(expect.objectContaining({
      mode: { type: "standard", role: "editor" },
      content: "serialized-modoc",
      collaboration: undefined,
      file: undefined,
      user: undefined,
      comments: { hidden: true },
      combineSheets: { hidden: true },
      form: { hidden: true },
      importRange: { hidden: true },
      history: { hidden: true },
      followMode: { hidden: true },
      followSelection: { hidden: true },
      mention: { hidden: true },
      lock: { hidden: true },
      shortcuts: { disabledShortcuts: ["mod+s", "mod+shift+s", "mod+shift+e"] },
    }));
    expect(mocks.editor.init).toHaveBeenCalledBefore(mocks.editor.mount);
    expect(mocks.editor.mount).toHaveBeenCalledWith(container);
    expect(mocks.editor.mount).toHaveBeenCalledBefore(mocks.editor.ready);
    appendChild.mockRestore();
  });
});
