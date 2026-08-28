import { describe, expect, it } from "vitest";
import { createArtifactStageEditIntent } from "../../shared/artifactStageProtocol";
import { resolveArtifactStageExecutionRoute } from "./executionRoute";

describe("artifact stage execution routing", () => {
  it("routes supported whole-document work through the real office.modify path", () => {
    const intent = createArtifactStageEditIntent({
      action: "rewrite",
      instruction: "Rewrite the report",
      target: { artifactId: "doc", artifactPath: "/tmp/report.docx", documentType: "docx" },
      scope: { kind: "document" },
    });
    expect(resolveArtifactStageExecutionRoute(intent)).toBe("artifact_stage_edit.v1");
  });

  it("fails closed before transport for addressed edits", () => {
    const intent = createArtifactStageEditIntent({
      action: "rewrite",
      instruction: "Rewrite this block",
      target: { artifactId: "doc", artifactPath: "/tmp/report.docx", documentType: "docx" },
      scope: { kind: "block", blockId: "block-1", blockKind: "paragraph", path: [0], textSha256: "a".repeat(64), paragraphHint: 1 },
    });
    expect(resolveArtifactStageExecutionRoute(intent)).toBe("artifact_stage_edit.v1");
  });

  it("does not send flat redraws through an unverified office.modify route", () => {
    const intent = createArtifactStageEditIntent({
      action: "redraw",
      instruction: "Remove the background",
      target: { artifactId: "image", artifactPath: "/tmp/image.png", documentType: "img" },
      scope: { kind: "document" },
    });
    expect(resolveArtifactStageExecutionRoute(intent)).toBe("artifact_stage_edit.v1");
  });
});
