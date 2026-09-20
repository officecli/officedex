import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import type { DesktopAPI, DesktopTask } from "../shared/types";
import { useLocale, type Locale } from "../renderer/i18n";
import { PresentationStage } from "./PresentationStage";

afterEach(() => {
  cleanup();
  editorMounts = 0;
});

let seen: Locale | null = null;
/** Any mount of the embedded editor, by either embed stack. */
let editorMounts = 0;

vi.mock("../renderer/presentation/PresentationEditorFrame", () => ({
  PresentationEditorFrame: () => {
    seen = useLocale();
    editorMounts += 1;
    return null;
  },
}));

vi.mock("../renderer/preview/viewers/presentation/PresentationPptxWorkbench", () => ({
  default: () => {
    seen = useLocale();
    editorMounts += 1;
    return null;
  },
}));

vi.mock("./useCanvasSession", () => ({
  useCanvasSession: () => ({
    grant: { token: "preview-token" },
    artifact: { taskId: "task-1", fileName: "deck.pptx" },
  }),
}));

/** Drawing ops do arrive; that was never the missing half. */
vi.mock("../renderer/controllers/usePptxLiveDraft", () => ({
  usePptxLiveDraft: () => ({ replayFeed: { ops: [{ op: "shape.add" }] } }),
}));

const task = { id: "task-1", status: "running", documentType: "pptx", events: [] } as unknown as DesktopTask;
const api = {} as DesktopAPI;

/*
 * An empty editor is worse than a skeleton — and an empty editor is all this
 * surface could show.
 *
 * Measured on real runs: the live draft stayed 10111 bytes, byte-for-byte a
 * blank deck, against a finished file of 1.6MB. So the canvas held a live
 * PowerPoint ribbon over nothing for three and a half minutes, under a banner
 * saying it was being drawn.
 *
 * Wiring the drawing was tried and failed at the editor itself: it reported
 * `drawing slide 1 of 3` and threw "Editing is not permitted". Of the two embed
 * stacks only the workbench's boot carries `documentWrite`, and mounting the
 * workbench failed to import the deck and dragged its own agent panel back onto
 * a canvas that had been emptied of exactly that.
 *
 * So a ready grant and a ready artifact no longer earn an editor here, which is
 * precisely what this file used to assert.
 */
it("shows the deck's shape while it is being written, not an empty editor", () => {
  const { container } = render(<PresentationStage api={api} task={task} onError={() => {}} />);
  expect(editorMounts, "an editor was mounted for a run that cannot draw into one").toBe(0);
  expect(container.querySelector(".shell-skeleton-slide")).not.toBeNull();
  // Nothing to lock and nothing to caption: both belonged to the live editor.
  expect(container.querySelector(".shell-live-deck-lock")).toBeNull();
  expect(container.querySelector(".shell-live-deck-note")).toBeNull();
});

/*
 * On a Chinese system this subtree resolved to `zh` on its own, so the canvas
 * said 「正在撰写页面正文」 while the panel beside it and the slides themselves
 * were English — one screen, two languages, neither chosen (S4-009). It reads
 * the shell's locale now; the `en` here is the fallback for a canvas root the
 * shell did not mount, and falling back to `navigator.language` there is
 * exactly the bug.
 */
it("speaks the shell's language, not the operating system's", () => {
  const original = navigator.language;
  Object.defineProperty(navigator, "language", { value: "zh-CN", configurable: true });
  try {
    render(<PresentationStage api={api} task={task} onError={() => {}} />);
    expect(seen ?? "en").toBe("en");
  } finally {
    Object.defineProperty(navigator, "language", { value: original, configurable: true });
  }
});
