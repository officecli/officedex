import { describe, expect, it } from "vitest";
import { createDocxArtifactStageIntent } from "./docxStageAdapter";

describe("DOCX shared stage adapter", () => {
  it("maps a selected block to metered shared intent", () => {
    expect(createDocxArtifactStageIntent({
      artifactId: "document:proposal",
      artifactPath: "/tmp/proposal.docx",
      selection: { blockId: "docx:block:2:paragraph" },
      block: { id: "docx:block:2:paragraph", kind: "paragraph", path: [2], textSha256: "a".repeat(64), paragraphHint: 3 },
      instruction: "Tighten this paragraph",
    })).toEqual(expect.objectContaining({
      version: 1,
      costClass: "metered",
      scope: expect.objectContaining({ kind: "block", blockId: "docx:block:2:paragraph" }),
    }));
  });

  it("falls back to a heavy document intent without a block", () => {
    expect(createDocxArtifactStageIntent({
      artifactId: "document:proposal",
      artifactPath: "/tmp/proposal.docx",
      instruction: "Rewrite the document",
    })).toEqual(expect.objectContaining({
      costClass: "heavy",
      scope: { kind: "document" },
    }));
  });
});
