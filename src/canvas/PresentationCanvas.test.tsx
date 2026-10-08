import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DesktopAPI, DocumentRecord } from "../shared/types";
import type { FileMeta } from "../shared/uiPort";
import {
  presentationSelectionLabel,
  PRESENTATION_SELECTION_SOURCE,
  PRESENTATION_SELECTION_TEXT_SOURCE,
} from "../shared/presentationSelection";

/**
 * The presentation leaf's selection reporting.
 *
 * PowerPoint has no selection event, and polling it was what kept this
 * unwired — every poll is a script into the iframe, forever, for a chip that
 * may never be used. The trigger is the gesture instead: the embed says the
 * user clicked or typed in the editor, and the window regaining focus covers
 * the user coming back from somewhere the embed never saw.
 *
 * The editor is stubbed. What is under test is when the script runs and what
 * the chip ends up saying, not whether PowerPoint renders.
 */

type FrameProps = {
  previewToken: string;
  fileName: string;
  onController?: (controller: unknown) => void;
  onUnavailable?: (error?: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSelectionChanged?: () => void;
};

const frameProps: FrameProps[] = [];

vi.mock("../renderer/presentation/PresentationEditorFrame", () => ({
  PresentationEditorFrame: (props: FrameProps) => {
    frameProps.push(props);
    return <div data-testid="presentation-frame" />;
  },
}));

const { PresentationCanvas } = await import("./PresentationCanvas");

function record(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: "document:deck",
    filePath: "/tmp/officedex/launch.pptx",
    fileName: "launch.pptx",
    documentType: "pptx",
    workspaceId: "",
    createdAt: "2026-09-10T09:00:00Z",
    updatedAt: "2026-09-10T09:00:00Z",
    migrationSource: "user",
    pinned: false,
    ...overrides,
  };
}

function file(): FileMeta {
  return {
    id: "document:deck",
    name: "launch.pptx",
    type: "slides",
    folderId: "folder:default",
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
    dirty: false,
    pinned: false,
  };
}

function stubApi(): DesktopAPI {
  return {
    getDocument: vi.fn(async () => record()),
    issuePreviewToken: vi.fn(async () => ({
      token: "token-1",
      fileName: "launch.pptx",
      documentType: "pptx",
    })),
  } as unknown as DesktopAPI;
}

const noop = () => {};

beforeEach(() => {
  frameProps.length = 0;
});
afterEach(cleanup);

/** Mounts, waits for the frame, and hands the controller in. */
async function mounted(executeScript: (source: string) => Promise<{ result: unknown }>) {
  const onSelectionChange = vi.fn();
  const onResolveSelection = vi.fn();
  render(
    <PresentationCanvas
      api={stubApi()}
      file={file()}
      onDirtyChange={noop}
      onSelectionChange={onSelectionChange}
      onResolveSelection={onResolveSelection}
      onController={noop}
      onEditRunner={noop}
      onUnavailable={noop}
    />,
  );
  await waitFor(() => expect(frameProps).toHaveLength(1));
  frameProps[0].onController?.({ executeScript, save: vi.fn(), inspect: vi.fn() });
  return { onSelectionChange, onResolveSelection };
}

describe("PresentationCanvas selection", () => {
  it("asks the editor nothing until the user looks away from it", async () => {
    const executeScript = vi.fn(async () => ({
      result: { slideCount: 1, shapes: [{ id: "s1", name: "Title 1", type: "Placeholder" }] },
    }));
    const { onSelectionChange } = await mounted(executeScript);

    expect(executeScript).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(executeScript).toHaveBeenCalledOnce());
    // The cheap script, not the planner's whole-deck snapshot.
    expect(executeScript).toHaveBeenCalledWith(PRESENTATION_SELECTION_SOURCE, expect.anything());
    await waitFor(() =>
      expect(onSelectionChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ label: "launch.pptx · Title 1", text: "" }),
      ),
    );
  });

  /**
   * The one that makes selecting a shape open the agent: the user is still
   * looking at the shape, so waiting for them to look away is too late.
   */
  it("asks as soon as the embed says the user picked something", async () => {
    const executeScript = vi.fn(async () => ({
      result: { slideCount: 1, shapes: [{ id: "s1", name: "Title 1", type: "Placeholder" }] },
    }));
    const { onSelectionChange } = await mounted(executeScript);

    frameProps[0].onSelectionChanged?.();

    await waitFor(() => expect(executeScript).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(onSelectionChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ label: "launch.pptx · Title 1", block: true }),
      ),
    );
  });

  // Clicking past everything leaves the slide selected. That is not a block,
  // and treating it as one would unfold the agent on every stray click.
  it("does not call a bare slide selection a block", async () => {
    const executeScript = vi.fn(async () => ({ result: { slideCount: 1, shapes: [] } }));
    const { onSelectionChange } = await mounted(executeScript);

    frameProps[0].onSelectionChanged?.();

    await waitFor(() =>
      expect(onSelectionChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ label: "launch.pptx · slide selection", block: false }),
      ),
    );
  });

  it("reports nothing selected as nothing to quote", async () => {
    const executeScript = vi.fn(async () => ({ result: { slideCount: 0, shapes: [] } }));
    const { onSelectionChange } = await mounted(executeScript);

    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(onSelectionChange).toHaveBeenLastCalledWith(null));
  });

  it("stays quiet when the editor cannot answer", async () => {
    const executeScript = vi.fn(async () => {
      throw new Error("The presentation script timed out.");
    });
    const { onSelectionChange } = await mounted(executeScript);

    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(onSelectionChange).toHaveBeenLastCalledWith(null));
  });

  it("reads the shapes' text only when the message is sent", async () => {
    const executeScript = vi.fn(async (source: string) => ({
      result:
        source === PRESENTATION_SELECTION_TEXT_SOURCE
          ? {
              slideCount: 1,
              shapes: [{ id: "s1", name: "Title 1", type: "Placeholder" }],
              text: "A better everyday workspace",
            }
          : { slideCount: 1, shapes: [{ id: "s1", name: "Title 1", type: "Placeholder" }] },
    }));
    const { onResolveSelection } = await mounted(executeScript);

    const resolve = onResolveSelection.mock.calls.at(-1)![0] as () => Promise<unknown>;
    await expect(resolve()).resolves.toEqual(
      expect.objectContaining({
        label: "launch.pptx · Title 1",
        text: "A better everyday workspace",
      }),
    );
  });
});

describe("PresentationCanvas start failures", () => {
  async function mountedUnavailable() {
    const onUnavailable = vi.fn();
    render(
      <PresentationCanvas
        api={stubApi()}
        file={file()}
        onDirtyChange={noop}
        onSelectionChange={noop}
        onResolveSelection={noop}
        onController={noop}
        onEditRunner={noop}
        onUnavailable={onUnavailable}
      />,
    );
    await waitFor(() => expect(frameProps).toHaveLength(1));
    return { onUnavailable };
  }

  // The frame already names missing assets and handshake timeouts. Filling in
  // "could not start" for an empty call toasts "Not built yet" over a live deck.
  it("does not treat a cleared unavailable as a start failure", async () => {
    const { onUnavailable } = await mountedUnavailable();

    frameProps[0].onUnavailable?.(undefined);
    frameProps[0].onUnavailable?.("");
    frameProps[0].onUnavailable?.("   ");

    expect(onUnavailable).not.toHaveBeenCalled();
  });

  it("passes on what the editor said when it could not start", async () => {
    const { onUnavailable } = await mountedUnavailable();

    frameProps[0].onUnavailable?.("the runtime never reported ready");

    expect(onUnavailable).toHaveBeenCalledWith(expect.stringContaining("never reported ready"));
  });
});

/*
 * The label rules are their own thing: what the chip says is the only part of
 * this the user ever reads.
 */
describe("presentationSelectionLabel", () => {
  it("prefers PowerPoint's own name for a single shape", () => {
    expect(
      presentationSelectionLabel({
        slideCount: 1,
        shapes: [{ id: "s1", name: "Content Placeholder 2", type: "Placeholder" }],
      }),
    ).toBe("Content Placeholder 2");
  });

  it("counts several shapes rather than listing them", () => {
    expect(
      presentationSelectionLabel({
        slideCount: 1,
        shapes: [
          { id: "s1", name: "Title 1", type: "Placeholder" },
          { id: "s2", name: "Picture 3", type: "Picture" },
        ],
      }),
    ).toBe("2 shapes");
  });

  it("falls back to the slides when no shape is selected", () => {
    expect(presentationSelectionLabel({ slideCount: 1, shapes: [] })).toBe("slide selection");
    expect(presentationSelectionLabel({ slideCount: 4, shapes: [] })).toBe("4 slides");
  });

  it("has nothing to say about an empty selection", () => {
    expect(presentationSelectionLabel({ slideCount: 0, shapes: [] })).toBeNull();
  });
});
