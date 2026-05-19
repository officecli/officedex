import path from "node:path";
import { describe, expect, it } from "vitest";
import { desktopWorkspaceDir, withDefaultOutputDir } from "./workspace";

describe("desktop workspace defaults", () => {
  it("uses a writable userData workspace for generated artifacts", () => {
    const userData = path.join("/Users/example/Library/Application Support", "OfficeDex");

    expect(desktopWorkspaceDir(userData)).toBe(path.join(userData, "workspace"));
  });

  it("sets outputDir when a generate request does not provide one", () => {
    const input = withDefaultOutputDir(
      {
        documentType: "pptx",
        topic: "Q3 Review",
        prompt: "Create a deck",
        runtimeMode: "hosted",
      },
      "/tmp/OfficeDex/workspace",
    );

    expect(input.outputDir).toBe("/tmp/OfficeDex/workspace");
  });

  it("preserves an explicit outputDir", () => {
    const input = withDefaultOutputDir(
      {
        documentType: "pptx",
        topic: "Q3 Review",
        prompt: "Create a deck",
        runtimeMode: "hosted",
        outputDir: "/tmp/custom-output",
      },
      "/tmp/OfficeDex/workspace",
    );

    expect(input.outputDir).toBe("/tmp/custom-output");
  });
});
