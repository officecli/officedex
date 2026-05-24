import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { SubmitReportInput, SubmitReportResult } from "../../shared/types";

const mockSubmitReport = vi.fn<(input: SubmitReportInput) => Promise<SubmitReportResult>>();
const mockShowItemInFolder = vi.fn<(path: string) => Promise<void>>();

vi.mock("../bridge", () => ({
  officecli: {
    submitReport: (input: SubmitReportInput) => mockSubmitReport(input),
    showItemInFolder: (path: string) => mockShowItemInFolder(path),
  },
}));

vi.mock("../i18n", () => ({
  useT: () => (key: string, vars?: Record<string, string | number>) => {
    if (!vars) return key;
    return Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), key);
  },
}));

// jsdom polyfills required by antd
const fakeStyle = new Proxy({} as CSSStyleDeclaration, {
  get(_target, prop) {
    if (prop === "getPropertyValue") return () => "";
    if (typeof prop === "string") return "";
    return undefined;
  },
});
Object.defineProperty(window, "getComputedStyle", {
  value: () => fakeStyle,
  writable: true,
  configurable: true,
});
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(window, "ResizeObserver", {
  value: ResizeObserverStub,
  writable: true,
  configurable: true,
});
window.HTMLElement.prototype.scrollIntoView = vi.fn() as unknown as typeof window.HTMLElement.prototype.scrollIntoView;
Object.defineProperty(window, "matchMedia", {
  writable: true,
  configurable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

describe("ReportIssueDialog", () => {
  beforeEach(() => {
    mockSubmitReport.mockReset();
    mockShowItemInFolder.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders all form fields when open", async () => {
    const { ReportIssueDialog } = await import("../components/ReportIssueDialog");

    render(<ReportIssueDialog open={true} onClose={() => {}} />);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("report.dialog.title")).toBeTruthy();
    expect(within(dialog).getByText("report.dialog.description.label")).toBeTruthy();
    expect(within(dialog).getByText("report.dialog.sections.settings")).toBeTruthy();
    expect(within(dialog).getByText("report.dialog.sections.events")).toBeTruthy();
    expect(within(dialog).getByText("report.dialog.sections.logs")).toBeTruthy();
    expect(within(dialog).getByText("report.dialog.sections.recent")).toBeTruthy();
    expect(within(dialog).getByText("report.dialog.removePrompt")).toBeTruthy();
  });

  it("does not render dialog content when closed", async () => {
    const { ReportIssueDialog } = await import("../components/ReportIssueDialog");

    render(<ReportIssueDialog open={false} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("validates description is required", async () => {
    const { ReportIssueDialog } = await import("../components/ReportIssueDialog");

    render(<ReportIssueDialog open={true} taskId="task-1" onClose={() => {}} />);

    const dialog = screen.getByRole("dialog");
    const submitBtn = within(dialog).getByRole("button", { name: /report\.dialog\.submit/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(within(dialog).queryByText("report.dialog.description.required")).toBeTruthy();
    });

    expect(mockSubmitReport).not.toHaveBeenCalled();
  });

  it("submits with correct input for uploaded=true", async () => {
    const { ReportIssueDialog } = await import("../components/ReportIssueDialog");

    mockSubmitReport.mockResolvedValue({
      ticketId: "T-123",
      uploaded: true,
      viewUrl: "https://example.com/tickets/T-123",
      bundlePath: "/Users/test/Downloads/bundle.zip",
      manifest: { schemaVersion: 1, bundleId: "b-123", items: [], truncated: false },
    });

    const onClose = vi.fn();
    render(<ReportIssueDialog open={true} taskId="task-42" onClose={onClose} />);

    const dialog = screen.getByRole("dialog");
    const textarea = within(dialog).getByRole("textbox", { name: /report\.dialog\.description\.label/i });
    fireEvent.change(textarea, { target: { value: "The application froze when generating a report" } });

    const submitBtn = within(dialog).getByRole("button", { name: /report\.dialog\.submit/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockSubmitReport).toHaveBeenCalledWith({
        taskId: "task-42",
        description: "The application froze when generating a report",
        contactEmail: undefined,
        exportOpts: {
          includeSettings: true,
          includeEvents: true,
          includeLogs: true,
          includeRecent: true,
        },
      });
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("submits with uploaded=false calls onClose", async () => {
    const { ReportIssueDialog } = await import("../components/ReportIssueDialog");

    mockSubmitReport.mockResolvedValue({
      ticketId: "",
      uploaded: false,
      bundlePath: "/tmp/diag.zip",
      manifest: { schemaVersion: 1, bundleId: "b-fallback", items: [], truncated: false },
    });

    const onClose = vi.fn();
    render(<ReportIssueDialog open={true} onClose={onClose} />);

    const dialog = screen.getByRole("dialog");
    const textarea = within(dialog).getByRole("textbox", { name: /report\.dialog\.description\.label/i });
    fireEvent.change(textarea, { target: { value: "Something went wrong during generation" } });

    const submitBtn = within(dialog).getByRole("button", { name: /report\.dialog\.submit/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockSubmitReport).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("shows error on submit failure without crashing", async () => {
    const { ReportIssueDialog } = await import("../components/ReportIssueDialog");

    mockSubmitReport.mockRejectedValue(new Error("Network error"));

    render(<ReportIssueDialog open={true} onClose={() => {}} />);

    const dialog = screen.getByRole("dialog");
    const textarea = within(dialog).getByRole("textbox", { name: /report\.dialog\.description\.label/i });
    fireEvent.change(textarea, { target: { value: "Something went wrong during generation" } });

    const submitBtn = within(dialog).getByRole("button", { name: /report\.dialog\.submit/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockSubmitReport).toHaveBeenCalled();
    });
  });

  it("excludes events when removePrompt is checked", async () => {
    const { ReportIssueDialog } = await import("../components/ReportIssueDialog");

    mockSubmitReport.mockResolvedValue({
      ticketId: "T-999",
      uploaded: true,
      bundlePath: "/tmp/diag.zip",
      manifest: { schemaVersion: 1, bundleId: "b-999", items: [], truncated: false },
    });

    render(<ReportIssueDialog open={true} taskId="task-5" onClose={() => {}} />);

    const dialog = screen.getByRole("dialog");
    const textarea = within(dialog).getByRole("textbox", { name: /report\.dialog\.description\.label/i });
    fireEvent.change(textarea, { target: { value: "Prompt content should be removed from report" } });

    const checkboxes = dialog.querySelectorAll<HTMLInputElement>("input[type='checkbox']");
    const removePromptCheckbox = checkboxes[checkboxes.length - 1];
    fireEvent.click(removePromptCheckbox);

    const submitBtn = within(dialog).getByRole("button", { name: /report\.dialog\.submit/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockSubmitReport).toHaveBeenCalledWith(
        expect.objectContaining({
          exportOpts: expect.objectContaining({
            includeEvents: false,
          }),
        }),
      );
    });
  });
});
