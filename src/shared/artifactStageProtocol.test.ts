import { describe, expect, it } from "vitest";
import {
  createArtifactStageEditIntent,
  costClassForArtifactScope,
} from "./artifactStageProtocol";

describe("artifact stage protocol", () => {
  it("creates an immutable type-specific intent without file content", () => {
    const intent = createArtifactStageEditIntent({
      action: "rewrite",
      instruction: " Tighten the selected section ",
      target: {
        artifactId: "document:proposal",
        artifactPath: "/tmp/proposal.docx",
        documentType: "docx",
      },
      scope: { kind: "block", blockId: "docx:block:2:paragraph", blockKind: "paragraph", path: [0], textSha256: "a".repeat(64), paragraphHint: 1 },
    });
    expect(intent).toEqual(expect.objectContaining({
      version: 1,
      instruction: "Tighten the selected section",
      costClass: "metered",
    }));
    expect(JSON.stringify(intent)).not.toContain("base64");
    expect(Object.isFrozen(intent)).toBe(true);
    expect(Object.isFrozen(intent.scope)).toBe(true);
  });

  it("keeps document and tail work heavy while addressed edits are metered", () => {
    expect(costClassForArtifactScope({ kind: "document" })).toBe("heavy");
    expect(costClassForArtifactScope({ kind: "tail", fromSlide: 2 })).toBe("heavy");
    expect(costClassForArtifactScope({ kind: "range", sheetId: "sheet-1", a1: "A1" })).toBe("metered");
    expect(costClassForArtifactScope({ kind: "range", sheetId: "sheet-1", a1: "A1:B2" })).toBe("metered");
  });

  it("fails closed for a scope that does not belong to the artifact type", () => {
    expect(() => createArtifactStageEditIntent({
      action: "rewrite",
      instruction: "Change it",
      target: { artifactId: "sheet", artifactPath: "/tmp/sheet.xlsx", documentType: "xlsx" },
      scope: { kind: "block", blockId: "paragraph-1", blockKind: "paragraph", path: [0], textSha256: "a".repeat(64), paragraphHint: 1 },
    })).toThrow(/DOCX block/);
    expect(() => createArtifactStageEditIntent({
      action: "rewrite",
      instruction: "Change it",
      target: { artifactId: "sheet", artifactPath: "/tmp/sheet.xlsx", documentType: "xlsx" },
      scope: { kind: "range", sheetId: "sheet-1", a1: "A:A" },
    })).toThrow(/bounded XLSX/);
  });

  it("validates normalized image regions and still-image frame zero", () => {
    expect(() => createArtifactStageEditIntent({
      action: "redraw",
      instruction: "Brighten it",
      target: { artifactId: "image", artifactPath: "/tmp/image.png", documentType: "img" },
      scope: { kind: "region", x: 0.8, y: 0.2, width: 0.3, height: 0.4 },
    })).toThrow(/normalized rectangle/);
    expect(() => createArtifactStageEditIntent({
      action: "redraw",
      instruction: "Brighten it",
      target: { artifactId: "image", artifactPath: "/tmp/image.png", documentType: "img" },
      scope: { kind: "region", x: 0.1, y: 0.2, width: 0.3, height: 0.4, frames: { kind: "single", index: 2, frameCount: 3 } },
    })).toThrow(/frame zero/);
  });
});
