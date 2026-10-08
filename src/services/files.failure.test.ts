import { describe, expect, it } from "vitest";

import type { DesktopAPI, DocumentRecord } from "../shared/types";
import { createFileService } from "./files";

/**
 * The service's half of "Saved is an assertion".
 *
 * `dirty` and `failure` are both session state the desktop has no row for, so
 * this is the only place they are kept — and the only place a reload could
 * lose them. What is pinned: a recorded failure comes back on `list`, a save
 * clears both, and removing a file forgets both.
 */
function record(id: string): DocumentRecord {
  return {
    id,
    filePath: `/Users/qa/${id}.docx`,
    fileName: `${id}.docx`,
    documentType: "docx",
    workspaceId: "",
    createdAt: "2026-10-08T09:00:00Z",
    updatedAt: "2026-10-08T09:00:00Z",
    migrationSource: "user",
    pinned: false,
  };
}

function stubApi(): DesktopAPI {
  const docs = [record("one"), record("two")];
  return {
    listDocuments: async () => ({ items: docs, total: docs.length }),
    getDocument: async (id: string) => docs.find((doc) => doc.id === id)!,
    listRecentFiles: async () => [],
    removeDocument: async () => undefined,
  } as unknown as DesktopAPI;
}

describe("file service failures", () => {
  it("keeps a recorded failure on the file across reloads, beside its dirty flag", async () => {
    const files = createFileService(stubApi());
    await files.setDirty("one", true);
    await files.setFailure!("one", { kind: "save", reason: "permission-denied", detail: "permission denied", at: 1 });

    const listed = await files.list();
    expect(listed.find((file) => file.id === "one")).toMatchObject({
      dirty: true,
      failure: { kind: "save", reason: "permission-denied" },
    });
    expect(listed.find((file) => file.id === "two")?.failure).toBeUndefined();
  });

  it("clears the failure with the dirty flag when a save gets through", async () => {
    const files = createFileService(stubApi());
    await files.setDirty("one", true);
    await files.setFailure!("one", { kind: "save", reason: "unknown", detail: "x", at: 1 });

    await files.save("one");

    const [one] = await files.list();
    expect(one.dirty).toBe(false);
    expect(one.failure).toBeUndefined();
  });

  it("clears a failure on request, and forgets it with the file", async () => {
    const files = createFileService(stubApi());
    await files.setFailure!("one", { kind: "open", reason: "invalid-docx", detail: "x", at: 1 });
    await files.setFailure!("one", null);
    expect((await files.list())[0].failure).toBeUndefined();

    await files.setFailure!("two", { kind: "open", reason: "invalid-docx", detail: "x", at: 1 });
    await files.remove("two");
    files.forget("two");
    await files.setDirty("two", false);
    expect((await files.list())[1].failure).toBeUndefined();
  });
});
