import type { PublishedWorkbookApp } from "./types";

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

export function slugifyAppName(value: string): string {
  const latin = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return latin || "workbook-app";
}
