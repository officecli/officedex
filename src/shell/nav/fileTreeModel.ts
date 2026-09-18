/**
 * The one grouping model behind both file lists.
 *
 * Decision 2: the sidebar tree and the Home list are the same component at two
 * densities, so they must not disagree about structure. The way to guarantee
 * that is for neither of them to compute it — both render what this module
 * returns. Density is purely presentational below this line.
 *
 * Folder is the only hierarchy. Time is a *grouping of the same flat list*, not
 * a second tree, which is why `groupByTime` returns the same `FileGroup` shape
 * with `folderId: null` — there is no location called "Previous 7 days" that a
 * file could be dropped into.
 */

import type { FileMeta, FileType, Folder } from "../../shared/uiPort";

export type Grouping = "folder" | "time";
export type FileFilter = "all" | "pinned";

export interface FileGroup {
  /** Stable key for React and for expand/collapse state. */
  id: string;
  label: string;
  /**
   * The real folder this group represents, or null for a time bucket.
   * Only a non-null `folderId` can accept a dropped file.
   */
  folderId: string | null;
  files: FileMeta[];
  /** Total before any "show more" truncation, so the caller can label the rest. */
  total: number;
}

export interface GroupOptions {
  filter?: FileFilter;
  fileType?: FileType | "all";
  /** Cap per group; groups report `total` so the overflow can be offered. */
  limit?: number;
  now?: number;
}

const DAY = 86_400_000;

const lastTouched = (file: FileMeta) => file.lastOpenedAt ?? file.updatedAt ?? file.createdAt ?? 0;

const byRecency = (a: FileMeta, b: FileMeta) => lastTouched(b) - lastTouched(a);

function applyFilters(files: FileMeta[], options: GroupOptions): FileMeta[] {
  const { filter = "all", fileType = "all" } = options;
  return files.filter((file) => {
    if (filter === "pinned" && !file.pinned) return false;
    if (fileType !== "all" && file.type !== fileType) return false;
    return true;
  });
}

function truncate(files: FileMeta[], limit?: number): { files: FileMeta[]; total: number } {
  const sorted = [...files].sort(byRecency);
  if (limit === undefined || sorted.length <= limit) return { files: sorted, total: sorted.length };
  return { files: sorted.slice(0, limit), total: sorted.length };
}

/** Folders in the user's order, each with the files that live in it. */
export function groupByFolder(
  folders: Folder[],
  files: FileMeta[],
  options: GroupOptions = {},
): FileGroup[] {
  const visible = applyFilters(files, options);
  return folders.map((folder) => {
    const mine = visible.filter((file) => file.folderId === folder.id);
    const { files: page, total } = truncate(mine, options.limit);
    return { id: folder.id, label: folder.name, folderId: folder.id, files: page, total };
  });
}

/** Buckets matching the prototype's Home headings. */
export function timeBucket(file: FileMeta, now = Date.now()): string {
  const touched = lastTouched(file);
  if (!touched) return "Earlier";
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const days = (startOfToday.getTime() - touched) / DAY;
  if (days < 0) return "Today";
  if (days < 7) return "Previous 7 days";
  if (days < 30) return "Previous 30 days";
  return "Earlier";
}

const BUCKET_ORDER = ["Today", "Previous 7 days", "Previous 30 days", "Earlier"] as const;

export function groupByTime(files: FileMeta[], options: GroupOptions = {}): FileGroup[] {
  const now = options.now ?? Date.now();
  const visible = applyFilters(files, options);
  return BUCKET_ORDER.map((label) => {
    const mine = visible.filter((file) => timeBucket(file, now) === label);
    const { files: page, total } = truncate(mine, options.limit);
    return { id: `time:${label}`, label, folderId: null, files: page, total };
  }).filter((group) => group.total > 0);
}

export function buildGroups(
  grouping: Grouping,
  folders: Folder[],
  files: FileMeta[],
  options: GroupOptions = {},
): FileGroup[] {
  return grouping === "folder"
    ? groupByFolder(folders, files, options)
    : groupByTime(files, options);
}

/** Shown under a file's name; a file always has a real location. */
export function locationLabel(file: FileMeta, folders: Folder[]): string {
  return folders.find((folder) => folder.id === file.folderId)?.name ?? "On this computer";
}

export function formatTouched(file: FileMeta, now = Date.now()): string {
  const touched = lastTouched(file);
  if (!touched) return "—";
  const date = new Date(touched);
  const isToday = new Date(now).toDateString() === date.toDateString();
  if (isToday) {
    return `Today, ${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date(now).getFullYear() ? undefined : "numeric",
  });
}
