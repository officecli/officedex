import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeEvent, DesktopAPI, UserSettings } from "../shared/types";

const mocks = vi.hoisted(() => ({
  listener: (() => undefined) as (event: BridgeEvent) => void,
  maybeNotify: vi.fn(),
  nudgeForTaskTransition: vi.fn(),
}));

const settings: UserSettings = {
  version: 1,
  defaults: {
    documentType: "pptx",
    mode: "fast",
    enableImages: true,
    imageQuality: "premium",
  },
  outputDir: null,
  llmProvider: null,
  onboardingCompletedAt: "2026-05-22T00:00:00.000Z",
  proxy: null,
};

vi.mock("./notifications", () => ({
  maybeNotify: mocks.maybeNotify,
}));

vi.mock("./bridge", () => ({
  officecli: {
    initialize: vi.fn(async () => ({})),
    getCapabilities: vi.fn(async () => ({})),
    getTaskHistory: vi.fn(async () => []),
    onBridgeEvent: vi.fn((callback: (event: BridgeEvent) => void) => {
      mocks.listener = callback;
      return () => undefined;
    }),
  } as Partial<DesktopAPI>,
}));

vi.mock("./useCreditStatus", () => ({
  useCreditStatus: () => ({
    credit: null,
    refresh: vi.fn(),
    nudgeForTaskTransition: mocks.nudgeForTaskTransition,
  }),
}));

vi.mock("./useSettings", () => ({
  useSettings: () => ({
    settings,
    defaultWorkspaceDir: "/tmp/default-workspace",
    loading: false,
  }),
}));

vi.mock("./useAppUpdate", () => ({
  useAppUpdate: () => ({
    status: { mandatory: false },
    release: null,
  }),
}));

vi.mock("./components/Shell", () => ({
  Shell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("./screens/DialogueScreens", () => ({
  DialogueScreen: () => <div>Dialogue</div>,
}));

vi.mock("./screens/DataScreens", () => ({
  TasksScreen: () => <div>Tasks</div>,
}));

vi.mock("./screens/SettingsScreens", () => ({
  LoginScreen: () => <div>Login</div>,
  SettingsScreen: () => <div>Settings</div>,
}));

vi.mock("./screens/OnboardingScreen", () => ({
  OnboardingScreen: () => <div>Onboarding</div>,
}));

vi.mock("./components/PreviewPanel", () => ({
  PreviewPanel: () => <div>Preview</div>,
}));

vi.mock("./components/UpdateBanner", () => ({
  UpdateBanner: () => null,
}));

vi.mock("./components/ForceUpdateOverlay", () => ({
  ForceUpdateOverlay: () => null,
}));

describe("App desktop notification wiring", () => {
  beforeEach(() => {
    mocks.listener = () => undefined;
    mocks.maybeNotify.mockClear();
    mocks.nudgeForTaskTransition.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("notifies for completed and failed task events but not cancelled events", async () => {
    const { App } = await import("./App");
    render(<App />);

    await waitFor(() => expect(mocks.listener).not.toBeUndefined());

    act(() => {
      mocks.listener({ type: "task.completed", task_id: "task-1" });
      mocks.listener({ type: "task.failed", task_id: "task-2" });
      mocks.listener({ type: "task.cancelled", task_id: "task-3" });
    });

    expect(mocks.maybeNotify).toHaveBeenCalledTimes(2);
    expect(mocks.maybeNotify).toHaveBeenNthCalledWith(1, {
      title: "OfficeDex",
      body: "Generation finished",
    });
    expect(mocks.maybeNotify).toHaveBeenNthCalledWith(2, {
      title: "OfficeDex",
      body: "Generation failed",
    });
    expect(mocks.nudgeForTaskTransition).toHaveBeenCalledTimes(3);
  });
});
