import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { PeekReportContextResult, SubmitReportInput, SubmitReportResult } from "../../shared/types";

const mockSubmitReport = vi.fn<(input: SubmitReportInput) => Promise<SubmitReportResult>>();
const mockPeekReportContext = vi.fn<(taskId: string) => Promise<PeekReportContextResult>>();

vi.mock("../bridge", () => ({
  officecli: {
    submitReport: (input: SubmitReportInput) => mockSubmitReport(input),
    peekReportContext: (taskId: string) => mockPeekReportContext(taskId),
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
    mockPeekReportContext.mockReset();
    mockPeekReportContext.mockResolvedValue({ requestId: "req-abc-123", errorCode: "rate_limit", errorMessage: "Too many requests" });
  });

  afterEach(async () => {
    cleanup();
    // antd `message` portals schedule React work that lands after cleanup;
    // yield one macrotask so the scheduler drains before vitest tears
    // down jsdom, otherwise the late callback throws `window is not defined`.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("displays context bar with requestId from peekReportContext", async () => {
    const { ReportIssueDialog } = await import("../components/ReportIssueDialog");

    render(<ReportIssueDialog open={true} taskId="task-1" onClose={() => {}} />);

    await waitFor(() => {
      expect(mockPeekReportContext).toHaveBeenCalledWith("task-1");
    });

    const dialog = screen.getByRole("dialog");
    await waitFor(() => {
      expect(within(dialog).getByText("report.dialog.contextBar.request")).toBeTruthy();
      expect(within(dialog).getByText("report.dialog.contextBar.error")).toBeTruthy();
    });
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

  it("submit when capability enabled posts JSON payload", async () => {
    const { ReportIssueDialog } = await import("../components/ReportIssueDialog");

    mockSubmitReport.mockResolvedValue({
      ticketId: "T-123",
      requestId: "req-abc-123",
      uploaded: true,
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
      });
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("shows error on submit failure without crashing", async () => {
    const { ReportIssueDialog } = await import("../components/ReportIssueDialog");

    mockSubmitReport.mockRejectedValue(new Error("Network error"));

    render(<ReportIssueDialog open={true} taskId="task-1" onClose={() => {}} />);

    const dialog = screen.getByRole("dialog");
    const textarea = within(dialog).getByRole("textbox", { name: /report\.dialog\.description\.label/i });
    fireEvent.change(textarea, { target: { value: "Something went wrong during generation" } });

    const submitBtn = within(dialog).getByRole("button", { name: /report\.dialog\.submit/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockSubmitReport).toHaveBeenCalled();
    });
  });

  it("shows copy request ID button when context available", async () => {
    const { ReportIssueDialog } = await import("../components/ReportIssueDialog");

    render(<ReportIssueDialog open={true} taskId="task-1" onClose={() => {}} />);

    const dialog = screen.getByRole("dialog");
    await waitFor(() => {
      expect(within(dialog).getByText("report.dialog.copyRequestId")).toBeTruthy();
    });
  });

  it("does not show sections or removePrompt checkboxes", async () => {
    const { ReportIssueDialog } = await import("../components/ReportIssueDialog");

    render(<ReportIssueDialog open={true} taskId="task-1" onClose={() => {}} />);

    const dialog = screen.getByRole("dialog");
    await waitFor(() => {
      expect(within(dialog).queryByText("report.dialog.sections.settings")).toBeNull();
      expect(within(dialog).queryByText("report.dialog.removePrompt")).toBeNull();
    });
  });
});
