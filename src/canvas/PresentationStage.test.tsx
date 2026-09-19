import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import type { DesktopAPI, DesktopTask } from "../shared/types";
import { useLocale, type Locale } from "../renderer/i18n";
import { PresentationStage } from "./PresentationStage";

afterEach(() => {
  cleanup();
  mounted = 0;
});

/**
 * The stage mounts the old renderer's editor frame, so it arrives carrying that
 * renderer's i18n. The frame itself is stubbed: what is under test is that the
 * canvas puts the *editor* there and what language the subtree resolves to —
 * not what PowerPoint draws.
 */
let seen: Locale | null = null;
let mounted = 0;

vi.mock("../renderer/presentation/PresentationEditorFrame", () => ({
  PresentationEditorFrame: () => {
    seen = useLocale();
    mounted += 1;
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
  usePptxLiveDraft: () => undefined,
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
  expect(mounted).toBe(1);
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
