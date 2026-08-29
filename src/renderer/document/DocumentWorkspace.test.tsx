import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopTask } from "../../shared/types";
import { DocumentWorkspace } from "./DocumentWorkspace";

const task = (status: DesktopTask["status"]): DesktopTask => ({ id: "run-1", conversationId: "internal", status, documentType: "docx", topic: "Quarterly report", events: [], plan: status === "plan_review" ? { id: "plan", markdown: "1. Summary\n2. Metrics", revision: 1 } : undefined, question: status === "question" ? { id: "q1", question: "What should we include?", options: [{ id: "summary", label: "Summary", recommended: true }], allowFreeform: true } : undefined, error: status === "failed" ? "Render failed" : undefined });

afterEach(cleanup);

describe("DocumentWorkspace", () => {
  it.each(["starting", "running"] as const)("shows %s without chat UI", (status) => { render(<DocumentWorkspace task={task(status)} />); expect(screen.getByRole("status")).toHaveTextContent(status === "running" ? "Creating" : "Preparing"); expect(screen.queryByText(/chat|task id|conversation/i)).not.toBeInTheDocument(); });
  it("answers a question", () => { const onAnswer = vi.fn(); render(<DocumentWorkspace task={task("question")} onAnswer={onAnswer} />); fireEvent.click(screen.getByRole("button", { name: /summary/i })); expect(onAnswer).toHaveBeenCalledWith(expect.objectContaining({ answer: "Summary", optionId: "summary" })); });
  it("reviews a plan", () => { const onApprovePlan = vi.fn(); render(<DocumentWorkspace task={task("plan_review")} onApprovePlan={onApprovePlan} />); expect(screen.getByText(/1\. Summary/)).toBeInTheDocument(); fireEvent.click(screen.getByRole("button", { name: "Continue" })); expect(onApprovePlan).toHaveBeenCalled(); });
  it.each(["completed", "failed", "cancelled"] as const)("renders %s state", (status) => { render(<DocumentWorkspace task={task(status)} onRetry={vi.fn()} />); expect(screen.getByRole("status")).toBeInTheDocument(); expect(status === "completed" ? screen.getByText("Document ready") : screen.getByRole("button", { name: /retry/i })).toBeInTheDocument(); });
  it("renders a full-width PPTX adapter slot without duplicate artifact actions", () => { const onAction = vi.fn(); const current = { ...task("completed"), documentType: "pptx", artifact: { fileName: "deck.pptx", filePath: "/tmp/deck.pptx", documentType: "pptx" } }; render(<DocumentWorkspace task={current} pptxStage={<div>Editable canvas</div>} onArtifactAction={onAction} />); expect(screen.getByRole("main", { name: "Document workspace" })).toHaveClass("document-workspace--pptx"); expect(screen.getByText("Editable canvas")).toBeInTheDocument(); expect(screen.queryByRole("navigation", { name: "Artifact actions" })).toBeNull(); expect(screen.queryByRole("button", { name: "Open" })).toBeNull(); expect(screen.queryByRole("button", { name: "Copy path" })).toBeNull(); expect(screen.queryByRole("button", { name: "Show in folder" })).toBeNull(); expect(onAction).not.toHaveBeenCalled(); });
  it("lets the PPTX stage own question UI without rendering the generic question panel", () => {
    const current = { ...task("question"), documentType: "pptx" };
    render(<DocumentWorkspace task={current} pptxStage={<div>Progressive PPTX question</div>} onAnswer={vi.fn()} />);

    expect(screen.getByText("Progressive PPTX question")).toBeInTheDocument();
    expect(screen.queryByText("What should we include?")).toBeNull();
    expect(screen.queryByRole("button", { name: /summary/i })).toBeNull();
    expect(screen.queryByPlaceholderText("Add a custom answer")).toBeNull();
  });
});
