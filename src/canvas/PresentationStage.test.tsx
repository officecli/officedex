import { cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, expect, it, vi } from "vitest";

import type { DesktopAPI, DesktopTask } from "../shared/types";
import { useLocale, type Locale } from "../renderer/i18n";
import { PresentationStage } from "./PresentationStage";

afterEach(() => {
  cleanup();
  mounted = 0;
  liveOps = [{ op: "shape.add" }];
  wiredControllers = [];
});

/*
 * The ops reach the renderer whether or not anything draws them.
 *
 * That was the bug: the feed arrived, the editor mounted, and the deck stayed
 * blank for the length of the run because the thing that executes ops lives in
 * the workbench — a layer above what this stage mounts. The frame hands out a
 * controller for exactly this, so what has to hold is that the stage takes it
 * and gives it to the replay.
 */
it("hands the editor's controller to the replay, so the run can draw", () => {
  render(<PresentationStage api={api} task={task} onError={() => {}} />);
  expect(wiredControllers.at(-1), "the replay was wired with no controller").toEqual({
    id: "editor-controller",
  });
});

/**
 * The stage mounts the old renderer's editor frame, so it arrives carrying that
 * renderer's i18n. The frame itself is stubbed: what is under test is that the
 * canvas puts the *editor* there and what language the subtree resolves to —
 * not what PowerPoint draws.
 */
let seen: Locale | null = null;
let mounted = 0;
/** Controllers the stage passed to the replay wiring, in order. */
let wiredControllers: unknown[] = [];

vi.mock("../renderer/presentation/PresentationEditorFrame", () => ({
  PresentationEditorFrame: ({ onController }: { onController?: (c: unknown) => void }) => {
    seen = useLocale();
    mounted += 1;
    // The real frame hands its controller over once the editor has booted.
    useEffect(() => onController?.({ id: "editor-controller" }), [onController]);
    return null;
  },
}));

vi.mock("./useLiveDeckReplay", () => ({
  useLiveDeckReplay: (_api: unknown, controller: unknown) => {
    wiredControllers.push(controller);
  },
}));

vi.mock("./useCanvasSession", () => ({
  useCanvasSession: () => ({
    grant: { token: "preview-token" },
    artifact: { taskId: "task-1", fileName: "deck.pptx" },
  }),
}));

/**
 * The ops the stage is told about. `shape.add` is what
 * `hasPptxDrawingContent` counts as drawing.
 */
let liveOps: Array<{ op: string }> = [{ op: "shape.add" }];

vi.mock("../renderer/controllers/usePptxLiveDraft", () => ({
  usePptxLiveDraft: () => ({ replayFeed: { ops: liveOps } }),
}));

const task = { id: "task-1", status: "running", documentType: "pptx", events: [] } as unknown as DesktopTask;
const api = {} as DesktopAPI;

/*
 * The canvas shows the deck, and only the deck.
 *
 * It used to render the whole run around it — the request echoed back, the
 * outline with a status line per page, the timer, follow and cancel — with the
 * document itself a panel inside its own commentary. All of that is the task
 * panel's now.
 */
it("puts the editor on the canvas, and nothing else", () => {
  render(<PresentationStage api={api} task={task} onError={() => {}} />);
  // Presence, not a mount count: the stage re-renders when the editor hands
  // over its controller, and how many times React runs the child is not what
  // this is about.
  expect(mounted).toBeGreaterThan(0);
});

/*
 * The deck on screen is `workspaceDir/live/` scratch — replaced on every redraw
 * and deleted by the next run — so an edit made now cannot reach the finished
 * file. The embedded editor owns its ribbon and has no read-only mode to ask
 * for, so the shell blocks pointer events over it and says why.
 */
it("does not let the scratch deck be edited while it is being drawn", () => {
  const { container } = render(<PresentationStage api={api} task={task} onError={() => {}} />);
  expect(container.querySelector(".shell-live-deck-lock")).not.toBeNull();
  expect(container.querySelector(".shell-live-deck-note")?.textContent).toContain("Being drawn");
});

/*
 * An empty editor is worse than a skeleton.
 *
 * Measured on a real run: the live draft came out byte-for-byte the size of
 * `blank.pptx` — 10111 bytes, one empty slide — while the finished deck was
 * 1.6MB. The drawing ops have one producer in the runtime, the jssdk-design
 * path, and the desktop's default backend (`mop-skill`) authors server-side and
 * returns the finished file. So on the default path the canvas showed a live
 * editor with nothing in it, for the length of the run, under a banner saying
 * it was being drawn.
 */
it("shows a skeleton rather than an empty editor when nothing is being drawn", () => {
  liveOps = [];
  const { container } = render(<PresentationStage api={api} task={task} onError={() => {}} />);
  expect(mounted, "the editor was mounted with no drawing to put in it").toBe(0);
  expect(container.querySelector(".shell-live-deck")).toBeNull();
  expect(container.querySelector(".shell-skeleton-slide")).not.toBeNull();
});

/*
 * On a Chinese system this subtree used to resolve to `zh`, so the canvas said
 * 「正在撰写页面正文」 while the task panel beside it, the ribbon above it and
 * the slides themselves were English — one screen, two languages, neither
 * chosen. `src/shell` has no i18n by decision, so English is what the rest of
 * this window speaks and this subtree has to agree.
 */
it("speaks the shell's language, not the operating system's", () => {
  const original = navigator.language;
  Object.defineProperty(navigator, "language", { value: "zh-CN", configurable: true });
  try {
    render(<PresentationStage api={api} task={task} onError={() => {}} />);
    expect(seen).toBe("en");
  } finally {
    Object.defineProperty(navigator, "language", { value: original, configurable: true });
  }
});
