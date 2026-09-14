import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopTask, RecentFile } from "../../shared/types";
import { LocaleProvider } from "../i18n";
import { toast } from "../ui";
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
    onOpenLocalFile: vi.fn(),
    onRemoveFile: vi.fn(),
    pickers: { taskFile: vi.fn(), taskDirectory: vi.fn(), referenceImages: vi.fn(async () => []) },
    onStartTask: vi.fn(),
    taskActions: { open: vi.fn(), retry: vi.fn() },
    ...overrides,
  };
  render(<LocaleProvider value={locale}><HomeScreen {...props} /></LocaleProvider>);
  return props;
}

describe("HomeScreen", () => {
  it.each([0, 1, 2])("submits advanced mode only while enabled (%i toggles)", async (toggles) => {
    const info = vi.spyOn(toast, "info").mockReturnValue("mode-toast");
    try {
      const props = renderHome();
      const checkbox = screen.getByRole("checkbox", { name: "Advanced mode" });
      expect(checkbox).not.toBeChecked();
      for (let index = 0; index < toggles; index++) fireEvent.click(checkbox);
      fireEvent.change(screen.getByRole("textbox", { name: "Describe the result you want" }), { target: { value: "Make a launch deck" } });
      fireEvent.click(screen.getByRole("button", { name: "Start creating" }));
      await waitFor(() => expect(props.onStartTask).toHaveBeenCalledWith({
        prompt: "Make a launch deck", documentType: "pptx", ...(toggles === 1 ? { advancedMode: true } : {}),
      }));
    } finally { info.mockRestore(); }
  });

  it("updates mode text after switching language without resetting the selected mode", () => {
    const info = vi.spyOn(toast, "info").mockReturnValue("mode-toast");
    const home = <HomeScreen files={[]} loading={false} onOpenFile={vi.fn()} onCreate={vi.fn()} onRemoveFile={vi.fn()} />;
    const view = render(<LocaleProvider value="en">{home}</LocaleProvider>);
    fireEvent.click(screen.getByRole("checkbox", { name: "Advanced mode" }));
    view.rerender(<LocaleProvider value="zh">{home}</LocaleProvider>);
    const checkbox = screen.getByRole("checkbox", { name: "高级模式" });
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(info).toHaveBeenLastCalledWith({ key: "home-mode", content: "高级模式已关闭 · 直接生成" });
    info.mockRestore();
  });

  it.each(["en", "zh"] as const)("localizes the mode control and switch notifications in %s", (locale) => {
    const info = vi.spyOn(toast, "info").mockReturnValue("mode-toast");
    renderHome({}, locale);
    const label = locale === "en" ? "Advanced mode" : "高级模式";
    const checkbox = screen.getByRole("checkbox", { name: label });
    expect(info).not.toHaveBeenCalled();
    expect(document.querySelector(".home-intake__advanced-mode small")).toBeNull();
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(info).toHaveBeenLastCalledWith({ key: "home-mode", content: locale === "en"
      ? "Advanced mode on · Review plan first"
      : "高级模式已开启 · 先确认计划" });
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
    expect(info).toHaveBeenLastCalledWith({ key: "home-mode", content: locale === "en"
      ? "Advanced mode off · Generate directly"
      : "高级模式已关闭 · 直接生成" });
    info.mockRestore();
  });

  it("keeps the brand in the sidebar only and renders the intake controls, gallery, and recent rows", () => {
    renderHome();

    expect(document.querySelector(".home-brand-lockup")).toBeNull();
    expect(screen.getByRole("group", { name: "Output type" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Select working directory" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Technology Product Launch" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start creating" })).toHaveClass("od-button--circular-submit");
    expect(document.querySelectorAll(".doc-type-chip")).toHaveLength(2);
    expect(document.querySelector(".doc-type-chip.doc-type--pptx")).toBeTruthy();
    expect(document.querySelector(".doc-type-chip.doc-type--xlsx")).toBeTruthy();
  });

  it("uses 从范例开始 wording for the Chinese homepage case section", () => {
    renderHome({}, "zh");
    expect(screen.getByText("描述想法、添加文件，或从范例开始。")).toBeTruthy();
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
    expect(props.onStartTask).not.toHaveBeenCalled();
  });

  it("leads the PPTX examples with the NexaEdge replay and drops the sample download", () => {
    const onReplayPptxDemo = vi.fn();
    renderHome({ onReplayPptxDemo });

    const firstCard = document.querySelector(".home-template-grid .home-template-card");
    expect(firstCard).toHaveClass("home-template-card--demo");
    expect(screen.queryByText("Download sample PPT")).toBeNull();
    expect(document.querySelector(".home-pptx-demo")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Watch PPT generation" }));
    expect(onReplayPptxDemo).toHaveBeenCalledTimes(1);
    // It is a PPTX example, so it leaves with the PPTX rail.
    fireEvent.click(screen.getByRole("button", { name: "Image" }));
    expect(screen.queryByRole("button", { name: "Watch PPT generation" })).toBeNull();
  });

  it("holds the NexaEdge replay card while its recording loads", () => {
    const onReplayPptxDemo = vi.fn();
    renderHome({ onReplayPptxDemo, replayPptxDemoLoading: true });

    const card = screen.getByRole("button", { name: "Watch PPT generation" });
    expect(card).toBeDisabled();
    expect(within(card).getByText("Preparing the drawing…")).toBeTruthy();
    fireEvent.click(card);
    expect(onReplayPptxDemo).not.toHaveBeenCalled();
  });

  it("keeps image controls in Home and removes GIF output", async () => {
    const onPickReferenceImages = vi.fn(async () => ["/tmp/product.png"]);
    const props = renderHome({ pickers: { referenceImages: onPickReferenceImages } });
    fireEvent.click(screen.getByRole("button", { name: "Image" }));
    fireEvent.click(screen.getByRole("button", { name: /Add reference|Add source or reference/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Reference images/ }));
    expect(await screen.findByText("product.png")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Landscape" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Describe the result you want" }), { target: { value: "Create a product image" } });
    fireEvent.click(screen.getByRole("button", { name: "Start creating" }));
    await waitFor(() => expect(props.onStartTask).toHaveBeenCalledWith(expect.objectContaining({
      documentType: "img", referenceImages: ["/tmp/product.png"], imageRatio: "landscape",
    })));

    expect(screen.queryByRole("button", { name: "GIF" })).toBeNull();
  });

  it("starts directly and leaves progressive review to the production stage", async () => {
    const props = renderHome();
    fireEvent.change(screen.getByRole("textbox", { name: "Describe the result you want" }), { target: { value: "Clean this supplier catalog" } });
    fireEvent.click(screen.getByRole("button", { name: "Start creating" }));
    await waitFor(() => expect(props.onStartTask).toHaveBeenCalledWith({ prompt: "Clean this supplier catalog", documentType: "pptx" }));
  });

  it("keeps IME Enter inside the Chinese input method instead of starting a task", async () => {
    const props = renderHome();
    const prompt = screen.getByRole("textbox", { name: "Describe the result you want" });
    fireEvent.change(prompt, { target: { value: "如ru'tu" } });

    fireEvent.keyDown(prompt, { key: "Enter", keyCode: 229, which: 229 });

    expect(props.onStartTask).not.toHaveBeenCalled();
    fireEvent.keyDown(prompt, { key: "Enter", keyCode: 13, which: 13 });
    await waitFor(() => expect(props.onStartTask).toHaveBeenCalledWith({ prompt: "如ru'tu", documentType: "pptx" }));
  });

  it("starts a clear generation request without showing the full review card", async () => {
    let resolveStart!: () => void;
    const onStartTask = vi.fn(() => new Promise<void>((resolve) => { resolveStart = resolve; }));
    renderHome({
      onStartTask,
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
    expect(await screen.findByRole("status")).toHaveTextContent("Starting");
    expect(screen.getByRole("button", { name: "Start creating" })).toBeDisabled();
    resolveStart();
    await waitFor(() => expect(onStartTask).toHaveBeenCalledTimes(1));
  });

  it("binds an added file to the task instead of opening it", async () => {
    const onPickTaskFile = vi.fn(async () => "/tmp/supplier.xlsx");
    const props = renderHome({
      pickers: { taskFile: onPickTaskFile },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add reference" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Reference file/ }));
    expect(await screen.findByText("supplier.xlsx")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Describe the result you want" }), { target: { value: "Clean for Shopify import" } });
    fireEvent.click(screen.getByRole("button", { name: "Start creating" }));
    fireEvent.click(screen.getByRole("button", { name: "Start creating" }));
    await waitFor(() => expect(props.onStartTask).toHaveBeenCalledWith({
      prompt: "Clean for Shopify import",
      sourceFile: "/tmp/supplier.xlsx",
      documentType: "xlsx",
    }));
  });

  it("opens a local file directly from the top of the reference menu", async () => {
    const props = renderHome();
    fireEvent.click(screen.getByRole("button", { name: "Add reference" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Open file/ }));
    expect(props.onOpenLocalFile).toHaveBeenCalledTimes(1);
    expect(props.pickers?.taskFile).not.toHaveBeenCalled();
  });

  it("keeps the intake in place when analysis needs more input", async () => {
    renderHome({ onStartTask: vi.fn(async () => { throw new Error("Add the source workbook first"); }) });
    fireEvent.change(screen.getByRole("textbox", { name: "Describe the result you want" }), { target: { value: "Clean for Shopify import" } });
    fireEvent.click(screen.getByRole("button", { name: "Start creating" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Add the source workbook first");
    expect(screen.getByDisplayValue("Clean for Shopify import")).toBeTruthy();
  });

  it("shows file picker failures inside the task intake", async () => {
    renderHome({ pickers: { taskFile: vi.fn(async () => { throw new Error("File picker timed out"); }) } });
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

  it("keeps the attention list to decisions", () => {
    const runningTask: DesktopTask = { ...attentionTasks[0], id: "task-running", conversationId: "task-running", status: "running", topic: "Running task", plan: undefined };
    const props = renderHome({ attentionTasks: [...attentionTasks, runningTask] });
    const attention = screen.getByRole("region", { name: /Needs your attention/i });
    expect(within(attention).getByText("Client proposal")).toBeTruthy();
    // Running work is not a decision, so it stays out of the attention list.
    expect(within(attention).queryByText("Running task")).toBeNull();

    fireEvent.click(within(attention).getByRole("button", { name: /Client proposal/i }));
    expect(props.taskActions?.open).toHaveBeenCalledWith("task-review");
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


it("submits the animation workflow explicitly and drops it for other document types", async () => {
  const props = renderHome();
  fireEvent.click(screen.getByRole("button", { name: "Animated PPT" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Describe the result you want" }), {target:{value:"Introduce three benefits"}});
  fireEvent.click(screen.getByRole("button", {name:"Start creating"}));
  await waitFor(()=>expect(props.onStartTask).toHaveBeenCalledWith(expect.objectContaining({documentType:"pptx",pptxWorkflow:"animation"})));
  fireEvent.click(screen.getByRole("button", {name:"Image"}));
  fireEvent.click(screen.getByRole("button", {name:"Start creating"}));
  await waitFor(()=>expect(props.onStartTask).toHaveBeenCalledTimes(2));
  expect(vi.mocked(props.onStartTask!).mock.calls[1][0]).not.toHaveProperty("pptxWorkflow");
});
