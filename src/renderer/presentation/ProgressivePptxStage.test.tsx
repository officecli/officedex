import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopTask } from "../../shared/types";
import { ProgressivePptxStage } from "./ProgressivePptxStage";

function task(overrides: Partial<DesktopTask> = {}): DesktopTask { return { id: "task-1", conversationId: "c-1", status: "starting", events: [], ...overrides }; }

describe("ProgressivePptxStage", () => {
  afterEach(cleanup);
  it("reveals an editable brief before any op arrives", () => {
    const onBriefChange = vi.fn();
    render(<ProgressivePptxStage task={task({ topic: "运营汇报", userInput: { prompt: "制作一份 6 页运营汇报" } })} onBriefChange={onBriefChange} />);
    expect(screen.getByTestId("progressive-disclosure")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Presentation brief" })).toHaveValue("制作一份 6 页运营汇报");
    fireEvent.change(screen.getByRole("textbox", { name: "Presentation brief" }), { target: { value: "改成面向管理层" } });
    expect(onBriefChange).toHaveBeenCalledWith("改成面向管理层");
  });
  it("shows outline intervention and starts drawing explicitly", () => {
    const onStartDrawing = vi.fn();
    const taskWithOutline = task({ status: "running", plan: { id: "p", markdown: "outline", revision: 1 }, vibeTree: { stage: "refined_ready", tree: { id: "t", rootId: "r", title: "Deck", nodes: [{ id: "s1", kind: "slide", title: "现状" }] }, actions: [] } });
    render(<ProgressivePptxStage task={taskWithOutline} onStartDrawing={onStartDrawing} />);
    expect(screen.getByRole("textbox", { name: "Slide 1 title" })).toHaveValue("现状");
    fireEvent.click(screen.getByRole("button", { name: /开始绘制/i }));
    expect(onStartDrawing).toHaveBeenCalledOnce();
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
    expect(screen.getByTestId("op-stream")).toHaveTextContent("第 1 页");
    expect(screen.getByTestId("op-stream")).toHaveTextContent("#5");
  });
});
