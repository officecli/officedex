import { getCurrentLocale } from "../../renderer/i18n";

/**
 * "30 Sept, 01:40" — day, short month, 24-hour time, as the prototype formats
 * every time it shows (`A.date`). The day-first form is the prototype's; the
 * month name follows the display language.
 */
export function formatDateTime(epochMs: number | null | undefined): string {
  if (!epochMs) return "";
  const locale = getCurrentLocale() === "zh" ? "zh-CN" : "en-GB";
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(epochMs);
}

/** Bytes as the Local list shows them; an unknown size is a dash, never a guess. */
export function formatSize(bytes: number | null | undefined): string {
  if (bytes === undefined || bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/** Elapsed run time: "14s", "2m 5s". */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
