/**
 * Contract tests for the implicit interaction rules catalogued in
 * docs/interaction-rules.md.
 *
 * These rules live today as anonymous effects and conditional branches inside
 * App.tsx and Shell.tsx. Nothing names them, so an IA change would drop them
 * silently. Each test below is indexed by its rule id; when a rule changes,
 * change the document first.
 *
 * The heavy surfaces are mocked and their props captured, so what is under test
 * is the orchestration decision itself rather than any particular rendering of
 * it. That is deliberate: the views are going to be replaced, the rules are not.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Artifact, BridgeEvent, DesktopAPI, DesktopTask, UserSettings, WorkspaceSummary } from "../../shared/types";

type StageProps = {
  task: DesktopTask;
  productionProps?: {
    onSteer?: (instruction: string) => void | Promise<void>;
    onCancel?: () => void;
    onRetry?: () => void;
    onOpenEditor?: () => void;
  };
  editor?: { previewToken: string; fileName: string };
  draftReady?: boolean;
};

const mocks = vi.hoisted(() => ({
  listener: (() => undefined) as (event: BridgeEvent) => void,
  /** Props the mocked Shell last received. */
  shell: {
    activeNav: "",
    documents: [] as Array<{ id: string; title: string; conversationId?: string }>,
    railRevision: 0,
    activeWorkspaceId: undefined as string | undefined,
    activeDocumentId: undefined as string | undefined,
  },
  /** Props the mocked pptx stage last received, or null when it is not mounted. */
  stage: null as StageProps | null,
  /** The artifact the preview panel is currently showing, or null. */
  previewArtifact: null as Artifact | null,
  generate: vi.fn(),
  modify: vi.fn(),
  intervenePptx: vi.fn(),
  createLivePptxDraft: vi.fn(),
  selectWorkspace: vi.fn(),
}));

const settings: UserSettings = {
  version: 1,
  defaults: { documentType: "pptx", enableImages: true, imageQuality: "premium" },
  workspaceDir: null,
  outputDir: null,
  llmProvider: null,
  onboardingCompletedAt: "2026-05-22T00:00:00.000Z",
  proxy: null,
  imageWatermark: { showWatermark: true, preferenceSource: "system" },
  waiting2048Enabled: false,
};

const WORKSPACES: WorkspaceSummary[] = [
  { id: "ws-a", name: "Alpha", path: "/tmp/alpha", active: true },
  { id: "ws-b", name: "Beta", path: "/tmp/beta", active: false },
];

vi.mock("./../notifications", () => ({ maybeNotify: vi.fn() }));

vi.mock("./../bridge", () => ({
  officecli: {
    initialize: vi.fn(async () => ({})),
    getCapabilities: vi.fn(async () => ({})),
    whoami: vi.fn(async () => ({ mode: "anonymous" as const })),
    onFileDrop: vi.fn(() => () => undefined),
    getTaskHistory: vi.fn(async () => []),
    listWorkspaces: vi.fn(async () => WORKSPACES),
    listRecentFiles: vi.fn(async () => []),
    openFileDialog: vi.fn(),
    openRecentFile: vi.fn(async (file) => ({ taskId: file.taskId ?? "", filePath: file.filePath, fileName: file.fileName, documentType: file.documentType })),
    issuePreviewToken: vi.fn(async (artifact: Artifact) => ({ token: `preview-${artifact.fileName}`, documentType: artifact.documentType, fileName: artifact.fileName })),
    revokePreviewToken: vi.fn(async () => undefined),
    createLivePptxDraft: (...args: unknown[]) => mocks.createLivePptxDraft(...args),
    addWorkspace: vi.fn(),
    selectWorkspace: (...args: unknown[]) => mocks.selectWorkspace(...args),
    removeWorkspace: vi.fn(),
    cancel: vi.fn(async () => undefined),
    deleteDocument: vi.fn(async () => undefined),
    removeRecentFile: vi.fn(async () => undefined),
    generate: (...args: unknown[]) => mocks.generate(...args),
    modify: (...args: unknown[]) => mocks.modify(...args),
    intervenePptx: (...args: unknown[]) => mocks.intervenePptx(...args),
    onBridgeEvent: vi.fn((callback: (event: BridgeEvent) => void) => {
      mocks.listener = callback;
      return () => undefined;
    }),
  } as Partial<DesktopAPI>,
}));

vi.mock("./../useCreditStatus", () => ({
  useCreditStatus: () => ({ credit: null, refresh: vi.fn(), nudgeForTaskTransition: vi.fn() }),
}));
vi.mock("./../useSettings", () => ({
  useSettings: () => ({ settings, defaultWorkspaceDir: "/tmp/default-workspace", loading: false }),
}));
vi.mock("./../useAppUpdate", () => ({
  useAppUpdate: () => ({ status: { mandatory: false }, release: null }),
}));

vi.mock("./../components/Shell", () => ({
  Shell: (props: {
    children: React.ReactNode;
    inspector?: React.ReactNode;
    activeNav: string;
    onNavChange: (key: string) => void;
    documents?: Array<{ id: string; title: string; conversationId?: string }>;
    onOpenDocument: (document: { id: string }) => void;
    onDeleteDocument?: (document: { id: string }) => void | Promise<void>;
    documentOpenRevision?: number;
    activeWorkspaceId?: string;
    activeDocumentId?: string;
  }) => {
    mocks.shell = {
      activeNav: props.activeNav,
      documents: props.documents ?? [],
      railRevision: props.documentOpenRevision ?? 0,
      activeWorkspaceId: props.activeWorkspaceId,
      activeDocumentId: props.activeDocumentId,
    };
    return (
      <div>
        <button type="button" onClick={() => props.onNavChange("home")}>go-home</button>
        <button type="button" onClick={() => props.onNavChange("settings")}>go-settings</button>
        {props.documents?.map((document) => (
          <span key={document.id}>
            <button onClick={() => props.onOpenDocument(document)}>open-{document.id}</button>
            <button onClick={() => void props.onDeleteDocument?.(document)}>delete-{document.id}</button>
          </span>
        ))}
        {props.inspector}
        {props.children}
      </div>
    );
  },
  MaterialSymbol: () => null,
  FileGlyph: () => null,
  StatusDot: () => null,
}));

vi.mock("./../presentation/ProgressivePptxStage", () => ({
  ProgressivePptxStage: (props: StageProps) => {
    mocks.stage = props;
    return <div data-testid="pptx-stage">stage-{props.task.id}</div>;
  },
}));

vi.mock("./../components/PreviewPanel", () => ({
  PreviewPanel: ({ artifact, onClose }: { artifact: Artifact | null; onClose: () => void }) => {
    mocks.previewArtifact = artifact;
    return <button onClick={onClose}>editor-back</button>;
  },
}));

vi.mock("./../spreadsheet/SpreadsheetWorkspace", async () => {
  const { forwardRef } = await import("react");
  return {
    SpreadsheetWorkspace: forwardRef((props: { onBack: () => void; onDirtyChange: (dirty: boolean) => void }, _ref) => (
      <div>
        <button onClick={props.onBack}>sheet-back</button>
        <button onClick={() => props.onDirtyChange(true)}>sheet-make-dirty</button>
      </div>
    )),
  };
});
vi.mock("./../components/ForceUpdateOverlay", () => ({ ForceUpdateOverlay: () => null }));
vi.mock("./../screens/SettingsScreens", () => ({
  LoginScreen: () => <div>Login</div>,
  SettingsScreen: () => <div>Settings</div>,
}));

const PROMPT_LABEL = "Describe the result you want";

async function renderApp() {
  const { App } = await import("./../App");
  render(<App />);
  await waitFor(() => expect(mocks.listener).not.toBe(undefined));
}

/** Types into the home intake and submits with Enter, as the user would. */
async function submitPrompt(text: string) {
  const boxes = await screen.findAllByLabelText(PROMPT_LABEL);
  const box = boxes.find((node) => node.tagName === "TEXTAREA")!;
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter" });
}

/** Emits bridge events the way the transport would, inside act. */
async function emit(...events: BridgeEvent[]) {
  await act(async () => {
    for (const event of events) mocks.listener(event);
  });
}

const drawingOp = (taskId: string): BridgeEvent => ({
  type: "task.vibe_ops",
  task_id: taskId,
  payload: { ops: [{ op: "shape.add", seq: 1 }] },
});

const completion = (taskId: string, documentType = "pptx"): BridgeEvent => ({
  type: "task.completed",
  task_id: taskId,
  payload: {
    document_type: documentType,
    result: { file_path: `/tmp/${taskId}.${documentType}`, file_name: `${taskId}.${documentType}`, document_type: documentType },
  },
});

beforeEach(() => {
  mocks.listener = () => undefined;
  mocks.shell = { activeNav: "", documents: [], railRevision: 0, activeWorkspaceId: undefined, activeDocumentId: undefined };
  mocks.stage = null;
  mocks.previewArtifact = null;
  mocks.generate.mockReset();
  mocks.modify.mockReset().mockResolvedValue({ taskId: "modify-1", sessionId: "s", status: "running" });
  mocks.intervenePptx.mockReset().mockResolvedValue({});
  mocks.createLivePptxDraft.mockReset().mockImplementation(async (taskId: string) => ({
    filePath: `/tmp/live-${taskId}.pptx`,
    fileName: `live-${taskId}.pptx`,
  }));
  mocks.selectWorkspace.mockReset().mockImplementation(async (id: string) => WORKSPACES.find((workspace) => workspace.id === id));
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("R-A · connection lifecycle", () => {
  // A stopped bridge is a transport outage. Native runtime tasks outlive the
  // stdio process and are reattached after reconnect, so nothing about the
  // tasks themselves may be concluded from the transport dying.
  it("R-A-05: bridge.exited leaves a running task running", async () => {
    await renderApp();
    await emit({ type: "task.started", task_id: "run-1", payload: { document_type: "pptx" } });
    await waitFor(() => expect(mocks.shell.documents.some((document) => document.id === "run-1")).toBe(true));

    await emit({ type: "bridge.exited", payload: { message: "agent-bridge exited" } });

    // The task survives the outage as its own row; nothing marked it failed.
    expect(mocks.shell.documents.some((document) => document.id === "run-1")).toBe(true);
  });

  // A manually stopped bridge disables the Go client's reconnect timer, so the
  // renderer has to trigger Initialize itself. Several client exits inside one
  // interruption window must still produce exactly one reconnect, or the app
  // starts duplicate bridge child processes.
  it("R-A-06: repeated bridge.exited in one outage window starts one reconnect", async () => {
    const { officecli } = await import("./../bridge");
    await renderApp();
    await waitFor(() => expect(officecli.initialize).toHaveBeenCalled());
    const afterBoot = vi.mocked(officecli.initialize).mock.calls.length;

    await emit({ type: "bridge.exited", payload: { message: "exited" } });
    await emit({ type: "bridge.exited", payload: { message: "exited again" } });

    await waitFor(() => expect(vi.mocked(officecli.initialize).mock.calls.length).toBe(afterBoot + 1));
    // Give a second reconnect the chance to appear before concluding it did not.
    await act(async () => { await Promise.resolve(); });
    expect(vi.mocked(officecli.initialize).mock.calls.length).toBe(afterBoot + 1);
  });
});

describe("R-B · routing", () => {
  // The backend broadcasts on one channel; a task surfacing from somewhere else
  // must not take over the screen the user is looking at. Only a local submit
  // or an explicit selection moves the route.
  it("R-B-03b: a task arriving purely as a bridge event does not steal the route", async () => {
    await renderApp();
    await emit({ type: "task.started", task_id: "run-1", payload: { document_type: "pptx" } });

    await waitFor(() => expect(mocks.shell.documents.some((document) => document.id === "run-1")).toBe(true));
    expect(mocks.shell.activeNav).toBe("home");
  });

  // Home is the inbox, not whichever production stage was last selected. The
  // transient stage pick has to be dropped, or clicking Home while already on
  // Home leaves the production view in place.
  it("R-B-08: navigating Home clears the transient stage selection", async () => {
    mocks.generate.mockResolvedValue({ taskId: "real-1", sessionId: "s", status: "running" });
    await renderApp();
    await submitPrompt("deck about otters");
    await waitFor(() => expect(mocks.shell.activeNav).toBe("document"));
    await emit(drawingOp("real-1"));
    await waitFor(() => expect(screen.queryByTestId("pptx-stage")).toBeInTheDocument());

    fireEvent.click(screen.getByText("go-home"));

    await waitFor(() => expect(mocks.shell.activeNav).toBe("home"));
    // Home no longer mounts the production stage for that submission.
    await waitFor(() => expect(screen.queryByTestId("pptx-stage")).not.toBeInTheDocument());
  });

  // Selecting a task that belongs elsewhere carries the workspace with it,
  // rather than showing the document against the wrong working directory.
  it("R-B-06: opening a task from another workspace switches to it", async () => {
    await renderApp();
    await emit({
      type: "task.started",
      task_id: "run-b",
      payload: { document_type: "pptx", workspace_id: "ws-b" },
    });
    await waitFor(() => expect(mocks.shell.documents.some((document) => document.id === "run-b")).toBe(true));

    fireEvent.click(screen.getByText("open-run-b"));

    await waitFor(() => expect(mocks.selectWorkspace).toHaveBeenCalledWith("ws-b"));
  });

  // A restored document route can name a task this session never learns about.
  // Rather than showing an empty workbench, the route adopts a live run.
  it("R-B-05: a document route whose task is gone falls back to an active run", async () => {
    const { officecli } = await import("./../bridge");
    vi.mocked(officecli.getTaskHistory).mockResolvedValue([{
      taskId: "survivor",
      createdAt: "2026-09-01T00:00:00Z",
      conversationId: "survivor",
      events: [{
        event_id: "p-1",
        task_id: "survivor",
        type: "task.progress",
        payload: { status: "running", step: "outline", document_type: "pptx" },
      }],
    }]);
    const { writeStoredAppRoute } = await import("./../App");
    writeStoredAppRoute({ nav: "document", taskId: "ghost-from-a-past-session" });

    await renderApp();

    await waitFor(() => expect(mocks.shell.activeDocumentId).toBe("survivor"));
  });
});

describe("R-E · pptx live canvas", () => {
  // The outline arriving is not authorisation to draw: the user still has to
  // review it. The first real drawing op is the planning/authoring boundary and
  // the only automatic trigger for the live canvas.
  it("R-E-01: an outline does not open the live canvas, the first drawing op does", async () => {
    await renderApp();
    await emit(
      { type: "task.started", task_id: "run-1", payload: { document_type: "pptx" } },
      { type: "task.progress", task_id: "run-1", payload: { status: "running", step: "outline" } },
    );

    expect(mocks.createLivePptxDraft).not.toHaveBeenCalled();

    await emit(drawingOp("run-1"));

    await waitFor(() => expect(mocks.createLivePptxDraft).toHaveBeenCalledWith("run-1"));
  });

  // History replay on page load restores completed tasks' primitives in the
  // same state batch; redrawing a finished deck would look like a phantom
  // generation.
  it("R-E-01: a completed task's ops never open the live canvas", async () => {
    await renderApp();
    await emit(
      { type: "task.started", task_id: "run-1", payload: { document_type: "pptx" } },
      completion("run-1"),
      drawingOp("run-1"),
    );

    expect(mocks.createLivePptxDraft).not.toHaveBeenCalled();
  });

  it("R-E-02: the live draft is attempted once per task", async () => {
    await renderApp();
    await emit({ type: "task.started", task_id: "run-1", payload: { document_type: "pptx" } }, drawingOp("run-1"));
    await waitFor(() => expect(mocks.createLivePptxDraft).toHaveBeenCalledTimes(1));

    await emit({ type: "task.vibe_ops", task_id: "run-1", payload: { ops: [{ op: "shape.add", seq: 2 }] } });

    expect(mocks.createLivePptxDraft).toHaveBeenCalledTimes(1);
  });

  // Steering a live run lands at the next page boundary; once the run is over
  // nothing can absorb it and the same instruction becomes a modification.
  it("R-E-04: steering a running task intervenes rather than starting a second run", async () => {
    await renderApp();
    await emit({ type: "task.started", task_id: "run-1", payload: { document_type: "pptx" } }, drawingOp("run-1"));
    fireEvent.click(await screen.findByText("open-run-1"));
    await waitFor(() => expect(mocks.stage?.productionProps?.onSteer).toBeTypeOf("function"));

    await act(async () => {
      await mocks.stage!.productionProps!.onSteer!("tighten the intro");
    });

    expect(mocks.intervenePptx).toHaveBeenCalledWith("run-1", "tighten the intro");
    expect(mocks.modify).not.toHaveBeenCalled();
  });

  // A run that stops mid-draw leaves a real file behind: the editor session
  // saved every page drawn before the failure. Committing it as the partial
  // artifact is what lets the failed state offer "change this deck" instead of
  // pretending the run produced nothing.
  it("R-E-03 + R-E-04: a stopped run keeps its partial deck, and steering modifies it", async () => {
    await renderApp();
    await emit({ type: "task.started", task_id: "run-1", payload: { document_type: "pptx" } }, drawingOp("run-1"));
    await waitFor(() => expect(mocks.createLivePptxDraft).toHaveBeenCalledWith("run-1"));
    fireEvent.click(await screen.findByText("open-run-1"));
    await waitFor(() => expect(mocks.stage).not.toBeNull());

    await emit({ type: "task.failed", task_id: "run-1", payload: { message: "ran out of credits" } });
    await waitFor(() => expect(mocks.stage?.productionProps?.onSteer).toBeTypeOf("function"));

    await act(async () => {
      await mocks.stage!.productionProps!.onSteer!("fix the last slide");
    });

    expect(mocks.intervenePptx).not.toHaveBeenCalled();
    // The half-drawn deck is what the instruction lands on.
    expect(mocks.modify).toHaveBeenCalledWith(expect.objectContaining({
      documentType: "pptx",
      sourceFile: "/tmp/live-run-1.pptx",
      prompt: "fix the last slide",
    }));
  });
});

describe("R-D · opening artifacts", () => {
  // Completion must not replace the op-authored editor with a second artifact
  // import: the deck on screen is this task's own live draft and the sequencer
  // already saved it.
  it("R-D-03: completion does not re-import over the task's own live draft", async () => {
    mocks.generate.mockResolvedValue({ taskId: "real-1", sessionId: "s", status: "running" });
    await renderApp();
    await submitPrompt("deck about otters");
    await waitFor(() => expect(mocks.shell.activeNav).toBe("document"));
    await emit(drawingOp("real-1"));
    await waitFor(() => expect(mocks.previewArtifact?.filePath).toBe("/tmp/live-real-1.pptx"));

    await emit(completion("real-1"));

    // Still the live draft, not the freshly imported /tmp/real-1.pptx.
    await waitFor(() => expect(mocks.shell.activeNav).toBe("home"));
    expect(mocks.previewArtifact?.filePath).toBe("/tmp/live-real-1.pptx");
  });

  // The other half of that rule: with no live draft on screen there is nothing
  // to protect, so the finished artifact opens by itself.
  it("R-D-03: completion opens the artifact when no live draft is on screen", async () => {
    mocks.generate.mockResolvedValue({ taskId: "real-2", sessionId: "s", status: "running" });
    await renderApp();
    await submitPrompt("a short report");
    await waitFor(() => expect(mocks.shell.activeNav).toBe("document"));

    await emit(completion("real-2", "docx"));

    await waitFor(() => expect(mocks.previewArtifact?.filePath).toBe("/tmp/real-2.docx"));
  });

  // XLSX has an editable workspace with the Sheet SDK; it must never go through
  // the read-only viewer that serves the other formats.
  it("R-D-01: a workbook opens the spreadsheet workspace, not the preview overlay", async () => {
    const { officecli } = await import("./../bridge");
    const workbook = {
      filePath: "/tmp/book.xlsx",
      fileName: "book.xlsx",
      documentType: "xlsx",
      source: "local" as const,
      lastOpenedAt: "2026-09-11T12:00:00Z",
    };
    vi.mocked(officecli.listRecentFiles).mockResolvedValue([workbook]);

    await renderApp();
    fireEvent.click(await screen.findByText(`open-file:${workbook.filePath}`));

    await waitFor(() => expect(mocks.shell.activeNav).toBe("spreadsheet"));
    // The preview overlay never received it.
    expect(mocks.previewArtifact).toBeNull();
  });

  // Deleting one row deletes the conversation behind it: a follow-up edit is a
  // second task against the same document, and leaving it listed would resurrect
  // a document the user just removed.
  it("R-D-09: deleting a document cancels and removes its whole lineage", async () => {    const { officecli } = await import("./../bridge");
    await renderApp();
    await emit(
      { type: "task.started", task_id: "run-1", payload: { document_type: "pptx" } },
      completion("run-1"),
    );
    await waitFor(() => expect(mocks.shell.documents.some((document) => document.id === "run-1")).toBe(true));
    // A follow-up edit on the same conversation, still running.
    await emit({
      type: "task.started",
      task_id: "run-1-edit",
      payload: { document_type: "pptx", conversation_id: "run-1", parent_task_id: "run-1" },
    });

    fireEvent.click(await screen.findByText("delete-run-1"));

    await waitFor(() => expect(officecli.deleteDocument).toHaveBeenCalledWith("run-1"));
    await waitFor(() => expect(mocks.shell.documents.some((document) => document.id === "run-1")).toBe(false));
  });
});

describe("R-G · unsaved workbook gate", () => {
  // Navigating away from a dirty workbook goes through the gate rather than
  // dropping the edits. Note what is *not* covered: opening a non-workbook
  // document does not pass through it today — only navigation and workbook
  // opens do (App.tsx call sites of runSpreadsheetAction).
  it("R-G-01: navigating away from a dirty workbook asks first", async () => {
    const { officecli } = await import("./../bridge");
    const workbook = {
      filePath: "/tmp/book.xlsx",
      fileName: "book.xlsx",
      documentType: "xlsx",
      source: "local" as const,
      lastOpenedAt: "2026-09-11T12:00:00Z",
    };
    vi.mocked(officecli.listRecentFiles).mockResolvedValue([workbook]);

    await renderApp();
    fireEvent.click(await screen.findByText(`open-file:${workbook.filePath}`));
    await waitFor(() => expect(mocks.shell.activeNav).toBe("spreadsheet"));

    fireEvent.click(screen.getByText("sheet-make-dirty"));
    fireEvent.click(screen.getByText("go-home"));

    // The gate is up and the navigation has not happened behind it.
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(mocks.shell.activeNav).toBe("spreadsheet");
  });
});