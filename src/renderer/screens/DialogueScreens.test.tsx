import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopAPI, DesktopTask } from "../../shared/types";
import { officecli } from "../bridge";
import { DialogueScreen } from "./DialogueScreens";

function installDomStubs() {
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
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
  }
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

describe("DialogueScreen state machine", () => {
  it("Question state with options invokes respond with the picked option id", async () => {
    const task: DesktopTask = {
      id: "task-q",
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
    render(<DialogueScreen {...baseProps()} task={task} />);
    fireEvent.click(screen.getByRole("button", { name: /^include$/i }));
    await waitFor(() => expect(respondSpy).toHaveBeenCalledTimes(1));
    expect(respondSpy).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-q", questionId: "q-1", optionId: "include", answer: "Include" }),
    );
  });

  it("Question state freeform submits typed answer via respond", async () => {
    const task: DesktopTask = {
      id: "task-q2",
      status: "question",
      events: [],
      question: {
        id: "q-2",
        question: "Anything else?",
        options: [],
        allowFreeform: true,
      },
    };
    render(<DialogueScreen {...baseProps()} task={task} />);
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
      status: "running",
      events: [{ task_id: "task-run", type: "task.started", payload: {} }],
    };
    render(<DialogueScreen {...baseProps()} task={task} />);
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
      status: "completed",
      events: [{ task_id: "task-img", type: "task.completed", payload: { message: "done" } }],
      artifact: {
        taskId: "task-img",
        filePath: "/tmp/banner.png",
        fileName: "banner.png",
        documentType: "img",
      },
    };
    render(<DialogueScreen {...baseProps()} task={task} />);
    expect(screen.getByText("Generation Complete")).toBeTruthy();
    expect(screen.getAllByText("banner.png").length).toBeGreaterThan(0);
    const openButtons = screen.getAllByRole("button", { name: /open/i });
    expect(openButtons.length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /show in folder/i })).toBeTruthy();
  });
});
