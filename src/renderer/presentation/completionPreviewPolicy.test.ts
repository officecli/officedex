import { describe, expect, it } from "vitest";
import { shouldKeepLivePreviewOnCompletion } from "./completionPreviewPolicy";

describe("shouldKeepLivePreviewOnCompletion", () => {
  it("keeps the live editor when the live task state owns the completion", () => {
    expect(shouldKeepLivePreviewOnCompletion({ taskId: "task-1", liveDraftTaskId: "task-1" })).toBe(true);
  });

  it("keeps the live editor during the state update race when the preview registry owns it", () => {
    expect(shouldKeepLivePreviewOnCompletion({
      taskId: "task-1",
      liveDraftTaskId: null,
      previewTaskId: "task-1",
      previewLiveTaskId: "task-1",
    })).toBe(true);
  });

  it("allows the final artifact to open when no live editor exists", () => {
    expect(shouldKeepLivePreviewOnCompletion({ taskId: "task-1", liveDraftTaskId: null })).toBe(false);
  });

  it("does not keep a live preview owned by another task", () => {
    expect(shouldKeepLivePreviewOnCompletion({
      taskId: "task-1",
      liveDraftTaskId: "task-2",
      previewTaskId: "task-2",
      previewLiveTaskId: "task-2",
    })).toBe(false);
  });
});
