/**
 * The file service's view of a document row, with what the recent-files list
 * adds to it.
 */
import { describe, expect, it } from "vitest";

import type { DesktopAPI, DocumentRecord, RecentFile } from "../shared/types";
import { createFileService } from "./files";

function api(documents: DocumentRecord[], recents: RecentFile[]): DesktopAPI {
  return {
    async listDocuments() {
      return { items: documents, total: documents.length };
    },
    async getDocument(id: string) {
      const record = documents.find((entry) => entry.id === id);
      if (!record) throw new Error(`no document ${id}`);
      return record;
    },
    async listRecentFiles() {
      return recents;
    },
  } as unknown as DesktopAPI;
}

const record = (id: string, filePath: string, taskId?: string): DocumentRecord => ({
  id,
  filePath,
  fileName: filePath.split("/").pop() ?? filePath,
  documentType: "docx",
  createdAt: "2026-10-08T00:00:00Z",
  updatedAt: "2026-10-08T00:00:00Z",
  migrationSource: "",
  pinned: false,
  ...(taskId ? { currentArtifactTaskId: taskId } : {}),
});

describe("originConversationId", () => {
  it("comes from the generated recent entry's conversation", async () => {
    const files = createFileService(
      api(
        [record("d1", "/p/first.docx", "task-1"), record("d2", "/p/second.docx", "task-2")],
        [
          { filePath: "/p/first.docx", fileName: "first.docx", documentType: "docx", source: "generated", taskId: "task-1", lastOpenedAt: "2026-10-08T01:00:00Z" },
          { filePath: "/p/second.docx", fileName: "second.docx", documentType: "docx", source: "generated", taskId: "task-2", conversationId: "task-1", lastOpenedAt: "2026-10-08T02:00:00Z" },
        ],
      ),
    );
    const list = await files.list();
    // A first run's conversation is its own id; a follow-up's is recorded.
    expect(list.find((file) => file.id === "d1")?.originConversationId).toBe("task-1");
    expect(list.find((file) => file.id === "d2")?.originConversationId).toBe("task-1");
    expect(list.find((file) => file.id === "d2")?.lastOpenedAt).toBe(Date.parse("2026-10-08T02:00:00Z"));
  });

  it("is absent for a file the user brought in themselves", async () => {
    const files = createFileService(
      api(
        [record("d3", "/p/mine.docx")],
        [{ filePath: "/p/mine.docx", fileName: "mine.docx", documentType: "docx", source: "local", lastOpenedAt: "2026-10-08T01:00:00Z" }],
      ),
    );
    const [file] = await files.list();
    expect(file.originConversationId).toBeUndefined();
    expect(file.artifactTaskId).toBeUndefined();
  });

  it("is absent when the recent list knows nothing of the file", async () => {
    const files = createFileService(api([record("d4", "/p/old.docx", "task-7")], []));
    const [file] = await files.list();
    expect(file.originConversationId).toBeUndefined();
    expect(file.lastOpenedAt).toBeNull();
  });
});

it("retains open/save failures across service restart until a successful retry", async () => {
  localStorage.clear();
  const desktop = api([record("bad", "/p/bad.docx"), record("conflict", "/p/conflict.docx")], []);
  const first = createFileService(desktop);
  await first.setFailure!("bad", { kind: "open", reason: "invalid-docx", detail: "bad zip", at: 1 });
  await first.setFailure!("conflict", { kind: "save", reason: "source-changed", detail: "changed externally", at: 2 });
  const second = createFileService(desktop);
  expect((await second.list()).map(f => f.failure?.kind)).toEqual(["open", "save"]);
  await second.save("conflict");
  expect((await createFileService(desktop).list()).map(f => f.failure?.kind)).toEqual(["open", undefined]);
  await second.setFailure!("bad", null);
  expect((await createFileService(desktop).list()).every(f => !f.failure)).toBe(true);
  localStorage.clear();
});
