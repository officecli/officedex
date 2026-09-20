import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import type { DesktopAPI, DesktopTask } from "../shared/types";
import { useLocale, type Locale } from "../renderer/i18n";
import { PresentationStage } from "./PresentationStage";

afterEach(() => {
  cleanup();
  editorMounts = 0;
  replayFeed = { ops: [{ op: "shape.add" }] };
});

let seen: Locale | null = null;
/** Any mount of the embedded editor, by either embed stack. */
let editorMounts = 0;
/**
 * What the live-draft controller hands back; per-test so both halves can run.
 *
 * Initialised here and not only in `afterEach`: the first test runs before any
 * `afterEach` does, so leaving it undefined made "there are ops" read as "there
 * are none" and the test failed for the wrong reason.
 */
let replayFeed: { ops: unknown[] } | undefined = { ops: [{ op: "shape.add" }] };

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

vi.mock("../renderer/controllers/usePptxLiveDraft", () => ({
  usePptxLiveDraft: () => ({
    replayFeed,
    replayBundledDemo: async () => {},
    liveDraft: undefined,
  }),
}));

const task = { id: "task-1", status: "running", documentType: "pptx", events: [] } as unknown as DesktopTask;
const api = {} as DesktopAPI;

/*
 * The editor is mounted when there is something to draw, and not otherwise.
 *
 * This file previously asserted the opposite — that a ready grant and a ready
 * artifact were *not* enough to earn an editor, because drawing into it had
 * "failed at the editor itself" with `Editing is not permitted`. That
 * attribution was wrong: a probe measured the frame editor accepting
 * `shapes.addTextBox` (the sequencer's own call) and the shape landing. See
 * `docs/ui-audit-2026-09-19/findings-pptx-write-probe.md`.
 *
 * So the guard belongs on the other axis. What made the old surface dishonest
 * was never the editor — it was an editor over an *empty* document for three
 * and a half minutes under a banner claiming it was being drawn. That is what
 * `hasPptxDrawingContent` still prevents, and it is the half worth asserting:
 * ops arriving is the precondition, and no ops means skeleton.
 */
it("mounts the editor when there are ops for it to draw", () => {
  const { container } = render(<PresentationStage api={api} task={task} onError={() => {}} />);
  expect(editorMounts).toBe(1);
  // The lock is what makes the editor's own live-looking toolbar inert while
  // the runtime draws through the controller.
  expect(container.querySelector('[data-testid="shell-live-deck-lock"]')).not.toBeNull();
});

it("shows the deck's shape instead when nothing is being drawn", () => {
  replayFeed = { ops: [] };
  const { container } = render(<PresentationStage api={api} task={task} onError={() => {}} />);
  expect(editorMounts, "an editor was mounted over a document with nothing in it").toBe(0);
  expect(container.querySelector(".shell-skeleton-slide")).not.toBeNull();
  expect(container.querySelector('[data-testid="shell-live-deck-lock"]')).toBeNull();
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
