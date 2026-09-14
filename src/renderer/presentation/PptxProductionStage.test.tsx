import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopTask } from "../../shared/types";
import type { SlidePreview } from "../../shared/slidePreviewWire";
import { PptxProductionStage } from "./PptxProductionStage";

const slide = (id: string): SlidePreview => ({ id, elements: [] });
function task(overrides: Partial<DesktopTask> = {}): DesktopTask {
  return { id: "task-1", conversationId: "conversation-1", status: "starting", events: [], ...overrides };
}

describe("PptxProductionStage", () => {
  afterEach(cleanup);
  it("shows immediate starting feedback", () => {
    render(<PptxProductionStage task={task()} />);
    expect(screen.getByTestId("pptx-production-status")).toHaveTextContent("Starting");
    expect(screen.getByText("Preparing your presentation…")).toBeInTheDocument();
  });

  it("shows outline and drawing progress with completed slides", () => {
    render(<PptxProductionStage task={task({ status: "running", plan: { id: "p", markdown: "outline", revision: 1 }, vibeSlides: [slide("one"), slide("two")], events: [{ type: "task.progress", payload: { slide: 2, total_slides: 5 } }] })} />);
    expect(screen.getByTestId("pptx-production-status")).toHaveTextContent("Drawing slides");
    expect(screen.getByText("2 / 5")).toBeInTheDocument();
    expect(screen.getByTestId("pptx-slide-2")).toHaveClass("is-ready");
    expect(screen.getByText("Drawing slide 2")).toBeInTheDocument();
  });

  it("keeps failed output actionable", () => {
    const onRetry = vi.fn();
    render(<PptxProductionStage task={task({ status: "failed", error: "provider unavailable", vibeSlides: [slide("one")] })} onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("provider unavailable");
    fireEvent.click(screen.getByRole("button", { name: /Retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("offers an editor once the deck is complete", () => {
    const onOpenEditor = vi.fn();
    render(<PptxProductionStage task={task({ status: "completed", vibeSlides: [slide("one")] })} onOpenEditor={onOpenEditor} />);
    fireEvent.click(screen.getByRole("button", { name: /Open editor/i }));
    expect(onOpenEditor).toHaveBeenCalledOnce();
  });

  it("shows image progress while visual assets are still pending", () => {
    const onOpenEditor = vi.fn();
    render(<PptxProductionStage task={task({
      status: "completed",
      vibeOps: [
        { seq: 1, op: "shape.add", slide: 1, shape: { kind: "picture", imageRef: { kind: "primary", pending: true } } },
        { seq: 2, op: "shape.add", slide: 2, shape: { kind: "picture", imageRef: { kind: "primary", pending: true } } },
        { seq: 3, op: "shape.update", slide: 1, fill: { imageRef: { kind: "primary", digest: "b".repeat(64) } } },
      ],
    })} onOpenEditor={onOpenEditor} />);
    expect(screen.getByTestId("pptx-production-status")).toHaveTextContent("Drawing slides");
    expect(screen.getByTestId("pptx-image-progress")).toHaveTextContent("1 / 2 images ready · 1 generating");
    expect(screen.queryByRole("button", { name: /Open editor/i })).toBeNull();
  });

  it("exposes a stage command bar and routes steering/resume controls", async () => {
    const onSteer = vi.fn(async () => undefined);
    const onResume = vi.fn(async () => undefined);
    render(<PptxProductionStage task={task({ status: "question", plan: { id: "p", markdown: "outline", revision: 1 } })} onSteer={onSteer} onResume={onResume} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Stage instruction" }), { target: { value: "add a takeaway" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Stage instruction" }), { key: "Enter" });
    expect(onSteer).toHaveBeenCalledWith("add a takeaway");
    await waitFor(() => expect(screen.getByRole("button", { name: "Resume" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(onResume).toHaveBeenCalledOnce());
  });

  it("holds and releases a drawing run through the live controls", async () => {
    const onPause = vi.fn(async () => undefined);
    const onResumeLive = vi.fn(async () => undefined);
    const drawing = task({ status: "running", plan: { id: "p", markdown: "outline", revision: 1 }, vibeSlides: [slide("one")] });
    const view = render(<PptxProductionStage task={drawing} onPause={onPause} onResumeLive={onResumeLive} />);
    fireEvent.click(screen.getByRole("button", { name: /Pause/i }));
    await waitFor(() => expect(onPause).toHaveBeenCalledOnce());
    view.rerender(<PptxProductionStage task={drawing} onPause={onPause} onResumeLive={onResumeLive} livePaused />);
    // Held: the status says so, and the only way forward is Continue.
    expect(screen.getByTestId("pptx-production-status")).toHaveTextContent("Paused");
    expect(screen.queryByRole("button", { name: /^Pause$/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    await waitFor(() => expect(onResumeLive).toHaveBeenCalledOnce());
  });

  it("promises live steering only while there is a live run to steer", () => {
    const drawing = task({ status: "running", plan: { id: "p", markdown: "outline", revision: 1 }, vibeSlides: [slide("one")] });
    const view = render(<PptxProductionStage task={drawing} onSteer={vi.fn()} />);
    expect(screen.getByPlaceholderText("Tell OfficeDex what to change from the next slide")).toBeTruthy();
    view.rerender(<PptxProductionStage task={task({ status: "completed", vibeSlides: [slide("one")] })} onSteer={vi.fn()} />);
    expect(screen.getByPlaceholderText("Describe the next change")).toBeTruthy();
  });
});
