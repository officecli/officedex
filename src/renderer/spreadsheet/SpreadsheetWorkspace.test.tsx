import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Artifact, PreviewGrant } from "../../shared/types";
import type { SpreadsheetSessionState } from "./types";

const canvasAddChart = vi.fn(async () => ({
  chartId: "chart-1",
  chartType: "columnClustered",
  sheetId: "sheet-1",
  sheetName: "Data",
}));
const canvasSave = vi.fn(async () => true);

vi.mock("./SpreadsheetCanvas", async () => {
  const React = await import("react");
  return {
    SpreadsheetCanvas: React.forwardRef(function SpreadsheetCanvasMock(
      { artifact }: { artifact: Artifact },
      ref: React.ForwardedRef<{ save: typeof canvasSave; focus(): void; addChart: typeof canvasAddChart }>,
    ) {
      React.useImperativeHandle(ref, () => ({
        save: canvasSave,
        focus: () => undefined,
        addChart: canvasAddChart,
      }));
      return <div data-testid="spreadsheet-canvas">{artifact.fileName}</div>;
    }),
  };
});

import { SpreadsheetWorkspace, type SpreadsheetWorkspaceHandle } from "./SpreadsheetWorkspace";

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

const readySession: SpreadsheetSessionState = {
  phase: "ready",
  workspaceId: "ws-1",
  artifact,
  grant,
  dirty: false,
};

afterEach(() => cleanup());

describe("SpreadsheetWorkspace", () => {
  it("renders the workbook, document topbar, and AI assistant without legacy dialogue surfaces", () => {
    render(
      <SpreadsheetWorkspace
        session={readySession}
        workspaceName="Client A"
        onBack={vi.fn()}
        agentPanel={<div>Spreadsheet assistant content</div>}
      />,
    );

    expect(screen.getByRole("region", { name: "forecast.xlsx workbook" })).toBeInTheDocument();
    expect(screen.getByText("Client A")).toBeInTheDocument();
    expect(screen.getAllByText("forecast.xlsx")).toHaveLength(2);
    expect(screen.getByRole("complementary", { name: "AI Assistant" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create App" })).toBeInTheDocument();
    expect(screen.queryByText("What should we work on?")).toBeNull();
    expect(screen.queryByRole("button", { name: /New chat/i })).toBeNull();
    expect(screen.queryByTestId("new-generation-form")).toBeNull();
  });

  it("collapses and restores the AI panel", () => {
    render(<SpreadsheetWorkspace session={readySession} onBack={vi.fn()} agentPanel={<div>Assistant</div>} />);

    fireEvent.click(screen.getByRole("button", { name: "Hide AI assistant" }));
    expect(screen.queryByRole("complementary", { name: "AI Assistant" })).toBeNull();
    expect(screen.getByRole("button", { name: "Show AI assistant" })).toBeInTheDocument();
  });

  it("keeps the workbook canvas mounted while App Builder is open", () => {
    render(<SpreadsheetWorkspace session={readySession} onBack={vi.fn()} agentPanel={<div>Assistant</div>} />);

    fireEvent.click(screen.getByRole("button", { name: "Create App" }));

    expect(screen.getByRole("region", { name: "App Builder" })).toBeInTheDocument();
    expect(screen.getByTestId("spreadsheet-canvas")).toHaveTextContent("forecast.xlsx");
  });

  it("shows a stable workbook placeholder before generation completes", () => {
    render(<SpreadsheetWorkspace session={{ phase: "empty", dirty: false }} onBack={vi.fn()} />);

    expect(screen.getByRole("region", { name: "Untitled workbook" })).toBeInTheDocument();
    expect(screen.getByText("Your spreadsheet will appear here")).toBeInTheDocument();
  });

  it("shows only Save failed in the topbar after a conversion failure", () => {
    render(
      <SpreadsheetWorkspace
        session={{ ...readySession, phase: "dirty", dirty: true, saveError: "export failed" }}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByText("Save failed")).toHaveAttribute("data-state", "error");
    expect(screen.queryByText("export failed")).toBeNull();
  });

  it("exposes every workbook client tool the agent runtime can call", () => {
    // App.tsx routes agent client tools straight at this handle. A method that
    // is advertised but missing fails at call time, so the surface is asserted
    // here rather than trusted to the interface alone.
    const ref = createRef<SpreadsheetWorkspaceHandle>();
    render(<SpreadsheetWorkspace ref={ref} session={readySession} onBack={vi.fn()} />);
    for (const method of ["save", "focus", "addChart"]) {
      expect(typeof ref.current?.[method]).toBe("function");
    }
  });

  it("forwards chart requests to the canvas", async () => {
    const ref = createRef<SpreadsheetWorkspaceHandle>();
    render(<SpreadsheetWorkspace ref={ref} session={readySession} onBack={vi.fn()} />);
    const request = {
      range: { row: 0, column: 0, rowCount: 5, columnCount: 2 },
      chartType: "columnClustered" as const,
    };
    await expect(ref.current?.addChart(request)).resolves.toEqual({
      chartId: "chart-1",
      chartType: "columnClustered",
      sheetId: "sheet-1",
      sheetName: "Data",
    });
    expect(canvasAddChart).toHaveBeenCalledWith(request);
  });

  it("saves pending edits before building a deck from the workbook", async () => {
    // The deck is generated from the file on disk, so an unsaved chart would
    // otherwise be missing from the slides.
    const onCreateDeck = vi.fn(async () => undefined);
    canvasSave.mockClear();
    render(
      <SpreadsheetWorkspace
        session={{ ...readySession, dirty: true }}
        onBack={vi.fn()}
        onCreateDeck={onCreateDeck}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create Deck" }));
    await waitFor(() => expect(onCreateDeck).toHaveBeenCalledWith("/tmp/forecast.xlsx"));
    expect(canvasSave).toHaveBeenCalled();
    expect(canvasSave.mock.invocationCallOrder[0]).toBeLessThan(onCreateDeck.mock.invocationCallOrder[0]);
  });

  it("does not build a deck when the pending save fails", async () => {
    const onCreateDeck = vi.fn(async () => undefined);
    canvasSave.mockClear();
    canvasSave.mockResolvedValueOnce(false);
    render(
      <SpreadsheetWorkspace
        session={{ ...readySession, dirty: true }}
        onBack={vi.fn()}
        onCreateDeck={onCreateDeck}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create Deck" }));
    await waitFor(() => expect(canvasSave).toHaveBeenCalled());
    expect(onCreateDeck).not.toHaveBeenCalled();
  });
});
