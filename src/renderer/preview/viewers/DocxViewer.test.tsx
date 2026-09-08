import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
    <LocaleProvider value="zh">
      <DocxViewer previewToken="token" fileName="report.docx" documentType="docx" />
    </LocaleProvider>,
  );
}

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

  it("refuses a Writer build that speaks a different protocol version", async () => {
    mockManifest({ name: "writer", protocolVersion: WRITER_EMBED_PROTOCOL_VERSION + 1 });

    const { container } = renderViewer();

    expect(await screen.findByRole("note")).toBeInTheDocument();
    expect(container.querySelector("iframe.writer-embed-frame")).toBeNull();
  });
});
