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

import { getCurrentLocale, translate } from "../../renderer/i18n";
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

/**
 * Which bucket a file falls in — an identity, not a label.
 *
 * The bucket used to *be* its English heading, which made it both the grouping
 * key and the copy: translating the heading would have silently re-keyed the
 * groups. The identity is now stable across languages and `bucketLabel` is the
 * only thing that speaks.
 */
export type TimeBucket = "today" | "previous7" | "previous30" | "earlier";

const BUCKET_ORDER: readonly TimeBucket[] = ["today", "previous7", "previous30", "earlier"];

const BUCKET_KEYS: Record<TimeBucket, string> = {
  today: "shell.time.today",
  previous7: "shell.time.previous7",
  previous30: "shell.time.previous30",
  earlier: "shell.time.earlier",
};

export function bucketOf(file: FileMeta, now = Date.now()): TimeBucket {
  const touched = lastTouched(file);
  if (!touched) return "earlier";
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const days = (startOfToday.getTime() - touched) / DAY;
  if (days < 0) return "today";
  if (days < 7) return "previous7";
  if (days < 30) return "previous30";
  return "earlier";
}

export function bucketLabel(bucket: TimeBucket): string {
  return translate(BUCKET_KEYS[bucket]);
}

/** Buckets matching the prototype's Home headings, in the reader's language. */
export function timeBucket(file: FileMeta, now = Date.now()): string {
  return bucketLabel(bucketOf(file, now));
}

export function groupByTime(files: FileMeta[], options: GroupOptions = {}): FileGroup[] {
  const now = options.now ?? Date.now();
  const visible = applyFilters(files, options);
  return BUCKET_ORDER.map((bucket) => {
    const mine = visible.filter((file) => bucketOf(file, now) === bucket);
    const { files: page, total } = truncate(mine, options.limit);
    return {
      id: `time:${bucket}`,
      label: bucketLabel(bucket),
      folderId: null,
      files: page,
      total,
    };
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
  return (
    folders.find((folder) => folder.id === file.folderId)?.name ??
    translate("shell.status.onThisComputer")
  );
}

/**
 * The date tag follows the reader, not the build.
 *
 * `en-US` was hardcoded into both calls, so a Chinese reader got "Sep 17" in a
 * column headed 最近打开. `Intl` is the part of this that already knows how each
 * language writes a date; the only decision left here is which language to ask
 * it about.
 */
function dateTag(): string {
  return getCurrentLocale() === "zh" ? "zh-CN" : "en-US";
}

export function formatTouched(file: FileMeta, now = Date.now()): string {
  const touched = lastTouched(file);
  if (!touched) return "—";
  const date = new Date(touched);
  const isToday = new Date(now).toDateString() === date.toDateString();
  if (isToday) {
    return translate("shell.time.todayAt", {
      time: date.toLocaleTimeString(dateTag(), { hour: "numeric", minute: "2-digit" }),
    });
  }
  return date.toLocaleDateString(dateTag(), {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date(now).getFullYear() ? undefined : "numeric",
  });
}
