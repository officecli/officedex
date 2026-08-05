import { describe, expect, it } from "vitest";

import { normaliseRecentFiles } from "./bridge";

describe("recent file bridge normalization", () => {
  it("normalizes recent files from the desktop bridge", () => {
    expect(normaliseRecentFiles([{
      filePath: "/tmp/deck.pptx",
      fileName: "deck.pptx",
      documentType: "pptx",
      source: "generated",
      workspaceId: "ws-a",
      taskId: "task-a",
      conversationId: "conv-a",
      lastOpenedAt: "2026-08-05T01:00:00Z",
    }, null, { filePath: "" }])).toEqual([{
      filePath: "/tmp/deck.pptx",
      fileName: "deck.pptx",
      documentType: "pptx",
      source: "generated",
      workspaceId: "ws-a",
      taskId: "task-a",
      conversationId: "conv-a",
      lastOpenedAt: "2026-08-05T01:00:00Z",
    }]);
  });

  it("fills safe defaults without accepting invalid sources", () => {
    expect(normaliseRecentFiles([{
      filePath: "/tmp/local.pdf",
      source: "local",
    }, {
      filePath: "/tmp/remote.pdf",
      source: "remote",
    }])).toEqual([expect.objectContaining({
      filePath: "/tmp/local.pdf",
      fileName: "local.pdf",
      documentType: "pdf",
      source: "local",
    })]);
  });
});
