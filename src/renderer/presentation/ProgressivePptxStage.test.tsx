import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopTask } from "../../shared/types";
import type { SlidePreview } from "../../shared/slidePreviewWire";
import { LocaleProvider } from "../i18n";
import { startLocalTask, promoteLocalTask } from "../taskState";
import { ProgressivePptxStage } from "./ProgressivePptxStage";

function task(overrides: Partial<DesktopTask> = {}): DesktopTask { return { id: "task-1", conversationId: "c-1", status: "starting", events: [], ...overrides }; }

describe("ProgressivePptxStage", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
  it("preserves animated DOM when the optimistic task receives its server ID", () => {
    const input = { prompt: "Brand launch" };
    const local = startLocalTask({ tasks: {}, taskOrder: [], artifacts: [] }, "local-test", input, { documentType: "pptx", topic: "New slides" });
    const view = render(<ProgressivePptxStage task={local.tasks["local-test"]} />);
    const brief = view.container.querySelector(".pptx-flow-request");
    const lower = view.container.querySelector(".pptx-flow-lower");
    const promoted = promoteLocalTask(local, "local-test", "server-test", input);
    view.rerender(<ProgressivePptxStage task={promoted.tasks["server-test"]} />);
    expect(view.container.querySelector(".pptx-flow-request")).toBe(brief);
    expect(view.container.querySelector(".pptx-flow-lower")).toBe(lower);
  });
  it("describes recent activity with a relative time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T08:00:40Z"));
    render(<LocaleProvider value="en"><ProgressivePptxStage task={task({ status: "running", createdAt: "2026-09-11T08:00:00Z", events: [{ type: "task.progress", task_id: "task-1", ts: "2026-09-11T08:00:00Z", payload: { step: "research", content: "Researching the subject" } }] })} /></LocaleProvider>);
    expect(screen.getByText("Last activity")).toHaveTextContent("40s ago");
    expect(screen.queryByText("Since last update")).toBeNull();
  });
  it("withholds the timers until the run is old enough for them to mean anything", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T08:00:06Z"));
    render(<LocaleProvider value="en"><ProgressivePptxStage task={task({ status: "running", createdAt: "2026-09-11T08:00:00Z" })} /></LocaleProvider>);
    expect(screen.queryByText("Elapsed")).toBeNull();
    expect(screen.queryByText("Last activity")).toBeNull();
  });
  it("states the running message once instead of echoing it", () => {
    render(<LocaleProvider value="en"><ProgressivePptxStage task={task({ status: "running", events: [{ type: "task.progress", payload: { step: "license", content: "Checking access status" } }] })} /></LocaleProvider>);
    expect(screen.getAllByText(/Checking access status/)).toHaveLength(1);
  });
  it("titles the card from the runtime step instead of the view's own phase", () => {
    render(<LocaleProvider value="en"><ProgressivePptxStage task={task({ status: "running", events: [{ type: "task.progress", payload: { step: "license", content: "Checking access status" } }] })} /></LocaleProvider>);
    expect(screen.getByRole("heading", { name: "Preparing the workspace" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Understanding your direction" })).toBeNull();
  });
  it("moves the card title with the pipeline stage the runtime reports", () => {
    const { rerender } = render(<LocaleProvider value="en"><ProgressivePptxStage task={task({ status: "running", events: [{ type: "task.progress", payload: { step: "plan.research", content: "Searching the web" } }] })} /></LocaleProvider>);
    expect(screen.getByRole("heading", { name: "Researching the subject" })).toBeInTheDocument();
    rerender(<LocaleProvider value="en"><ProgressivePptxStage task={task({ status: "running", events: [{ type: "task.progress", payload: { step: "plan.expand", content: "Writing slide 3" } }] })} /></LocaleProvider>);
    expect(screen.getByRole("heading", { name: "Writing the slides" })).toBeInTheDocument();
  });
  it("shows the roadmap as a position rather than three labels", () => {
    const view = render(<LocaleProvider value="en"><ProgressivePptxStage task={task({ status: "running", events: [{ type: "task.progress", payload: { step: "plan.outline", content: "Structuring" } }] })} /></LocaleProvider>);
    const rail = screen.getByTestId("pptx-flow-rail");
    expect(rail).toHaveAttribute("data-stage", "0");
    expect(rail.querySelectorAll("span")).toHaveLength(3);
    expect(rail.textContent).toBe("Story structure");
    expect(view.container).not.toHaveTextContent("Layout & images");
    view.rerender(<LocaleProvider value="en"><ProgressivePptxStage task={task({ status: "running", events: [{ type: "task.progress", payload: { step: "assemble", content: "Assembling" } }] })} /></LocaleProvider>);
    expect(screen.getByTestId("pptx-flow-rail")).toHaveAttribute("data-stage", "1");
    expect(screen.getByTestId("pptx-flow-rail").textContent).toBe("Layout & images");
  });
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
    const { container, rerender } = render(<ProgressivePptxStage task={first} />, { wrapper: ({ children }) => <div style={{ overflowY: "auto" }} data-testid="scroll-owner">{children}</div> });
    const content = container.querySelector<HTMLDivElement>(".progressive-pptx-stage__content-scroll");
    if (!content) throw new Error("outline content scroller not found");
    Object.defineProperty(content, "scrollHeight", { configurable: true, value: 1200 });
    Object.defineProperty(content, "clientHeight", { configurable: true, value: 480 });
    const scrollTo = vi.fn();
    const owner = screen.getByTestId("scroll-owner");
    Object.defineProperty(owner, "scrollHeight", { configurable: true, value: 1800 });
    owner.scrollTo = scrollTo;

    rerender(<ProgressivePptxStage task={{ ...first, status: "plan_review" }} />);
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 1800, behavior: "instant" }));

    rerender(<ProgressivePptxStage task={{ ...first, status: "plan_review" }} />);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });
  it("keeps following outline items appended after the review gate", async () => {
    const first = task({
      status: "plan_review",
      plan: { id: "p", markdown: "outline", revision: 1 },
      vibeOutline: { slides: [{ id: "s1", headline: "Context" }] },
    });
    const { container, rerender } = render(<ProgressivePptxStage task={first} />, { wrapper: ({ children }) => <div style={{ overflowY: "auto" }} data-testid="scroll-owner">{children}</div> });
    const content = container.querySelector<HTMLDivElement>(".progressive-pptx-stage__content-scroll");
    if (!content) throw new Error("outline content scroller not found");
    Object.defineProperty(content, "scrollHeight", { configurable: true, value: 1200 });
    const scrollTo = vi.fn();
    const owner = screen.getByTestId("scroll-owner");
    Object.defineProperty(owner, "scrollHeight", { configurable: true, value: 1800 });
    owner.scrollTo = scrollTo;
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
    const { container } = render(<ProgressivePptxStage task={taskWithGate} />, { wrapper: ({ children }) => <div style={{ overflowY: "auto" }} data-testid="scroll-owner">{children}</div> });
    const content = container.querySelector<HTMLDivElement>(".progressive-pptx-stage__content-scroll");
    if (!content) throw new Error("outline content scroller not found");
    Object.defineProperty(content, "scrollHeight", { configurable: true, value: 1200 });
    const scrollTo = vi.fn();
    const owner = screen.getByTestId("scroll-owner");
    Object.defineProperty(owner, "scrollHeight", { configurable: true, value: 1800 });
    owner.scrollTo = scrollTo;
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 1800, behavior: "instant" }));
  });
  it("stops following when the user scrolls up", async () => {
    const first = task({
      status: "plan_review",
      plan: { id: "p", markdown: "outline", revision: 1 },
      vibeOutline: { slides: [{ id: "s1", headline: "Context" }] },
    });
    const { container, rerender } = render(<ProgressivePptxStage task={first} />, { wrapper: ({ children }) => <div style={{ overflowY: "auto" }} data-testid="scroll-owner">{children}</div> });
    const content = container.querySelector<HTMLDivElement>(".progressive-pptx-stage__content-scroll");
    if (!content) throw new Error("outline content scroller not found");
    Object.defineProperty(content, "scrollHeight", { configurable: true, value: 1200 });
    const scrollTo = vi.fn();
    const owner = screen.getByTestId("scroll-owner");
    Object.defineProperty(owner, "scrollHeight", { configurable: true, value: 1800 });
    owner.scrollTo = scrollTo;
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
    expect(screen.getByRole("status")).toHaveTextContent(/正在把你的需求整理成可执行的演示结构|turning your request into an executable presentation structure/i);
    expect(screen.queryByRole("button", { name: /确认方向|Confirm direction/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /取消任务|Cancel task/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
  it("keeps the loud status line localized and the engine's sentence underneath it", () => {
    // Engine progress text is English no matter the locale. Leading with it put
    // an English sentence at the top of a Chinese screen, and duplicated the
    // step heading whenever no sentence had arrived yet.
    render(<LocaleProvider value="zh"><ProgressivePptxStage task={task({ status: "running", events: [{ type: "task.progress", payload: { step: "plan.expand", content: "Writing slide 3" } }] })} /></LocaleProvider>);
    const status = screen.getByRole("status");
    expect(status.querySelector("strong")).toHaveTextContent("正在准备下一页");
    expect(status.querySelector(".pptx-flow-runtime-detail")).toHaveTextContent("Writing slide 3");
  });
  it("does not leak Chinese UI copy in English mode", () => {
    const { container } = render(
      <LocaleProvider value="en">
        <ProgressivePptxStage task={task({ status: "running", topic: "Quarterly business review" })} productionProps={{ onCancel: vi.fn() }} />
      </LocaleProvider>,
    );

    expect(container).toHaveTextContent("Understanding your direction");
    expect(container).toHaveTextContent("Your presentation is taking shape");
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
  it("renders the main actions outside the generation step so they can always stick", () => {
    const drawing = task({ status: "running", plan: { id: "p", markdown: "outline", revision: 1 }, vibeSlides: [{ id: "s1", elements: [] }] });
    render(<ProgressivePptxStage task={drawing} />);
    const actions = screen.getByTestId("pptx-flow-actions");
    // Sticky is bounded by its containing block: inside the step it could only
    // pin while that one screen was in view.
    expect(screen.getByTestId("pptx-flow-generation").contains(actions)).toBe(false);
    expect(actions.contains(screen.getByTestId("pptx-production-stage"))).toBe(true);
  });
  it("withholds the action bar until there is a run to act on", () => {
    render(<ProgressivePptxStage task={task({ status: "running", topic: "经营分析" })} />);
    expect(screen.queryByTestId("pptx-flow-actions")).toBeNull();
  });
  it("reserves an outline status slot so a status word cannot reflow the list", () => {
    const outline = task({ status: "running", plan: { id: "p", markdown: "# 经营概览\n# 关键指标", revision: 1 } });
    const view = render(<ProgressivePptxStage task={outline} />);
    const slots = view.container.querySelectorAll(".pptx-flow-outline__state");
    expect(slots.length).toBe(2);
    expect(slots[0]).toHaveAttribute("data-state", "none");
    expect(slots[0]).toHaveTextContent("");
    view.rerender(<ProgressivePptxStage task={{ ...outline, events: [{ type: "task.progress", payload: { slide_state: { slide: 1, state: "generating" } } }] }} />);
    const filled = view.container.querySelectorAll(".pptx-flow-outline__state");
    expect(filled[0]).toHaveAttribute("data-state", "generating");
    expect(filled[0].textContent).not.toBe("");
  });
  it("exposes the latest op stream as visible progress", () => {
    render(<ProgressivePptxStage task={task({ status: "running", vibeOps: [{ seq: 4, op: "shape.add", slide: 1 }, { seq: 5, op: "text.add", slide: 1 }] } as DesktopTask & { vibeOps: unknown[] })} />);
    expect(screen.getByTestId("op-stream")).toHaveTextContent("shape.add");
    expect(screen.getByTestId("op-stream")).toHaveTextContent(/第 1 页|Slide 1/);
    expect(screen.getByTestId("op-stream")).toHaveTextContent("#5");
  });
});

describe("vertical PPT creation flow", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
  it("retains the outline while slides arrive without another outline snapshot", () => {
    const first = task({ status: "plan_review", vibeOutline: { slides: [{ id: "s1", headline: "Launch story" }] } });
    const { rerender } = render(<ProgressivePptxStage task={first} />);
    rerender(<ProgressivePptxStage task={task({ status: "running", vibeSlides: [{ id: "s1", elements: [{ content: "<p>Launch story</p>" }] }] })} />);
    expect(screen.getByRole("textbox", { name: "Section 1 title" })).toHaveValue("Launch story");
    expect(screen.getByRole("textbox", { name: "Section 1 title" })).toHaveAttribute("readonly");
    expect(screen.getByTestId("pptx-flow-page-1")).toHaveTextContent("Launch story");
    expect(screen.queryByRole("navigation")).toBeNull();
  });
  it("stops current-stage animation on pause, failure and cancellation", () => {
    const first = task({ status: "running", vibeOutline: { slides: [{ headline: "Story" }] } });
    const { container, rerender } = render(<ProgressivePptxStage task={first} />);
    expect(container.querySelectorAll(".pptx-flow-step.is-active")).toHaveLength(1);
    for (const status of ["plan_review", "failed", "cancelled"] as const) {
      rerender(<ProgressivePptxStage task={{ ...first, status }} />);
      expect(container.querySelectorAll(".pptx-flow-step.is-active")).toHaveLength(0);
    }
  });
  it("preserves failed slides and offers the retained deck and a restart", () => {
    const retry = vi.fn();
    render(<ProgressivePptxStage task={task({ status: "failed", error: "Provider unavailable", vibeSlides: [{ id: "s1", elements: [] }] })} productionProps={{ onRetry: retry }} />);
    expect(screen.getByTestId("pptx-flow-page-1")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Provider unavailable");
    // The kept page is stated as a fact and the destructive restart names what
    // it discards, instead of a bare button labelled "Retry" that said neither.
    expect(screen.getByRole("alert")).toHaveTextContent("Pages kept: 1");
    expect(screen.getByText(/discards pages already generated \(1\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Generate the whole deck again/ }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it("makes opening the kept pages the primary action when the run left a deck", () => {
    const openEditor = vi.fn();
    const retry = vi.fn();
    render(<ProgressivePptxStage task={task({ status: "failed", error: "provider unavailable", vibeSlides: [{ id: "s1", elements: [] }] })} productionProps={{ onOpenEditor: openEditor, onRetry: retry }} />);
    // Restarting is available but must not be the primary while pages exist.
    fireEvent.click(screen.getByRole("button", { name: "Open the generated pages (1)" }));
    expect(openEditor).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
  });
  it("hides the follow-latest control once the run is over", () => {
    render(<ProgressivePptxStage task={task({ status: "failed", error: "provider unavailable", vibeSlides: [{ id: "s1", elements: [] }] })} />);
    // Nothing else will arrive, so "follow latest" is a control with no object.
    expect(screen.queryByRole("button", { name: /Follow latest/ })).toBeNull();
  });
  it("uses plain text for streamed markup and never mounts runtime HTML", () => {
    const { container } = render(<ProgressivePptxStage task={task({ status: "running", vibeSlides: [{ id: "s1", elements: [{ content: '<p>Safe title</p><img src="x" onerror="alert(1)">' }] }] })} />);
    expect(screen.getByRole("heading", { name: "Safe title" })).toBeInTheDocument();
    expect(container.querySelector(".pptx-flow-page img")).toBeNull();
  });
  it("keeps progress indeterminate if the runtime has not supplied a total", () => {
    render(<ProgressivePptxStage task={task({ status: "running", vibeSlides: [{ id: "s1", elements: [] }] })} />);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
  it("runs Debug from zero, can replay and never calls live actions", async () => {
    vi.useFakeTimers();
    const action = vi.fn();
    const { container } = render(<ProgressivePptxStage task={task({ status: "plan_review", topic: "Live task", vibeOutline: { slides: [{ headline: "Live outline" }] } })} onContinue={action} onStartDrawing={action} productionProps={{ onCancel: action, onRetry: action }} />);
    fireEvent.click(screen.getByRole("button", { name: "Debug: replay from zero" }));
    expect(container.querySelector('[data-demo="true"]')).toHaveAttribute("data-phase", "brief");
    for (let step = 0; step < 17; step++) await act(async () => { await vi.advanceTimersByTimeAsync(step < 9 ? 650 : 1300); });
    expect(container.querySelector('[data-demo="true"]')).toHaveAttribute("data-phase", "ready");
    expect(container.querySelectorAll('[data-demo="true"] .pptx-flow-page')).toHaveLength(6);
    expect(action).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Debug: replay from zero" }));
    expect(container.querySelectorAll('[data-demo="true"] .pptx-flow-page')).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Return to live task" }));
    expect(container.querySelector('[data-demo="true"]')).toBeNull();
    expect(screen.getByRole("textbox", { name: "Section 1 title" })).toHaveValue("Live outline");
    expect(action).not.toHaveBeenCalled();
  });
  it("cleans up the demo clock on unmount", () => {
    vi.useFakeTimers();
    const { unmount } = render(<ProgressivePptxStage task={task()} />);
    fireEvent.click(screen.getByRole("button", { name: "Debug: replay from zero" }));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not retain the previous task's story or demo when switching tasks", () => {
    const { container, rerender } = render(<ProgressivePptxStage task={task({ vibeOutline: { slides: [{ headline: "Previous outline" }] } })} />);
    fireEvent.click(screen.getByRole("button", { name: "Debug: replay from zero" }));
    rerender(<ProgressivePptxStage task={task({ id: "new-task", topic: "New task" })} />);
    expect(container.querySelector('[data-demo="true"]')).toBeNull();
    expect(screen.queryByDisplayValue("Previous outline")).toBeNull();
  });
});

describe("MOP runtime progress before slide previews", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
  it("shows image-provider progress rather than understanding the brief", () => {
    render(<ProgressivePptxStage task={task({ status: "running", events: [{ type: "task.progress", ts: new Date().toISOString(), payload: { step: "assemble", content: "Still waiting on image provider (asset 2/2, elapsed 50s)", elapsed_ms: 50000 } }] })} />);
    expect(screen.getByTestId("progressive-pptx-stage")).toHaveAttribute("data-phase", "drawing");
    expect(screen.getByRole("heading", { name: "Creating presentation images" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Still waiting on image provider");
    expect(screen.queryByRole("heading", { name: "Understanding your direction" })).toBeNull();
    expect(screen.queryByTestId("pptx-flow-outline")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
  it("offers a read-only status refresh after a quiet period, and surfaces failure", async () => {
    const refresh = vi.fn().mockRejectedValue(new Error("Bridge unavailable"));
    render(<ProgressivePptxStage task={task({ status: "running", events: [{ type: "task.progress", ts: new Date(Date.now() - 130000).toISOString(), payload: { step: "assemble", content: "Generating image asset (1/2)" } }] })} onRefresh={refresh} />);
    expect(screen.getByRole("status")).toHaveTextContent("No new progress for a while");
    expect(screen.getByTestId("progressive-pptx-stage")).toHaveAttribute("data-delayed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Bridge unavailable"));
    expect(refresh).toHaveBeenCalledOnce();
  });
  it("clears delayed feedback when a new provider heartbeat arrives", () => {
    const first = task({ status: "running", events: [{ type: "task.progress" as const, ts: new Date(Date.now() - 130000).toISOString(), payload: { step: "assemble", content: "Generating image asset (1/2)" } }] });
    const { rerender } = render(<ProgressivePptxStage task={first} />);
    rerender(<ProgressivePptxStage task={{ ...first, events: [...first.events, { type: "task.progress", ts: new Date().toISOString(), payload: { step: "assemble", content: "Image asset ready" } }] }} />);
    expect(screen.getByTestId("progressive-pptx-stage")).not.toHaveAttribute("data-delayed");
    expect(screen.getByRole("status")).toHaveTextContent("Image asset ready");
  });
});

it("shows page 2 content before page 1 and retains it after failure", () => {
  const current = task({ status: "running", events: [{ type: "task.progress", payload: { step: "plan.expand", content: "Slide 2 content ready", slide_preview: { slide: 2, headline: "Ready out of order", takeaway: "Useful result", blocks: [{ sections: [{ heading: "Benefit", detail: "Full detail" }] }] } } }] });
  const view = render(<ProgressivePptxStage task={current} />);
  expect(screen.getByTestId("pptx-content-page-2").textContent).toContain("Full detail");
  expect(screen.queryByTestId("pptx-content-page-1")).toBeNull();
  view.rerender(<ProgressivePptxStage task={{ ...current, status: "failed" }} />);
  expect(screen.getByTestId("pptx-content-page-2")).toBeTruthy();
  expect(screen.getByTestId("progressive-pptx-stage").getAttribute("data-phase")).toBe("failed");
  cleanup();
});

describe("runtime reconciliation", () => {
 afterEach(() => { cleanup(); vi.useRealTimers(); });
 it("checks quiet tasks without overlapping requests and stops on failure", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-11T08:00:00Z"));
  let resolve!: () => void;
  const refresh = vi.fn(() => new Promise<void>(done => { resolve = done; }));
  const current = task({ status: "running", createdAt: "2026-09-11T08:00:00Z" });
  const view = render(<ProgressivePptxStage task={current} onRefresh={refresh} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => { resolve(); });
  view.rerender(<ProgressivePptxStage task={{ ...current, status: "failed" }} onRefresh={refresh} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(refresh).toHaveBeenCalledTimes(1);
 });
});

describe("recovery actions", () => {
 afterEach(cleanup);
 it("skips only the active research stage", async () => {
  const skip = vi.fn(async () => {});
  const current = task({ status: "running", events: [{ type: "task.progress", payload: { step: "plan.research", content: "Searching" } }] });
  const view = render(<ProgressivePptxStage task={current} onSkipResearch={skip} />);
  fireEvent.click(screen.getByText("Skip research and continue"));
  await waitFor(() => expect(skip).toHaveBeenCalledTimes(1));
  view.rerender(<ProgressivePptxStage task={{ ...current, events: [{type:"task.progress",payload:{step:"plan.expand",content:"Writing"}}] }} onSkipResearch={skip} />);
  expect(screen.queryByText("Skip research and continue")).toBeNull();
 });
 it("passes the saved checkpoint only on explicit retry", async () => {
  const retry = vi.fn(async (_path: string) => {});
  render(<ProgressivePptxStage task={task({ status: "failed", events: [{ type: "task.progress", payload: { step: "plan.expand", resume_checkpoint: "/checkpoint/expansion-state.json" } }] })} onRetryFailed={retry} />);
  expect(retry).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Continue the unfinished pages"));
  await waitFor(() => expect(retry).toHaveBeenCalledWith("/checkpoint/expansion-state.json"));
 });
 it("states the stage, the kept pages and the resume point from structured data", () => {
  const retry = vi.fn(async (_path: string) => {});
  const drawn = [{ id: "s1", elements: [] }, { id: "s2", elements: [] }] as SlidePreview[];
  render(<ProgressivePptxStage task={task({
    status: "failed",
    error: "PPTX rendering is incomplete; drawn pages retained: worker exited 1",
    // A sparse deck: two pages drawn, the third never arrived.
    vibeSlides: Object.assign([...drawn], { length: 3 }),
    failure: {
      stage: "render",
      reason: "worker_died",
      retryable: true,
      resume_stage: "expansion",
      resume_checkpoint: "/checkpoint/expansion-state.json",
      retained: { ready_pages: 3, total_pages: 5, failed_pages: [4, 5] },
    },
  })} onRetryFailed={retry} />);
  // The stage comes from the failure, not from the sentence -- which is about
  // rendering even though it used to be shown under a content-generation title.
  const panel = screen.getByRole("alert");
  expect(panel).toHaveTextContent("Layout did not finish");
  expect(panel).toHaveAttribute("data-stage", "render");
  expect(panel).toHaveAttribute("data-reason", "worker_died");
  expect(panel).toHaveTextContent("Pages kept: 2 / 5");
  expect(panel).toHaveTextContent("Unfinished pages: 4, 5");
  // Ready-but-undrawn pages must not inflate the count of what can be opened.
  expect(screen.getByText("Continue unfinished pages (3)")).toBeInTheDocument();
 });
});

describe("compact runtime polling", () => {
 afterEach(() => { cleanup(); vi.useRealTimers(); });
 it("checks every 3 seconds even with recent progress and never overlaps", async () => {
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-09-11T08:00:00Z"));
  let release!:()=>void;
  const check=vi.fn(()=>new Promise<void>(done=>{release=done}));
  const history=vi.fn(async()=>{});
  const current=task({status:"running",createdAt:"2026-09-11T08:00:00Z"});
  const view=render(<ProgressivePptxStage task={current} onCheckStatus={check} onRefresh={history}/>);
  await act(async()=>{await vi.advanceTimersByTimeAsync(3000)});expect(check).toHaveBeenCalledTimes(1);
  await act(async()=>{await vi.advanceTimersByTimeAsync(6000)});expect(check).toHaveBeenCalledTimes(1);expect(history).not.toHaveBeenCalled();
  await act(async()=>{release()});
  view.rerender(<ProgressivePptxStage task={{...current,status:"failed"}} onCheckStatus={check}/>);
  await act(async()=>{await vi.advanceTimersByTimeAsync(6000)});expect(check).toHaveBeenCalledTimes(1);
 });
 it("does not probe a task the runtime has not acknowledged yet", async () => {
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-09-11T08:00:00Z"));
  const input={prompt:"Brand launch"};
  const check=vi.fn(async()=>{});
  const local=startLocalTask({tasks:{},taskOrder:[],artifacts:[]},"local-1",input,{documentType:"pptx",topic:"New slides"});
  const view=render(<ProgressivePptxStage task={local.tasks["local-1"]} onCheckStatus={check}/>);
  await act(async()=>{await vi.advanceTimersByTimeAsync(9000)});
  expect(check).not.toHaveBeenCalled();
  const promoted=promoteLocalTask(local,"local-1","server-1",input);
  view.rerender(<ProgressivePptxStage task={promoted.tasks["server-1"]} onCheckStatus={check}/>);
  await act(async()=>{await vi.advanceTimersByTimeAsync(3000)});
  expect(check).toHaveBeenCalledTimes(1);
 });
 it("reports a sustained status failure, not a single miss", async () => {
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-09-11T08:00:00Z"));
  const check=vi.fn(async()=>{throw new Error("task not found")});
  const current=task({status:"running",createdAt:"2026-09-11T08:00:00Z"});
  render(<LocaleProvider value="en"><ProgressivePptxStage task={current} onCheckStatus={check}/></LocaleProvider>);
  await act(async()=>{await vi.advanceTimersByTimeAsync(3000)});
  expect(screen.queryByTestId("pptx-status-check-note")).toBeNull();
  await act(async()=>{await vi.advanceTimersByTimeAsync(3000)});
  expect(screen.getByTestId("pptx-status-check-note")).toHaveTextContent("Status check unavailable");
 });
});
