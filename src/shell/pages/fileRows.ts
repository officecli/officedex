import type { AgentTask, FileMeta } from "../../shared/uiPort";

/** The nine types New and Quick start offer, grouped as the standard names them (§18). */
export const NEW_GROUPS = [
  { id: "office", labelKey: "dx.new.groupOffice", types: ["docx", "xlsx", "pptx"] },
  { id: "more", labelKey: "dx.new.groupMore", types: ["txt", "md", "rtf", "html", "pdf"] },
  { id: "ai", labelKey: "dx.new.groupAi", types: ["png"] },
] as const;

export type NewType = (typeof NEW_GROUPS)[number]["types"][number];

/** The file type the workspace can create for a New type, when it can. */
export const CREATABLE: Partial<Record<NewType, FileMeta["type"]>> = {
  docx: "doc",
  xlsx: "sheet",
  pptx: "slides",
};

/** Files the current run is writing to, and files with a suggestion waiting for review. */
export function filesTouchedBy(task: AgentTask | null): { working: Set<string>; review: Set<string> } {
  const working = new Set<string>();
  const review = new Set<string>();
  if (!task) return { working, review };
  const running = task.status === "working" || task.status === "reading" || task.status === "writing";
  const target = task.suggestion?.targetFileId;
  if (target && task.suggestion && !task.suggestion.applied) review.add(target);
  if (running && target) working.add(target);
  return { working, review };
}

/** Most recently opened first; files never opened are not "recent". */
export function recentFiles(files: FileMeta[], limit: number): FileMeta[] {
  return files
    .filter((file) => file.lastOpenedAt)
    .sort(
      (a, b) =>
        (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}
