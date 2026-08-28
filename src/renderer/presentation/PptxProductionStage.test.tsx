import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopTask } from "../../shared/types";
import type { PptistSlide } from "../../shared/pptistProtocol";
import { PptxProductionStage } from "./PptxProductionStage";

const slide = (id: string): PptistSlide => ({ id, elements: [] });
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
});
