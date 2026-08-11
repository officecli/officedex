import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { LocaleProvider } from "../i18n";

const { readArtifactFile } = vi.hoisted(() => ({ readArtifactFile: vi.fn() }));

vi.mock("../bridge", () => ({
  officecli: { readArtifactFile },
}));

import { WorkbookAppBuilder } from "./WorkbookAppBuilder";

function workbookBytes(): Uint8Array {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Task", "Status", "Owner"],
    ["Design homepage", "In progress", "Alex"],
    ["Release beta", "Done", "Riley"],
  ]), "Tasks");
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

describe("WorkbookAppBuilder", () => {
  it("moves from workbook configuration to live preview and a published App page", async () => {
    readArtifactFile.mockResolvedValue({ data: workbookBytes() });
    const onOpenPublished = vi.fn();
    render(
      <LocaleProvider value="en">
        <WorkbookAppBuilder
          artifact={{ filePath: "/tmp/tasks.xlsx", fileName: "tasks.xlsx", documentType: "xlsx" }}
          grant={{ token: "preview-token", fileName: "tasks.xlsx", documentType: "xlsx" }}
          onClose={vi.fn()}
          onOpenPublished={onOpenPublished}
        />
      </LocaleProvider>,
    );

    await screen.findByText("Workbook data source");
    expect(screen.getAllByText("Tasks").length).toBeGreaterThan(0);
    expect(screen.getByText("3 fields · 2 records")).toBeInTheDocument();

    await waitFor(() => expect(screen.getAllByRole("button", { name: "Generate App" })[0]).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /Generate and preview/ }));
    await screen.findByText("The first version is ready and connected to this workbook.");
    expect(screen.getByRole("region", { name: "tasks App preview" })).toBeInTheDocument();
    expect(screen.getByText("Design homepage")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Publish App" }));
    await screen.findByText("Publish App page");
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await screen.findByText("App published");
    fireEvent.click(screen.getByRole("button", { name: "Open App page" }));

    await waitFor(() => expect(onOpenPublished).toHaveBeenCalledWith(expect.objectContaining({
      sourceFileName: "tasks.xlsx",
      config: expect.objectContaining({ sheetName: "Tasks", fieldIds: ["column-0", "column-1", "column-2"] }),
    })));
  });
});
