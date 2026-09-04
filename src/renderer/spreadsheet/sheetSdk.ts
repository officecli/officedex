import "@shimo/sdk-sheet/lib/index.css";
import type {
  AbstractedEditorFileUploader,
  AbstractedSheetSDK,
  EditorUploadStartOptions,
  EditorUploadTaskInfo,
  HTTPProxy,
  HTTPRequestConfig,
  HTTPResponse,
  SheetSDKOptions,
} from "@shimo/sdk-sheet";
import { getS18n } from "@shimo/simple-i18n";

const loadedScripts = new Map<string, Promise<void>>();

interface OfflineImageRegistration {
  assetUrl: string;
  displayUrl: string;
}

const offlineImages = new WeakMap<File, OfflineImageRegistration>();
const ratioValidationPatchedSheets = new WeakSet<object>();

const ratioValuePattern = /^\d{1,3}\s*:\s*\d{1,3}$/;
const ratioHeaderPattern = /^(比例|宽高比|纵横比|画面比例|aspect\s*ratio|ratio)$/i;

interface RuntimeDataValidator {
  type?: () => number;
  getValidList?: (sheet: RuntimeCoreSheet, row: number, column: number) => unknown[] | null;
}

interface RuntimeCoreSheet {
  getValue?: (row: number, column: number) => unknown;
  getDataValidator?: (row: number, column: number, area?: number) => RuntimeDataValidator | undefined;
  isValid?: (row: number, column: number, value: unknown, options?: unknown) => boolean;
}

interface RuntimeSheetSDK extends AbstractedSheetSDK {
  __editor?: {
    spread?: {
      coreBook?: {
        sheets?: RuntimeCoreSheet[] | { forEach: (callback: (sheet: RuntimeCoreSheet) => void) => void };
      };
    };
  };
}

function normalizedRatioValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s*:\s*/, ":");
  return ratioValuePattern.test(normalized) ? normalized : null;
}

function validationListContainsRatio(
  validator: RuntimeDataValidator,
  sheet: RuntimeCoreSheet,
  row: number,
  column: number,
  ratio: string,
): boolean {
  try {
    const values = validator.getValidList?.(sheet, row, column);
    return Array.isArray(values) && values.some((value) => normalizedRatioValue(value) === ratio);
  } catch {
    return false;
  }
}

function hasRatioHeader(sheet: RuntimeCoreSheet, row: number, column: number): boolean {
  if (!sheet.getValue) return false;
  for (let headerRow = row - 1; headerRow >= Math.max(0, row - 20); headerRow -= 1) {
    const value = sheet.getValue(headerRow, column);
    if (typeof value !== "string") continue;
    const header = value.trim();
    if (!header) continue;
    return ratioHeaderPattern.test(header);
  }
  return false;
}

export function installRatioValidationCompatibility(editor: AbstractedSheetSDK): void {
  const sheets = (editor as RuntimeSheetSDK).__editor?.spread?.coreBook?.sheets;
  if (!sheets || typeof sheets.forEach !== "function") return;

  sheets.forEach((sheet) => {
    if (ratioValidationPatchedSheets.has(sheet) || typeof sheet.isValid !== "function") return;
    const nativeIsValid = sheet.isValid;
    sheet.isValid = function ratioCompatibleIsValid(row, column, value, options) {
      const nativeResult = nativeIsValid.call(this, row, column, value, options);
      if (nativeResult) return true;

      const currentValue = this.getValue?.(row, column) ?? value;
      const ratio = normalizedRatioValue(currentValue);
      if (!ratio) return false;

      const validator = this.getDataValidator?.(row, column, 3);
      if (!validator || validator.type?.() !== 3) return false;

      // Sheet SDK's inline-list validator can parse colon-delimited strings as
      // time-like values. That makes a text cell such as "16:9" fail even when
      // the imported custom list contains the exact same text. Prefer the
      // validator's own list when available, with a header check as a fallback
      // for SDK versions that expose parsed numeric entries instead of strings.
      return validationListContainsRatio(validator, this, row, column, ratio)
        || hasRatioHeader(this, row, column);
    };
    ratioValidationPatchedSheets.add(sheet);
  });
}

function modocAssetBaseUrl(url: string): string {
  return url.split(/[?#]/, 1)[0] ?? url;
}

class OfflineModocAssets {
  private readonly displayUrls = new Map<string, string>();

  constructor(assets: Array<{ url: string; dataUrl: string }> = []) {
    for (const asset of assets) this.register(asset.url, asset.dataUrl);
  }

  register(assetUrl: string, displayUrl: string): void {
    if (!assetUrl.startsWith("modoc-assets:")) throw new Error("无效的 MODoc 图片地址。");
    if (!displayUrl.startsWith("data:image/")) throw new Error("无效的本地图片显示地址。");
    this.displayUrls.set(modocAssetBaseUrl(assetUrl), displayUrl);
  }

  resolve(url: string): string {
    if (!url.startsWith("modoc-assets:")) return url;
    return this.displayUrls.get(modocAssetBaseUrl(url)) ?? url;
  }

  readonly proxy: HTTPProxy = {
    interceptors: {
      request: {
        intercept: <D,>(config: HTTPRequestConfig<D>): HTTPRequestConfig<D> => ({
          ...config,
          url: this.resolve(config.url),
        }),
      },
    },
    request: async <D, T>(config: HTTPRequestConfig<D>): Promise<HTTPResponse<T>> => {
      const intercepted = this.proxy.interceptors?.request?.intercept(config) ?? config;
      const response = await fetch(intercepted.url, { method: intercepted.method ?? "GET" });
      let data: unknown;
      switch (intercepted.responseType) {
        case "arraybuffer": data = await response.arrayBuffer(); break;
        case "blob": data = await response.blob(); break;
        case "json": data = await response.json(); break;
        default: data = await response.text(); break;
      }
      return {
        data: data as T,
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
      };
    },
    create: async () => this.proxy,
  };

  readonly resolver = {
    resolveUrl: (assetId: string): string | null => this.displayUrls.get(modocAssetBaseUrl(assetId)) ?? null,
    parseId: (url: string): string | null => url.startsWith("modoc-assets:") ? modocAssetBaseUrl(url) : null,
    checkAssetReady: (assetId: string): boolean => this.displayUrls.has(modocAssetBaseUrl(assetId)),
  };
}

async function localImageDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("离线上传器仅支持图片文件。");
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string"
      ? resolve(reader.result)
      : reject(new Error("无法读取剪贴板图片。"));
    reader.onerror = () => reject(reader.error ?? new Error("无法读取剪贴板图片。"));
    reader.readAsDataURL(file);
  });
}

export function registerOfflineImage(file: File, assetUrl: string, displayUrl: string): File {
  if (!assetUrl.startsWith("modoc-assets:")) throw new Error("无效的 MODoc 图片地址。");
  if (!displayUrl.startsWith("data:image/")) throw new Error("无效的本地图片显示地址。");
  offlineImages.set(file, { assetUrl, displayUrl });
  return file;
}

export type OfflineImageStager = (file: File) => Promise<{ assetUrl: string }>;

export class OfflineImageUploader implements AbstractedEditorFileUploader {
  private nextTaskId = 1;

  constructor(
    private readonly modocAssets = new OfflineModocAssets(),
    private readonly stageImage?: OfflineImageStager,
  ) {}

  start(options: EditorUploadStartOptions): EditorUploadTaskInfo[] {
    const tasks = options.files.map((fileInfo) => {
      const taskId = `officedex-local-image-${this.nextTaskId++}`;
      const total = fileInfo.size ?? 0;
      return {
        taskId,
        fileInfo,
        total,
        loaded: 0,
        progress: 0,
        status: "Uploading" as EditorUploadTaskInfo["status"],
      };
    });

    void Promise.all(tasks.map(async (task) => {
      try {
        if (!(task.fileInfo.raw instanceof File)) throw new Error("离线图片上传器未收到本地图片数据。");
        const registered = offlineImages.get(task.fileInfo.raw);
        if (registered) {
          this.modocAssets.register(registered.assetUrl, registered.displayUrl);
          return {
            taskId: task.taskId,
            status: "Finished" as const,
            data: {
              // Sheet SDK uses url/images to display the uploaded image and
              // rawUrl as the persistent cell-image URL. This keeps the live
              // editor on a browser-readable Data URL while MODoc stores the
              // desktop-client asset protocol expected by office2modoc.
              url: registered.displayUrl,
              images: registered.displayUrl,
              rawUrl: registered.assetUrl,
            },
          };
        }
        const dataUrl = await localImageDataUrl(task.fileInfo.raw);
        if (!this.stageImage) throw new Error("当前表格会话不支持暂存剪贴板图片。");
        const staged = await this.stageImage(task.fileInfo.raw);
        this.modocAssets.register(staged.assetUrl, dataUrl);
        return {
          taskId: task.taskId,
          status: "Finished" as const,
          data: { url: dataUrl, images: dataUrl, rawUrl: staged.assetUrl },
        };
      } catch (error) {
        const uploadError = error instanceof Error ? error : new Error(String(error));
        options.onError?.(task.taskId, uploadError);
        return { taskId: task.taskId, status: "Error" as const, data: uploadError };
      }
    })).then(options.onLoadend);

    return tasks;
  }

  pause(): void {}
  abort(): void {}
  resume(): void {}
}

function loadScriptOnce(src: string): Promise<void> {
  const existing = loadedScripts.get(src);
  if (existing) return existing;

  const loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.dataset.officedexSdkResource = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load Sheet SDK resource: ${src}`));
    document.head.appendChild(script);
  }).catch((error) => {
    loadedScripts.delete(src);
    throw error;
  });
  loadedScripts.set(src, loading);
  return loading;
}

/**
 * The namespace the sheet SDK's own locale bundle registers under, and the keys
 * it uses for "this cell range is still loading" — one per mutation the SDK
 * refuses while a range is in flight (edit, resize, insert/delete row/column,
 * insert/delete cells).
 */
const SHEET_SDK_I18N_NAMESPACE = "sheet-sdk";
const CELLS_LOADING_KEYS = [
  "cells.loading.please.do.it",
  "cells.loading.please.do.it.v2",
  "cells.loading.please.do.it.v3",
  "cells.loading.please.do.it.v4",
  "cells.loading.please.do.it.v5",
  "cells.loading.please.do.it.v6",
  "cells.loading.please.do.it.v7",
  "cells.loading.please.do.it.v8",
] as const;

/**
 * The messages the SDK throws when a range is still loading, resolved through
 * the SDK's own locale bundle.
 *
 * The SDK attaches no error code to these — the thrown value carries only the
 * translated sentence. Matching that sentence with a hand-written regex is what
 * this replaces: the regex listed two Chinese phrases and two English ones, so
 * it silently stopped recognising the condition in any of the other twelve
 * locales the SDK ships, and would have stopped recognising it in these two the
 * next time upstream reworded them. Asking the same i18n instance the SDK asked
 * means the comparison is against whatever the SDK will actually throw.
 *
 * Returns an empty array when the locale bundle has not loaded, which reads as
 * "no message is a loading message" — the caller then rethrows rather than
 * retrying blind.
 */
export function cellsLoadingMessages(): string[] {
  try {
    const s18n = getS18n(SHEET_SDK_I18N_NAMESPACE);
    const messages = CELLS_LOADING_KEYS.map((key) => s18n(key)).filter((text) => text && text !== "");
    // An unloaded bundle echoes the key back; those are not messages.
    return messages.filter((text) => !CELLS_LOADING_KEYS.includes(text as (typeof CELLS_LOADING_KEYS)[number]));
  } catch {
    return [];
  }
}

export async function createOfflineSheetEditor(
  container: HTMLElement,
  modocContent: string,
  imageAssets: Array<{ url: string; dataUrl: string }> = [],
  stageImage?: OfflineImageStager,
): Promise<AbstractedSheetSDK> {
  const sheetLocaleGlobal = globalThis as typeof globalThis & {
    s18n?: { getS18n: typeof getS18n };
  };
  sheetLocaleGlobal.s18n = { getS18n };

  await loadScriptOnce("/sdk-sheet-locales/fe-common/zh-CN.js");
  await loadScriptOnce("/sdk-sheet-locales/lizard-service-sheet-sdk/zh-CN.js");

  const { createSheetSDK } = await import("@shimo/sdk-sheet");
  const modocAssets = new OfflineModocAssets(imageAssets);
  const options: SheetSDKOptions = {
    mode: {
      type: "standard",
      role: "editor",
    },
    attachment: {
      uploader: new OfflineImageUploader(modocAssets, stageImage),
      image: {
        disableThumbnail: true,
      },
    },
    assets: {
      proxy: modocAssets.proxy,
      resolver: modocAssets.resolver,
    },
    link: {},
    collaboration: undefined,
    combineSheets: { hidden: true },
    comments: { hidden: true },
    content: modocContent,
    dateMention: { hidden: true },
    file: undefined,
    followMode: { hidden: true },
    followSelection: { hidden: true },
    formula: {
      cache: {
        hasFormulaCache: true,
      },
    },
    form: { hidden: true },
    importRange: { hidden: true },
    independentViewport: { hidden: true },
    lock: { hidden: true },
    mention: { hidden: true },
    history: { hidden: true },
    sheet2Table: { hidden: true },
    shortcuts: {
      disabledShortcuts: ["mod+s", "mod+shift+s", "mod+shift+e"],
    },
    ui: {
      helpCenter: { hidden: true },
      newFeature: { hidden: true },
    },
    user: undefined,
  };
  const editor = await createSheetSDK(options);
  await editor.init();
  await editor.mount(container);
  await editor.ready();
  installRatioValidationCompatibility(editor);
  return editor;
}
