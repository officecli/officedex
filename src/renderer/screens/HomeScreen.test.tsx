import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecentFile } from "../../shared/types";
import { LocaleProvider } from "../i18n";
import { HomeScreen } from "./HomeScreen";

const files: RecentFile[] = [
  { filePath: "/tmp/generated.pptx", fileName: "Launch deck.pptx", documentType: "pptx", source: "generated", lastOpenedAt: "2026-08-05T02:00:00Z" },
  { filePath: "/tmp/forecast.xlsx", fileName: "Q3 forecast.xlsx", documentType: "xlsx", source: "local", lastOpenedAt: "2026-08-05T01:00:00Z" },
];

afterEach(cleanup);

function renderHome(overrides: Partial<React.ComponentProps<typeof HomeScreen>> = {}) {
  const props: React.ComponentProps<typeof HomeScreen> = {
    files,
    loading: false,
    onCreate: vi.fn(),
    onOpenFile: vi.fn(),
    onRemoveFile: vi.fn(),
    onOpenLocalFile: vi.fn(),
    ...overrides,
  };
  render(<LocaleProvider value="en"><HomeScreen {...props} /></LocaleProvider>);
  return props;
}

describe("HomeScreen", () => {
  it("shows five creation types and hides GIF", () => {
    const props = renderHome();
    for (const name of ["Presentation", "Word document", "Spreadsheet", "Research report", "Image"]) {
      expect(screen.getByRole("button", { name: new RegExp(name, "i") })).toBeTruthy();
    }
    expect(screen.queryByRole("button", { name: /gif/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /presentation/i }));
    expect(props.onCreate).toHaveBeenCalledWith("pptx");
  });

  it("filters recent files by source and opens the selected file", () => {
    const props = renderHome();
    fireEvent.click(screen.getByRole("tab", { name: "Local files" }));
    expect(screen.getByText("Q3 forecast.xlsx")).toBeTruthy();
    expect(screen.queryByText("Launch deck.pptx")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /open Q3 forecast.xlsx/i }));
    expect(props.onOpenFile).toHaveBeenCalledWith(expect.objectContaining({ source: "local" }));
  });

  it("sorts newest first and exposes local-open and remove actions", () => {
    const props = renderHome();
    const generatedRow = screen.getByRole("button", { name: "Open Launch deck.pptx" });
    const localRow = screen.getByRole("button", { name: "Open Q3 forecast.xlsx" });
    expect(generatedRow.compareDocumentPosition(localRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open local file" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Launch deck.pptx" }));
    expect(props.onOpenLocalFile).toHaveBeenCalledOnce();
    expect(props.onRemoveFile).toHaveBeenCalledWith("/tmp/generated.pptx");
  });

  it("keeps loading and errors local to the recent-file section", () => {
    const { rerender } = render(<LocaleProvider value="en"><HomeScreen files={[]} loading onCreate={vi.fn()} onOpenFile={vi.fn()} onRemoveFile={vi.fn()} onOpenLocalFile={vi.fn()} /></LocaleProvider>);
    expect(screen.getByText("Loading recent files…")).toBeTruthy();
    expect(screen.getByRole("button", { name: /presentation/i })).toBeTruthy();
    rerender(<LocaleProvider value="en"><HomeScreen files={[]} loading={false} error="Offline" onCreate={vi.fn()} onOpenFile={vi.fn()} onRemoveFile={vi.fn()} onOpenLocalFile={vi.fn()} /></LocaleProvider>);
    expect(screen.getByText("Offline")).toBeTruthy();
  });
});
