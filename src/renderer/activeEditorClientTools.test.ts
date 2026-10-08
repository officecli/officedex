import { afterEach, describe, expect, it, vi } from "vitest";
import {
  executeActiveEditorClientTool,
  registerActiveEditorClientTools,
  waitForActiveEditorSurface,
} from "./activeEditorClientTools";

describe("activeEditorClientTools", () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => cleanup?.());

  it("routes a tool only to the active editor registration", async () => {
    const save = vi.fn(async () => ({ saved: true }));
    cleanup = registerActiveEditorClientTools("pptx-editor", { "pptx.editor.save": save });

    await expect(executeActiveEditorClientTool("pptx-editor", "pptx.editor.save", { reason: "runtime" }))
      .resolves.toEqual({ saved: true });
    expect(save).toHaveBeenCalledWith({ reason: "runtime" });
    await expect(executeActiveEditorClientTool("docx-editor", "docx.editor.save", {}))
      .rejects.toThrow("does not provide");
  });

  it("wakes a pending surface wait when the editor becomes ready", async () => {
    const waiting = waitForActiveEditorSurface("docx-editor", 1_000);
    cleanup = registerActiveEditorClientTools("docx-editor", { "docx.editor.save": vi.fn() });
    await expect(waiting).resolves.toBe(true);
  });
});

