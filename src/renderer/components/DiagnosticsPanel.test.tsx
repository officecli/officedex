import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import type { DesktopAPI } from "../../shared/types";
import { toast } from "../ui";

const mockExportLogs = vi.fn();

vi.mock("../bridge", () => ({
  officecli: new Proxy({} as DesktopAPI, {
    get(_target, prop) {
      if (prop === "exportLogs") return mockExportLogs;
      return vi.fn();
    },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("DiagnosticsPanel", () => {
  it("renders with export button and description", () => {
    render(<DiagnosticsPanel />);
    expect(screen.getByText("Diagnostics")).toBeTruthy();
    expect(screen.getByText("Export diagnostic logs")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Test provider" })).toBeTruthy();
    expect(screen.queryByText("diagnostics.providerTest.button")).toBeNull();
    expect(screen.getByText(/report an issue/i)).toBeTruthy();
  });

  it("calls exportLogs on button click and shows success", async () => {
    const success = vi.spyOn(toast, "success").mockImplementation(() => "toast-success");
    mockExportLogs.mockResolvedValueOnce({
      path: "/Users/test/Downloads/diag-bundle.zip",
      manifest: {
        schemaVersion: 1,
        bundleId: "test-bundle",
        items: [],
        truncated: false,
      },
    });

    render(<DiagnosticsPanel />);
    const button = screen.getByRole("button", { name: /Export diagnostic logs/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockExportLogs).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(success).toHaveBeenCalledWith(
        expect.stringContaining("/Users/test/Downloads/diag-bundle.zip"),
      );
    });
  });

  it("shows error message on export failure", async () => {
    const error = vi.spyOn(toast, "error").mockImplementation(() => "toast-error");
    mockExportLogs.mockRejectedValueOnce(new Error("disk full"));

    render(<DiagnosticsPanel />);
    const button = screen.getByRole("button", { name: /Export diagnostic logs/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(error).toHaveBeenCalledWith("disk full");
    });
  });
});
