import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpreadsheetAgentPanel } from "./SpreadsheetAgentPanel";

afterEach(() => cleanup());

describe("SpreadsheetAgentPanel", () => {
  it("submits an XLSX-only generation request without legacy document controls", async () => {
    const onGenerate = vi.fn(async () => undefined);
    render(<SpreadsheetAgentPanel workspaceId="ws-1" onGenerate={onGenerate} onModify={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Spreadsheet generation request" }), { target: { value: "Build a quarterly sales forecast" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({
      documentType: "xlsx",
      generationMode: "plan",
      prompt: "Build a quarterly sales forecast",
      workspaceId: "ws-1",
    })));
    expect(screen.queryByText("GIF")).toBeNull();
    expect(screen.queryByTestId("new-generation-form")).toBeNull();
  });

  it("submits continue-modify against the open workbook", async () => {
    const onModify = vi.fn(async () => undefined);
    render(<SpreadsheetAgentPanel artifactPath="/tmp/book.xlsx" conversationId="conversation-1" sourceTaskId="task-1" onGenerate={vi.fn()} onModify={onModify} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Spreadsheet modification request" }), { target: { value: "Add a chart" } });
    fireEvent.click(screen.getByRole("button", { name: "Modify" }));
    await waitFor(() => expect(onModify).toHaveBeenCalledWith(expect.objectContaining({
      documentType: "xlsx",
      sourceFile: "/tmp/book.xlsx",
      prompt: "Add a chart",
      conversationId: "conversation-1",
      parentTaskId: "task-1",
    })));
  });
});
