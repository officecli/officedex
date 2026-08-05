import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Artifact } from "../../shared/types";

const officecli = vi.hoisted(() => ({
  issuePreviewToken: vi.fn(async () => ({ token: "preview-1", fileName: "book.xlsx", documentType: "xlsx" })),
  generate: vi.fn(async () => ({ taskId: "task-1", sessionId: "session-1", status: "running" })),
  modify: vi.fn(async () => ({ taskId: "task-2", sessionId: "session-2", status: "running" })),
}));

vi.mock("../bridge", () => ({ officecli }));

import { useSpreadsheetSession } from "./useSpreadsheetSession";

const artifact: Artifact = { filePath: "/tmp/book.xlsx", fileName: "book.xlsx", documentType: "xlsx" };

describe("useSpreadsheetSession", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens an XLSX artifact with an exact preview grant", async () => {
    const { result } = renderHook(() => useSpreadsheetSession({ kind: "new", workspaceId: "ws-1" }));
    await act(async () => result.current.openArtifact(artifact, "conversation-1"));
    expect(officecli.issuePreviewToken).toHaveBeenCalledWith(artifact);
    expect(result.current.session).toMatchObject({ phase: "loading", artifact, workspaceId: "ws-1", conversationId: "conversation-1" });
  });

  it("starts spreadsheet generation and modification in the same session", async () => {
    const { result } = renderHook(() => useSpreadsheetSession({ kind: "new" }));
    await act(async () => result.current.startGeneration({ documentType: "xlsx", generationMode: "plan", topic: "Forecast", prompt: "Forecast", noProject: true }));
    expect(result.current.session).toMatchObject({ phase: "generating", taskId: "task-1" });
    await act(async () => result.current.startModify({ documentType: "xlsx", sourceFile: "/tmp/book.xlsx", prompt: "Add chart", noProject: true }));
    expect(result.current.session).toMatchObject({ phase: "generating", taskId: "task-2" });
  });
});
