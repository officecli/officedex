import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WriterSelectionSummary } from "../../../shared/writerProtocol";

vi.mock("../../bridge", () => ({
  officecli: {
    readArtifactFile: vi.fn(async () => ({ data: new Uint8Array([80, 75, 3, 4]), sha256: "abc" })),
    openPath: vi.fn(async () => undefined),
  },
}));

import DocxViewer from "./DocxViewer";
import { LocaleProvider } from "../../i18n";
import { WRITER_EMBED_PROTOCOL_VERSION } from "../../../shared/writerProtocol";

function mockManifest(body: unknown | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      body === null
        ? ({ ok: false, json: async () => ({}) } as Response)
        : ({ ok: true, json: async () => body } as Response),
    ),
  );
}

function renderViewer() {
  return render(
    <LocaleProvider value="en">
      <DocxViewer previewToken="token" fileName="report.docx" documentType="docx" />
    </LocaleProvider>,
  );
}

/** Impersonates the embed pushing a selection over postMessage. */
function pushSelection(frame: HTMLIFrameElement, selection: WriterSelectionSummary) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        data: { type: "writer:selection-changed", selection },
      }),
    );
  });
}

async function mountedFrame(container: HTMLElement) {
  await waitFor(() => {
    expect(container.querySelector("iframe.writer-embed-frame")).not.toBeNull();
  });
  return container.querySelector<HTMLIFrameElement>("iframe.writer-embed-frame")!;
}

// These cases query by role across the whole document, so a leaked render from
// the previous case would match twice.
afterEach(() => cleanup());

describe("DocxViewer", () => {
  it("mounts the Writer editor when the component manifest matches", async () => {
    mockManifest({ name: "writer", protocolVersion: WRITER_EMBED_PROTOCOL_VERSION });

    const { container } = renderViewer();

    await waitFor(() => {
      expect(container.querySelector("iframe.writer-embed-frame")).not.toBeNull();
    });
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("explains the fallback when the Writer component is not installed", async () => {
    mockManifest(null);

    const { container } = renderViewer();

    expect(await screen.findByRole("note")).toBeInTheDocument();
    expect(container.querySelector("iframe.writer-embed-frame")).toBeNull();
  });

  it("scopes the assistant to the whole document until Writer reports a selection", async () => {
    mockManifest({ name: "writer", protocolVersion: WRITER_EMBED_PROTOCOL_VERSION });

    const { container } = renderViewer();
    await mountedFrame(container);

    const panel = screen.getByRole("complementary", { name: "OfficeDex Agent" });
    expect(panel).toHaveTextContent("No selection");
    expect(panel.querySelector(".agent-panel__scope")).toHaveTextContent("No selection");
    expect(panel.querySelector("textarea")).toBeDisabled();
    expect(panel.querySelector(".agent-composer-actions button")).toBeDisabled();
    expect(panel).not.toHaveTextContent("Edits are saved to report.docx");
  });

  it("narrows the scope to the paragraphs Writer says are selected", async () => {
    mockManifest({ name: "writer", protocolVersion: WRITER_EMBED_PROTOCOL_VERSION });

    const { container } = renderViewer();
    const frame = await mountedFrame(container);

    pushSelection(frame, { empty: false, collapsed: false, paragraphs: 3 });
    expect(screen.getByRole("complementary", { name: "OfficeDex Agent" })).toHaveTextContent(
      "Selected: 3 paragraph(s)",
    );

    // A caret is not a selection: the scope goes back to the whole document.
    pushSelection(frame, { empty: false, collapsed: true, paragraphs: 1 });
    expect(screen.getByRole("complementary", { name: "OfficeDex Agent" })).toHaveTextContent(
      "No selection",
    );
  });

  it("says the selection is a range even before Writer resolves the paragraph count", async () => {
    mockManifest({ name: "writer", protocolVersion: WRITER_EMBED_PROTOCOL_VERSION });

    const { container } = renderViewer();
    const frame = await mountedFrame(container);

    pushSelection(frame, { empty: false, collapsed: false });
    expect(screen.getByRole("complementary", { name: "OfficeDex Agent" })).toHaveTextContent(
      "Selected: part of the document",
    );
  });

  it("offers no assistant panel when the editor itself is unavailable", async () => {
    mockManifest(null);

    renderViewer();

    expect(await screen.findByRole("note")).toBeInTheDocument();
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("refuses a Writer build that speaks a different protocol version", async () => {
    mockManifest({ name: "writer", protocolVersion: WRITER_EMBED_PROTOCOL_VERSION + 1 });

    const { container } = renderViewer();

    expect(await screen.findByRole("note")).toBeInTheDocument();
    expect(container.querySelector("iframe.writer-embed-frame")).toBeNull();
  });
});
