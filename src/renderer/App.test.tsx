import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeEvent, DesktopAPI } from "../shared/types";
import { applyTaskEvent, createInitialTaskState, reduceStages } from "./taskState";

describe("reduceStages", () => {
  it("derives four default stages from task.started + progress events", () => {
    const { stages, activeStageId } = reduceStages([
      { task_id: "t", type: "task.started", payload: {} },
      { task_id: "t", type: "task.progress", payload: {} },
      { task_id: "t", type: "task.progress", payload: {} },
    ]);
    expect(stages).toHaveLength(4);
    expect(stages.map((s) => s.id)).toEqual(["analyze", "outline", "writing", "format"]);
    expect(stages[0].status).toBe("completed");
    expect(stages[1].status).toBe("active");
    expect(stages[2].status).toBe("pending");
    expect(stages[3].status).toBe("pending");
    expect(activeStageId).toBe("outline");
  });

  it("uses payload.stage as the human-readable label override", () => {
    const { stages } = reduceStages([
      { task_id: "t", type: "task.progress", payload: { stage: "Generating milestone sections" } },
    ]);
    expect(stages[0].label).toBe("Generating milestone sections");
    expect(stages[0].status).toBe("active");
  });

  it("marks all stages completed when task.completed arrives", () => {
    const { stages, activeStageId } = reduceStages([
      { task_id: "t", type: "task.progress", payload: {} },
      { task_id: "t", type: "task.completed", payload: {} },
    ]);
    expect(stages.every((s) => s.status === "completed")).toBe(true);
    expect(activeStageId).toBeUndefined();
  });

  it("marks the current active stage failed on task.failed", () => {
    const { stages } = reduceStages([
      { task_id: "t", type: "task.progress", payload: {} },
      { task_id: "t", type: "task.progress", payload: {} },
      { task_id: "t", type: "task.failed", payload: { message: "boom" } },
    ]);
    expect(stages[0].status).toBe("completed");
    expect(stages[1].status).toBe("failed");
  });

  it("honors native payload.stage_id and ignores derived defaults", () => {
    const { stages, activeStageId } = reduceStages([
      { task_id: "t", type: "task.progress", payload: { stage_id: "ingest", stage_label: "Ingesting" } },
      { task_id: "t", type: "task.progress", payload: { stage_id: "render", stage_label: "Rendering" } },
    ]);
    expect(stages.map((s) => s.id)).toEqual(["ingest", "render"]);
    expect(stages[0].status).toBe("completed");
    expect(stages[1].status).toBe("active");
    expect(activeStageId).toBe("render");
  });

  it("applyTaskEvent attaches stages to the DesktopTask", () => {
    let state = createInitialTaskState();
    state = applyTaskEvent(state, { task_id: "t", type: "task.started", payload: {} });
    state = applyTaskEvent(state, { task_id: "t", type: "task.progress", payload: {} });
    const task = state.tasks["t"];
    expect(task.stages).toBeDefined();
    expect(task.stages![0].status).toBe("active");
    expect(task.activeStageId).toBe("analyze");
  });
});

describe("App task flow", () => {
  beforeEach(() => {
    vi.resetModules();
    installDomStubs();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("keeps New Generation on a blank composer after a previous task exists and submits another generate request", async () => {
    const bridge = installBridgeMock();
    const { App } = await import("./App");

    render(<App />);

    act(() => {
      bridge.emit({
        event_id: "event-1",
        task_id: "task-1",
        type: "task.completed",
        payload: {
          result: {
            file_path: "/tmp/previous.pptx",
            file_name: "previous.pptx",
            document_type: "pptx",
          },
        },
      });
    });

    expect(await screen.findByText("Generation Complete")).toBeTruthy();

    expect(screen.queryByText("Fluid")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: /New Generation/ })[0]);

    expect(await screen.findByRole("heading", { name: "Start a New Generation" })).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/Enter what you want to generate/), {
      target: { value: "Generate a new quarterly review PPT" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Generate$/ }));

    await waitFor(() => expect(bridge.generate).toHaveBeenCalledTimes(1));
    expect(bridge.generate).toHaveBeenCalledWith(expect.objectContaining({ prompt: "Generate a new quarterly review PPT" }));
  });

  it("renders a failed task with its recorded error and bridge event context", async () => {
    const bridge = installBridgeMock();
    const { App } = await import("./App");

    render(<App />);

    act(() => {
      bridge.emit({
        event_id: "event-failed",
        task_id: "task-failed",
        type: "task.failed",
        payload: { message: "model quota exceeded" },
      });
    });

    expect(await screen.findByText("Generation Failed")).toBeTruthy();
    expect(screen.getAllByText("model quota exceeded").length).toBeGreaterThan(0);
    expect(screen.getByText("task.failed")).toBeTruthy();
  });

  it("renders a cancelled task as a visible terminal state", async () => {
    const bridge = installBridgeMock();
    const { App } = await import("./App");

    render(<App />);

    act(() => {
      bridge.emit({
        event_id: "event-cancelled",
        task_id: "task-cancelled",
        type: "task.cancelled",
        payload: { message: "User cancelled the task" },
      });
    });

    expect(await screen.findByText("Task Cancelled")).toBeTruthy();
    expect(screen.getAllByText("User cancelled the task").length).toBeGreaterThan(0);
    expect(screen.getByText("task.cancelled")).toBeTruthy();
  });

  it("shows real bridge tasks in Recent Tasks and reopens the selected task dialogue", async () => {
    const bridge = installBridgeMock();
    const { App } = await import("./App");

    render(<App />);

    act(() => {
      bridge.emit({
        event_id: "event-live-1",
        task_id: "task-live",
        type: "task.started",
        payload: { document_type: "pptx", topic: "Live Bridge Task" },
      });
    });

    fireEvent.click(screen.getAllByRole("button", { name: /New Generation/ })[0]);
    expect(await screen.findByRole("heading", { name: "Start a New Generation" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Tasks/ }));

    expect(await screen.findByText("Live Bridge Task")).toBeTruthy();
    expect(screen.getAllByText("Running").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Live Bridge Task/ }));

    expect(await screen.findByText("Processing your request...")).toBeTruthy();
  });

  it("uses the page-level New Generation button to return to a blank composer", async () => {
    const bridge = installBridgeMock();
    const { App } = await import("./App");

    render(<App />);

    act(() => {
      bridge.emit({
        event_id: "event-completed",
        task_id: "task-completed",
        type: "task.completed",
        payload: {
          result: {
            file_path: "/tmp/completed.pptx",
            file_name: "completed.pptx",
            document_type: "pptx",
          },
        },
      });
    });

    expect(await screen.findByText("Generation Complete")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Tasks/ }));

    const tasksPage = screen.getByRole("heading", { name: "Recent Tasks" }).closest(".page-stack");
    expect(tasksPage).toBeTruthy();
    fireEvent.click(within(tasksPage as HTMLElement).getByRole("button", { name: /New Generation/ }));

    expect(await screen.findByRole("heading", { name: "Start a New Generation" })).toBeTruthy();
  });

  it("renders offline preview for office artifacts without exposing previewUrl online preview", async () => {
    const bridge = installBridgeMock();
    const { ArtifactsScreen } = await import("./screens/DataScreens");
    const artifact = {
      taskId: "task-no-preview",
      filePath: "/tmp/no-preview.docx",
      fileName: "no-preview.docx",
      documentType: "docx",
      previewUrl: "https://platform.officecli.io/files/no-preview",
    };
    const onPreview = vi.fn();

    render(
      <ArtifactsScreen fluid={false} onNewGeneration={vi.fn()} artifacts={[artifact]} onPreview={onPreview} />,
    );

    expect(screen.getByText("no-preview.docx")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Online Preview/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Preview/ }));
    expect(onPreview).toHaveBeenCalledWith(artifact);
    expect(bridge.openExternal).not.toHaveBeenCalled();
  });

  it("renders the artifacts empty state without production mock files", async () => {
    installBridgeMock();
    const { ArtifactsScreen } = await import("./screens/DataScreens");

    render(<ArtifactsScreen fluid={false} onNewGeneration={vi.fn()} artifacts={[]} onPreview={vi.fn()} />);

    expect(screen.getByText("No files generated yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Generate Now/ })).toBeTruthy();
    expect(screen.queryByText("2024_Q3_Marketing_Strategy_Report_v2.docx")).toBeNull();
  });

  it("renders real artifacts without the empty CTA or mock fallback", async () => {
    installBridgeMock();
    const { ArtifactsScreen } = await import("./screens/DataScreens");

    render(
      <ArtifactsScreen fluid={false} onNewGeneration={vi.fn()} artifacts={[
          {
            taskId: "task-real",
            filePath: "/tmp/real-board-report.xlsx",
            fileName: "real-board-report.xlsx",
            documentType: "xlsx",
            syncedAt: "2026-05-20 09:00",
          },
        ]} onPreview={vi.fn()} />,
    );

    expect(screen.getByText("real-board-report.xlsx")).toBeTruthy();
    expect(screen.queryByText("No files generated yet")).toBeNull();
    expect(screen.queryByText("2024_Q3_Marketing_Strategy_Report_v2.docx")).toBeNull();
  });

  it("renders Fluid artifacts empty state without a detail pane from mocks", async () => {
    installBridgeMock();
    const { ArtifactsScreen } = await import("./screens/DataScreens");

    render(<ArtifactsScreen fluid onNewGeneration={vi.fn()} artifacts={[]} onPreview={vi.fn()} />);

    expect(screen.getByText("No files generated yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Generate Now/ })).toBeTruthy();
    expect(screen.queryByText("Generation Prompt")).toBeNull();
    expect(screen.queryByText("2024_Q3_Marketing_Strategy_Report_v2.docx")).toBeNull();
  });

  it("renders Fluid artifact detail from the selected real artifact only", async () => {
    installBridgeMock();
    const { ArtifactsScreen } = await import("./screens/DataScreens");

    render(
      <ArtifactsScreen fluid onNewGeneration={vi.fn()} artifacts={[
          {
            taskId: "task-fluid",
            filePath: "/tmp/client-roadmap.pptx",
            fileName: "client-roadmap.pptx",
            documentType: "pptx",
            syncedAt: "2026-05-20T10:30:00+08:00",
          },
        ]} onPreview={vi.fn()} />,
    );

    expect(screen.getAllByText("client-roadmap.pptx").length).toBeGreaterThan(0);
    expect(screen.getAllByText("PPTX").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2026-05-20T10:30:00+08:00").length).toBeGreaterThan(0);
    expect(screen.queryByText("Generation Prompt")).toBeNull();
    expect(screen.queryByText("GPT-4 Turbo")).toBeNull();
    expect(screen.queryByText("2024-10-26 14:30")).toBeNull();
    expect(screen.queryByText("2.4 MB")).toBeNull();
    expect(screen.queryByText("Q3")).toBeNull();
  });

  it("does not expose previewUrl online preview in Fluid artifact detail and uses offline preview", async () => {
    const bridge = installBridgeMock();
    const { ArtifactsScreen } = await import("./screens/DataScreens");
    const artifact = {
      taskId: "task-fluid-preview",
      filePath: "/tmp/fluid-preview.pptx",
      fileName: "fluid-preview.pptx",
      documentType: "pptx",
      previewUrl: "https://platform.officecli.io/files/fluid-preview",
    };
    const onPreview = vi.fn();

    render(<ArtifactsScreen fluid onNewGeneration={vi.fn()} artifacts={[artifact]} onPreview={onPreview} />);

    expect(screen.queryByRole("button", { name: /Online Preview/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Preview/ }));
    expect(onPreview).toHaveBeenCalledWith(artifact);
    expect(bridge.openExternal).not.toHaveBeenCalled();
  });

  it("renders running dialogue from task topic and bridge events instead of Q3 sample text", async () => {
    installBridgeMock();
    const { DialogueScreen } = await import("./screens/DialogueScreens");

    render(
      <DialogueScreen
        task={{
          id: "task-running",
          status: "running",
          topic: "Auto-generate product roadmap",
          documentType: "pptx",
          events: [
            {
              event_id: "event-started",
              task_id: "task-running",
              type: "task.started",
              ts: "2026-05-20T10:00:00+08:00",
              payload: { message: "Roadmap task started" },
            },
            {
              event_id: "event-progress",
              task_id: "task-running",
              type: "task.progress",
              ts: "2026-05-20T10:00:05+08:00",
              payload: { stage: "Generating milestone sections" },
            },
          ],
        }}
        artifacts={[]}
        busy={false}
        bridgeStatus="connected"
        fluid={false}
        onSubmit={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenLogin={vi.fn()}
        onRetry={vi.fn()}
        onPreview={vi.fn()}
        errorKind="connection"
      />,
    );

    expect(screen.getByText("Auto-generate product roadmap")).toBeTruthy();
    expect(screen.getByText(/Roadmap task started/)).toBeTruthy();
    expect(screen.getAllByText("Generating milestone sections").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Q3 promo/)).toBeNull();
    expect(screen.queryByText(/market data report/)).toBeNull();
    expect(screen.queryByText(/knowledge base/)).toBeNull();
  });

  it("renders completed dialogue from the current task artifact and event payload", async () => {
    const bridge = installBridgeMock();
    const { DialogueScreen } = await import("./screens/DialogueScreens");
    const artifact = {
      taskId: "task-completed-real",
      filePath: "/tmp/budget-summary.docx",
      fileName: "budget-summary.docx",
      documentType: "docx",
      syncedAt: "2026-05-20 11:30",
      previewUrl: "https://platform.officecli.io/files/budget-summary",
    };
    const onPreview = vi.fn();

    render(
      <DialogueScreen
        task={{
          id: "task-completed-real",
          status: "completed",
          topic: "Annual budget review",
          documentType: "docx",
          events: [
            {
              event_id: "event-completed-real",
              task_id: "task-completed-real",
              type: "task.completed",
              ts: "2026-05-20T11:30:00+08:00",
              payload: { message: "Budget review synced" },
            },
          ],
          artifact,
        }}
        artifacts={[
          {
            taskId: "other-task",
            filePath: "/tmp/other-task.pptx",
            fileName: "other-task.pptx",
            documentType: "pptx",
          },
        ]}
        busy={false}
        bridgeStatus="connected"
        fluid={false}
        onSubmit={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenLogin={vi.fn()}
        onRetry={vi.fn()}
        onPreview={onPreview}
        errorKind="connection"
      />,
    );

    expect(screen.getByText("Budget review synced")).toBeTruthy();
    expect(screen.getByText("budget-summary.docx")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Online Preview/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Preview/ }));
    expect(onPreview).toHaveBeenCalledWith(artifact);
    expect(bridge.openExternal).not.toHaveBeenCalled();
    expect(screen.queryByText("other-task.pptx")).toBeNull();
    expect(screen.queryByText(/Q3/)).toBeNull();
    expect(screen.queryByText("12s elapsed")).toBeNull();
    expect(screen.queryByText(/2.4 MB/)).toBeNull();
    expect(screen.queryByText(/Just now/)).toBeNull();
  });

  it("does not show another task artifact when a completed task has no artifact", async () => {
    installBridgeMock();
    const { DialogueScreen } = await import("./screens/DialogueScreens");

    render(
      <DialogueScreen
        task={{
          id: "task-completed-empty",
          status: "completed",
          topic: "Completed only",
          documentType: "report",
          events: [
            {
              event_id: "event-completed-empty",
              task_id: "task-completed-empty",
              type: "task.completed",
              payload: { status: "completed" },
            },
          ],
        }}
        artifacts={[
          {
            taskId: "other-task",
            filePath: "/tmp/other-task.pptx",
            fileName: "other-task.pptx",
            documentType: "pptx",
          },
        ]}
        busy={false}
        bridgeStatus="connected"
        fluid={false}
        onSubmit={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenLogin={vi.fn()}
        onRetry={vi.fn()}
        onPreview={vi.fn()}
        errorKind="connection"
      />,
    );

    expect(screen.getByText("Generation Complete")).toBeTruthy();
    expect(screen.getByText("Completed only")).toBeTruthy();
    expect(screen.queryByText("other-task.pptx")).toBeNull();
  });

  it("submits referenceImages when documentType is Image and the user picks reference images", async () => {
    const bridge = installBridgeMock();
    bridge.openMultiFileDialog.mockResolvedValueOnce(["/tmp/ref-a.png", "/tmp/ref-b.jpg"]);
    const { App } = await import("./App");

    render(<App />);

    await screen.findByRole("heading", { name: "Start a New Generation" });

    fireEvent.click(screen.getByLabelText("Image"));

    const addButton = await screen.findByRole("button", { name: /Add reference image/ });
    fireEvent.click(addButton);

    await waitFor(() => expect(bridge.openMultiFileDialog).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("ref-a.png")).toBeTruthy();
    expect(screen.getByText("ref-b.jpg")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText(/Enter what you want to generate/), {
      target: { value: "Match the style of these references" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Generate$/ }));

    await waitFor(() => expect(bridge.generate).toHaveBeenCalledTimes(1));
    expect(bridge.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        documentType: "img",
        referenceImages: ["/tmp/ref-a.png", "/tmp/ref-b.jpg"],
      }),
    );
  });

  it("does not include referenceImages when documentType is not Image", async () => {
    const bridge = installBridgeMock();
    const { App } = await import("./App");

    render(<App />);

    await screen.findByRole("heading", { name: "Start a New Generation" });

    fireEvent.change(screen.getByPlaceholderText(/Enter what you want to generate/), {
      target: { value: "Build a deck" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Generate$/ }));

    await waitFor(() => expect(bridge.generate).toHaveBeenCalledTimes(1));
    expect(bridge.generate).toHaveBeenCalledWith(expect.not.objectContaining({ referenceImages: expect.anything() }));
  });
});

function installBridgeMock() {
  let listener: (event: BridgeEvent) => void = () => undefined;
  const generate = vi.fn(async () => ({ taskId: "task-2", sessionId: "session-2", status: "starting" }));
  const previewArtifact = vi.fn(async () => undefined);
  const openExternal = vi.fn(async () => undefined);
  const openMultiFileDialog = vi.fn<(options?: { filters?: Array<{ name: string; extensions: string[] }> }) => Promise<string[] | null>>(async () => null);
  const api: DesktopAPI = {
    initialize: vi.fn(async () => ({})),
    getCapabilities: vi.fn(async () => ({})),
    generate,
    respond: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    openPath: vi.fn(async () => undefined),
    showItemInFolder: vi.fn(async () => undefined),
    openExternal,
    openFileDialog: vi.fn(async () => null),
    openMultiFileDialog,
    previewArtifact,
    readArtifactFile: vi.fn(async () => ({ data: new Uint8Array() })),
    renderPreviewHtml: vi.fn(async () => ({ html: "<html><body>preview</body></html>" }) as { html: string } | null),
    issuePreviewToken: vi.fn(async (artifact) => ({ token: "test-token", fileName: artifact.fileName, documentType: artifact.documentType })),
    revokePreviewToken: vi.fn(async () => undefined),
    setPreviewMode: vi.fn(async () => undefined),
    login: vi.fn(async () => ({ url: "https://example.com/login" })),
    cancelLogin: vi.fn(async () => undefined),
    whoami: vi.fn(async () => ({ mode: "anonymous" as const })),
    logout: vi.fn(async () => undefined),
    getSettings: vi.fn(async () => ({
      version: 1,
      defaults: {
        documentType: "pptx" as const,
        mode: "fast" as const,
        runtimeMode: "hosted" as const,
        enableImages: true,
        imageQuality: "standard" as const,
      },
      outputDir: null,
      bridgeBinaryPath: null,
      llmProvider: null,
      onboardingCompletedAt: "2026-05-22T00:00:00.000Z",
    })),
    updateSettings: vi.fn(async (patch) => ({
      version: 1,
      defaults: {
        documentType: "pptx" as const,
        mode: "fast" as const,
        runtimeMode: "hosted" as const,
        enableImages: true,
        imageQuality: "standard" as const,
        ...(patch.defaults ?? {}),
      },
      outputDir: patch.outputDir ?? null,
      bridgeBinaryPath: patch.bridgeBinaryPath ?? null,
      llmProvider: patch.llmProvider ?? null,
      onboardingCompletedAt: patch.onboardingCompletedAt ?? "2026-05-22T00:00:00.000Z",
    })),
    getDefaultWorkspaceDir: vi.fn(async () => "/Users/test/Library/Application Support/OfficeDex/workspace"),
    onAuthEvent: vi.fn(() => () => undefined),
    onBridgeEvent: vi.fn((callback) => {
      listener = callback;
      return () => undefined;
    }),
  };
  window.officecli = api;
  return {
    generate,
    previewArtifact,
    issuePreviewToken: api.issuePreviewToken,
    openExternal,
    openMultiFileDialog,
    emit(event: BridgeEvent) {
      listener(event);
    },
  };
}

function installDomStubs() {
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
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    () =>
      ({
        getPropertyValue: () => "",
      }) as unknown as CSSStyleDeclaration,
  );
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
}
