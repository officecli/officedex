import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { officecli } from "../bridge";
import { toast } from "../ui";
import { PreviewReadyNotice } from "./PreviewReadyNotice";

const grant = {
  token: "preview-token",
  fileName: "quarterly-review.pptx",
  documentType: "pptx",
} as const;

const artifact = {
  filePath: "/tmp/quarterly-review.pptx",
  fileName: "quarterly-review.pptx",
  documentType: "pptx",
} as const;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("PreviewReadyNotice", () => {
  it("starts expanded, reveals the file, and collapses after four seconds", async () => {
    vi.useFakeTimers();
    const reveal = vi.spyOn(officecli, "showItemInFolder").mockResolvedValue(undefined);
    render(<PreviewReadyNotice grant={grant} artifact={artifact} />);

    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getByText("quarterly-review.pptx")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show in folder" }));
    expect(reveal).toHaveBeenCalledWith("/tmp/quarterly-review.pptx");

    await act(async () => vi.advanceTimersByTime(4_000));
    expect(screen.queryByRole("button", { name: "Show in folder" })).toBeNull();
    expect(screen.getByRole("button", { name: /Show completion status/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("pauses while hovered and can be expanded again", async () => {
    vi.useFakeTimers();
    render(<PreviewReadyNotice grant={grant} artifact={artifact} />);
    const status = screen.getByRole("status");

    fireEvent.mouseEnter(status);
    await act(async () => vi.advanceTimersByTime(5_000));
    expect(screen.getByRole("button", { name: "Show in folder" })).toBeTruthy();

    fireEvent.mouseLeave(status);
    await act(async () => vi.advanceTimersByTime(4_000));
    fireEvent.click(screen.getByRole("button", { name: /Show completion status/ }));
    expect(screen.getByRole("button", { name: "Show in folder" })).toBeTruthy();
  });

  it("reports a folder reveal failure instead of silently swallowing it", async () => {
    vi.spyOn(officecli, "showItemInFolder").mockRejectedValue(new Error("permission denied"));
    const reportError = vi.spyOn(toast, "error");
    render(<PreviewReadyNotice grant={grant} artifact={artifact} />);

    fireEvent.click(screen.getByRole("button", { name: "Show in folder" }));
    await vi.waitFor(() => expect(reportError).toHaveBeenCalledWith("Could not show the file in its folder: permission denied"));
  });
});
