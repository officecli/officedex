import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopTask } from "../../shared/types";
import { LocaleProvider } from "../i18n";
import { ProgressivePptxStage } from "./ProgressivePptxStage";

function task(overrides: Partial<DesktopTask> = {}): DesktopTask { return { id: "task-1", conversationId: "c-1", status: "starting", events: [], ...overrides }; }

describe("ProgressivePptxStage", () => {
  afterEach(cleanup);
  it("reveals an editable brief before any op arrives", () => {
    const onBriefChange = vi.fn();
    render(<ProgressivePptxStage task={task({ status: "question", topic: "运营汇报", userInput: { prompt: "制作一份 6 页运营汇报" } })} onBriefChange={onBriefChange} />);
    expect(screen.getByTestId("progressive-disclosure")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Presentation brief" })).toHaveValue("制作一份 6 页运营汇报");
    fireEvent.change(screen.getByRole("textbox", { name: "Presentation brief" }), { target: { value: "改成面向管理层" } });
    expect(onBriefChange).toHaveBeenCalledWith("改成面向管理层");
  });
  it("shows outline intervention and starts drawing explicitly", async () => {
    const onStartDrawing = vi.fn();
    const taskWithOutline = task({ status: "plan_review", plan: { id: "p", markdown: "outline", revision: 1 }, vibeTree: { stage: "refined_ready", tree: { id: "t", rootId: "r", title: "Deck", nodes: [{ id: "s1", kind: "slide", title: "现状" }] }, actions: [] } });
    render(<ProgressivePptxStage task={taskWithOutline} onStartDrawing={onStartDrawing} />);
    expect(screen.getByRole("textbox", { name: /Section 1 title|第 1 部分标题/ })).toHaveValue("现状");
    fireEvent.click(screen.getByRole("button", { name: /确认大纲并开始绘制|Confirm outline and start drawing/i }));
    expect(onStartDrawing).toHaveBeenCalledOnce();
  });
  it("renders every headline from the runtime vibe outline", () => {
    const taskWithVibeOutline = task({
      status: "plan_review",
      plan: { id: "p", markdown: "outline", revision: 1 },
      vibeOutline: {
        slides: [
          { id: "s1", headline: "Launch context", intent: "Set the stage" },
          { id: "s2", headline: "Product capabilities", takeawayHint: "Show the value" },
          { id: "s3", headline: "Launch milestones" },
        ],
      },
    } as unknown as Partial<DesktopTask> & { vibeOutline: unknown });

    render(<ProgressivePptxStage task={taskWithVibeOutline} />);

    expect(screen.getByRole("textbox", { name: "Section 1 title" })).toHaveValue("Launch context");
    expect(screen.getByRole("textbox", { name: "Section 2 title" })).toHaveValue("Product capabilities");
    expect(screen.getByRole("textbox", { name: "Section 3 title" })).toHaveValue("Launch milestones");
    expect(screen.getByText("Set the stage")).toBeInTheDocument();
    expect(screen.getByText("Show the value")).toBeInTheDocument();
  });
  it("submits stable source slide numbers after outline edits", () => {
    const onStartDrawing = vi.fn();
    const taskWithVibeOutline = task({
      status: "plan_review",
      plan: { id: "p", markdown: "outline", revision: 1 },
      vibeOutline: { slides: [{ id: "s1", headline: "第一页" }, { id: "s2", headline: "第二页" }] },
    } as Partial<DesktopTask> & { vibeOutline: unknown });
    render(<ProgressivePptxStage task={taskWithVibeOutline} onStartDrawing={onStartDrawing} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Section 1 title" }), { target: { value: "修改第一页" } });
    fireEvent.click(screen.getByRole("button", { name: /确认大纲并开始绘制|Confirm outline and start drawing/i }));
    expect(onStartDrawing).toHaveBeenCalledOnce();
    expect(onStartDrawing.mock.calls[0][0]).toEqual([
      expect.objectContaining({ id: "s1", title: "修改第一页", slide: 1 }),
      expect.objectContaining({ id: "s2", title: "第二页", slide: 2 }),
    ]);
  });
  it("replaces a same-length outline when a newer runtime event arrives", () => {
    const first = task({
      status: "running",
      plan: { id: "p", markdown: "outline", revision: 1 },
      vibeOutline: { slides: [{ id: "s1", headline: "Draft context" }, { id: "s2", headline: "Draft plan" }] },
    });
    const { rerender } = render(<ProgressivePptxStage task={first} />);
    expect(screen.getByDisplayValue("Draft context")).toBeInTheDocument();

    rerender(<ProgressivePptxStage task={{
      ...first,
      vibeOutline: { slides: [{ id: "s1", headline: "Confirmed context" }, { id: "s2", headline: "Confirmed plan" }] },
    }} />);

    expect(screen.getByDisplayValue("Confirmed context")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Confirmed plan")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Draft context")).toBeNull();
  });
  it("scrolls to the latest outline section once review becomes available", async () => {
    const first = task({
      status: "running",
      plan: { id: "p", markdown: "outline", revision: 1 },
      vibeOutline: { slides: [{ id: "s1", headline: "Context" }, { id: "s2", headline: "Plan" }] },
    });
    const { container, rerender } = render(<ProgressivePptxStage task={first} />);
    const content = container.querySelector<HTMLDivElement>(".progressive-pptx-stage__content-scroll");
    if (!content) throw new Error("outline content scroller not found");
    Object.defineProperty(content, "scrollHeight", { configurable: true, value: 1200 });
    Object.defineProperty(content, "clientHeight", { configurable: true, value: 480 });
    const scrollTo = vi.fn();
    content.scrollTo = scrollTo;

    rerender(<ProgressivePptxStage task={{ ...first, status: "plan_review" }} />);
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 1200, behavior: "smooth" }));

    rerender(<ProgressivePptxStage task={{ ...first, status: "plan_review" }} />);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });
  it("keeps following outline items appended after the review gate", async () => {
    const first = task({
      status: "plan_review",
      plan: { id: "p", markdown: "outline", revision: 1 },
      vibeOutline: { slides: [{ id: "s1", headline: "Context" }] },
    });
    const { container, rerender } = render(<ProgressivePptxStage task={first} />);
    const content = container.querySelector<HTMLDivElement>(".progressive-pptx-stage__content-scroll");
    if (!content) throw new Error("outline content scroller not found");
    Object.defineProperty(content, "scrollHeight", { configurable: true, value: 1200 });
    const scrollTo = vi.fn();
    content.scrollTo = scrollTo;
    await waitFor(() => expect(scrollTo).toHaveBeenCalledTimes(1));

    rerender(<ProgressivePptxStage task={{ ...first, vibeOutline: { slides: [
      { id: "s1", headline: "Context" },
      { id: "s2", headline: "Plan" },
    ] } } as DesktopTask & { vibeOutline: unknown } } />);
    await waitFor(() => expect(scrollTo).toHaveBeenCalledTimes(2));
  });
  it("follows an outline gate delivered as a question", async () => {
    const taskWithGate = task({
      status: "question",
      plan: { id: "p", markdown: "outline", revision: 1 },
      question: { id: "pptx-outline-gate", question: "Review the outline", options: [], allowFreeform: false },
      vibeOutline: { slides: [{ id: "s1", headline: "Context" }, { id: "s2", headline: "Plan" }] },
    } as Partial<DesktopTask> & { vibeOutline: unknown });
    (taskWithGate.question as DesktopTask["question"] & { kind: string }).kind = "pptx_outline_gate";
    const { container } = render(<ProgressivePptxStage task={taskWithGate} />);
    const content = container.querySelector<HTMLDivElement>(".progressive-pptx-stage__content-scroll");
    if (!content) throw new Error("outline content scroller not found");
    Object.defineProperty(content, "scrollHeight", { configurable: true, value: 1200 });
    const scrollTo = vi.fn();
    content.scrollTo = scrollTo;
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 1200, behavior: "smooth" }));
  });
  it("stops following when the user scrolls up", async () => {
    const first = task({
      status: "plan_review",
      plan: { id: "p", markdown: "outline", revision: 1 },
      vibeOutline: { slides: [{ id: "s1", headline: "Context" }] },
    });
    const { container, rerender } = render(<ProgressivePptxStage task={first} />);
    const content = container.querySelector<HTMLDivElement>(".progressive-pptx-stage__content-scroll");
    if (!content) throw new Error("outline content scroller not found");
    Object.defineProperty(content, "scrollHeight", { configurable: true, value: 1200 });
    const scrollTo = vi.fn();
    content.scrollTo = scrollTo;
    await waitFor(() => expect(scrollTo).toHaveBeenCalledTimes(1));
    fireEvent.wheel(content, { deltaY: -100 });

    rerender(<ProgressivePptxStage task={{ ...first, vibeOutline: { slides: [
      { id: "s1", headline: "Context" },
      { id: "s2", headline: "Plan" },
    ] } } as DesktopTask & { vibeOutline: unknown } } />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });
  it("shows chapter sections instead of flattening every slide", () => {
    render(<ProgressivePptxStage task={task({ status: "plan_review", plan: { id: "p", markdown: "outline", revision: 1 }, vibeTree: { stage: "outline_ready", tree: { id: "t", rootId: "r", title: "Deck", nodes: [
      { id: "b1", kind: "branch", title: "背景与问题", summary: "说明为什么现在要解决" },
      ...Array.from({ length: 24 }, (_, index) => ({ id: `s${index}`, parentId: "b1", kind: "slide", title: `页面 ${index + 1}` })),
      { id: "b2", kind: "branch", title: "方案与落地", summary: "说明怎么做" },
    ] }, actions: [] } })} />);
    expect(screen.getAllByRole("textbox")).toHaveLength(3);
    expect(screen.getByRole("textbox", { name: /Section 1 title|第 1 部分标题/ })).toHaveValue("背景与问题");
    expect(screen.getByRole("textbox", { name: /Section 2 title|第 2 部分标题/ })).toHaveValue("方案与落地");
    expect(screen.queryByDisplayValue("页面 24")).toBeNull();
  });
  it("caps legacy ungrouped slide outlines at a readable section count", () => {
    render(<ProgressivePptxStage task={task({ status: "plan_review", plan: { id: "p", markdown: "outline", revision: 1 }, vibeTree: { stage: "refined_ready", tree: { id: "t", rootId: "r", title: "Deck", nodes: Array.from({ length: 30 }, (_, index) => ({ id: `s${index}`, kind: "slide", title: `页面 ${index + 1}` })) }, actions: [] } })} />);
    expect(screen.getAllByRole("textbox").length).toBeLessThanOrEqual(9); // brief + at most eight sections
  });
  it("blocks repeated confirmation clicks while the first response is pending", async () => {
    let resolveAction: () => void = () => undefined;
    const onStartDrawing = vi.fn(() => new Promise<void>((resolve) => { resolveAction = resolve; }));
    render(<ProgressivePptxStage task={task({ status: "plan_review", plan: { id: "p", markdown: "# Outline", revision: 1 } })} onStartDrawing={onStartDrawing} />);
    const button = screen.getByRole("button", { name: /确认大纲并开始绘制|Confirm outline and start drawing/i });

    fireEvent.click(button);
    fireEvent.click(button);

    expect(onStartDrawing).toHaveBeenCalledOnce();
    expect(button).toBeDisabled();
    resolveAction();
    await waitFor(() => expect(button).not.toBeDisabled());
  });
  it("groups task actions into one hierarchy-aware footer", () => {
    render(
      <LocaleProvider value="en">
        <ProgressivePptxStage
          task={task({ status: "question", topic: "Brand launch" })}
          onContinue={vi.fn()}
          onDeleteTask={vi.fn()}
          productionProps={{ onCancel: vi.fn() }}
        />
      </LocaleProvider>,
    );

    const footer = screen.getByTestId("progressive-stage-actions");
    expect(footer).toContainElement(screen.getByRole("button", { name: "Delete task" }));
    expect(footer).toContainElement(screen.getByRole("button", { name: "Cancel task" }));
    expect(footer).toContainElement(screen.getByRole("button", { name: "Confirm direction and continue" }));
    expect(screen.getByRole("button", { name: "Delete task" })).toHaveClass("is-danger");
    expect(screen.getByRole("button", { name: "Cancel task" })).toHaveClass("is-secondary");
    expect(screen.getByRole("button", { name: "Confirm direction and continue" })).toHaveClass("is-primary");
  });
  it("submits the default PPTX question option through the single primary action", () => {
    const onQuestionAnswer = vi.fn();
    render(
      <LocaleProvider value="en">
        <ProgressivePptxStage
          task={task({ status: "question", topic: "Brand launch", question: { id: "brief-1", question: "Confirm the inferred brief", options: [{ id: "start", label: "Start", recommended: true }], allowFreeform: true } })}
          onQuestionAnswer={onQuestionAnswer}
        />
      </LocaleProvider>,
    );

    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Confirm direction and continue" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Confirm direction and continue" }));
    expect(onQuestionAnswer).toHaveBeenCalledWith({ questionId: "brief-1", answer: "Start", optionId: "start" });
  });
  it("submits a custom PPTX answer with the same primary action", () => {
    const onQuestionAnswer = vi.fn();
    render(
      <LocaleProvider value="en">
        <ProgressivePptxStage
          task={task({ status: "question", topic: "Brand launch", question: { id: "brief-1", question: "Confirm the inferred brief", options: [{ id: "start", label: "Start" }], allowFreeform: true, currentIndex: 0 } })}
          onQuestionAnswer={onQuestionAnswer}
        />
      </LocaleProvider>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Custom answer" }), { target: { value: "Use eight slides for executives" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm direction and continue" }));
    expect(onQuestionAnswer).toHaveBeenCalledWith({ questionId: "brief-1", answer: "Use eight slides for executives", questionIndex: 0 });
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
  });
  it("falls back to plan markdown when no structured outline arrived", () => {
    const onStartDrawing = vi.fn();
    render(<ProgressivePptxStage task={task({ status: "plan_review", plan: { id: "p", markdown: "# 经营概览\n2. 关键指标\n- 行动建议", revision: 1 } })} onStartDrawing={onStartDrawing} />);
    expect(screen.getByRole("textbox", { name: /Section 1 title|第 1 部分标题/ })).toHaveValue("经营概览");
    expect(screen.getByRole("textbox", { name: /Section 2 title|第 2 部分标题/ })).toHaveValue("关键指标");
    expect(screen.getByRole("textbox", { name: /Section 3 title|第 3 部分标题/ })).toHaveValue("行动建议");
    expect(screen.getByRole("button", { name: /确认大纲并开始绘制|Confirm outline and start drawing/i })).toBeInTheDocument();
  });
  it("does not ask for confirmation while the outline is empty", () => {
    render(<ProgressivePptxStage task={task({ status: "plan_review", plan: { id: "p", markdown: "", revision: 1 } })} onStartDrawing={vi.fn()} />);
    expect(screen.getAllByText(/等待大纲内容|Waiting for outline content/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /确认大纲并开始绘制|Confirm outline and start drawing/i })).toBeNull();
  });
  it("shows explicit processing feedback instead of a confirmation dead end", () => {
    const onCancel = vi.fn();
    render(<ProgressivePptxStage task={task({ status: "running", topic: "经营分析" })} productionProps={{ onCancel }} />);
    expect(screen.getByRole("heading", { name: /正在理解制作方向|Understanding your direction/i })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/正在理解制作方向|Understanding your direction/i);
    expect(screen.queryByRole("button", { name: /确认方向|Confirm direction/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /取消任务|Cancel task/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
  it("does not leak Chinese UI copy in English mode", () => {
    const { container } = render(
      <LocaleProvider value="en">
        <ProgressivePptxStage task={task({ status: "running", topic: "Quarterly business review" })} productionProps={{ onCancel: vi.fn() }} />
      </LocaleProvider>,
    );

    expect(container).toHaveTextContent("OfficeDex is understanding");
    expect(container).toHaveTextContent("This page updates automatically");
    expect(container).toHaveTextContent("Cancel task");
    expect(container.textContent).not.toMatch(/[\p{Script=Han}]/u);
    for (const element of container.querySelectorAll("[aria-label], [title]")) {
      expect(element.getAttribute("aria-label") ?? "").not.toMatch(/[\p{Script=Han}]/u);
      expect(element.getAttribute("title") ?? "").not.toMatch(/[\p{Script=Han}]/u);
    }
  });
  it("marks draft ready before the op stream and mounts the editor slot", () => {
    render(<ProgressivePptxStage task={task({ status: "running" })} draftReady />);
    expect(screen.getByTestId("draft-ready")).toBeInTheDocument();
    expect(screen.getByTestId("progressive-pptx-stage")).toHaveAttribute("data-phase", "draft");
  });
  it("hands drawing and completion to the existing production stage", () => {
    render(<ProgressivePptxStage task={task({ status: "completed", vibeSlides: [{ id: "s1", elements: [] }] })} />);
    expect(screen.getByTestId("pptx-production-stage")).toBeInTheDocument();
    expect(screen.getByTestId("progressive-pptx-stage")).toHaveAttribute("data-phase", "ready");
  });
  it("exposes the latest op stream as visible progress", () => {
    render(<ProgressivePptxStage task={task({ status: "running", vibeOps: [{ seq: 4, op: "shape.add", slide: 1 }, { seq: 5, op: "text.add", slide: 1 }] } as DesktopTask & { vibeOps: unknown[] })} />);
    expect(screen.getByTestId("op-stream")).toHaveTextContent("shape.add");
    expect(screen.getByTestId("op-stream")).toHaveTextContent(/第 1 页|Slide 1/);
    expect(screen.getByTestId("op-stream")).toHaveTextContent("#5");
  });
});
