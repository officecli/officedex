import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { StatusBar } from "./StatusBar";
import { publishEditorChrome, resetCanvasSurface } from "../editor/canvasSurface";
import { SLIDES_CHROME, STAGE_CHROME } from "../../canvas/editorChrome";

/**
 * The status bar during a run, which is the one time it was wrong.
 *
 * A deck being generated has no library entry — the live draft is scratch in
 * `workspaceDir/live/` and never reaches `documents` — so `activeFile` is null
 * for the whole minute or more the deck is visibly being drawn on the canvas
 * beside this bar. It said "No file open" the entire time.
 *
 * What it reads instead is the canvas announcing itself: a mounted editor
 * publishes its chrome, and so does the live stage.
 */
let activeFile: { name: string; dirty: boolean } | null = null;

vi.mock("../state/ShellContext", () => ({
  useShell: () => ({ activeFile }),
}));

vi.mock("../../renderer/i18n", () => ({
  useT: () => (key: string) => key,
}));

beforeEach(() => {
  resetCanvasSurface();
  activeFile = null;
});

afterEach(() => {
  cleanup();
  resetCanvasSurface();
});

it("says nothing is open when the canvas is empty", () => {
  render(<StatusBar />);
  expect(screen.getByText("shell.status.noFile")).toBeTruthy();
});

it("does not claim nothing is open while a deck is being written into the canvas", () => {
  const release = publishEditorChrome(SLIDES_CHROME);
  try {
    render(<StatusBar />);
    expect(screen.queryByText("shell.status.noFile"), "a visible deck was reported as no file").toBeNull();
    expect(screen.getByText("shell.status.beingWritten")).toBeTruthy();
  } finally {
    release();
  }
});

/*
 * An open file outranks the canvas signal: the editor showing it publishes
 * chrome too, and the file's own name is the more specific true thing.
 */
it("still reports the open file by name when there is one", () => {
  activeFile = { name: "MO launch deck.pptx", dirty: false };
  const release = publishEditorChrome(SLIDES_CHROME);
  try {
    render(<StatusBar />);
    expect(screen.getByText("MO launch deck.pptx")).toBeTruthy();
    expect(screen.queryByText("shell.status.beingWritten")).toBeNull();
  } finally {
    release();
  }
});

/*
 * The deck was only half the problem.
 *
 * `DocxStage` and `SheetStage` reserve no space, and used to report nothing at
 * all — which this bar cannot tell apart from an empty canvas. So a workbook
 * generated from Home said "No file open" for the length of the run, under a
 * stage captioned "Writing the workbook". They report `STAGE_CHROME` now:
 * still nothing reserved, but no longer silence.
 */
it("does not claim nothing is open while a document or workbook stage owns the canvas", () => {
  const release = publishEditorChrome(STAGE_CHROME);
  try {
    render(<StatusBar />);
    expect(screen.queryByText("shell.status.noFile")).toBeNull();
    expect(screen.getByText("shell.status.beingWritten")).toBeTruthy();
  } finally {
    release();
  }
});

// A stage draws no status bar of its own, so the shell must keep drawing one.
it("keeps the shell's own bar for a stage", () => {
  expect(STAGE_CHROME.ownsStatusBar).toBe(false);
});
