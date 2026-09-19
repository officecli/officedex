import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import type { DesktopAPI, DesktopTask } from "../shared/types";
import { useLocale, type Locale } from "../renderer/i18n";
import { PresentationStage } from "./PresentationStage";

afterEach(cleanup);

/**
 * The stage is the one piece of the old renderer the shell mounts whole, so it
 * arrives carrying that renderer's i18n. Everything under it is stubbed: what
 * is under test is the language the subtree resolves to, not what it draws.
 */
let seen: Locale | null = null;

vi.mock("../renderer/presentation/ProgressivePptxStage", () => ({
  ProgressivePptxStage: () => {
    seen = useLocale();
    return null;
  },
}));

vi.mock("./useCanvasSession", () => ({
  useCanvasSession: () => ({ grant: null, artifact: null }),
}));

vi.mock("../renderer/controllers/usePptxLiveDraft", () => ({
  usePptxLiveDraft: () => undefined,
}));

vi.mock("../renderer/controllers/usePptxRunControls", () => ({
  usePptxRunControls: () => ({ livePausedTaskIds: [] }),
}));

const task = { id: "task-1", status: "running", documentType: "pptx", events: [] } as unknown as DesktopTask;
const api = {} as DesktopAPI;

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
