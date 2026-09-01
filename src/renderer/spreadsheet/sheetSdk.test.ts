import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SheetSDKOptions } from "@shimo/sdk-sheet";

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

import {
  createOfflineSheetEditor,
  installRatioValidationCompatibility,
  OfflineImageUploader,
  registerOfflineImage,
} from "./sheetSdk";

describe("createOfflineSheetEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete (globalThis as typeof globalThis & { s18n?: unknown }).s18n;
  });

  it("accepts colon-delimited ratios present in an imported list validation", () => {
    const nativeIsValid = vi.fn((_row: number, _column: number, _value: unknown, _options?: unknown) => false);
    const coreSheet = {
      getValue: vi.fn(() => "16:9"),
      getDataValidator: vi.fn(() => ({
        type: () => 3,
        getValidList: () => ["1:1", "4:5", "3:4", "16:9", "9:16"],
      })),
      isValid: nativeIsValid,
    };
    const editor = {
      __editor: { spread: { coreBook: { sheets: [coreSheet] } } },
    };

    installRatioValidationCompatibility(editor as never);

    expect(coreSheet.isValid(4, 23, "16:9")).toBe(true);
    expect(nativeIsValid).toHaveBeenCalledWith(4, 23, "16:9", undefined);
  });

  it("uses the ratio header when the SDK exposes parsed validation entries", () => {
    const coreSheet = {
      getValue: vi.fn((row: number) => row === 3 ? "比例" : "4:5"),
      getDataValidator: vi.fn(() => ({
        type: () => 3,
        getValidList: () => [0.042361, 0.170139],
      })),
      isValid: vi.fn((_row: number, _column: number, _value: unknown, _options?: unknown) => false),
    };
    const editor = {
      __editor: { spread: { coreBook: { sheets: [coreSheet] } } },
    };

    installRatioValidationCompatibility(editor as never);

    expect(coreSheet.isValid(4, 14, "4:5")).toBe(true);
  });

  it("does not bypass unrelated list validation failures", () => {
    const coreSheet = {
      getValue: vi.fn((row: number) => row === 3 ? "优先级" : "16:9"),
      getDataValidator: vi.fn(() => ({
        type: () => 3,
        getValidList: () => ["P0", "P1", "P2"],
      })),
      isValid: vi.fn((_row: number, _column: number, _value: unknown, _options?: unknown) => false),
    };
    const editor = {
      __editor: { spread: { coreBook: { sheets: [coreSheet] } } },
    };

    installRatioValidationCompatibility(editor as never);

    expect(coreSheet.isValid(4, 31, "16:9")).toBe(false);
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
      attachment: expect.objectContaining({ uploader: expect.any(OfflineImageUploader) }),
      assets: expect.objectContaining({
        proxy: expect.any(Object),
        resolver: expect.any(Object),
      }),
    }));
    expect(mocks.editor.init).toHaveBeenCalledBefore(mocks.editor.mount);
    expect(mocks.editor.mount).toHaveBeenCalledWith(container);
    expect(mocks.editor.mount).toHaveBeenCalledBefore(mocks.editor.ready);
    appendChild.mockRestore();
  });

  it("returns a display URL plus a persistent MODoc asset URL through the SDK uploader", async () => {
    const uploader = new OfflineImageUploader();
    const onLoadend = vi.fn();
    uploader.start({
      files: [{
        bucket: "images",
        encrypt: "",
        fileGuid: "",
        name: "result.png",
        size: 4,
        mime: "image/png",
        raw: registerOfflineImage(
          new File([new Uint8Array([137, 80, 78, 71])], "result.png", { type: "image/png" }),
          "modoc-assets:/media/result.png",
          "data:image/png;base64,iVBORw==",
        ),
      }],
      onLoadend,
    });

    await vi.waitFor(() => expect(onLoadend).toHaveBeenCalledTimes(1));
    expect(onLoadend).toHaveBeenCalledWith([
      expect.objectContaining({
        status: "Finished",
        data: expect.objectContaining({
          url: "data:image/png;base64,iVBORw==",
          images: "data:image/png;base64,iVBORw==",
          rawUrl: "modoc-assets:/media/result.png",
        }),
      }),
    ]);
  });

  it("maps MODoc asset requests to local data URLs without changing editor content", async () => {
    const appendChild = vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
      const script = node as HTMLScriptElement;
      queueMicrotask(() => script.onload?.(new Event("load")));
      return node;
    });
    await createOfflineSheetEditor(document.createElement("div"), "serialized-modoc", [{
      url: "modoc-assets:/media/result.png",
      dataUrl: "data:image/png;base64,iVBORw==",
    }]);
    const options = (mocks.createSheetSDK.mock.calls.at(-1) as unknown[] | undefined)?.[0] as
      | SheetSDKOptions
      | undefined;
    const intercept = options?.assets?.proxy?.interceptors?.request?.intercept;
    expect(intercept?.({ url: "modoc-assets:/media/result.png?sm_xform=style/thumbnail_s" })).toEqual({
      url: "data:image/png;base64,iVBORw==",
    });
    expect(options?.content).toBe("serialized-modoc");
    expect(options?.assets?.resolver?.parseId("modoc-assets:/media/result.png?sm_xform=style/thumbnail_s"))
      .toBe("modoc-assets:/media/result.png");
    expect(options?.assets?.resolver?.resolveUrl("modoc-assets:/media/result.png"))
      .toBe("data:image/png;base64,iVBORw==");
    expect(options?.assets?.resolver?.checkAssetReady("modoc-assets:/media/result.png")).toBe(true);
    appendChild.mockRestore();
  });

  it("stages an unregistered clipboard image and persists its MODoc asset URL", async () => {
    const stageImage = vi.fn(async () => ({ assetUrl: "modoc-assets:/media/clipboard.png" }));
    const uploader = new OfflineImageUploader(undefined, stageImage);
    const onLoadend = vi.fn();
    const clipboardFile = new File(
      [new Uint8Array([137, 80, 78, 71])],
      "clipboard.png",
      { type: "image/png" },
    );
    uploader.start({
      files: [{
        bucket: "images",
        encrypt: "",
        fileGuid: "",
        name: "clipboard.png",
        size: 4,
        mime: "image/png",
        raw: clipboardFile,
      }],
      onLoadend,
    });

    await vi.waitFor(() => expect(onLoadend).toHaveBeenCalledTimes(1));
    expect(stageImage).toHaveBeenCalledWith(clipboardFile);
    expect(onLoadend).toHaveBeenCalledWith([
      expect.objectContaining({
        status: "Finished",
        data: expect.objectContaining({
          url: "data:image/png;base64,iVBORw==",
          images: "data:image/png;base64,iVBORw==",
          rawUrl: "modoc-assets:/media/clipboard.png",
        }),
      }),
    ]);
  });
});
