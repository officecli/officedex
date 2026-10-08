/**
 * "From chat" on Assets — F11 of the 1.0.11 acceptance.
 *
 * A conversation's row id is its first run's id, and a file carries the id of
 * the run that wrote it. Only a first run's file could ever match, so every
 * follow-up's output — and every edit's — showed as "—".
 */
import { describe, expect, it } from "vitest";

import type { AgentTaskSummary } from "../../shared/uiPort";
import { originChatOf } from "./AssetsPage";

const chat = (id: string, name: string, summary: Partial<AgentTaskSummary> = {}) => ({
  id,
  name,
  summary: { id, conversationId: id, title: name, folderId: "p", status: "done" as const, phase: "", ...summary },
});

describe("originChatOf", () => {
  const chats = [
    chat("task-1", "Launch plan & copy", { runTaskIds: ["task-1", "task-2", "task-3"] }),
    chat("task-9", "Hero image", { image: { runs: [{ taskId: "task-9", status: "done", prompt: "" }, { taskId: "task-10", status: "done", prompt: "" }] } }),
  ];

  it("finds the conversation for a file a later run produced", () => {
    expect(originChatOf({ artifactTaskId: "task-3" }, chats)?.name).toBe("Launch plan & copy");
  });

  it("still finds it for the first run's file", () => {
    expect(originChatOf({ artifactTaskId: "task-1" }, chats)?.name).toBe("Launch plan & copy");
  });

  it("prefers the recorded origin when the port wrote one", () => {
    expect(originChatOf({ originConversationId: "task-9", artifactTaskId: "task-3" }, chats)?.name).toBe("Hero image");
  });

  it("falls through to the run when the recorded origin names no known conversation", () => {
    expect(originChatOf({ originConversationId: "gone", artifactTaskId: "task-2" }, chats)?.name).toBe("Launch plan & copy");
  });

  it("matches a picture by any of its versions", () => {
    expect(originChatOf({ artifactTaskId: "task-10" }, chats)?.name).toBe("Hero image");
  });

  it("answers nothing for a file no run made", () => {
    expect(originChatOf({}, chats)).toBeUndefined();
    expect(originChatOf({ artifactTaskId: "task-404" }, chats)).toBeUndefined();
  });
});
