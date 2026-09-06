import type { PublishedWorkbookApp } from "./types";
import type { WorkbookDataSnapshot } from "./types";
import { buildHtmlAppSpec } from "./htmlAppModel";

const STORAGE_KEY = "officedex.workbookApps.v1";

export function loadPublishedWorkbookApps(): PublishedWorkbookApp[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as unknown;
    return Array.isArray(parsed) ? parsed as PublishedWorkbookApp[] : [];
  } catch {
    return [];
  }
}

export function savePublishedWorkbookApp(app: PublishedWorkbookApp): void {
  if (typeof localStorage === "undefined") return;
  try {
    const apps = loadPublishedWorkbookApps().filter((item) => item.id !== app.id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([app, ...apps].slice(0, 50)));
  } catch {
    // The active in-memory publication remains usable when persistent storage is unavailable.
  }
}

/** Refreshes the generated HTML contract while preserving its identity and
 * permissions. The caller decides when to publish the new snapshot; this
 * keeps workbook edits from silently replacing a user's deployed version. */
export function preparePublishedWorkbookRefresh(app: PublishedWorkbookApp, snapshot: WorkbookDataSnapshot): PublishedWorkbookApp {
  const spec = buildHtmlAppSpec(snapshot, app.config.sheetName, app.config.name);
  return spec ? { ...app, htmlSpec: spec } : app;
}

export function slugifyAppName(value: string): string {
  const latin = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return latin || "workbook-app";
}
