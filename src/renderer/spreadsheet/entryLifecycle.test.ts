import { describe, expect, it } from "vitest";
import type { SpreadsheetEntry } from "./types";
import { clearSpreadsheetEntryGrant } from "./entryLifecycle";

const entry: SpreadsheetEntry = {
  kind: "artifact",
  artifact: {
    filePath: "/tmp/runtime-tools.xlsx",
    fileName: "runtime-tools.xlsx",
    documentType: "xlsx",
  },
  workspaceId: "workspace-1",
  conversationId: "conversation-1",
  grant: {
    token: "token-old",
    fileName: "runtime-tools.xlsx",
    documentType: "xlsx",
  },
};

describe("clearSpreadsheetEntryGrant", () => {
  it("drops the closed canvas grant while preserving the artifact context", () => {
    expect(clearSpreadsheetEntryGrant(entry, "token-old")).toEqual({
      kind: "artifact",
      artifact: entry.artifact,
      workspaceId: "workspace-1",
      conversationId: "conversation-1",
    });
  });

  it("does not clear a replacement grant closed by an older canvas", () => {
    expect(clearSpreadsheetEntryGrant(entry, "token-stale")).toBe(entry);
  });
});
