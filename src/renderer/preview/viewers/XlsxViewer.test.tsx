import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Artifact, PreviewGrant } from "../../../shared/types";

const canvasSave = vi.fn(async () => true);

vi.mock("../../bridge", () => ({
  officecli: { openPath: vi.fn(async () => undefined) },
}));

vi.mock("../../spreadsheet/SpreadsheetCanvas", async () => {
  const React = await import("react");
  return {
    SpreadsheetCanvas: React.forwardRef(function SpreadsheetCanvasMock(
      {
        artifact,
        grant,
        onStateChange,
      }: {
        artifact: Artifact;
        grant: PreviewGrant;
        onStateChange?: (state: string) => void;
      },
      ref: React.ForwardedRef<Record<string, unknown>>,
    ) {
      React.useImperativeHandle(ref, () => ({ save: canvasSave }));
      React.useEffect(() => {
        onStateChange?.("dirty");
      }, [onStateChange]);
      return (
        <div data-testid="spreadsheet-canvas" data-token={grant.token}>
          {artifact.fileName}
        </div>
      );
    }),
  };
});

import XlsxViewer from "./XlsxViewer";

const artifact: Artifact = {
  taskId: "task-1",
  filePath: "/tmp/forecast.xlsx",
  fileName: "forecast.xlsx",
  documentType: "xlsx",
};

const grant: PreviewGrant = {
  token: "preview-1",
  fileName: "forecast.xlsx",
  documentType: "xlsx",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("XlsxViewer", () => {
  it("opens the workbook in the sheet editor rather than a rendered snapshot", () => {
    render(
      <XlsxViewer
        previewToken={grant.token}
        fileName={artifact.fileName}
        documentType="xlsx"
        artifact={artifact}
        grant={grant}
      />,
    );

    const canvas = screen.getByTestId("spreadsheet-canvas");
    expect(canvas).toBeInTheDocument();
    expect(canvas.getAttribute("data-token")).toBe("preview-1");
    expect(screen.getByText("XLS")).toBeInTheDocument();
  });

  it("saves through the editor once it reports unsaved changes", () => {
    render(
      <XlsxViewer
        previewToken={grant.token}
        fileName={artifact.fileName}
        artifact={artifact}
        grant={grant}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(canvasSave).toHaveBeenCalledTimes(1);
  });

  it("explains itself instead of mounting an editor with nothing to save back to", () => {
    render(<XlsxViewer previewToken={grant.token} fileName="orphan.xlsx" artifact={null} grant={null} />);

    expect(screen.queryByTestId("spreadsheet-canvas")).toBeNull();
    expect(screen.getByText(/orphan\.xlsx/)).toBeInTheDocument();
  });
});
