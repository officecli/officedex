import type { SpreadsheetEntry } from "./types";

export function clearSpreadsheetEntryGrant(
  entry: SpreadsheetEntry | null,
  previewToken: string,
): SpreadsheetEntry | null {
  if (entry?.kind !== "artifact" || entry.grant?.token !== previewToken) return entry;
  return {
    kind: "artifact",
    artifact: entry.artifact,
    ...(entry.workspaceId ? { workspaceId: entry.workspaceId } : {}),
    ...(entry.conversationId ? { conversationId: entry.conversationId } : {}),
  };
}
