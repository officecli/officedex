import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("docx-preview", () => ({ renderAsync: vi.fn(async () => undefined) }));
vi.mock("../../bridge", () => ({
  officecli: {
    readArtifactFile: vi.fn(async () => ({ data: new Uint8Array([80, 75, 3, 4]) })),
    openPath: vi.fn(async () => undefined),
  },
}));
vi.mock("../../word/DocxEditor", async () => {
  const React = await import("react");
  return {
    DocxEditor: ({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) => {
      const [value, setValue] = React.useState("draft");
      return (
        <div>
          <input aria-label="mock document" value={value} onChange={(event) => { setValue(event.target.value); onDirtyChange?.(true); }} />
        </div>
      );
    },
  };
});

import DocxViewer from "./DocxViewer";

describe("DocxViewer", () => {
  it("keeps editor state and dirty status while checking the layout preview", () => {
    const onDirtyChange = vi.fn();
    render(<DocxViewer previewToken="token" fileName="report.docx" documentType="docx" onDirtyChange={onDirtyChange} />);

    fireEvent.change(screen.getByRole("textbox", { name: "mock document" }), { target: { value: "edited draft" } });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    fireEvent.click(screen.getByRole("button", { name: "版式预览" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));

    expect(screen.getByRole("textbox", { name: "mock document" })).toHaveValue("edited draft");
    expect(onDirtyChange).not.toHaveBeenCalledWith(false);
  });
});
