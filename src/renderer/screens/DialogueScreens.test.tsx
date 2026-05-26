import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopAPI, DesktopTask } from "../../shared/types";
import { officecli } from "../bridge";
import { DialogueScreen } from "./DialogueScreens";

function installDomStubs() {
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
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    () => ({ getPropertyValue: () => "" }) as unknown as CSSStyleDeclaration,
  );
}

let respondSpy: ReturnType<typeof vi.fn>;
let cancelSpy: ReturnType<typeof vi.fn>;
let originals: Partial<DesktopAPI>;

beforeEach(() => {
  installDomStubs();
  respondSpy = vi.fn(async () => undefined);
  cancelSpy = vi.fn(async () => undefined);
  originals = {
    respond: officecli.respond,
    cancel: officecli.cancel,
  };
  officecli.respond = respondSpy as unknown as DesktopAPI["respond"];
  officecli.cancel = cancelSpy as unknown as DesktopAPI["cancel"];
});

afterEach(() => {
  cleanup();
  Object.assign(officecli, originals);
  vi.restoreAllMocks();
});

function baseProps(overrides: Partial<React.ComponentProps<typeof DialogueScreen>> = {}) {
  return {
    tasks: [] as DesktopTask[],
    artifacts: [],
    busy: false,
    errorKind: "connection" as const,
    bridgeStatus: "connected",
    onSubmit: vi.fn(async () => undefined),
    onOpenSettings: vi.fn(),
    onOpenLogin: vi.fn(),
    onRetry: vi.fn(),
    onPreview: vi.fn(),
    ...overrides,
  };
}

function makeCompletedImageTask(overrides: Partial<DesktopTask> = {}): DesktopTask {
  return {
    id: "task-img",
    conversationId: "task-img",
    status: "completed",
    events: [{ task_id: "task-img", type: "task.completed", payload: { message: "done" } }],
    artifact: {
      taskId: "task-img",
      filePath: "/tmp/banner.png",
      fileName: "banner.png",
      documentType: "img",
    },
    ...overrides,
  };
}

function makeCompletedDocTask(docType: string, fileName: string): DesktopTask {
  return {
    id: `task-${docType}`,
    conversationId: `task-${docType}`,
    status: "completed",
    events: [{ task_id: `task-${docType}`, type: "task.completed", payload: { message: "done" } }],
    artifact: {
      taskId: `task-${docType}`,
      filePath: `/tmp/${fileName}`,
      fileName,
      documentType: docType,
    },
  };
}

describe("DialogueScreen state machine", () => {
  it("Question state with options invokes respond with the picked option id", async () => {
    const task: DesktopTask = {
      id: "task-q",
      conversationId: "task-q",
      status: "question",
      events: [],
      question: {
        id: "q-1",
        question: "Include last quarter's financial comparison data?",
        options: [
          { id: "include", label: "Include" },
          { id: "skip", label: "Exclude" },
        ],
        allowFreeform: false,
      },
    };
    render(<DialogueScreen {...baseProps()} tasks={[task]} />);
    fireEvent.click(screen.getByRole("button", { name: /^include$/i }));
    await waitFor(() => expect(respondSpy).toHaveBeenCalledTimes(1));
    expect(respondSpy).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-q", questionId: "q-1", optionId: "include", answer: "Include" }),
    );
  });

  it("Question state freeform submits typed answer via respond", async () => {
    const task: DesktopTask = {
      id: "task-q2",
      conversationId: "task-q2",
      status: "question",
      events: [],
      question: {
        id: "q-2",
        question: "Anything else?",
        options: [],
        allowFreeform: true,
      },
    };
    render(<DialogueScreen {...baseProps()} tasks={[task]} />);
    const input = screen.getByPlaceholderText(/or add other instructions/i);
    fireEvent.change(input, { target: { value: "Add appendix" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(respondSpy).toHaveBeenCalledTimes(1));
    expect(respondSpy).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-q2", questionId: "q-2", answer: "Add appendix" }),
    );
  });

  it("Running state Cancel button calls officecli.cancel with task id", async () => {
    const task: DesktopTask = {
      id: "task-run",
      conversationId: "task-run",
      status: "running",
      events: [{ task_id: "task-run", type: "task.started", payload: {} }],
    };
    render(<DialogueScreen {...baseProps()} tasks={[task]} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(cancelSpy).toHaveBeenCalledWith("task-run"));
  });

  it("connection failure banner shows Retry and triggers onRetry", () => {
    const onRetry = vi.fn();
    render(
      <DialogueScreen {...baseProps({ onRetry })} lastError="Bridge dropped" errorKind="connection" />,
    );
    const retryButtons = screen.getAllByRole("button", { name: /retry/i });
    fireEvent.click(retryButtons[0]);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("auth failure banner triggers onOpenLogin", () => {
    const onOpenLogin = vi.fn();
    render(
      <DialogueScreen
        {...baseProps({ onOpenLogin })}
        lastError="OfficeCLI is not signed in"
        errorKind="auth"
      />,
    );
    const signInButtons = screen.getAllByRole("button", { name: /sign in/i });
    fireEvent.click(signInButtons[0]);
    expect(onOpenLogin).toHaveBeenCalledTimes(1);
  });

  it("setup failure banner exposes Open Settings", () => {
    const onOpenSettings = vi.fn();
    render(
      <DialogueScreen
        {...baseProps({ onOpenSettings })}
        lastError="OfficeCLI binary is not configured"
        errorKind="setup"
      />,
    );
    const settingsButtons = screen.getAllByRole("button", { name: /settings/i });
    fireEvent.click(settingsButtons[0]);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("completed image artifact renders Open and Show in folder actions", () => {
    const task: DesktopTask = {
      id: "task-img",
      conversationId: "task-img",
      status: "completed",
      events: [{ task_id: "task-img", type: "task.completed", payload: { message: "done" } }],
      artifact: {
        taskId: "task-img",
        filePath: "/tmp/banner.png",
        fileName: "banner.png",
        documentType: "img",
      },
    };
    render(<DialogueScreen {...baseProps()} tasks={[task]} />);
    expect(screen.getByText("Generation Complete")).toBeTruthy();
    expect(screen.getAllByText("banner.png").length).toBeGreaterThan(0);
    const openButtons = screen.getAllByRole("button", { name: /open/i });
    expect(openButtons.length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /show in folder/i })).toBeTruthy();
  });

  it("failed task with credits-exhausted error shows Sign In button wired to onOpenLogin", () => {
    const onOpenLogin = vi.fn();
    const task: DesktopTask = {
      id: "task-credits",
      conversationId: "task-credits",
      status: "failed",
      events: [{ task_id: "task-credits", type: "task.failed", payload: { message: "Anonymous credits are exhausted. Run `officecli login`, then buy hosted credits for your account." } }],
      error: "Anonymous credits are exhausted. Run `officecli login`, then buy hosted credits for your account.",
    };
    render(<DialogueScreen {...baseProps({ onOpenLogin })} tasks={[task]} />);
    expect(screen.getByText(/used up the free credits for anonymous use/i)).toBeTruthy();
    const signInBtn = screen.getByRole("button", { name: /sign in to continue/i });
    fireEvent.click(signInBtn);
    expect(onOpenLogin).toHaveBeenCalledTimes(1);
  });
});

describe("Conversation multi-round", () => {
  it("renders time markers for each task round", () => {
    const task1: DesktopTask = {
      id: "task-1",
      conversationId: "conv-1",
      status: "completed",
      events: [{ task_id: "task-1", type: "task.completed", ts: "2026-05-26T10:00:00Z", payload: { message: "done" } }],
    };
    const task2: DesktopTask = {
      id: "task-2",
      conversationId: "conv-1",
      parentTaskId: "task-1",
      status: "completed",
      events: [{ task_id: "task-2", type: "task.completed", ts: "2026-05-26T10:05:00Z", payload: { message: "done" } }],
    };
    render(<DialogueScreen {...baseProps()} tasks={[task1, task2]} />);

    // Two time markers (one per round) — verify they exist and differ
    const markers = document.querySelectorAll(".time-marker");
    expect(markers.length).toBe(2);
    // Content depends on local timezone rendering, just verify non-empty dates
    const datePattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
    expect(datePattern.test(markers[0].textContent?.trim() || "")).toBe(true);
    expect(datePattern.test(markers[1].textContent?.trim() || "")).toBe(true);
    expect(markers[0].textContent).not.toBe(markers[1].textContent);
  });
});

describe("Bottom continuation composer — acceptance criteria", () => {
  it("T1: renders on a completed image task with correct placeholder", () => {
    const task = makeCompletedImageTask();
    render(<DialogueScreen {...baseProps()} tasks={[task]} />);
    const composer = screen.getByTestId("continuation-composer");
    expect(composer).toBeTruthy();
    expect(screen.getByPlaceholderText(/describe what you want to generate/i)).toBeTruthy();
  });

  it("T2: renders on completed non-image tasks (all types support continuation)", () => {
    for (const [docType, fileName] of [
      ["pptx", "deck.pptx"],
      ["docx", "letter.docx"],
      ["xlsx", "data.xlsx"],
      ["report", "analysis.report"],
    ] as const) {
      cleanup();
      const task = makeCompletedDocTask(docType, fileName);
      render(<DialogueScreen {...baseProps()} tasks={[task]} />);
      expect(screen.getByTestId("continuation-composer")).toBeTruthy();
    }
  });

  it("T3: NOT rendered on running tasks, rendered on terminal tasks", () => {
    const runningTask: DesktopTask = {
      id: "task-run",
      conversationId: "task-run",
      status: "running",
      events: [{ task_id: "task-run", type: "task.started", payload: {} }],
    };
    render(<DialogueScreen {...baseProps()} tasks={[runningTask]} />);
    expect(screen.queryByTestId("continuation-composer")).toBeNull();
    cleanup();

    const failedTask: DesktopTask = {
      id: "task-fail",
      conversationId: "task-fail",
      status: "failed",
      events: [{ task_id: "task-fail", type: "task.failed", payload: { message: "err" } }],
    };
    render(<DialogueScreen {...baseProps()} tasks={[failedTask]} />);
    expect(screen.getByTestId("continuation-composer")).toBeTruthy();
  });

  it("T4: submit button disabled when textarea empty, enabled with non-whitespace", () => {
    const task = makeCompletedImageTask();
    render(<DialogueScreen {...baseProps()} tasks={[task]} />);
    const submitBtn = screen.getByTestId("continuation-composer").querySelector("button")!;
    expect(submitBtn.disabled).toBe(true);

    const textarea = screen.getByPlaceholderText(/describe what you want to generate/i);
    fireEvent.change(textarea, { target: { value: "Make sky brighter" } });
    expect(submitBtn.disabled).toBe(false);
  });

  it("T5: clicking submit calls onContinueGeneration with documentType, prompt, and referenceImages", () => {
    const onContinueGeneration = vi.fn();
    const task = makeCompletedImageTask();
    render(<DialogueScreen {...baseProps({ onContinueGeneration })} tasks={[task]} />);

    const textarea = screen.getByPlaceholderText(/describe what you want to generate/i);
    fireEvent.change(textarea, { target: { value: "Add a sunset" } });
    const submitBtn = screen.getByTestId("continuation-composer").querySelector("button")!;
    fireEvent.click(submitBtn);

    expect(onContinueGeneration).toHaveBeenCalledTimes(1);
    expect(onContinueGeneration).toHaveBeenCalledWith("img", "Add a sunset", undefined);
  });

  it("T6: Enter submits, Shift+Enter does not", () => {
    const onContinueGeneration = vi.fn();
    const task = makeCompletedImageTask();
    render(<DialogueScreen {...baseProps({ onContinueGeneration })} tasks={[task]} />);

    const textarea = screen.getByPlaceholderText(/describe what you want to generate/i);
    fireEvent.change(textarea, { target: { value: "Brighten colors" } });

    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onContinueGeneration).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    expect(onContinueGeneration).toHaveBeenCalledTimes(1);
    expect(onContinueGeneration).toHaveBeenCalledWith("img", "Brighten colors", undefined);
  });
});
