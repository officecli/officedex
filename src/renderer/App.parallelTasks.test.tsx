import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeEvent, DesktopAPI, UserSettings } from "../shared/types";

const mocks = vi.hoisted(() => ({
  listener: (() => undefined) as (event: BridgeEvent) => void,
  generate: vi.fn(),
  // The document list App derives from task state, captured on every render:
  // one entry per task, titled by that task's own topic.
  documents: [] as Array<{ id: string; title: string; conversationId?: string }>,
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
  Shell: ({ children, onNavChange, documents }: { children: React.ReactNode; onNavChange: (key: string) => void; documents?: Array<{ id: string; title: string; conversationId?: string }> }) => {
    mocks.documents = documents ?? [];
    return (
      <div>
        <button type="button" onClick={() => onNavChange("home")}>go-home</button>
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
vi.mock("./components/PreviewPanel", () => ({ PreviewPanel: () => <div>Preview</div> }));
vi.mock("./components/UpdateBanner", () => ({ UpdateBanner: () => null }));
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
    // App persists its route in sessionStorage; without clearing it each test
    // boots into the previous test's document view instead of Home.
    window.sessionStorage.clear();
    window.localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
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
    expect(byId.get("real-a")?.title).toBe("deck about otters");
    expect(byId.get("real-b")?.title).toBe("deck about penguins");
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
    expect(titles).toContain("deck about otters");
    // The optimistic placeholder must not survive alongside the real task.
    expect(mocks.documents).toHaveLength(1);
  });
});
