import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeEvent, DesktopAPI, UserSettings } from "../shared/types";

const mocks = vi.hoisted(() => ({
  listener: (() => undefined) as (event: BridgeEvent) => void,
  generate: vi.fn(),
  // The document list App derives from task state, captured on every render:
  // one entry per task, titled by that task's own topic.
  documents: [] as Array<{ id: string; title: string; conversationId?: string }>,
  // The rail's revision, captured on every render: Shell collapses the task
  // sidebar when App reports that a document workbench opened.
  railRevision: 0,
}));

const settings: UserSettings = {
  version: 1,
  defaults: { documentType: "pptx", enableImages: true, enableWebSearch: false, imageQuality: "premium" },
  workspaceDir: null,
  outputDir: null,
  llmProvider: null,
  onboardingCompletedAt: "2026-05-22T00:00:00.000Z",
  proxy: null,
  imageWatermark: { showWatermark: true, preferenceSource: "system" },
  waiting2048Enabled: false,
};

const PROMPT_LABEL = "Describe the result you want";

vi.mock("./notifications", () => ({ maybeNotify: vi.fn() }));

vi.mock("./bridge", () => ({
  officecli: {
    initialize: vi.fn(async () => ({})),
    getCapabilities: vi.fn(async () => ({})),
    whoami: vi.fn(async () => ({ mode: "anonymous" as const })),
    onFileDrop: vi.fn(() => () => undefined),
    getTaskHistory: vi.fn(async () => []),
    listWorkspaces: vi.fn(async () => []),
    listRecentFiles: vi.fn(async () => []),
    openFileDialog: vi.fn(),
    openRecentFile: vi.fn(async (file) => ({ taskId: file.taskId ?? "", filePath: file.filePath, fileName: file.fileName, documentType: file.documentType })),
    issuePreviewToken: vi.fn(async (artifact) => ({ token: "preview-test", documentType: artifact.documentType, fileName: artifact.fileName })),
    revokePreviewToken: vi.fn(async () => undefined),
    createLivePptxDraft: vi.fn(async (taskId: string) => ({ filePath: `/tmp/live-${taskId}-1.pptx`, fileName: `live-${taskId}-1.pptx` })),
    addWorkspace: vi.fn(),
    selectWorkspace: vi.fn(),
    removeWorkspace: vi.fn(),
    generate: (...args: unknown[]) => mocks.generate(...args),
    onBridgeEvent: vi.fn((callback: (event: BridgeEvent) => void) => {
      mocks.listener = callback;
      return () => undefined;
    }),
  } as Partial<DesktopAPI>,
}));

vi.mock("./useCreditStatus", () => ({
  useCreditStatus: () => ({ credit: null, refresh: vi.fn(), nudgeForTaskTransition: vi.fn() }),
}));
vi.mock("./useSettings", () => ({
  useSettings: () => ({ settings, defaultWorkspaceDir: "/tmp/default-workspace", loading: false }),
}));
vi.mock("./useAppUpdate", () => ({
  useAppUpdate: () => ({ status: { mandatory: false }, release: null }),
}));
// The real Shell is heavy, but the test needs its one behaviour that matters
// here: navigating back to Home, which is how a second task is submitted while
// the first is running.
vi.mock("./components/Shell", () => ({
  Shell: ({ children, inspector, onNavChange, documents, onOpenDocument, documentOpenRevision }: { children: React.ReactNode; inspector?: React.ReactNode; onNavChange: (key: string) => void; documents?: Array<{ id: string; title: string; conversationId?: string }>; onOpenDocument: (document: { id: string; title: string }) => void; documentOpenRevision?: number }) => {
    mocks.documents = documents ?? [];
    mocks.railRevision = documentOpenRevision ?? 0;
    return (
      <div>
        <button type="button" onClick={() => onNavChange("home")}>go-home</button>
        {documents?.map(document => <button key={document.id} onClick={() => onOpenDocument(document)}>open-{document.id}</button>)}
        {inspector}
        {children}
      </div>
    );
  },
  MaterialSymbol: () => null,
}));
vi.mock("./screens/DataScreens", () => ({ TasksScreen: () => <div>Tasks</div> }));
vi.mock("./screens/SettingsScreens", () => ({
  LoginScreen: () => <div>Login</div>,
  SettingsScreen: () => <div>Settings</div>,
}));
vi.mock("./screens/OnboardingScreen", () => ({ OnboardingScreen: () => <div>Onboarding</div> }));
vi.mock("./components/PreviewPanel", () => ({ PreviewPanel: ({ onClose }: { onClose: () => void }) => <button onClick={onClose}>editor-back</button> }));
vi.mock("./spreadsheet/SpreadsheetWorkspace", async () => {
  const { forwardRef } = await import("react");
  return { SpreadsheetWorkspace: forwardRef((_props: { onBack: () => void }, _ref) => <button onClick={_props.onBack}>editor-back</button>) };
});
vi.mock("./components/ForceUpdateOverlay", () => ({ ForceUpdateOverlay: () => null }));

/** Types a prompt into the home intake and submits it with Enter. */
async function submitPrompt(text: string) {
  const boxes = await screen.findAllByLabelText(PROMPT_LABEL);
  const box = boxes.find((node) => node.tagName === "TEXTAREA")!;
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter" });
}

describe("parallel task submissions", () => {
  beforeEach(() => {
    mocks.listener = () => undefined;
    mocks.generate.mockReset();
    mocks.documents = [];
    mocks.railRevision = 0;
    // App persists its route in sessionStorage; without clearing it each test
    // boots into the previous test's document view instead of Home.
    window.sessionStorage.clear();
    window.localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it.each(["docx", "pptx", "xlsx"])("keeps a locally opened %s in a full sidebar and reopens it", async (documentType) => {
    const { officecli } = await import("./bridge");
    const file = {
      filePath: `/tmp/local.${documentType}`,
      fileName: `local.${documentType}`,
      documentType,
      source: "local" as const,
      lastOpenedAt: "2026-09-11T12:00:00Z",
    };
    vi.mocked(officecli.getTaskHistory).mockResolvedValueOnce(Array.from({ length: 40 }, (_, index) => ({
      taskId: `old-${index}`,
      createdAt: "2026-09-01T00:00:00Z",
      events: [{
        task_id: `old-${index}`,
        type: "task.completed",
        payload: {
          document_type: "docx",
          result: { file_path: `/tmp/old-${index}.docx`, file_name: `old-${index}.docx`, document_type: "docx" },
        },
      }],
    })));
    vi.mocked(officecli.openFileDialog).mockResolvedValueOnce(file.filePath);

    const { App } = await import("./App");
    render(<App />);
    await waitFor(() => expect(mocks.documents).toHaveLength(40));
    vi.mocked(officecli.listRecentFiles).mockResolvedValueOnce([file]).mockResolvedValueOnce([file]);
    fireEvent.click(screen.getByRole("button", { name: "Add reference" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Open file/ }));
    await waitFor(() => expect(mocks.documents[0]).toMatchObject({ id: `file:${file.filePath}`, title: file.fileName }));
    expect(mocks.documents).toHaveLength(40);
    fireEvent.click(await screen.findByText("editor-back"));
    fireEvent.click(screen.getByText(`open-file:${file.filePath}`));
    await waitFor(() => expect(officecli.openRecentFile).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("editor-back")).toBeInTheDocument();
    // Opening the workbench is the document step in every suite, and the step
    // owns the window: the task rail is told to collapse for all three.
    await waitFor(() => expect(mocks.railRevision).toBeGreaterThan(0));
  });

  // A running pptx task opens its own draft in the workbench, with no click on
  // a file: the deck is drawn into an editor the runtime put there. That is the
  // generation step, and it used to be the one way in that left the task rail
  // docked over the deck for the whole run.
  it("hides the task rail when a running task's live draft opens the workbench", async () => {
    const { officecli } = await import("./bridge");

    const { App } = await import("./App");
    render(<App />);
    await waitFor(() => expect(mocks.listener).not.toBe(undefined));
    expect(mocks.railRevision).toBe(0);

    await act(async () => {
      mocks.listener({ type: "task.started", task_id: "live-1", payload: { document_type: "pptx" } });
      mocks.listener({ type: "task.vibe_ops", task_id: "live-1", payload: { ops: [{ op: "shape.add", seq: 1 }] } });
    });

    await waitFor(() => expect(officecli.createLivePptxDraft).toHaveBeenCalledWith("live-1"));
    expect(await screen.findByText("editor-back")).toBeInTheDocument();
    await waitFor(() => expect(mocks.railRevision).toBeGreaterThan(0));
  });

  it.each(["docx", "pptx", "xlsx", "img", "gif"])("returns the %s editor to New without a completed-result page", async (documentType) => {
    const { App, writeStoredAppRoute, readStoredAppRoute } = await import("./App");
    writeStoredAppRoute({ nav: "document", taskId: "finished" });
    render(<App />);
    await act(async () => {
      mocks.listener({ type: "task.completed", task_id: "finished", payload: {
        document_type: documentType,
        result: { file_path: `/tmp/result.${documentType}`, file_name: `result.${documentType}`, document_type: documentType },
      } });
    });
    await waitFor(() => expect(readStoredAppRoute()).toEqual({ nav: "home" }));
    expect(screen.queryByText("Document ready")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByText("open-finished"));
    fireEvent.click(await screen.findByText("editor-back"));
    await waitFor(() => expect(screen.queryByText("editor-back")).not.toBeInTheDocument());
    expect(readStoredAppRoute()).toEqual({ nav: "home" });
    expect(screen.getAllByLabelText(PROMPT_LABEL).some(node => node.tagName === "TEXTAREA")).toBe(true);
    expect(screen.queryByText("Document ready")).not.toBeInTheDocument();
  });

  // Regression: a task event was treated as proof that the newest optimistic
  // submission had just been given that id. With one submission in flight that
  // is usually true; with two, an event from the older run adopted the newer
  // run's prompt and conversation, merging both runs into one lineage — which
  // is how a new deck came out carrying the previous task's requirements.
  it("does not hand a running task the prompt of a later submission", async () => {
    let settleFirst: (value: unknown) => void = () => {};
    let settleSecond: (value: unknown) => void = () => {};
    mocks.generate
      .mockImplementationOnce(() => new Promise((resolve) => { settleFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { settleSecond = resolve; }));

    const { App } = await import("./App");
    render(<App />);
    await waitFor(() => expect(mocks.listener).not.toBe(undefined));

    // Task A is submitted; its id has not come back yet.
    await submitPrompt("deck about otters");
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(1));

    // A's real id arrives, and A starts running.
    await act(async () => {
      settleFirst({ taskId: "real-a", sessionId: "s", status: "running" });
    });
    act(() => {
      mocks.listener({ type: "task.started", task_id: "real-a", payload: { document_type: "pptx" } });
    });

    // Back to Home, and task B is submitted while A is still running.
    fireEvent.click(screen.getByText("go-home"));
    await submitPrompt("deck about penguins");
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(2));

    // The window that matters: B's invoke has not returned yet, so B is still
    // an optimistic placeholder, and A — already running — emits its next
    // progress event. That event says nothing about B.
    act(() => {
      mocks.listener({ type: "task.progress", task_id: "real-a", payload: { status: "running", step: "outline" } });
    });

    // Only now does B learn its own id.
    await act(async () => {
      settleSecond({ taskId: "real-b", sessionId: "s", status: "running" });
    });

    // The production stage names the task it is showing. Task A must still be
    // the otters deck: adopting B's pending input renamed it to the penguins
    // one and dropped B's own task entirely.
    expect(mocks.generate.mock.calls[0][0]).toMatchObject({ prompt: "deck about otters" });
    expect(mocks.generate.mock.calls[1][0]).toMatchObject({ prompt: "deck about penguins" });
    const byId = new Map(mocks.documents.map((doc) => [doc.id, doc]));
    // Both runs survive as their own task, each keeping the prompt it was
    // submitted with. Adoption renamed A to B's prompt and deleted B outright.
    expect(byId.get("real-a")?.title).toBe("Untitled task");
    expect(byId.get("real-b")?.title).toBe("Untitled task");
    // Naming can finish out of order without touching either brief.
    act(() => {
      mocks.listener({ type: "task.title", task_id: "real-b", payload: { topic: "Penguin Life" } });
      mocks.listener({ type: "task.title", task_id: "real-a", payload: { topic: "Otter Life" } });
    });
    expect(mocks.documents.find(doc => doc.id === "real-a")?.title).toBe("Otter Life");
    expect(mocks.documents.find(doc => doc.id === "real-b")?.title).toBe("Penguin Life");
    // Two submissions are two conversations, not one merged lineage.
    expect(byId.get("real-a")?.conversationId).not.toBe(byId.get("real-b")?.conversationId);
  });

  // The single-submission ordering the deleted adoption code existed to cover:
  // Generate does its sqlite bookkeeping after the invoke returns, so the
  // task's first events can reach the renderer before the RPC result does.
  // The placeholder must still converge on the real task once it resolves,
  // with no duplicate left behind.
  it("converges when the task's events arrive before its own invoke returns", async () => {
    let settle: (value: unknown) => void = () => {};
    mocks.generate.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve; }));

    const { App } = await import("./App");
    render(<App />);
    await waitFor(() => expect(mocks.listener).not.toBe(undefined));

    await submitPrompt("deck about otters");
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(1));

    // Events land first, naming an id the renderer has not been told about.
    act(() => {
      mocks.listener({ type: "task.started", task_id: "real-a", payload: { document_type: "pptx" } });
      mocks.listener({ type: "task.progress", task_id: "real-a", payload: { status: "running", step: "outline" } });
    });

    // Then the invoke resolves with that same id.
    await act(async () => {
      settle({ taskId: "real-a", sessionId: "s", status: "running" });
    });

    const titles = mocks.documents.map((doc) => doc.title);
    expect(mocks.documents.map((doc) => doc.id)).toContain("real-a");
    expect(titles).toContain("Untitled task");
    // The optimistic placeholder must not survive alongside the real task.
    expect(mocks.documents).toHaveLength(1);
  });
});
