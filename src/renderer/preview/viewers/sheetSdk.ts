import "@shimo/sdk-sheet/lib/index.css";
import type { AbstractedSheetSDK, SheetSDKOptions } from "@shimo/sdk-sheet";
import { getS18n } from "@shimo/simple-i18n";

const loadedScripts = new Map<string, Promise<void>>();

export function loadScriptOnce(src: string): Promise<void> {
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

export async function createOfflineSheetEditor(
  container: HTMLElement,
  modocContent: string,
): Promise<AbstractedSheetSDK> {
  const sheetLocaleGlobal = globalThis as typeof globalThis & {
    s18n?: { getS18n: typeof getS18n };
  };
  sheetLocaleGlobal.s18n = { getS18n };

  await loadScriptOnce("/sdk-sheet-locales/fe-common/zh-CN.js");
  await loadScriptOnce("/sdk-sheet-locales/lizard-service-sheet-sdk/zh-CN.js");

  const { createSheetSDK } = await import("@shimo/sdk-sheet");
  const options: SheetSDKOptions = {
    mode: {
      type: "standard",
      role: "editor",
    },
    attachment: {
      image: {
        disableThumbnail: true,
      },
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
  return editor;
}
