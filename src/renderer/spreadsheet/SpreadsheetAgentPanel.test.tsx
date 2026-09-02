import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopTask } from "../../shared/types";
import { SpreadsheetAgentPanel } from "./SpreadsheetAgentPanel";

afterEach(() => cleanup());

describe("SpreadsheetAgentPanel", () => {
  it("submits an XLSX-only generation request without legacy document controls", async () => {
    const onGenerate = vi.fn(async () => undefined);
    render(<SpreadsheetAgentPanel workspaceId="ws-1" onGenerate={onGenerate} onModify={vi.fn()} onRespond={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Spreadsheet generation request" }), { target: { value: "Build a quarterly sales forecast" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({
      documentType: "xlsx",
      generationMode: "plan",
      prompt: "Build a quarterly sales forecast",
      workspaceId: "ws-1",
    })));
    expect(screen.queryByText("GIF")).toBeNull();
    expect(screen.queryByTestId("new-generation-form")).toBeNull();
  });

  it("submits continue-modify against the open workbook", async () => {
    const onModify = vi.fn(async () => undefined);
    render(<SpreadsheetAgentPanel artifactPath="/tmp/book.xlsx" conversationId="conversation-1" sourceTaskId="task-1" onGenerate={vi.fn()} onModify={onModify} onRespond={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Spreadsheet modification request" }), { target: { value: "Add a chart" } });
    fireEvent.click(screen.getByRole("button", { name: "Modify" }));
    await waitFor(() => expect(onModify).toHaveBeenCalledWith(expect.objectContaining({
      documentType: "xlsx",
      sourceFile: "/tmp/book.xlsx",
      prompt: "Add a chart",
      conversationId: "conversation-1",
      parentTaskId: "task-1",
    })));
  });

  it("renders XLSX clarification questions instead of misleading export progress", () => {
    const task: DesktopTask = {
      id: "xlsx-question-layout",
      conversationId: "xlsx-question-layout",
      status: "question",
      topic: "Build a finance report",
      events: [],
      stages: [
        { id: "analyze", label: "Analyzing request", status: "completed" },
        { id: "format", label: "Formatting & export", status: "active" },
      ],
      question: {
        id: "question-group",
        question: "Who is this report for?",
        options: [{ id: "leadership", label: "Leadership", recommended: true }],
        allowFreeform: true,
      },
    };

    render(<SpreadsheetAgentPanel task={task} onGenerate={vi.fn()} onModify={vi.fn()} onRespond={vi.fn()} />);

    expect(screen.getByText("Your input is needed to continue")).toBeTruthy();
    expect(screen.getByText("Who is this report for?")).toBeTruthy();
    expect(screen.getByText("Recommended")).toBeTruthy();
    expect(screen.queryByText("Formatting & export")).toBeNull();
    expect(screen.queryByText("Working on your workbook…")).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Spreadsheet generation request" })).toBeNull();
  });

  it("renders and approves an XLSX execution plan without showing export progress", async () => {
    const onApprovePlan = vi.fn(async () => undefined);
    const task: DesktopTask = {
      id: "xlsx-plan-review",
      conversationId: "xlsx-plan-review",
      status: "plan_review",
      topic: "Compare regional Q3 results",
      events: [],
      stages: [{ id: "plan-review", label: "Waiting for plan approval", status: "active" }],
      plan: {
        id: "plan-1",
        markdown: "# Execution plan\n\n- Build a regional comparison sheet",
        revision: 1,
      },
    };

    render(
      <SpreadsheetAgentPanel
        task={task}
        onGenerate={vi.fn()}
        onModify={vi.fn()}
        onRespond={vi.fn()}
        onApprovePlan={onApprovePlan}
      />,
    );

    expect(screen.getAllByText("Review the plan before continuing")).toHaveLength(2);
    expect(screen.getByText(/Build a regional comparison sheet/)).toBeTruthy();
    expect(screen.queryByText("Formatting & export")).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Spreadsheet generation request" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Approve and continue" }));
    await waitFor(() => expect(onApprovePlan).toHaveBeenCalledWith(task));
  });

  it("keeps a failed XLSX plan approval actionable", async () => {
    const task: DesktopTask = {
      id: "xlsx-plan-failure",
      conversationId: "xlsx-plan-failure",
      status: "plan_review",
      events: [],
      plan: { id: "plan-1", markdown: "# Plan", revision: 1 },
    };
    render(
      <SpreadsheetAgentPanel
        task={task}
        onGenerate={vi.fn()}
        onModify={vi.fn()}
        onRespond={vi.fn()}
        onApprovePlan={vi.fn(async () => { throw new Error("bridge unavailable"); })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Approve and continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not approve the plan: bridge unavailable");
    expect(screen.getByRole("button", { name: "Approve and continue" })).toBeEnabled();
  });

  it("responds to multi-step XLSX questions with ordered accumulated answers", async () => {
    const onRespond = vi.fn(async () => undefined);
    const question = {
      id: "xlsx-question-group",
      question: "Who is this report for?",
      options: [{ id: "leadership", label: "Leadership", recommended: true }],
      allowFreeform: true,
      currentIndex: 0,
      questions: [
        {
          id: "q-audience",
          question: "Who is this report for?",
          options: [{ id: "leadership", label: "Leadership", recommended: true }],
          allowFreeform: true,
        },
        {
          id: "q-granularity",
          question: "What data granularity do you need?",
          options: [{ id: "monthly", label: "Monthly" }],
          allowFreeform: true,
        },
      ],
    };
    const task: DesktopTask = {
      id: "xlsx-multi-question",
      conversationId: "xlsx-multi-question",
      status: "question",
      events: [],
      question,
    };
    const { rerender } = render(
      <SpreadsheetAgentPanel task={task} onGenerate={vi.fn()} onModify={vi.fn()} onRespond={onRespond} />,
    );

    expect(screen.getByRole("button", { name: "Next question" })).toBeDisabled();
    expect(screen.queryByText("What data granularity do you need?")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /leadership/i }));
    await waitFor(() => expect(onRespond).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "xlsx-multi-question",
      questionId: "xlsx-question-group",
      optionId: "leadership",
      answer: "Leadership",
      answers: [
        { questionGroupId: "xlsx-question-group", questionId: "q-audience", optionId: "leadership", answer: "Leadership", questionIndex: 0 },
      ],
    })));

    rerender(
      <SpreadsheetAgentPanel
        task={{ ...task, question: { ...question, currentIndex: 1 } }}
        onGenerate={vi.fn()}
        onModify={vi.fn()}
        onRespond={onRespond}
      />,
    );
    expect(await screen.findByText("What data granularity do you need?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Monthly" }));

    await waitFor(() => expect(onRespond).toHaveBeenLastCalledWith(expect.objectContaining({
      optionId: "monthly",
      answer: "Monthly",
      answers: [
        { questionGroupId: "xlsx-question-group", questionId: "q-audience", optionId: "leadership", answer: "Leadership", questionIndex: 0 },
        { questionGroupId: "xlsx-question-group", questionId: "q-granularity", optionId: "monthly", answer: "Monthly", questionIndex: 1 },
      ],
    })));
  });

  it("submits a freeform XLSX clarification answer", async () => {
    const onRespond = vi.fn(async () => undefined);
    const task: DesktopTask = {
      id: "xlsx-freeform-question",
      conversationId: "xlsx-freeform-question",
      status: "question",
      events: [],
      question: {
        id: "q-context",
        question: "Anything else?",
        options: [],
        allowFreeform: true,
      },
    };
    render(<SpreadsheetAgentPanel task={task} onGenerate={vi.fn()} onModify={vi.fn()} onRespond={onRespond} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Custom answer" }), { target: { value: "Include a cash flow sheet" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(onRespond).toHaveBeenCalledWith({
      taskId: "xlsx-freeform-question",
      questionId: "q-context",
      answer: "Include a cash flow sheet",
    }));
  });

  it("turns the footer composer into the custom-answer field during a question gate", async () => {
    const onRespond = vi.fn(async () => undefined);
    const onCancel = vi.fn(async () => undefined);
    const task: DesktopTask = {
      id: "xlsx-gate",
      conversationId: "xlsx-gate",
      status: "question",
      events: [],
      question: {
        id: "q-detail",
        question: "How detailed should the sheet be?",
        options: [
          { id: "detailed", label: "Detailed comparison", description: "One row per region." },
          { id: "summary", label: "Summary table" },
        ],
        allowFreeform: true,
      },
    };
    render(<SpreadsheetAgentPanel task={task} onGenerate={vi.fn()} onModify={vi.fn()} onRespond={onRespond} onCancel={onCancel} />);

    expect(screen.getByText("AI · Question")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Spreadsheet generation request" })).toBeNull();
    expect(screen.getByText("1–2 to choose · Enter to send")).toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Detailed comparison" }));
    expect(screen.getByText("One row per region.")).toBeInTheDocument();

    const composer = screen.getByRole("textbox", { name: "Custom answer" });
    fireEvent.change(composer, { target: { value: "Split by month" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    await waitFor(() => expect(onRespond).toHaveBeenCalledWith({ taskId: "xlsx-gate", questionId: "q-detail", answer: "Split by month" }));

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledWith("xlsx-gate");
  });

  it("answers with a number key from anywhere in the panel except the composer", async () => {
    const onRespond = vi.fn(async () => undefined);
    const task: DesktopTask = {
      id: "xlsx-keys",
      conversationId: "xlsx-keys",
      status: "question",
      events: [],
      question: {
        id: "q-detail",
        question: "How detailed should the sheet be?",
        options: [{ id: "detailed", label: "Detailed comparison" }, { id: "summary", label: "Summary table" }],
        allowFreeform: true,
      },
    };
    render(<SpreadsheetAgentPanel task={task} onGenerate={vi.fn()} onModify={vi.fn()} onRespond={onRespond} />);

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Custom answer" }), { key: "2" });
    expect(onRespond).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByText("How detailed should the sheet be?"), { key: "2" });
    await waitFor(() => expect(onRespond).toHaveBeenCalledWith(expect.objectContaining({ optionId: "summary", answer: "Summary table" })));
  });

  it("locks the composer when the question does not accept a freeform answer", () => {
    const task: DesktopTask = {
      id: "xlsx-no-freeform",
      conversationId: "xlsx-no-freeform",
      status: "question",
      events: [],
      question: {
        id: "q-pick",
        question: "Pick a layout",
        options: [{ id: "a", label: "Layout A" }, { id: "b", label: "Layout B" }],
        allowFreeform: false,
      },
    };
    render(<SpreadsheetAgentPanel task={task} onGenerate={vi.fn()} onModify={vi.fn()} onRespond={vi.fn()} />);

    const composer = screen.getByRole("textbox", { name: "Custom answer" });
    expect(composer).toBeDisabled();
    expect(composer).toHaveAttribute("placeholder", "Choose an option above to continue");
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
    // Nothing to explain and nothing to type: the note line stays out of the way.
    expect(screen.queryByText("Pick one, or type your own answer below.")).toBeNull();
  });
});
