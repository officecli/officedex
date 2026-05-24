import { act, cleanup, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

    const addButton = await screen.findByRole("button", { name: /Attach reference images/ });
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

  it("attaches pasted image files as reference images when documentType is Image", async () => {
    const bridge = installBridgeMock();
    const { App } = await import("./App");

    render(<App />);

    await screen.findByRole("heading", { name: "Start a New Generation" });
    fireEvent.click(screen.getByLabelText("Image"));
    await screen.findByRole("button", { name: /Attach reference images/ });

    const textarea = screen.getByPlaceholderText(/Enter what you want to generate/) as HTMLTextAreaElement;
    const pastedFile = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "screenshot.png", { type: "image/png" });
    firePasteWithFile(textarea, pastedFile);

    await waitFor(() => expect(bridge.savePastedImage).toHaveBeenCalledTimes(1));
    expect(bridge.savePastedImage).toHaveBeenCalledWith(expect.any(Uint8Array), "png");
    expect(await screen.findByText("pasted-1.png")).toBeTruthy();
  });

  it("does not call savePastedImage when documentType is not Image", async () => {
    const bridge = installBridgeMock();
    const { App } = await import("./App");

    render(<App />);

    await screen.findByRole("heading", { name: "Start a New Generation" });

    const textarea = screen.getByPlaceholderText(/Enter what you want to generate/) as HTMLTextAreaElement;
    const pastedFile = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "screenshot.png", { type: "image/png" });
    firePasteWithFile(textarea, pastedFile);

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(bridge.savePastedImage).not.toHaveBeenCalled();
  });
});

describe("App auto-update flow", () => {
  beforeEach(() => {
    installDomStubs();
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    delete (window as { officecli?: unknown }).officecli;
  });

  it("renders ForceUpdateOverlay and hides the main shell when release is mandatory", async () => {
    const bridge = installBridgeMock();
    const { officecli } = await import("./bridge");
    const release = {
      version: "0.5.0",
      notes: "Critical migration",
      minSupportedVersion: "0.5.0",
      mandatory: true,
      assets: {},
    };
    const status = {
      currentVersion: "0.1.0",
      latestVersion: "0.5.0",
      updateAvailable: true,
      mandatory: true,
      downloading: false,
      downloadedPath: null,
      lastCheckedAt: new Date().toISOString(),
      lastError: null,
    };
    const checkSpy = vi.fn(async () => ({ release, status }));
    const downloadSpy = vi.fn(async () => "/tmp/x.dmg");
    const installSpy = vi.fn(async () => undefined);
    officecli.checkAppUpdate = checkSpy as unknown as DesktopAPI["checkAppUpdate"];
    officecli.downloadAppUpdate = downloadSpy as unknown as DesktopAPI["downloadAppUpdate"];
    officecli.installAppUpdate = installSpy as unknown as DesktopAPI["installAppUpdate"];
    officecli.cancelAppUpdate = vi.fn(async () => undefined) as unknown as DesktopAPI["cancelAppUpdate"];
    officecli.onAppUpdateEvent = (() => () => undefined) as unknown as DesktopAPI["onAppUpdateEvent"];
    officecli.getAppVersion = (async () => "0.1.0") as unknown as DesktopAPI["getAppVersion"];

    const { App } = await import("./App");
    render(<App />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_001);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText(/Required update/i)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /Start a New Generation/i })).toBeNull();
    expect(bridge.generate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Update now"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(downloadSpy).toHaveBeenCalledTimes(1);
  });

  it("renders UpdateBanner and keeps the Shell visible when release is non-mandatory", async () => {
    installBridgeMock();
    const { officecli } = await import("./bridge");
    const release = {
      version: "0.2.0",
      notes: "Bug fixes.",
      minSupportedVersion: "0.0.0",
      mandatory: false,
      assets: {},
    };
    const status = {
      currentVersion: "0.1.0",
      latestVersion: "0.2.0",
      updateAvailable: true,
      mandatory: false,
      downloading: false,
      downloadedPath: null,
      lastCheckedAt: new Date().toISOString(),
      lastError: null,
    };
    officecli.checkAppUpdate = (async () => ({ release, status })) as unknown as DesktopAPI["checkAppUpdate"];
    officecli.downloadAppUpdate = (async () => "/tmp/x.dmg") as unknown as DesktopAPI["downloadAppUpdate"];
    officecli.installAppUpdate = (async () => undefined) as unknown as DesktopAPI["installAppUpdate"];
    officecli.cancelAppUpdate = (async () => undefined) as unknown as DesktopAPI["cancelAppUpdate"];
    officecli.onAppUpdateEvent = (() => () => undefined) as unknown as DesktopAPI["onAppUpdateEvent"];
    officecli.getAppVersion = (async () => "0.1.0") as unknown as DesktopAPI["getAppVersion"];

    const { App } = await import("./App");
    render(<App />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_001);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText(/New version 0\.2\.0 available/i)).toBeTruthy();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("App credit display", () => {
  beforeEach(() => {
    vi.resetModules();
    installDomStubs();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function overrideCreditStatus(status: {
    mode: "anonymous" | "logged_in" | "api_key";
    accessMode?: string;
    planName?: string;
    hostedCreditBalance?: number | null;
    anonymousCreditAvailable?: number | null;
    anonymousCreditReserved?: number | null;
    anonymousCreditBalance?: number | null;
    rewardRemaining?: number;
    paidKeyPrefix?: string;
    paidKeyTotal?: number;
    paidKeyUsed?: number;
    paidKeyRemaining?: number;
  }) {
    const api = (window as unknown as { officecli: DesktopAPI }).officecli;
    api.getCreditStatus = (async () => ({
      mode: status.mode,
      accessMode: status.accessMode ?? "",
      planName: status.planName ?? "",
      hostedCreditBalance: status.hostedCreditBalance ?? null,
      anonymousCreditAvailable: status.anonymousCreditAvailable ?? null,
      anonymousCreditReserved: status.anonymousCreditReserved ?? null,
      anonymousCreditBalance: status.anonymousCreditBalance ?? null,
      rewardRemaining: status.rewardRemaining ?? 0,
      paidKeyPrefix: status.paidKeyPrefix ?? "",
      paidKeyTotal: status.paidKeyTotal ?? 0,
      paidKeyUsed: status.paidKeyUsed ?? 0,
      paidKeyRemaining: status.paidKeyRemaining ?? 0,
      raw: "",
    })) as unknown as DesktopAPI["getCreditStatus"];
  }

  it("renders anonymous credit balance when getCreditStatus returns anonymous credits", async () => {
    installBridgeMock();
    overrideCreditStatus({
      mode: "anonymous",
      anonymousCreditAvailable: 75,
      anonymousCreditReserved: 25,
      anonymousCreditBalance: 100,
    });

    const { App } = await import("./App");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Show credit balance/i }));
    expect(await screen.findByText("75 / 100")).toBeTruthy();
    expect(screen.getAllByText("Credits").length).toBeGreaterThan(0);
  });

  it("renders hosted balance when getCreditStatus returns logged_in with hostedCreditBalance and ignores any anonymous fields", async () => {
    installBridgeMock();
    overrideCreditStatus({
      mode: "logged_in",
      hostedCreditBalance: 42,
      planName: "Pro",
      accessMode: "hosted",
      anonymousCreditAvailable: 10,
      anonymousCreditReserved: 0,
      anonymousCreditBalance: 10,
    });

    const { App } = await import("./App");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Show credit balance/i }));
    expect(await screen.findByText("42 credits")).toBeTruthy();
    expect(screen.getAllByText("Pro").length).toBeGreaterThan(0);
  });

  it("refreshes the sidebar credit meter after a task.completed event (covers settlement delay)", async () => {
    const bridge = installBridgeMock();
    const api = (window as unknown as { officecli: DesktopAPI }).officecli;
    const sequence: number[] = [100, 100, 80];
    let call = 0;
    api.getCreditStatus = (async () => {
      const balance = sequence[Math.min(call, sequence.length - 1)];
      call += 1;
      return {
        mode: "logged_in" as const,
        accessMode: "hosted",
        planName: "Pro",
        hostedCreditBalance: balance,
        anonymousCreditAvailable: null,
        anonymousCreditReserved: null,
        anonymousCreditBalance: null,
        rewardRemaining: 0,
        paidKeyPrefix: "",
        paidKeyTotal: 0,
        paidKeyUsed: 0,
        paidKeyRemaining: 0,
        raw: "",
      };
    }) as unknown as DesktopAPI["getCreditStatus"];

    const { App } = await import("./App");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Show credit balance/i }));
    expect(await screen.findByText("100 credits")).toBeTruthy();

    act(() => {
      bridge.emit({
        event_id: "event-credit-1",
        task_id: "task-credit-1",
        type: "task.completed",
        payload: {
          result: {
            file_path: "/tmp/credit.pptx",
            file_name: "credit.pptx",
            document_type: "pptx",
          },
        },
      });
    });

    await waitFor(() => expect(screen.getByText("80 credits")).toBeTruthy(), { timeout: 1500 });
  });
});

function firePasteWithFile(target: HTMLElement, file: File) {
  const dataTransfer = {
    files: [file] as unknown as FileList,
    items: [],
    types: ["Files"],
    getData: () => "",
  } as unknown as DataTransfer;
  const event = createEvent.paste(target, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: dataTransfer });
  fireEvent(target, event);
}

function installBridgeMock() {
  let listener: (event: BridgeEvent) => void = () => undefined;
  const generate = vi.fn(async () => ({ taskId: "task-2", sessionId: "session-2", status: "starting" }));
  const previewArtifact = vi.fn(async () => undefined);
  const openExternal = vi.fn(async () => undefined);
  const openMultiFileDialog = vi.fn<(options?: { filters?: Array<{ name: string; extensions: string[] }> }) => Promise<string[] | null>>(async () => null);
  const savePastedImage = vi.fn<(data: Uint8Array, ext: string) => Promise<string>>(
    async (_data: Uint8Array, ext: string): Promise<string> =>
      `/tmp/pasted-${savePastedImage.mock.calls.length}.${ext || "png"}`,
  );
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
    savePastedImage,
    previewArtifact,
    readArtifactFile: vi.fn(async () => ({ data: new Uint8Array() })),
    readLocalImage: vi.fn(async () => ({ data: new Uint8Array(), mime: "image/png" })),
    renderPreviewHtml: vi.fn(async () => ({ html: "<html><body>preview</body></html>" }) as { html: string } | null),
    issuePreviewToken: vi.fn(async (artifact) => ({ token: "test-token", fileName: artifact.fileName, documentType: artifact.documentType })),
    revokePreviewToken: vi.fn(async () => undefined),
    setPreviewMode: vi.fn(async () => undefined),
    login: vi.fn(async () => ({ url: "https://example.com/login" })),
    cancelLogin: vi.fn(async () => undefined),
    whoami: vi.fn(async () => ({ mode: "anonymous" as const })),
    logout: vi.fn(async () => undefined),
    getCreditStatus: vi.fn(async () => ({
      mode: "anonymous" as const,
      accessMode: "",
      planName: "",
      hostedCreditBalance: null,
      anonymousCreditAvailable: null,
      anonymousCreditReserved: null,
      anonymousCreditBalance: null,
      rewardRemaining: 0,
      paidKeyPrefix: "",
      paidKeyTotal: 0,
      paidKeyUsed: 0,
      paidKeyRemaining: 0,
      raw: "",
    })),
    redeem: vi.fn(async () => ({
      code: "",
      credit_amount: 0,
      new_balance: 0,
      redeemed_at: "",
      expires_at: null,
    })),
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
    getAppVersion: vi.fn(async () => "0.1.0"),
    getAppUpdateStatus: vi.fn(async () => ({
      currentVersion: "0.1.0",
      latestVersion: null,
      updateAvailable: false,
      mandatory: false,
      downloading: false,
      downloadedPath: null,
      lastCheckedAt: null,
      lastError: null,
    })),
    checkAppUpdate: vi.fn(async () => ({
      release: null,
      status: {
        currentVersion: "0.1.0",
        latestVersion: null,
        updateAvailable: false,
        mandatory: false,
        downloading: false,
        downloadedPath: null,
        lastCheckedAt: new Date().toISOString(),
        lastError: null,
      },
    })),
    downloadAppUpdate: vi.fn(async () => ""),
    installAppUpdate: vi.fn(async () => undefined),
    cancelAppUpdate: vi.fn(async () => undefined),
    onAppUpdateEvent: vi.fn(() => () => undefined),
    exportLogs: vi.fn(async () => ({ path: "/Users/test/Downloads/officedex-logs.zip", manifest: { schemaVersion: 1, bundleId: "test", items: [], truncated: false } })),
    submitReport: vi.fn(async () => ({ ticketId: "T-001", requestId: "req-test-123", uploaded: true })),
    getReportCapability: vi.fn(async () => ({ enabled: false, reason: "test" })),
    peekReportContext: vi.fn(async () => ({ requestId: "req-test-123", errorCode: "", errorMessage: "" })),
  };
  window.officecli = api;
  return {
    generate,
    previewArtifact,
    issuePreviewToken: api.issuePreviewToken,
    openExternal,
    openMultiFileDialog,
    savePastedImage,
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
  if (typeof Blob.prototype.arrayBuffer !== "function") {
    Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(this);
      });
    };
  }
}
