import { describe, expect, it } from "vitest";
import { makeWorkbookSource, sourceAfterImport, workbookSourceId } from "./workbookSource";

describe("workbook sources", () => {
  it("normalizes connector identity and preserves import failures", () => {
    expect(workbookSourceId("book", "jira", "Team / Issues")).toBe("source:book:jira:team-issues");
    const source = makeWorkbookSource({ workbookId: "book", kind: "shopify", name: "Orders", location: "shopify://store" });
    expect(sourceAfterImport(source, { importedAt: "2026-09-06T00:00:00Z", error: "rate limited" })).toMatchObject({ lastImportedAt: "2026-09-06T00:00:00Z", lastError: "rate limited" });
  });
});
