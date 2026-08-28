import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopTask, RecentFile } from "../../shared/types";
import { LocaleProvider } from "../i18n";
import { HomeScreen } from "./HomeScreen";

const files: RecentFile[] = [
  { filePath: "/tmp/generated.pptx", fileName: "Launch deck.pptx", documentType: "pptx", source: "generated", lastOpenedAt: "2026-08-05T02:00:00Z" },
  { filePath: "/tmp/forecast.xlsx", fileName: "Q3 forecast.xlsx", documentType: "xlsx", source: "local", lastOpenedAt: "2026-08-05T01:00:00Z" },
];

const attentionTasks: DesktopTask[] = [{
  id: "task-review",
  conversationId: "task-review",
  status: "plan_review",
  documentType: "pptx",
  topic: "Client proposal",
  events: [],
  plan: { id: "plan-a", markdown: "# Plan", revision: 1 },
}];

afterEach(cleanup);

function renderHome(overrides: Partial<React.ComponentProps<typeof HomeScreen>> = {}, locale: "en" | "zh" = "en") {
  const props: React.ComponentProps<typeof HomeScreen> = {
    files,
    loading: false,
    onCreate: vi.fn(),
    onOpenFile: vi.fn(),
    onRemoveFile: vi.fn(),
    onPickTaskFile: vi.fn(),
    onPickTaskDirectory: vi.fn(),
    onAnalyzeTask: vi.fn(async (input) => ({ ...input, kind: "generate" as const, documentType: "pptx" as const, nextStep: "plan" as const })),
    onStartTask: vi.fn(),
    onOpenTask: vi.fn(),
    onRetryTask: vi.fn(),
    ...overrides,
  };
  render(<LocaleProvider value={locale}><HomeScreen {...props} /></LocaleProvider>);
  return props;
}

describe("HomeScreen", () => {
  it("keeps the brand in the sidebar only and renders the intake controls, gallery, and recent rows", () => {
    renderHome();

    expect(document.querySelector(".home-brand-lockup")).toBeNull();
    expect(screen.getByRole("group", { name: "Output type" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Select working directory" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Technology Product Launch" })).toBeTruthy();
    expect(document.querySelectorAll(".doc-type-chip")).toHaveLength(2);
    expect(document.querySelector(".doc-type-chip.doc-type--pptx")).toBeTruthy();
    expect(document.querySelector(".doc-type-chip.doc-type--xlsx")).toBeTruthy();
  });

  it("uses 从范例开始 wording for the Chinese homepage case section", () => {
    renderHome({}, "zh");
    expect(screen.getByText("用一句话、一份资料或一个优秀案例，开始制作幻灯片、图片、文档或表格。")).toBeTruthy();
    expect(screen.getByRole("region", { name: "从范例开始" })).toBeTruthy();
  });

  it("defaults to PPTX and shows templates only for the selected output type", () => {
    renderHome();
    expect(screen.getByRole("button", { name: "PPTX" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Technology Product Launch" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Product Image Set" })).toBeNull();
    expect(document.querySelector('img[src="/home-cases/pptx/tech-product-launch.webp"]')).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Image" }));
    expect(screen.getByRole("button", { name: "Image" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Product Image Set" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Technology Product Launch" })).toBeNull();
  });

  it("uses a template to prefill the prompt without starting the task", () => {
    const props = renderHome();
    fireEvent.click(screen.getByRole("button", { name: "Brand Product Launch" }));
    expect(screen.getByRole("textbox", { name: "Describe the result you want" })).toHaveValue("Create a brand product launch covering the product story, key benefits, visual direction, and go-to-market plan.");
    expect(props.onAnalyzeTask).not.toHaveBeenCalled();
    expect(props.onStartTask).not.toHaveBeenCalled();
  });

  it("shows a task review before starting from the result prompt", async () => {
    const props = renderHome();
    fireEvent.change(screen.getByRole("textbox", { name: "Describe the result you want" }), { target: { value: "Clean this supplier catalog" } });
    fireEvent.click(screen.getByRole("button", { name: "Start creating" }));
    expect(await screen.findByRole("heading", { name: "Confirm the task scope" })).toBeTruthy();
    expect(props.onStartTask).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Create execution plan" }));
    await waitFor(() => expect(props.onStartTask).toHaveBeenCalledWith({ prompt: "Clean this supplier catalog", documentType: "pptx" }));
  });

  it("starts a clear generation request without showing the full review card", async () => {
    let resolveStart!: () => void;
    const onStartTask = vi.fn(() => new Promise<void>((resolve) => { resolveStart = resolve; }));
    renderHome({
      onStartTask,
      onAnalyzeTask: vi.fn(async (input) => ({ ...input, kind: "generate" as const, documentType: "pptx" as const, nextStep: "execute" as const })),
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Describe the result you want" }), { target: { value: "Create a launch deck" } });
    fireEvent.click(screen.getByRole("button", { name: "Start creating" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Starting production");
    expect(screen.queryByRole("heading", { name: "Confirm the task scope" })).toBeNull();
    expect(onStartTask).toHaveBeenCalledWith({ prompt: "Create a launch deck", documentType: "pptx" });
    resolveStart();
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("shows immediate starting feedback while the task request is in flight", async () => {
    let resolveStart!: () => void;
    const onStartTask = vi.fn(() => new Promise<void>((resolve) => { resolveStart = resolve; }));
    renderHome({ onStartTask });
    fireEvent.change(screen.getByRole("textbox", { name: "Describe the result you want" }), { target: { value: "Create a launch deck" } });
    fireEvent.click(screen.getByRole("button", { name: "Start creating" }));
    fireEvent.click(await screen.findByRole("button", { name: /Create execution plan|Confirm and start/ }));
    expect(await screen.findByRole("status")).toHaveTextContent("Starting");
    expect(screen.getByRole("button", { name: /Create execution plan|Confirm and start/ })).toBeDisabled();
    resolveStart();
    await waitFor(() => expect(onStartTask).toHaveBeenCalledTimes(1));
  });

  it("binds an added file to the task instead of opening it", async () => {
    const onPickTaskFile = vi.fn(async () => "/tmp/supplier.xlsx");
    const props = renderHome({
      onPickTaskFile,
      onAnalyzeTask: vi.fn(async (input) => ({ ...input, kind: "catalog_cleanup" as const, documentType: "xlsx" as const, nextStep: "configure" as const })),
    });
    fireEvent.click(screen.getByRole("button", { name: "Add reference" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Reference file/ }));
    expect(await screen.findByText("supplier.xlsx")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Describe the result you want" }), { target: { value: "Clean for Shopify import" } });
    fireEvent.click(screen.getByRole("button", { name: "Start creating" }));
    expect(await screen.findByText("XLSX workbook")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Configure task" }));
    await waitFor(() => expect(props.onStartTask).toHaveBeenCalledWith({
      prompt: "Clean for Shopify import",
      sourceFile: "/tmp/supplier.xlsx",
      documentType: "xlsx",
    }));
  });

  it("keeps the intake in place when analysis needs more input", async () => {
    renderHome({ onAnalyzeTask: vi.fn(async () => { throw new Error("Add the source workbook first"); }) });
    fireEvent.change(screen.getByRole("textbox", { name: "Describe the result you want" }), { target: { value: "Clean for Shopify import" } });
    fireEvent.click(screen.getByRole("button", { name: "Start creating" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Add the source workbook first");
    expect(screen.getByDisplayValue("Clean for Shopify import")).toBeTruthy();
  });

  it("shows file picker failures inside the task intake", async () => {
    renderHome({ onPickTaskFile: vi.fn(async () => { throw new Error("File picker timed out"); }) });
    fireEvent.click(screen.getByRole("button", { name: "Add reference" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Reference file/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("File picker timed out");
  });

  it("opens recent files and keeps remove and local-open actions available", () => {
    const props = renderHome();
    expect(screen.getByText("Launch deck.pptx")).toBeTruthy();
    expect(screen.getByText("Q3 forecast.xlsx")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /open Q3 forecast.xlsx/i }));
    expect(props.onOpenFile).toHaveBeenCalledWith(expect.objectContaining({ source: "local" }));
    const generatedRow = screen.getByRole("button", { name: "Open Launch deck.pptx" });
    const localRow = screen.getByRole("button", { name: "Open Q3 forecast.xlsx" });
    expect(generatedRow.compareDocumentPosition(localRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove Launch deck.pptx" }));
    expect(screen.queryByRole("button", { name: "Open local file" })).toBeNull();
    expect(props.onRemoveFile).toHaveBeenCalledWith("/tmp/generated.pptx");
  });

  it("keeps the attention list to decisions and shows running work as a live card", () => {
    const runningTask: DesktopTask = { ...attentionTasks[0], id: "task-running", conversationId: "task-running", status: "running", topic: "Running task", plan: undefined };
    const props = renderHome({ attentionTasks: [...attentionTasks, runningTask] });
    const attention = screen.getByRole("region", { name: /Needs your attention/i });
    expect(within(attention).getByText("Client proposal")).toBeTruthy();
    // Running work is not a decision, so it stays out of the attention list —
    // it rides in Recent instead, where its result will land.
    expect(within(attention).queryByText("Running task")).toBeNull();
    expect(document.querySelector(".home-task-row--running")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open task Running task" })).toBeTruthy();

    fireEvent.click(within(attention).getByRole("button", { name: /Client proposal/i }));
    expect(props.onOpenTask).toHaveBeenCalledWith("task-review");
  });

  it("offers retry and dismiss on a failed task card", () => {
    const failedTask: DesktopTask = {
      id: "task-failed", conversationId: "task-failed", status: "failed", documentType: "pptx",
      topic: "Broken deck", error: "render failed: layout validation",
      events: [{ event_id: "e1", task_id: "task-failed", type: "task.failed", ts: new Date().toISOString(), payload: {} }],
    };
    const props = renderHome({ attentionTasks: [failedTask] });
    expect(document.querySelector(".home-task-row--failed")).toBeTruthy();
    expect(screen.getByText("render failed: layout validation")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(props.onRetryTask).toHaveBeenCalledWith(expect.objectContaining({ id: "task-failed" }));

    fireEvent.click(screen.getByRole("button", { name: "Dismiss Broken deck" }));
    expect(document.querySelector(".home-task-row--failed")).toBeNull();
  });

  it("ages stale failures off the home page", () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    renderHome({ attentionTasks: [{
      id: "task-old", conversationId: "task-old", status: "failed", documentType: "pptx",
      topic: "Ancient failure", error: "boom",
      events: [{ event_id: "e0", task_id: "task-old", type: "task.failed", ts: eightDaysAgo, payload: {} }],
    }] });
    // Still listed on the tasks page, but the front door stays clean.
    expect(document.querySelector(".home-task-row--failed")).toBeNull();
    expect(screen.queryByText("Ancient failure")).toBeNull();
  });

  it("keeps loading and errors local to the recent-file section", () => {
    const retry = vi.fn();
    const { rerender } = render(<LocaleProvider value="en"><HomeScreen files={[]} loading onCreate={vi.fn()} onOpenFile={vi.fn()} onRemoveFile={vi.fn()} onRetryRecentFiles={retry} /></LocaleProvider>);
    expect(screen.getByText("Loading recent files…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "PPTX" })).toBeTruthy();
    rerender(<LocaleProvider value="en"><HomeScreen files={[]} loading={false} error="Offline" onCreate={vi.fn()} onOpenFile={vi.fn()} onRemoveFile={vi.fn()} onRetryRecentFiles={retry} /></LocaleProvider>);
    expect(screen.getByText("Offline")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
