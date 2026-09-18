/**
 * The fixture the standalone shell boots into: the prototype's "MO product
 * launch" workspace, so screens can be compared against it side by side.
 */

import type { FileMeta, Folder, Model, ShellSettings } from "../types";

const DAY = 86_400_000;

/** Fixed clock offsets rather than literal dates, so the Home list's
 *  Today / Previous 7 days / Previous 30 days grouping always has members. */
export function seedFolders(): Folder[] {
  return [
    { id: "folder-launch", name: "MO product launch", path: "~/Documents/MO product launch" },
    { id: "folder-research", name: "Customer research", path: "~/Documents/Customer research" },
    { id: "folder-inbox", name: "Documents", path: "~/Documents", isDefault: true },
  ];
}

export function seedFiles(now = Date.now()): FileMeta[] {
  const file = (
    id: string,
    name: string,
    type: FileMeta["type"],
    folderId: string,
    openedDaysAgo: number,
    extra: Partial<FileMeta> = {},
  ): FileMeta => ({
    id,
    name,
    type,
    folderId,
    createdAt: now - (openedDaysAgo + 3) * DAY,
    updatedAt: now - openedDaysAgo * DAY,
    lastOpenedAt: now - openedDaysAgo * DAY,
    dirty: false,
    pinned: false,
    ...extra,
  });

  return [
    file("file-plan", "MO launch plan.docx", "doc", "folder-launch", 0, { pinned: true }),
    file("file-forecast", "MO sales forecast.xlsx", "sheet", "folder-launch", 0, { dirty: true }),
    file("file-deck", "MO launch deck.pptx", "slides", "folder-launch", 0),
    file("file-brief", "Positioning brief.docx", "doc", "folder-launch", 2),
    file("file-interviews", "Interview notes.docx", "doc", "folder-research", 3),
    file("file-panel", "Panel results.xlsx", "sheet", "folder-research", 9),
    file("file-readout", "Research readout.pptx", "slides", "folder-research", 12),
    file("file-scratch", "Untitled document.docx", "doc", "folder-inbox", 21),
  ];
}

export function seedModels(): Model[] {
  return [
    { id: "gpt-6-astra", name: "GPT-6 Astra", provider: "OpenAI", detail: "Complex tasks and deeper reasoning" },
    { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", provider: "OpenAI", detail: "Everyday tasks and document work" },
    { id: "kimi-k3", name: "K3", provider: "Kimi", detail: "Long-context reading" },
    { id: "deepseek-4-1", name: "DeepSeek 4.1", provider: "DeepSeek", detail: "General writing and analysis" },
  ];
}

export function seedSettings(): ShellSettings {
  return {
    permission: "review",
    enterToSend: true,
    customInstructions: "",
    reduceMotion: false,
    selectedModelId: "gpt-6-astra",
  };
}

/** Tabs the standalone shell opens on, matching the prototype's first screen. */
export const SEED_OPEN_FILE_IDS = ["file-plan", "file-forecast", "file-deck"];
export const SEED_ACTIVE_FILE_ID = "file-plan";
export const SEED_FOLDER_ID = "folder-launch";
