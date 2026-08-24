import { readFileSync } from "node:fs";
import { act, cleanup, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { message as antdMessage } from "antd";
import { getAttachmentSpec } from "../../shared/types";
import type { DesktopAPI, DesktopTask, GenerateInput, UserSettings, WorkspaceSummary } from "../../shared/types";
import { officecli } from "../bridge";
import { LocaleProvider, type Locale } from "../i18n";
import { clearPptistParsedSlidesMemoryCacheForTests, setPptistParsedSlidesPersistentCacheForTests } from "../components/PptistEmbedPanel";
import { DialogueScreen, IDEA_NODE_DRAWING_MS, assembleSlots, buildVibeFlowModel } from "./DialogueScreens";
import type { ImagePromptSlot, VibeTreeSnapshot } from "../../shared/types";
import type { PptistSlide } from "../../shared/pptistProtocol";

let resizeObserverRecords: Array<{ callback: ResizeObserverCallback; observed: Element[] }> = [];

vi.mock("antd", async () => {
  const actual = await vi.importActual<typeof import("antd")>("antd");
  return {
    ...actual,
    message: {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      destroy: vi.fn(),
    },
  };
});

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
    private record: { callback: ResizeObserverCallback; observed: Element[] };

    constructor(callback: ResizeObserverCallback) {
      this.record = { callback, observed: [] };
      resizeObserverRecords.push(this.record);
    }
    observe(target: Element) {
      this.record.observed.push(target);
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    () => ({ getPropertyValue: () => "" }) as unknown as CSSStyleDeclaration,
  );
  if (!URL.createObjectURL) {
    URL.createObjectURL = vi.fn(() => "blob:test-image");
  }
  if (!URL.revokeObjectURL) {
    URL.revokeObjectURL = vi.fn();
  }
}

let respondSpy: ReturnType<typeof vi.fn>;
let cancelSpy: ReturnType<typeof vi.fn>;
let listImageTemplatesSpy: ReturnType<typeof vi.fn>;
let createImageTemplateSpy: ReturnType<typeof vi.fn>;
let createImageTemplatePublishRequestSpy: ReturnType<typeof vi.fn>;
let issuePreviewTokenSpy: ReturnType<typeof vi.fn>;
let readArtifactFileSpy: ReturnType<typeof vi.fn>;
let readLocalImageSpy: ReturnType<typeof vi.fn>;
let revokePreviewTokenSpy: ReturnType<typeof vi.fn>;
let openPathSpy: ReturnType<typeof vi.fn>;
let showItemInFolderSpy: ReturnType<typeof vi.fn>;
let copyImageToClipboardSpy: ReturnType<typeof vi.fn>;
let savePastedImageSpy: ReturnType<typeof vi.fn>;
let savePptxSpy: ReturnType<typeof vi.fn>;
let modifyPptistDeckSpy: ReturnType<typeof vi.fn>;
let onFileDropSpy: ReturnType<typeof vi.fn>;
let writeTextSpy: ReturnType<typeof vi.fn>;
let getSettingsSpy: ReturnType<typeof vi.fn>;
let getDefaultWorkspaceDirSpy: ReturnType<typeof vi.fn>;
let originals: Partial<DesktopAPI>;
let fileDropCallback: ((paths: string[]) => void) | undefined;

function makeUserSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    version: 1,
    defaults: {
      documentType: "pptx",
      enableImages: true,
      imageQuality: "premium",
      ...(overrides.defaults ?? {}),
    },
    workspaceDir: overrides.workspaceDir ?? null,
    outputDir: overrides.outputDir ?? null,
    llmProvider: overrides.llmProvider ?? null,
    onboardingCompletedAt: overrides.onboardingCompletedAt ?? "2026-05-22T00:00:00Z",
    proxy: overrides.proxy ?? { enabled: false, url: "http://127.0.0.1:7890" },
    imageWatermark: overrides.imageWatermark ?? { showWatermark: true, preferenceSource: "system" },
    waiting2048Enabled: overrides.waiting2048Enabled ?? false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  setPptistParsedSlidesPersistentCacheForTests(null);
  clearPptistParsedSlidesMemoryCacheForTests();
  resizeObserverRecords = [];
  installDomStubs();
  respondSpy = vi.fn(async () => undefined);
  cancelSpy = vi.fn(async () => undefined);
  listImageTemplatesSpy = vi.fn(async () => []);
  createImageTemplateSpy = vi.fn(async () => ({ id: 17, slug: "poster-copy", title: "Poster copy", description: "Cinematic poster", promptPreset: "Template prompt", sortOrder: 10, enabled: true, visibility: "user_private" }));
  createImageTemplatePublishRequestSpy = vi.fn(async () => ({ id: 31, privateTemplateID: 17, provenanceID: 11, status: "pending" }));
  issuePreviewTokenSpy = vi.fn(async (artifact) => ({ token: "test-token", fileName: artifact.fileName, documentType: artifact.documentType }));
  readArtifactFileSpy = vi.fn(async () => ({ data: new Uint8Array([137, 80, 78, 71]) }));
  readLocalImageSpy = vi.fn(async () => ({ data: new Uint8Array([137, 80, 78, 71]), mime: "image/png" }));
  revokePreviewTokenSpy = vi.fn(async () => undefined);
  openPathSpy = vi.fn(async () => undefined);
  showItemInFolderSpy = vi.fn(async () => undefined);
  copyImageToClipboardSpy = vi.fn(async () => undefined);
  savePastedImageSpy = vi.fn(async (_data: Uint8Array, ext: string) => `/tmp/dropped-template-reference.${ext}`);
  savePptxSpy = vi.fn(async (_data: Uint8Array, fileName: string) => `/tmp/${fileName}`);
  modifyPptistDeckSpy = vi.fn(async () => ({
    summary: "Updated title",
    confidence: "high",
    requiresConfirmation: false,
    ops: [{ type: "element:update-text", slideId: "generated-slide-01", elementId: "title", text: "Executive title", preserveStyle: true }],
  }));
  fileDropCallback = undefined;
  onFileDropSpy = vi.fn((callback: (paths: string[]) => void) => {
    fileDropCallback = callback;
    return vi.fn();
  });
  writeTextSpy = vi.fn(async () => undefined);
  getSettingsSpy = vi.fn(async () => makeUserSettings());
  getDefaultWorkspaceDirSpy = vi.fn(async () => "/tmp/default-workspace");
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: writeTextSpy },
  });
  originals = {
    respond: officecli.respond,
    cancel: officecli.cancel,
    listImageTemplates: officecli.listImageTemplates,
    createImageTemplate: officecli.createImageTemplate,
    createImageTemplatePublishRequest: officecli.createImageTemplatePublishRequest,
    issuePreviewToken: officecli.issuePreviewToken,
    readArtifactFile: officecli.readArtifactFile,
    readLocalImage: officecli.readLocalImage,
    revokePreviewToken: officecli.revokePreviewToken,
    openPath: officecli.openPath,
    showItemInFolder: officecli.showItemInFolder,
    copyImageToClipboard: officecli.copyImageToClipboard,
    savePastedImage: officecli.savePastedImage,
    savePptx: officecli.savePptx,
    modifyPptistDeck: officecli.modifyPptistDeck,
    onFileDrop: officecli.onFileDrop,
    getSettings: officecli.getSettings,
    getDefaultWorkspaceDir: officecli.getDefaultWorkspaceDir,
  };
  officecli.respond = respondSpy as unknown as DesktopAPI["respond"];
  officecli.cancel = cancelSpy as unknown as DesktopAPI["cancel"];
  officecli.listImageTemplates = listImageTemplatesSpy as unknown as DesktopAPI["listImageTemplates"];
  officecli.createImageTemplate = createImageTemplateSpy as unknown as DesktopAPI["createImageTemplate"];
  (officecli as unknown as { createImageTemplatePublishRequest: typeof createImageTemplatePublishRequestSpy }).createImageTemplatePublishRequest = createImageTemplatePublishRequestSpy;
  officecli.issuePreviewToken = issuePreviewTokenSpy as unknown as DesktopAPI["issuePreviewToken"];
  officecli.readArtifactFile = readArtifactFileSpy as unknown as DesktopAPI["readArtifactFile"];
  officecli.readLocalImage = readLocalImageSpy as unknown as DesktopAPI["readLocalImage"];
  officecli.revokePreviewToken = revokePreviewTokenSpy as unknown as DesktopAPI["revokePreviewToken"];
  officecli.openPath = openPathSpy as unknown as DesktopAPI["openPath"];
  officecli.showItemInFolder = showItemInFolderSpy as unknown as DesktopAPI["showItemInFolder"];
  officecli.copyImageToClipboard = copyImageToClipboardSpy as unknown as DesktopAPI["copyImageToClipboard"];
  officecli.savePastedImage = savePastedImageSpy as unknown as DesktopAPI["savePastedImage"];
  officecli.savePptx = savePptxSpy as unknown as DesktopAPI["savePptx"];
  officecli.modifyPptistDeck = modifyPptistDeckSpy as unknown as DesktopAPI["modifyPptistDeck"];
  officecli.onFileDrop = onFileDropSpy as unknown as DesktopAPI["onFileDrop"];
  officecli.getSettings = getSettingsSpy as unknown as DesktopAPI["getSettings"];
  officecli.getDefaultWorkspaceDir = getDefaultWorkspaceDirSpy as unknown as DesktopAPI["getDefaultWorkspaceDir"];
});

afterEach(() => {
  cleanup();
  Object.assign(officecli, originals);
  vi.useRealTimers();
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
    workspaces: [] as WorkspaceSummary[],
    newChatTarget: { kind: "none" as const },
    onNewChatTargetChange: vi.fn(),
    onAddWorkspace: vi.fn(),
    ...overrides,
  };
}

function expectDialogueBubble(text: string, role: "ai" | "user") {
  const node = screen.getByText(text);
  expect(node.closest(`.living-tree-pptx-dialogue-message.is-${role}`)).toBeTruthy();
}

function expectDialogueBubbleNotLoading(text: string) {
  const node = screen.getByText(text);
  expect(node.closest(".living-tree-pptx-dialogue-message")?.querySelector(".anticon-loading")).toBeNull();
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

function makeCompletedGIFTask(overrides: Partial<DesktopTask> = {}): DesktopTask {
  return {
    id: "task-gif",
    conversationId: "task-gif",
    status: "completed",
    events: [{ task_id: "task-gif", type: "task.completed", payload: { message: "done" } }],
    userInput: { prompt: "Make a reaction GIF", fps: 16 },
    artifact: {
      taskId: "task-gif",
      filePath: "/tmp/reaction.gif",
      fileName: "reaction.gif",
      documentType: "gif",
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

function makeRunningTask(overrides: Partial<DesktopTask> = {}): DesktopTask {
  const documentType = overrides.documentType ?? "docx";
  return {
    id: `task-running-${documentType}`,
    conversationId: `task-running-${documentType}`,
    status: "running",
    documentType,
    topic: `Generate ${documentType}`,
    events: [
      { task_id: `task-running-${documentType}`, type: "task.started", payload: { document_type: documentType, topic: `Generate ${documentType}` } },
      { task_id: `task-running-${documentType}`, type: "task.progress", payload: { stage: "Writing content" } },
    ],
    stages: [
      { id: "analyze", label: "Analyzing request", status: "completed" },
      { id: "outline", label: "Drafting outline", status: "completed" },
      { id: "write", label: "Writing content", status: "active" },
    ],
    runtimeSnapshot: { mode: "hosted" },
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function currentVibePopoverTitle() {
  const openPopovers = Array.from(document.querySelectorAll<HTMLElement>(".ant-popover:not(.ant-popover-hidden) .living-tree-popover"));
  const fallbackPopovers = Array.from(document.querySelectorAll<HTMLElement>(".living-tree-popover"));
  const popover = openPopovers.at(-1) ?? fallbackPopovers.at(-1);
  if (popover?.dataset.nodeTitle) return popover.dataset.nodeTitle;
  return popover?.querySelector("strong")?.textContent;
}

const VIBE_NODE_SEQUENCE_TIMEOUT_MS = IDEA_NODE_DRAWING_MS * 12 + 1200;

async function waitForVibePopoverTitle(title: string) {
  await waitFor(() => expect(currentVibePopoverTitle()).toBe(title), { timeout: VIBE_NODE_SEQUENCE_TIMEOUT_MS });
}

function hasOpenVibeConfirmationPopover() {
  return Boolean(document.querySelector(".ant-popover:not(.ant-popover-hidden) .living-tree-popover-confirm"));
}

function activeVibeStepOwnsOpenPopover() {
  return Boolean(document.querySelector(".living-tree-step.is-active.ant-popover-open"));
}

function clickCurrentVibeConfirmButton() {
  const buttons = screen.getAllByRole("button", { name: "Confirm this node" });
  fireEvent.click(buttons.at(-1) as HTMLElement);
}

function clickCurrentVibeButton(name: string) {
  const buttons = screen.getAllByRole("button", { name });
  fireEvent.click(buttons.at(-1) as HTMLElement);
}

function currentOpenVibePopover() {
  const popovers = Array.from(document.querySelectorAll(".ant-popover:not(.ant-popover-hidden) .living-tree-popover"));
  return popovers.at(-1) as HTMLElement | undefined;
}

function clickCurrentOpenVibePopoverButton(name: string) {
  const popover = currentOpenVibePopover();
  expect(popover).toBeTruthy();
  fireEvent.click(within(popover as HTMLElement).getByRole("button", { name }));
}

function flowNodeCard(nodeId: string) {
  return document.querySelector(`.react-flow__node[data-id="${nodeId}"] .living-tree-flow-node`) as HTMLElement | null;
}

async function confirmInitialIdeaNode(firstStoryBeatTitle = "Current State") {
  await waitFor(() => expect(screen.getByText("Confirm Idea")).toBeTruthy());
  await waitFor(() => expect(screen.getAllByRole("button", { name: "Confirm this node" }).length).toBeGreaterThan(0), { timeout: IDEA_NODE_DRAWING_MS + 5000 });
  clickCurrentVibeConfirmButton();
  await waitForVibePopoverTitle(firstStoryBeatTitle);
}

describe("DialogueScreen state machine", () => {
  it("shows a project picker headline for new chats and switches to no-project", async () => {
    const onTargetChange = vi.fn();
    render(
      <DialogueScreen
        {...baseProps({
          workspaces: [
            { id: "ws-a", name: "void-oversea", path: "/tmp/void-oversea", active: true, conversations: [] },
            { id: "ws-b", name: "officedex", path: "/tmp/officedex", active: false, conversations: [] },
          ],
          newChatTarget: { kind: "workspace", workspaceId: "ws-a" },
          onNewChatTargetChange: onTargetChange,
        })}
      />,
    );

    expect(await screen.findByRole("heading", { name: /What should we work on in void-oversea/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /void-oversea/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Don't work in a project/ }));

    expect(onTargetChange).toHaveBeenCalledWith({ kind: "none" });
  });

  it("submits no-project chats without a workspaceId", async () => {
    const onSubmit = vi.fn<(values: GenerateInput) => Promise<void>>(async () => undefined);
    render(<DialogueScreen {...baseProps({ onSubmit, newChatTarget: { kind: "none" } })} />);

    expect(await screen.findByRole("heading", { name: /What should we work on\?/i })).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/Enter what you want to generate/), {
      target: { value: "Generate a standalone memo" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Generate$/ }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "Generate a standalone memo",
      noProject: true,
    }));
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("workspaceId");
  });

  it("Question state with options invokes respond without filling the custom answer input", async () => {
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
        allowFreeform: true,
      },
    };
    render(<DialogueScreen {...baseProps()} tasks={[task]} />);
    expect(screen.getByText("Q1")).toBeTruthy();
    const input = screen.getByPlaceholderText(/custom answer if none of the options fit/i) as HTMLInputElement;
    expect(input.value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: /^include$/i }));
    await waitFor(() => expect(respondSpy).toHaveBeenCalledTimes(1));
    const payload = respondSpy.mock.calls[0][0];
    expect(payload).toMatchObject({ taskId: "task-q", questionId: "q-1", optionId: "include", answer: "Include" });
    expect(input.value).toBe("");
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
    const input = screen.getByPlaceholderText(/custom answer if none of the options fit/i);
    fireEvent.change(input, { target: { value: "Add appendix" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(respondSpy).toHaveBeenCalledTimes(1));
    expect(respondSpy).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-q2", questionId: "q-2", answer: "Add appendix" }),
    );
  });

  it("Question state responds to a multi-step option with ordered answers", async () => {
    const task: DesktopTask = {
      id: "task-multi-q",
      conversationId: "task-multi-q",
      status: "question",
      events: [],
      question: {
        id: "question-000009",
        question: "Who is the audience?",
        options: [{ id: "leadership", label: "Leadership", description: "Decision makers", recommended: true }],
        allowFreeform: false,
        currentIndex: 0,
        questions: [
          {
            id: "q-audience",
            question: "Who is the audience?",
            options: [{ id: "leadership", label: "Leadership", description: "Decision makers", recommended: true }],
            allowFreeform: false,
          },
          {
            id: "q-tone",
            question: "Which tone should it use?",
            options: [{ id: "detailed", label: "Detailed" }],
            allowFreeform: false,
          },
        ],
      },
    };
    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    expect(screen.getByText("Question 1 of 2")).toBeTruthy();
    expect(screen.getByText("Q1")).toBeTruthy();
    expect(screen.getByText("Recommended")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /leadership/i }));

    await waitFor(() => expect(respondSpy).toHaveBeenCalledTimes(1));
    expect(respondSpy).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task-multi-q",
      questionId: "question-000009",
      optionId: "leadership",
      answer: "Leadership",
      answers: [
        { questionGroupId: "question-000009", questionId: "q-audience", optionId: "leadership", answer: "Leadership", questionIndex: 0 },
      ],
    }));
  });

  it("Question state waits for the bridge to send the next prompt after an option", async () => {
    const task: DesktopTask = {
      id: "task-multi-pending",
      conversationId: "task-multi-pending",
      status: "question",
      events: [],
      question: {
        id: "question-000010",
        question: "Who is the audience?",
        options: [{ id: "leadership", label: "Leadership" }],
        allowFreeform: false,
        currentIndex: 0,
        questions: [
          {
            id: "q-audience",
            question: "Who is the audience?",
            options: [{ id: "leadership", label: "Leadership" }],
            allowFreeform: false,
          },
          {
            id: "q-tone",
            question: "Which tone should it use?",
            options: [{ id: "detailed", label: "Detailed" }],
            allowFreeform: false,
          },
        ],
      },
    };
    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    fireEvent.click(screen.getByRole("button", { name: /^leadership$/i }));

    await waitFor(() => expect(respondSpy).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Which tone should it use?")).toBeNull();
    expect(screen.getByText("Question 1 of 2")).toBeTruthy();
  });

  it("restores a selected plan question option after the composer remounts", async () => {
    const question = {
      id: "question-restore-option",
      question: "Who is the audience?",
      options: [{ id: "leadership", label: "Leadership" }],
      allowFreeform: false,
      questions: [
        {
          id: "q-audience",
          question: "Who is the audience?",
          options: [{ id: "leadership", label: "Leadership" }],
          allowFreeform: false,
        },
        {
          id: "q-tone",
          question: "Which tone should it use?",
          options: [{ id: "detailed", label: "Detailed" }],
          allowFreeform: false,
        },
      ],
    };
    const task: DesktopTask = {
      id: "task-restore-option",
      conversationId: "task-restore-option",
      status: "question",
      events: [],
      question: { ...question, currentIndex: 0 },
    };
    const { rerender } = render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    fireEvent.click(screen.getByRole("button", { name: /^leadership$/i }));
    await waitFor(() => expect(respondSpy).toHaveBeenCalledTimes(1));

    rerender(<DialogueScreen {...baseProps()} tasks={[{ ...task, status: "running", question: undefined }]} />);
    rerender(<DialogueScreen {...baseProps()} tasks={[{ ...task, question: { ...question, id: "question-restore-option-next", currentIndex: 1 } }]} />);
    fireEvent.click(screen.getByRole("button", { name: /previous question/i }));

    expect(screen.getByRole("button", { name: /^leadership$/i }).dataset.variant === "primary").toBe(true);
  });

  it("restores a custom plan question answer after the composer remounts", async () => {
    const question = {
      id: "question-restore-freeform",
      question: "What context should be included?",
      options: [],
      allowFreeform: true,
      questions: [
        {
          id: "q-context",
          question: "What context should be included?",
          options: [],
          allowFreeform: true,
        },
        {
          id: "q-tone",
          question: "Which tone should it use?",
          options: [{ id: "concise", label: "Concise" }],
          allowFreeform: false,
        },
      ],
    };
    const task: DesktopTask = {
      id: "task-restore-freeform",
      conversationId: "task-restore-freeform",
      status: "question",
      events: [],
      question: { ...question, currentIndex: 0 },
    };
    const { rerender } = render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    const input = screen.getByPlaceholderText(/custom answer if none of the options fit/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Mention the 2026 launch plan." } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(respondSpy).toHaveBeenCalledTimes(1));

    rerender(<DialogueScreen {...baseProps()} tasks={[{ ...task, status: "running", question: undefined }]} />);
    rerender(<DialogueScreen {...baseProps()} tasks={[{ ...task, question: { ...question, id: "question-restore-freeform-next", currentIndex: 1 } }]} />);
    fireEvent.click(screen.getByRole("button", { name: /previous question/i }));

    const restoredInput = screen.getByPlaceholderText(/custom answer if none of the options fit/i) as HTMLInputElement;
    expect(restoredInput.value).toBe("Mention the 2026 launch plan.");
    expect(restoredInput.closest("form")?.classList.contains("user-answer-selected")).toBe(true);
  });

  it("renders persisted plan question answers after a cold history restore", () => {
    const task: DesktopTask = {
      id: "task-history-answers",
      conversationId: "task-history-answers",
      status: "question",
      events: [],
      question: {
        id: "question-history-answers",
        question: "What context should be included?",
        options: [],
        allowFreeform: true,
        currentIndex: 1,
        questions: [
          {
            id: "q-audience",
            question: "Who is the audience?",
            options: [{ id: "leadership", label: "Leadership" }],
            allowFreeform: false,
          },
          {
            id: "q-context",
            question: "What context should be included?",
            options: [],
            allowFreeform: true,
          },
        ],
        answers: [
          { questionId: "q-audience", optionId: "leadership", answer: "Leadership", questionIndex: 0 },
          { questionId: "q-context", answer: "Mention the 2026 launch plan.", questionIndex: 1 },
        ],
      },
    };
    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    const input = screen.getByPlaceholderText(/custom answer if none of the options fit/i) as HTMLInputElement;
    expect(input.value).toBe("Mention the 2026 launch plan.");
    expect(input.closest("form")?.classList.contains("user-answer-selected")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /previous question/i }));
    expect(screen.getByRole("button", { name: /^leadership$/i }).dataset.variant === "primary").toBe(true);
  });

  it("submits ordered answers for a restored multi-step plan question", async () => {
    const task: DesktopTask = {
      id: "task-history-submit-answers",
      conversationId: "task-history-submit-answers",
      status: "question",
      events: [],
      question: {
        id: "question-history-submit",
        question: "Which tone should it use?",
        options: [{ id: "concise", label: "Concise" }],
        allowFreeform: false,
        currentIndex: 1,
        questions: [
          {
            id: "q-audience",
            question: "Who is the audience?",
            options: [{ id: "leadership", label: "Leadership" }],
            allowFreeform: false,
          },
          {
            id: "q-tone",
            question: "Which tone should it use?",
            options: [{ id: "concise", label: "Concise" }],
            allowFreeform: false,
          },
        ],
        answers: [
          { questionId: "q-audience", optionId: "leadership", answer: "Leadership", questionIndex: 0 },
        ],
      },
    };
    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    fireEvent.click(screen.getByRole("button", { name: /^concise$/i }));

    await waitFor(() => expect(respondSpy).toHaveBeenCalledTimes(1));
    expect(respondSpy).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task-history-submit-answers",
      questionId: "question-history-submit",
      optionId: "concise",
      answer: "Concise",
      answers: [
        { questionGroupId: "question-history-submit", questionId: "q-audience", optionId: "leadership", answer: "Leadership", questionIndex: 0 },
        { questionGroupId: "question-history-submit", questionId: "q-tone", optionId: "concise", answer: "Concise", questionIndex: 1 },
      ],
    }));
  });

  it("hides task status cards while showing the active question controls", () => {
    const task: DesktopTask = {
      id: "task-q-layout",
      conversationId: "task-q-layout",
      status: "question",
      documentType: "docx",
      topic: "Create a crab intro document",
      events: [
        { task_id: "task-q-layout", type: "task.started", payload: { document_type: "docx", topic: "Create a crab intro document" } },
        { task_id: "task-q-layout", type: "task.progress", payload: { stage: "Writing content" } },
        { task_id: "task-q-layout", type: "task.question", payload: { question: "Who is this 10-page deck for?" } },
      ],
      stages: [
        { id: "analyze", label: "Analyzing request", status: "completed" },
        { id: "outline", label: "Drafting outline", status: "active" },
      ],
      runtimeSnapshot: { mode: "hosted" },
      userInput: {
        prompt: "Create a crab intro document",
      },
      question: {
        id: "q-layout",
        question: "Who is this 10-page deck for?",
        options: [
          { id: "newcomers", label: "Newcomers" },
          { id: "experienced", label: "Experienced users" },
        ],
        allowFreeform: true,
      },
    };
    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    const composer = document.querySelector(".question-composer") as HTMLElement;
    const prompt = within(composer).getByText("Who is this 10-page deck for?");
    const firstOption = within(composer).getByRole("button", { name: "Newcomers" });
    const freeform = within(composer).getByPlaceholderText(/custom answer if none of the options fit/i);

    expect(screen.getByText("Create a crab intro document")).toBeTruthy();
    expect(composer).toBeTruthy();
    expect(screen.getAllByText("Who is this 10-page deck for?")).toHaveLength(1);
    expect(Boolean(prompt.compareDocumentPosition(firstOption) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(firstOption.compareDocumentPosition(freeform) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(screen.getByRole("button", { name: /cancel/i })).toBeTruthy();
    expect(screen.queryByText(/Task received/i)).toBeNull();
    expect(screen.queryByText(/Target type/i)).toBeNull();
    expect(screen.queryByText("Runtime used")).toBeNull();
    expect(screen.queryByText(/Waiting for your input/i)).toBeNull();
    expect(screen.queryByText("Writing content")).toBeNull();
    expect(document.querySelector("[data-testid='task-runtime-panel']")).toBeNull();
    expect(document.querySelector(".fluid-progress-panel")).toBeNull();
  });

  it("renders a question after the latest task transitions from running", async () => {
    const runningTask: DesktopTask = {
      id: "task-q-transition",
      conversationId: "task-q-transition",
      status: "running",
      events: [{ task_id: "task-q-transition", type: "task.started", payload: { document_type: "pptx" } }],
      documentType: "pptx",
    };
    const questionTask: DesktopTask = {
      ...runningTask,
      status: "question",
      runtimeSnapshot: { mode: "hosted" },
      stages: [
        { id: "analyze", label: "Analyzing request", status: "completed" },
        { id: "outline", label: "Drafting outline", status: "active" },
      ],
      events: [
        ...runningTask.events,
        { task_id: "task-q-transition", type: "task.progress", payload: { stage: "Drafting outline" } },
        { task_id: "task-q-transition", type: "task.question", payload: { question: "Who is the audience?" } },
      ],
      question: {
        id: "q-audience",
        question: "Who is the audience?",
        options: [{ id: "leadership", label: "Leadership" }],
        allowFreeform: false,
      },
    };
    const { rerender } = render(<DialogueScreen {...baseProps()} tasks={[runningTask]} />);

    rerender(<DialogueScreen {...baseProps()} tasks={[questionTask]} />);

    expect(screen.getByRole("button", { name: "Leadership" })).toBeTruthy();
    expect(screen.queryByText(/Target type/i)).toBeNull();
    expect(screen.queryByText("Runtime used")).toBeNull();
    expect(screen.queryByText(/Waiting for your input/i)).toBeNull();
    expect(screen.queryByText("Drafting outline")).toBeNull();
    expect(document.querySelector("[data-testid='task-runtime-panel']")).toBeNull();
    expect(document.querySelector(".fluid-progress-panel")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Leadership" }));
    await waitFor(() => expect(respondSpy).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-q-transition", questionId: "q-audience", optionId: "leadership" }),
    ));
  });

  it("collapses a running generation into a single loading animation message", () => {
    const task = makeRunningTask({
      id: "task-running-thinking",
      conversationId: "task-running-thinking",
      topic: "Introduce Hairy Crabs",
      events: [
        { task_id: "task-running-thinking", type: "task.started", payload: { document_type: "docx", topic: "Introduce Hairy Crabs" } },
        { task_id: "task-running-thinking", type: "task.progress", payload: { stage: "Writing content" } },
      ],
    });

    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    expect(screen.getByText("Introduce Hairy Crabs")).toBeTruthy();
    expect(screen.getByText("Generating DOCX...")).toBeTruthy();
    expect(document.querySelector(".generation-loading-message")).toBeTruthy();
    expect(document.querySelector(".generation-loading-docx")).toBeTruthy();
    expect(screen.queryByText("Thinking...")).toBeNull();
    expect(screen.queryByText(/Task received/i)).toBeNull();
    expect(screen.queryByText(/Target type/i)).toBeNull();
    expect(screen.queryByText("Runtime used")).toBeNull();
    expect(screen.getByText("Writing content")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /play 2048/i })).toBeNull();
    expect(document.querySelector(".generation-stage-rail")).toBeTruthy();
    expect(document.querySelector("[data-testid='task-runtime-panel']")).toBeNull();
    expect(document.querySelector(".fluid-progress-panel")).toBeNull();
  });

  it("shows waiting 2048 only when enabled and while a generation is running or starting", async () => {
    getSettingsSpy.mockResolvedValue(makeUserSettings({ waiting2048Enabled: true }));
    const runningTask = makeRunningTask({ status: "running" });
    const questionTask: DesktopTask = {
      ...runningTask,
      status: "question",
      question: {
        id: "q-waiting-game",
        question: "Who is the audience?",
        options: [{ id: "leadership", label: "Leadership" }],
        allowFreeform: false,
      },
    };
    const planReviewTask: DesktopTask = {
      ...runningTask,
      status: "plan_review",
      plan: {
        id: "plan-waiting-game",
        markdown: "Review this plan.",
        revision: 1,
        executionPrompt: "Generate after approval.",
      },
    };
    const { rerender } = render(<DialogueScreen {...baseProps()} tasks={[runningTask]} />);

    expect(await screen.findByRole("button", { name: /play 2048/i })).toBeTruthy();

    rerender(<DialogueScreen {...baseProps()} tasks={[{ ...runningTask, status: "starting" }]} />);
    expect(await screen.findByRole("button", { name: /play 2048/i })).toBeTruthy();

    rerender(<DialogueScreen {...baseProps()} tasks={[questionTask]} />);
    expect(screen.queryByRole("button", { name: /play 2048/i })).toBeNull();

    rerender(<DialogueScreen {...baseProps()} tasks={[planReviewTask]} />);
    expect(screen.queryByRole("button", { name: /play 2048/i })).toBeNull();

    rerender(<DialogueScreen {...baseProps()} tasks={[{ ...runningTask, status: "completed" }]} />);
    expect(screen.queryByRole("button", { name: /play 2048/i })).toBeNull();
  });

  it.each([
    ["docx", "Generating DOCX...", ".generation-loading-docx"],
    ["pptx", "Generating PPTX...", ".generation-loading-pptx"],
    ["xlsx", "Generating XLSX...", ".generation-loading-xlsx"],
    ["report", "Generating report...", ".generation-loading-report"],
  ])("renders the %s generation animation while running", (documentType, label, variantClass) => {
    render(<DialogueScreen {...baseProps()} tasks={[makeRunningTask({ documentType })]} />);

    expect(screen.getByText(label)).toBeTruthy();
    expect(document.querySelector(".generation-loading-message")).toBeTruthy();
    expect(document.querySelector(variantClass)).toBeTruthy();
    expect(document.querySelector("[data-testid='task-runtime-panel']")).toBeNull();
    expect(document.querySelector(".fluid-progress-panel")).toBeNull();
  });

  it("renders the canvas preparation animation for PPT Vibe plan tasks before the tree exists", () => {
    const task = makeRunningTask({
      documentType: "pptx",
      userInput: {
        prompt: "Make a 10-slide onboarding deck",
        generationMode: "plan",
      },
      events: [
        { task_id: "task-running-pptx", type: "task.started", ts: new Date().toISOString(), payload: { document_type: "pptx", topic: "Generate pptx" } },
        { task_id: "task-running-pptx", type: "task.progress", ts: new Date().toISOString(), payload: { stage: "Preparing canvas" } },
      ],
    });

    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    expect(screen.getByText("Preparing canvas...")).toBeTruthy();
    expect(document.querySelector(".generation-loading-message")).toBeTruthy();
    expect(document.querySelector(".generation-loading-canvas")).toBeTruthy();
    expect((document.querySelector(".generation-loading-message") as HTMLElement)?.dataset.documentType).toBe("canvas");
    expect(document.querySelector(".generation-loading-plan")).toBeNull();
    expect(document.querySelector(".generation-loading-pptx")).toBeNull();
  });

  it("uses a vector canvas preparation transition without scaling the status label", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const now = new Date().toISOString();
    const task: DesktopTask = {
      ...makeRunningTask({
        id: "task-vibe-vector-transition",
        conversationId: "task-vibe-vector-transition",
        documentType: "pptx",
        topic: "Make a crisp vector loading state",
        userInput: {
          prompt: "Make a crisp vector loading state",
          generationMode: "plan",
        },
        events: [
          { task_id: "task-vibe-vector-transition", type: "task.started", ts: now, payload: { document_type: "pptx", topic: "Make a crisp vector loading state" } },
        ],
      }),
      vibeTree: {
        stage: "story_ready",
        actions: [],
        tree: {
          id: "tree-vector-transition",
          rootId: "root",
          title: "Make a crisp vector loading state",
          nodes: [{ id: "root", kind: "root", title: "Make a crisp vector loading state" }],
        },
      },
    };

    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    const transition = document.querySelector(".canvas-preparation-transition") as HTMLElement;
    expect(transition).toBeTruthy();
    expect(transition.querySelector("svg.canvas-preparation-vector")).toBeTruthy();
    expect(transition.querySelector(".canvas-preparation-transition-visual > strong.canvas-preparation-transition-label")?.textContent).toBe("Preparing canvas...");
  });

  it("keeps the canvas preparation transition crisp by avoiding large transform scaling", () => {
    const css = readFileSync("src/renderer/styles/dialogue.css", "utf8");
    const expandRule = css.match(/@keyframes canvas-preparation-expand\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    const labelRule = css.match(/\.canvas-preparation-transition-label\s*\{[^}]*\}/)?.[0] ?? "";

    expect(expandRule).not.toMatch(/scale\(\s*(?:2(?:\.\d+)?|[3-9](?:\.\d+)?)\s*\)/);
    expect(labelRule).toContain("animation:");
    expect(labelRule).not.toMatch(/scale\(/);
  });

  it("keeps the plan writing animation for non-PPT plan tasks before a plan exists", () => {
    const task = makeRunningTask({
      documentType: "docx",
      userInput: {
        prompt: "Make a rollout plan",
        generationMode: "plan",
      },
    });

    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    expect(screen.getByText("Writing plan...")).toBeTruthy();
    expect(document.querySelector(".generation-loading-plan")).toBeTruthy();
    expect(document.querySelector(".generation-loading-canvas")).toBeNull();
  });

  it("transitions from PPT canvas preparation into the Living Tree canvas", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const preparingTask = makeRunningTask({
      id: "task-vibe-transition",
      conversationId: "task-vibe-transition",
      documentType: "pptx",
      topic: "Make a product narrative deck",
      userInput: {
        prompt: "Make a product narrative deck",
        generationMode: "plan",
      },
      events: [
        { task_id: "task-vibe-transition", type: "task.started", ts: new Date().toISOString(), payload: { document_type: "pptx", topic: "Make a product narrative deck" } },
        { task_id: "task-vibe-transition", type: "task.progress", ts: new Date().toISOString(), payload: { stage: "Preparing canvas" } },
      ],
    });
    const treeTask: DesktopTask = {
      ...preparingTask,
      vibeTree: {
        stage: "story_ready",
        actions: [],
        tree: {
          id: "tree-transition",
          rootId: "root",
          title: "Make a product narrative deck",
          nodes: [
            { id: "root", kind: "root", title: "Make a product narrative deck" },
            { id: "branch", parentId: "root", kind: "branch", title: "Why now" },
          ],
        },
      },
    };

    const { rerender } = render(<DialogueScreen {...baseProps()} tasks={[preparingTask]} />);
    expect(document.querySelector(".generation-loading-canvas")).toBeTruthy();

    rerender(<DialogueScreen {...baseProps()} tasks={[treeTask]} />);

    const layout = document.querySelector(".conversation-layout.is-vibe-canvas-focus") as HTMLElement;
    expect(layout).toBeTruthy();
    expect(layout.dataset.canvasPhase).toBe("expanding");
    expect(document.querySelector(".canvas-preparation-transition")).toBeTruthy();
    expect(screen.getByText("Preparing canvas...")).toBeTruthy();
    expect(document.querySelector(".living-tree-cockpit")).toBeTruthy();
    expect((document.querySelector(".living-tree-cockpit") as HTMLElement).dataset.canvasReveal).toBe("pending");

    await act(async () => {
      vi.advanceTimersByTime(3999);
    });

    expect((document.querySelector(".conversation-layout.is-vibe-canvas-focus") as HTMLElement).dataset.canvasPhase).toBe("expanding");
    expect(document.querySelector(".canvas-preparation-transition")).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    expect((document.querySelector(".conversation-layout.is-vibe-canvas-focus") as HTMLElement).dataset.canvasPhase).toBe("ready");
    expect(document.querySelector(".canvas-preparation-transition")).toBeNull();
    expect((document.querySelector(".living-tree-cockpit") as HTMLElement).dataset.canvasReveal).toBe("ready");
    vi.useRealTimers();
  });

  it("plays the canvas preparation transition when a current-session PPT Vibe task first appears already with a tree", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const now = new Date().toISOString();
    const task: DesktopTask = {
      ...makeRunningTask({
        id: "task-vibe-fast-tree",
        conversationId: "task-vibe-fast-tree",
        documentType: "pptx",
        topic: "Make a product narrative deck",
        userInput: {
          prompt: "Make a product narrative deck",
          generationMode: "plan",
        },
        events: [
          { task_id: "task-vibe-fast-tree", type: "task.started", ts: now, payload: { document_type: "pptx", topic: "Make a product narrative deck" } },
        ],
      }),
      status: "question",
      question: {
        id: "vibe_story_ready",
        question: "Project Map generated.",
        allowFreeform: true,
        options: [{ id: "generate_chapters", label: "Generate Chapters", recommended: true }],
      },
      vibeTree: {
        stage: "story_ready",
        actions: [{ id: "generate_chapters", label: "Generate Chapters" }],
        tree: {
          id: "tree-fast",
          rootId: "root",
          title: "Make a product narrative deck",
          nodes: [
            { id: "root", kind: "root", title: "Make a product narrative deck" },
            { id: "branch", parentId: "root", kind: "branch", title: "Why now" },
          ],
        },
        confirmation: { nodeIds: ["branch"] },
      },
    };

    const existingTask = makeRunningTask({
      id: "task-existing-docx",
      conversationId: "task-existing-docx",
      documentType: "docx",
      events: [
        { task_id: "task-existing-docx", type: "task.started", ts: "2026-06-01T00:00:00Z", payload: { document_type: "docx", topic: "Existing task" } },
        { task_id: "task-existing-docx", type: "task.progress", ts: "2026-06-01T00:00:01Z", payload: { stage: "Writing content" } },
      ],
    });
    const { rerender } = render(<DialogueScreen {...baseProps()} tasks={[existingTask]} />);

    rerender(<DialogueScreen {...baseProps()} tasks={[task]} />);

    expect((document.querySelector(".conversation-layout.is-vibe-canvas-focus") as HTMLElement).dataset.canvasPhase).toBe("expanding");
    expect(document.querySelector(".canvas-preparation-transition")).toBeTruthy();
    expect((document.querySelector(".living-tree-cockpit") as HTMLElement).dataset.canvasReveal).toBe("pending");
    expect(hasOpenVibeConfirmationPopover()).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(3999);
    });

    expect((document.querySelector(".conversation-layout.is-vibe-canvas-focus") as HTMLElement).dataset.canvasPhase).toBe("expanding");
    expect(document.querySelector(".canvas-preparation-transition")).toBeTruthy();
    expect(hasOpenVibeConfirmationPopover()).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    expect((document.querySelector(".conversation-layout.is-vibe-canvas-focus") as HTMLElement).dataset.canvasPhase).toBe("ready");
    expect(document.querySelector(".canvas-preparation-transition")).toBeNull();
    const rootNode = flowNodeCard("root");
    expect(rootNode?.classList.contains("is-idea-drawing")).toBe(true);
    expect(rootNode?.dataset.motionRole).toBe("idea-drawing");
    expect(hasOpenVibeConfirmationPopover()).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(hasOpenVibeConfirmationPopover()).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(4000);
    });

    expect(flowNodeCard("root")?.classList.contains("is-idea-drawing")).toBe(false);
    expect(currentVibePopoverTitle()).toBe("Make a product narrative deck");
    vi.useRealTimers();
  });

  it("does not replay the canvas preparation animation when reopening a historical PPT Vibe task", () => {
    const historicalPreparingTask = makeRunningTask({
      id: "task-historical-preparing",
      conversationId: "task-historical-preparing",
      documentType: "pptx",
      userInput: {
        prompt: "Historical PPT task",
        generationMode: "plan",
      },
      events: [
        { task_id: "task-historical-preparing", type: "task.started", ts: "2026-06-01T00:00:00Z", payload: { document_type: "pptx", topic: "Historical PPT task" } },
        { task_id: "task-historical-preparing", type: "task.progress", ts: "2026-06-01T00:00:01Z", payload: { stage: "Preparing canvas" } },
      ],
    });

    const { rerender } = render(<DialogueScreen {...baseProps()} tasks={[historicalPreparingTask]} />);

    expect(screen.getByText("Writing plan...")).toBeTruthy();
    expect(document.querySelector(".generation-loading-plan")).toBeTruthy();
    expect(document.querySelector(".generation-loading-canvas")).toBeNull();

    const historicalTreeTask: DesktopTask = {
      ...historicalPreparingTask,
      status: "question",
      question: {
        id: "vibe_story_ready",
        question: "Project Map generated.",
        allowFreeform: true,
        options: [{ id: "generate_chapters", label: "Generate Chapters", recommended: true }],
      },
      vibeTree: {
        stage: "story_ready",
        actions: [{ id: "generate_chapters", label: "Generate Chapters" }],
        tree: {
          id: "tree-historical",
          rootId: "root",
          title: "Historical PPT task",
          nodes: [
            { id: "root", kind: "root", title: "Historical PPT task" },
            { id: "branch", parentId: "root", kind: "branch", title: "Why now" },
          ],
        },
        confirmation: { nodeIds: ["branch"] },
      },
    };

    rerender(<DialogueScreen {...baseProps()} tasks={[historicalTreeTask]} />);

    expect((document.querySelector(".conversation-layout.is-vibe-canvas-focus") as HTMLElement).dataset.canvasPhase).toBe("ready");
    expect(document.querySelector(".canvas-preparation-transition")).toBeNull();
    expect((document.querySelector(".living-tree-cockpit") as HTMLElement).dataset.canvasReveal).toBe("ready");
    expect(flowNodeCard("root")?.classList.contains("is-idea-drawing")).toBe(false);
    expect(document.querySelector(".living-tree-flow-node.is-idea-drawing, .living-tree-flow-node.is-node-drawing")).toBeNull();
  });

  it("does not replay the canvas preparation transition when a Vibe task advances stages", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const now = new Date().toISOString();
    const storyTask: DesktopTask = {
      ...makeRunningTask({
        id: "task-vibe-stage-handoff",
        conversationId: "task-vibe-stage-handoff",
        documentType: "pptx",
        topic: "Make a product narrative deck",
        userInput: {
          prompt: "Make a product narrative deck",
          generationMode: "plan",
        },
        events: [
          { task_id: "task-vibe-stage-handoff", type: "task.started", ts: now, payload: { document_type: "pptx", topic: "Make a product narrative deck" } },
        ],
      }),
      status: "question",
      question: {
        id: "vibe_story_ready",
        question: "Story Beats generated.",
        allowFreeform: true,
        options: [{ id: "generate_chapters", label: "Generate Chapters", recommended: true }],
      },
      vibeTree: {
        stage: "story_ready",
        actions: [{ id: "generate_chapters", label: "Generate Chapters" }],
        tree: {
          id: "tree-stage-handoff",
          rootId: "root",
          title: "Make a product narrative deck",
          nodes: [
            { id: "root", kind: "root", title: "Make a product narrative deck" },
            { id: "branch", parentId: "root", kind: "branch", title: "Why now" },
          ],
        },
        confirmation: { nodeIds: ["branch"] },
      },
    };
    const generatingChapterTask: DesktopTask = {
      ...storyTask,
      id: "task-vibe-stage-handoff-generating-chapter",
      status: "running",
      question: undefined,
      vibeTree: undefined,
    };
    const outlineTask: DesktopTask = {
      ...storyTask,
      id: "task-vibe-stage-handoff-outline",
      question: {
        id: "vibe_outline_ready",
        question: "Chapters generated.",
        allowFreeform: true,
        options: [{ id: "generate_outline", label: "Generate Outline", recommended: true }],
      },
      vibeTree: {
        stage: "outline_ready",
        actions: [{ id: "generate_outline", label: "Generate Outline" }],
        tree: {
          id: "tree-stage-handoff",
          rootId: "root",
          title: "Make a product narrative deck",
          nodes: [
            { id: "root", kind: "root", title: "Make a product narrative deck" },
            { id: "branch", parentId: "root", kind: "branch", title: "Why now" },
            { id: "chapter", parentId: "branch", kind: "slide_group", title: "Chapter 1" },
          ],
        },
        confirmation: { nodeIds: ["chapter"] },
      },
    };

    const { rerender } = render(<DialogueScreen {...baseProps()} tasks={[storyTask]} />);
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    expect((document.querySelector(".conversation-layout.is-vibe-canvas-focus") as HTMLElement).dataset.canvasPhase).toBe("ready");
    expect(document.querySelector(".canvas-preparation-transition")).toBeNull();

    rerender(<DialogueScreen {...baseProps()} tasks={[generatingChapterTask]} />);
    rerender(<DialogueScreen {...baseProps()} tasks={[outlineTask]} />);

    expect((document.querySelector(".conversation-layout.is-vibe-canvas-focus") as HTMLElement).dataset.canvasPhase).toBe("ready");
    expect(document.querySelector(".canvas-preparation-transition")).toBeNull();
    expect((document.querySelector(".living-tree-cockpit") as HTMLElement).dataset.vibeStage).toBe("outline_ready");
    expect(flowNodeCard("chapter")?.classList.contains("is-node-drawing")).toBe(true);
    vi.useRealTimers();
  });

  it("shows a temporary thinking node while the next PPT step waits on LLM output, then fades it before drawing the new node", async () => {
    const outlineTask: DesktopTask = {
      id: "task-vibe-outline-thinking",
      conversationId: "task-vibe-outline-thinking",
      status: "question",
      documentType: "pptx",
      events: [],
      question: {
        id: "vibe_outline_ready",
        question: "Chapters generated.",
        allowFreeform: true,
        options: [{ id: "generate_outline", label: "Generate Outline", recommended: true }],
      },
      vibeTree: {
        stage: "outline_ready",
        actions: [{ id: "generate_outline", label: "Generate Outline" }],
        tree: {
          id: "tree-outline-thinking",
          rootId: "root",
          title: "Awaiting Outline",
          nodes: [
            { id: "root", kind: "root", title: "Awaiting Outline" },
            { id: "branch", parentId: "root", kind: "branch", title: "Problem" },
            { id: "group-a", parentId: "branch", kind: "slide_group", title: "Chapter A" },
          ],
        },
        confirmation: { nodeIds: ["group-a"] },
      },
    };
    const runningTask: DesktopTask = {
      ...outlineTask,
      id: "task-vibe-outline-thinking-running",
      status: "running",
      question: undefined,
    };
    const refinedTask: DesktopTask = {
      ...outlineTask,
      id: "task-vibe-outline-thinking-refined",
      status: "question",
      events: [{ task_id: "task-vibe-outline-thinking-refined", type: "task.vibe_tree", ts: new Date().toISOString(), payload: { stage: "refined_ready" } }],
      question: {
        id: "vibe_refined_ready",
        question: "Outline generated.",
        allowFreeform: true,
        options: [{ id: "export_pptx", label: "Generate PPTX", recommended: true }],
      },
      vibeTree: {
        stage: "refined_ready",
        actions: [{ id: "export_pptx", label: "Generate PPTX" }],
        tree: {
          id: "tree-outline-thinking-refined",
          rootId: "root",
          title: "Awaiting Outline",
          nodes: [
            { id: "root", kind: "root", title: "Awaiting Outline" },
            { id: "branch", parentId: "root", kind: "branch", title: "Problem" },
            { id: "group-a", parentId: "branch", kind: "slide_group", title: "Chapter A" },
            { id: "outline-a", parentId: "group-a", kind: "outline", title: "Outline A" },
          ],
        },
        confirmation: { nodeIds: ["outline-a"] },
      },
    };

    const { rerender } = render(<DialogueScreen {...baseProps()} tasks={[outlineTask]} />);

    await waitForVibePopoverTitle("Chapter A");
    clickCurrentVibeConfirmButton();
    await waitFor(() => expect(screen.getByText("Confirmed 1/1")).toBeTruthy());

    rerender(<DialogueScreen {...baseProps()} tasks={[runningTask]} />);

    const thinkingNodeId = "thinking-group-a-outline_ready";
    expect(flowNodeCard(thinkingNodeId)?.classList.contains("is-thinking")).toBe(true);
    expect(flowNodeCard(thinkingNodeId)?.classList.contains("is-thinking-active")).toBe(true);

    vi.useFakeTimers();
    rerender(<DialogueScreen {...baseProps()} tasks={[refinedTask]} />);

    expect(flowNodeCard(thinkingNodeId)?.classList.contains("is-thinking-done")).toBe(true);
    expect(flowNodeCard("outline-a")).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(1200);
    });

    expect(flowNodeCard(thinkingNodeId)).toBeNull();
    expect(flowNodeCard("outline-a")?.classList.contains("is-node-drawing")).toBe(true);
    vi.useRealTimers();
  });

  it("shows the thinking node immediately while confirming Idea waits for the LLM to return Story Beat", async () => {
    const respondDeferred = deferred<unknown>();
    respondSpy.mockReturnValueOnce(respondDeferred.promise);
    const task: DesktopTask = {
      id: "task-vibe-idea-thinking",
      conversationId: "task-vibe-idea-thinking",
      status: "question",
      documentType: "pptx",
      events: [],
      question: {
        id: "vibe_story_ready",
        question: "Project Map generated.",
        allowFreeform: true,
        options: [{ id: "generate_chapters", label: "Generate Chapters", recommended: true }],
      },
      vibeTree: {
        stage: "story_ready",
        actions: [{ id: "generate_chapters", label: "Generate Chapters" }],
        tree: {
          id: "tree-idea-thinking",
          rootId: "root",
          title: "Introduce OfficeDex Docs",
          nodes: [
            { id: "root", kind: "root", title: "Introduce OfficeDex Docs" },
          ],
        },
        confirmation: { nodeIds: ["root"] },
      },
    };

    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    await waitForVibePopoverTitle("Introduce OfficeDex Docs");
    clickCurrentVibeConfirmButton();

    const thinkingNodeId = "thinking-root-story_ready";
    await waitFor(() => expect(flowNodeCard(thinkingNodeId)?.classList.contains("is-thinking-active")).toBe(true));
    expect(flowNodeCard(thinkingNodeId)?.textContent).toContain("Thinking");
    expect((document.querySelector(`.react-flow__node[data-id="${thinkingNodeId}"]`) as HTMLElement | null)?.style.height).toBe("108px");

    respondDeferred.resolve(undefined);
  });

  it("exposes motion state for running PPT generation stages", () => {
    const task = makeRunningTask({
      documentType: "pptx",
      stages: [
        { id: "analyze", label: "Analyzing request", status: "completed" },
        { id: "outline", label: "Drafting outline", status: "active" },
        { id: "writing", label: "Writing content", status: "pending" },
      ],
      activeStageId: "outline",
    });

    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    const loading = document.querySelector(".generation-loading-message") as HTMLElement;
    expect(loading.dataset.motionStatus).toBe("running");
    expect(loading.dataset.documentType).toBe("pptx");
    const rail = document.querySelector(".generation-stage-rail") as HTMLElement;
    expect(rail.dataset.activeStageId).toBe("outline");
    expect(rail.dataset.stageCount).toBe("3");
    expect(document.querySelector(".generation-stage-item[data-stage-id='analyze']")?.classList.contains("is-stage-completed")).toBe(true);
    expect(document.querySelector(".generation-stage-item[data-stage-id='outline']")?.classList.contains("is-stage-active")).toBe(true);
  });

  it("renders a backend Vibe Project Tree snapshot as a canvas-first task without the old question composer", async () => {
    vi.useFakeTimers();
    const task: DesktopTask = {
      id: "task-vibe",
      conversationId: "task-vibe",
      status: "question",
      documentType: "pptx",
      topic: "Rebuild Internal Knowledge Base",
      events: [
        { task_id: "task-vibe", type: "task.started", payload: { document_type: "pptx", topic: "Rebuild Internal Knowledge Base" } },
        { task_id: "task-vibe", type: "task.vibe_tree", payload: { stage: "refined_ready" } },
        { task_id: "task-vibe", type: "task.question", payload: { id: "vibe_refined_ready", question: "Ready to generate PPTX", options: [{ id: "export_pptx", label: "Generate PPTX" }], allow_freeform: true } },
      ],
      question: {
        id: "vibe_refined_ready",
        question: "Ready to generate PPTX, or type a message to adjust direction.",
        allowFreeform: true,
        options: [{ id: "export_pptx", label: "Generate PPTX", recommended: true }],
      },
      vibeTree: {
        stage: "refined_ready",
        tree: {
          id: "tree-1",
          rootId: "root",
          title: "I want to explain why we need to rebuild our internal knowledge base",
          direction: "More like a version for the boss",
          nodes: [
            { id: "root", kind: "root", title: "I want to explain why we need to rebuild our internal knowledge base", summary: "Raw request" },
            { id: "branch-problem", parentId: "root", kind: "branch", title: "Problem", summary: "Can't find, can't trust, can't use" },
            { id: "group-problem", parentId: "branch-problem", kind: "slide_group", title: "Problem Breakdown", slideRange: "3-5" },
            {
              id: "slide-03",
              parentId: "group-problem",
              kind: "slide",
              title: "Hidden cost 1: Search and repeated questions consume attention",
              summary: "Convert the inability to find knowledge into discussable time and efficiency costs.",
              slideNumber: 3,
              outline: ["Finding materials requires searching across multiple systems each time", "Repeated questions consume expert time"],
              visualAssets: [{ kind: "chart", description: "Bar chart comparing time spent searching for materials" }],
              trace: ["root", "branch-problem", "group-problem"],
            },
          ],
        },
        actions: [{ id: "export_pptx", label: "Generate PPTX" }],
      },
    };

    render(<DialogueScreen {...baseProps()} tasks={[task]} />);
    await act(async () => {
      vi.advanceTimersByTime(12000);
    });

    expect(screen.getByText("Living Tree Cockpit")).toBeTruthy();
    const cockpit = screen.getByLabelText("Living Tree Cockpit") as HTMLElement;
    expect(cockpit.dataset.vibeStage).toBe("refined_ready");
    expect(cockpit.dataset.vibeActiveIndex).toBe("3");
    expect(document.querySelector(".living-tree-steps")?.getAttribute("data-active-index")).toBe("3");
    expect(document.querySelector(".living-tree-step[data-step-key='outline']")?.classList.contains("is-active")).toBe(true);
    expect(screen.getAllByText("I want to explain why we need to rebuild our internal knowledge base").length).toBeGreaterThan(0);
    expect(flowNodeCard("group-problem")?.querySelector("strong")?.textContent).toBe("Problem Breakdown");
    expect(flowNodeCard("slide-03")?.querySelector("strong")?.textContent).toBe("Hidden cost 1: Search and repeated questions consume attention");
    expect(flowNodeCard("slide-03")?.querySelector(".living-tree-visual-asset-icon.is-chart")).toBeTruthy();
    expect(screen.getByLabelText("Chart: Bar chart comparing time spent searching for materials")).toBeTruthy();
    expect(within(flowNodeCard("slide-03") as HTMLElement).getByText("Page 3")).toBeTruthy();
    expect(within(flowNodeCard("slide-03") as HTMLElement).queryByText("P3")).toBeNull();
    expect(screen.queryByText("Q1")).toBeNull();
    expect(screen.queryByPlaceholderText(/custom answer if none of the options fit/i)).toBeNull();
    expect(document.querySelector(".conversation-layout.is-vibe-canvas-focus")).toBeTruthy();
    expect(document.querySelector(".react-flow__minimap")).toBeTruthy();
    expect(document.querySelector(".chat-thread")).toBeNull();
    expect(document.querySelector(".conversation-footer")).toBeNull();
    expect(screen.queryByText("Generation History")).toBeNull();
    expect(screen.queryByText("Rebuild Internal Knowledge Base")).toBeNull();

    fireEvent.click(flowNodeCard("slide-03") as Element);
    expect(currentVibePopoverTitle()).toBe("Hidden cost 1: Search and repeated questions consume attention");
    clickCurrentVibeConfirmButton();
    fireEvent.click(screen.getByRole("button", { name: "Generate PPTX" }));

    expect(respondSpy).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task-vibe",
      questionId: "vibe_refined_ready",
      optionId: "export_pptx",
    }));
    vi.useRealTimers();
  });

  it("places parent tree nodes at the center of their expanded child groups", () => {
    const snapshot: VibeTreeSnapshot = {
      stage: "refined_ready",
      actions: [],
      tree: {
        id: "tree-layout",
        rootId: "root",
        title: "Layout test",
        nodes: [
          { id: "root", kind: "root", title: "Idea" },
          { id: "branch", parentId: "root", kind: "branch", title: "Story Beat" },
          { id: "group-a", parentId: "branch", kind: "slide_group", title: "Short Chapter" },
          { id: "group-b", parentId: "branch", kind: "slide_group", title: "Long Chapter" },
          { id: "slide-a-1", parentId: "group-a", kind: "slide", title: "A1", slideNumber: 1 },
          { id: "slide-a-2", parentId: "group-a", kind: "slide", title: "A2", slideNumber: 2 },
          { id: "slide-b-1", parentId: "group-b", kind: "slide", title: "B1", slideNumber: 3 },
          { id: "slide-b-2", parentId: "group-b", kind: "slide", title: "B2", slideNumber: 4 },
          { id: "slide-b-3", parentId: "group-b", kind: "slide", title: "B3", slideNumber: 5 },
          { id: "slide-b-4", parentId: "group-b", kind: "slide", title: "B4", slideNumber: 6 },
          { id: "slide-b-5", parentId: "group-b", kind: "slide", title: "B5", slideNumber: 7 },
        ],
      },
    };

    const flowModel = buildVibeFlowModel(snapshot);
    const positions = new Map(flowModel.nodes.map((node) => [node.id, node.position.y]));
    const nodeCenterY = (id: string, height: number) => (positions.get(id) ?? 0) + height / 2;
    const groupAChildren = ["slide-a-1", "slide-a-2"].map((id) => nodeCenterY(id, 258));
    const groupBChildren = ["slide-b-1", "slide-b-2", "slide-b-3", "slide-b-4", "slide-b-5"].map((id) => nodeCenterY(id, 258));
    const center = (values: number[]) => (Math.min(...values) + Math.max(...values)) / 2;

    expect(nodeCenterY("group-a", 124)).toBeCloseTo(center(groupAChildren), 1);
    expect(nodeCenterY("group-b", 124)).toBeCloseTo(center(groupBChildren), 1);
    expect((positions.get("group-b") ?? 0) - (positions.get("group-a") ?? 0)).toBeGreaterThan(500);
  });

  it("creates visible chapter lanes that span each chapter's outline group", () => {
    const snapshot: VibeTreeSnapshot = {
      stage: "refined_ready",
      actions: [],
      tree: {
        id: "tree-lanes",
        rootId: "root",
        title: "Lane test",
        nodes: [
          { id: "root", kind: "root", title: "Idea" },
          { id: "branch", parentId: "root", kind: "branch", title: "Story Beat" },
          { id: "group-a", parentId: "branch", kind: "slide_group", title: "Context Setting" },
          { id: "group-b", parentId: "branch", kind: "slide_group", title: "Problem Breakdown" },
          { id: "slide-a-1", parentId: "group-a", kind: "slide", title: "A1", slideNumber: 1 },
          { id: "slide-a-2", parentId: "group-a", kind: "slide", title: "A2", slideNumber: 2 },
          { id: "slide-b-1", parentId: "group-b", kind: "slide", title: "B1", slideNumber: 3 },
          { id: "slide-b-2", parentId: "group-b", kind: "slide", title: "B2", slideNumber: 4 },
          { id: "slide-b-3", parentId: "group-b", kind: "slide", title: "B3", slideNumber: 5 },
        ],
      },
    };

    const flowModel = buildVibeFlowModel(snapshot);
    const lanes = flowModel.nodes.filter((node) => node.type === "vibeLane").sort((a, b) => a.position.y - b.position.y);
    const positions = new Map(flowModel.nodes.map((node) => [node.id, node.position.y]));

    expect(lanes).toHaveLength(2);
    expect(lanes[0].id).toBe("lane-group-a");
    expect(lanes[1].id).toBe("lane-group-b");
    expect(lanes[0].data.treeNode.title).toBe("Context Setting");
    expect(lanes[1].data.treeNode.title).toBe("Problem Breakdown");
    expect(lanes[0].position.y).toBeLessThan(positions.get("slide-a-1") ?? 0);
    expect(lanes[1].position.y).toBeLessThan(positions.get("slide-b-1") ?? 0);
    expect(Number(lanes[0].style?.height)).toBeGreaterThan(258);
    expect(Number(lanes[1].style?.height)).toBeGreaterThan(Number(lanes[0].style?.height));
  });

  it("shows the expected generated page count on each Chapter node", () => {
    const snapshot: VibeTreeSnapshot = {
      stage: "refined_ready",
      actions: [],
      tree: {
        id: "tree-chapter-page-count",
        rootId: "root",
        title: "Chapter page count",
        nodes: [
          { id: "root", kind: "root", title: "Idea" },
          { id: "branch", parentId: "root", kind: "branch", title: "Story Beat" },
          { id: "group-a", parentId: "branch", kind: "slide_group", title: "Context Setting" },
          { id: "group-b", parentId: "branch", kind: "slide_group", title: "Problem Breakdown" },
          { id: "slide-a-1", parentId: "group-a", kind: "slide", title: "A1", slideNumber: 1 },
          { id: "slide-a-2", parentId: "group-a", kind: "slide", title: "A2", slideNumber: 2 },
          { id: "outline-b-1", parentId: "group-b", kind: "outline", title: "B1" },
          { id: "outline-b-2", parentId: "group-b", kind: "outline", title: "B2" },
          { id: "outline-b-3", parentId: "group-b", kind: "outline", title: "B3" },
        ],
      },
    };

    render(<DialogueScreen {...baseProps()} tasks={[{
      id: "task-chapter-page-count",
      conversationId: "task-chapter-page-count",
      status: "question",
      documentType: "pptx",
      events: [],
      question: {
        id: "vibe_refined_ready",
        question: "Ready to generate PPTX.",
        allowFreeform: true,
        options: [{ id: "export_pptx", label: "Generate PPTX" }],
      },
      vibeTree: snapshot,
    }]} />);

    expect(within(flowNodeCard("group-a") as HTMLElement).getByText("2 Pages")).toBeTruthy();
    expect(within(flowNodeCard("group-b") as HTMLElement).getByText("3 Pages")).toBeTruthy();
  });

  it("does not show Deck or Deck edges while Slides are still awaiting confirmation", () => {
    const snapshot: VibeTreeSnapshot = {
      stage: "slides_ready",
      actions: [{ id: "export_pptx", label: "Generate PPTX" }],
      confirmation: { nodeIds: ["slide-01", "slide-02"] },
      tree: {
        id: "tree-slides-confirming",
        rootId: "root",
        title: "Deck visibility",
        nodes: [
          { id: "root", kind: "root", title: "Idea" },
          { id: "branch", parentId: "root", kind: "branch", title: "Story Beat" },
          { id: "chapter", parentId: "branch", kind: "slide_group", title: "Chapter" },
          { id: "outline-01", parentId: "chapter", kind: "outline", title: "P1" },
          { id: "slide-01", parentId: "outline-01", kind: "slide", title: "P1", slideNumber: 1 },
          { id: "outline-02", parentId: "chapter", kind: "outline", title: "P2" },
          { id: "slide-02", parentId: "outline-02", kind: "slide", title: "P2", slideNumber: 2 },
        ],
      },
    };

    const flowModel = buildVibeFlowModel(snapshot);

    expect(flowModel.nodes.some((node) => node.id === "deck")).toBe(false);
    expect(flowModel.edges.some((edge) => edge.source === "deck" || edge.target === "deck")).toBe(false);
  });

  it("keeps generated slides on the canvas until the visible approval is confirmed", async () => {
    const task: DesktopTask = {
      id: "task-generated-slide-approval",
      conversationId: "task-generated-slide-approval",
      status: "question",
      documentType: "pptx",
      events: [],
      question: {
        id: "demo-confirm-slides",
        question: "Confirm the generated slides",
        allowFreeform: true,
        options: [{ id: "confirm", label: "Approve Generated Slides" }],
      },
      vibeTree: {
        stage: "slides_ready",
        actions: [{ id: "confirm", label: "Approve Generated Slides" }],
        confirmation: { nodeIds: ["slide-6"] },
        tree: {
          id: "tree-generated-slide-approval",
          rootId: "root",
          title: "Launch Strategy",
          nodes: [
            { id: "root", kind: "root", title: "Launch Strategy" },
            { id: "chapter-02", parentId: "root", kind: "slide_group", title: "Launch Execution" },
            { id: "outline-6", parentId: "chapter-02", kind: "outline", title: "90-Day Timeline" },
            { id: "slide-6", parentId: "outline-6", kind: "generated_slide", title: "90-Day Launch Timeline", slideNumber: 6 },
          ],
        },
      },
    };

    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    await waitForVibePopoverTitle("90-Day Launch Timeline");
    clickCurrentVibeConfirmButton();
    await waitFor(() => expect(screen.getByRole("button", { name: "Approve Generated Slides" })).not.toBeDisabled());
    expect(document.querySelector(".living-tree-pptx-edit-panel")).toBeNull();
  });

  it("shows Deck and connects generated Slides after the flow advances to rendering", () => {
    const snapshot: VibeTreeSnapshot = {
      stage: "rendering",
      actions: [],
      tree: {
        id: "tree-rendering-deck",
        rootId: "root",
        title: "Deck visibility",
        nodes: [
          { id: "root", kind: "root", title: "Idea" },
          { id: "branch", parentId: "root", kind: "branch", title: "Story Beat" },
          { id: "chapter", parentId: "branch", kind: "slide_group", title: "Chapter" },
          { id: "outline-01", parentId: "chapter", kind: "outline", title: "P1" },
          { id: "slide-01", parentId: "outline-01", kind: "slide", title: "P1", slideNumber: 1 },
          { id: "outline-02", parentId: "chapter", kind: "outline", title: "P2" },
          { id: "slide-02", parentId: "outline-02", kind: "slide", title: "P2", slideNumber: 2 },
        ],
      },
    };

    const flowModel = buildVibeFlowModel(snapshot);

    expect(flowModel.nodes.some((node) => node.id === "deck")).toBe(true);
    expect(flowModel.edges.some((edge) => edge.source === "slide-01" && edge.target === "deck")).toBe(true);
    expect(flowModel.edges.some((edge) => edge.source === "slide-02" && edge.target === "deck")).toBe(true);
  });

  it("renders generated Slide nodes as horizontal PPTX placeholder thumbnails", () => {
    const snapshot: VibeTreeSnapshot = {
      stage: "rendering",
      actions: [],
      tree: {
        id: "tree-slide-thumbnail",
        rootId: "root",
        title: "Slide thumbnail",
        nodes: [
          { id: "root", kind: "root", title: "Slide thumbnail" },
          { id: "branch", parentId: "root", kind: "branch", title: "Problem" },
          { id: "chapter", parentId: "branch", kind: "slide_group", title: "Chapter" },
          { id: "outline-01", parentId: "chapter", kind: "outline", title: "P1" },
          {
            id: "slide-01",
            parentId: "outline-01",
            kind: "slide",
            title: "Rebuilding the internal knowledge base: from tool upgrade to organizational collaboration upgrade",
            summary: "Establish the reporting thesis: the essence of rebuilding the knowledge base is reducing collaboration friction.",
            outline: ["Clarify that today's discussion is not about switching storage tools", "Point out that knowledge workflow efficiency directly impacts cross-team decisions"],
            visualAssets: [{ kind: "chart", description: "Collaboration efficiency comparison chart" }],
            slideNumber: 1,
          },
        ],
      },
    };

    const flowModel = buildVibeFlowModel(snapshot);
    const slideNode = flowModel.nodes.find((node) => node.id === "slide-01");

    expect(slideNode).toEqual(expect.objectContaining({ width: 416, height: 234 }));
    expect(slideNode?.style).toEqual(expect.objectContaining({ width: 416, height: 234 }));

    render(<DialogueScreen {...baseProps()} tasks={[{
      id: "task-slide-thumbnail",
      conversationId: "task-slide-thumbnail",
      status: "running",
      documentType: "pptx",
      events: [],
      vibeTree: snapshot,
    }]} />);

    const slideCard = flowNodeCard("slide-01") as HTMLElement;
    expect(slideCard.classList.contains("is-slide-thumbnail")).toBe(true);
    expect(slideCard.querySelector(".living-tree-slide-thumbnail")).toBeTruthy();
    expect(slideCard.querySelector(".living-tree-pptx-placeholder")).toBeTruthy();
    expect(slideCard.querySelector(".living-tree-pptx-underlay")).toBeTruthy();
    expect(slideCard.querySelector(".living-tree-pptx-placeholder-mask")).toBeTruthy();
    expect(slideCard.querySelector(".living-tree-slide-preview-iframe")).toBeNull();
    expect(within(slideCard).queryByText("Page 1")).toBeTruthy();
    expect(within(slideCard).queryByText("Preview thumbnail unavailable")).toBeTruthy();
    expect(within(slideCard).queryByText("Final PPTX output is the source of truth")).toBeTruthy();
    expect(within(slideCard).queryByText("暂无缩略图预览")).toBeNull();
    expect(within(slideCard).queryByText("以实际生成的 PPTX 为准")).toBeNull();
    expect(within(slideCard).queryByText("Rebuilding the internal knowledge base: from tool upgrade to organizational collaboration upgrade")).toBeTruthy();
    expect(within(slideCard).queryByText("Establish the reporting thesis: the essence of rebuilding the knowledge base is reducing collaboration friction.")).toBeTruthy();
    expect(within(slideCard).queryByText("Clarify that today's discussion is not about switching storage tools")).toBeTruthy();
    expect(within(slideCard).queryByText("Point out that knowledge workflow efficiency directly impacts cross-team decisions")).toBeTruthy();
  });

  it("keeps generated Slide thumbnails separated with strict PowerPoint proportions", () => {
    const snapshot: VibeTreeSnapshot = {
      stage: "rendering",
      actions: [],
      tree: {
        id: "tree-slide-thumbnail-spacing",
        rootId: "root",
        title: "Slide thumbnail spacing",
        nodes: [
          { id: "root", kind: "root", title: "Slide thumbnail spacing" },
          { id: "branch", parentId: "root", kind: "branch", title: "Problem" },
          { id: "chapter", parentId: "branch", kind: "slide_group", title: "Chapter" },
          { id: "outline-01", parentId: "chapter", kind: "outline", title: "P1" },
          { id: "slide-01", parentId: "outline-01", kind: "slide", title: "P1", slideNumber: 1 },
          { id: "outline-02", parentId: "chapter", kind: "outline", title: "P2" },
          { id: "slide-02", parentId: "outline-02", kind: "slide", title: "P2", slideNumber: 2 },
        ],
      },
    };
    const model = buildVibeFlowModel(snapshot);
    const firstSlide = model.nodes.find((node) => node.id === "slide-01");
    const secondSlide = model.nodes.find((node) => node.id === "slide-02");
    const css = readFileSync("src/renderer/styles/dialogue.css", "utf8");
    const slideRule = css.match(/^\.living-tree-flow-node\.is-generated_slide\s*\{(?<body>[^}]*)\}/m)?.groups?.body ?? "";
    const pageRule = css.match(/^\.living-tree-slide-thumbnail-page\s*\{(?<body>[^}]*)\}/m)?.groups?.body ?? "";
    const underlayRule = css.match(/^\.living-tree-pptx-underlay\s*\{(?<body>[^}]*)\}/m)?.groups?.body ?? "";
    const maskRule = css.match(/^\.living-tree-pptx-placeholder-mask\s*\{(?<body>[^}]*)\}/m)?.groups?.body ?? "";
    const deckRule = css.match(/^\.living-tree-flow-node\.is-deck\s*\{(?<body>[^}]*)\}/m)?.groups?.body ?? "";
    const deckPptxArtRule = css.match(/^\.living-tree-deck-pptx-art\s*\{(?<body>[^}]*)\}/m)?.groups?.body ?? "";
    const deckActionsRule = css.match(/^\.living-tree-flow-node\.is-deck\.has-completed-artifact \.living-tree-artifact-actions\s*\{(?<body>[^}]*)\}/m)?.groups?.body ?? "";
    const deckButtonRule = css.match(/^\.living-tree-flow-node\.is-deck\.has-completed-artifact \.living-tree-artifact-actions \.ant-btn\s*\{(?<body>[^}]*)\}/m)?.groups?.body ?? "";

    expect(firstSlide).toEqual(expect.objectContaining({ width: 416, height: 234 }));
    expect(secondSlide).toEqual(expect.objectContaining({ width: 416, height: 234 }));
    expect((secondSlide?.position.y ?? 0) - (firstSlide?.position.y ?? 0)).toBeGreaterThanOrEqual(306);
    expect(slideRule).toContain("aspect-ratio: 16 / 9");
    expect(slideRule).toContain("overflow: visible");
    expect(pageRule).toContain("box-sizing: border-box");
    expect(pageRule).toContain("overflow: hidden");
    expect(underlayRule).toContain("filter: blur(0.55px)");
    expect(underlayRule).toContain("opacity: 0.76");
    expect(underlayRule).toContain("z-index: 0");
    expect(maskRule).toContain("z-index: 1");
    expect(deckRule).toContain("width: 100%");
    expect(deckActionsRule).toContain("display: grid");
    expect(deckActionsRule).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(deckActionsRule).toContain("align-self: end");
    expect(css).toContain("grid-template-rows: auto minmax(0, 1fr) auto");
    expect(css).toContain(".living-tree-deck-pptx-art");
    expect(css).toContain(".living-tree-deck-slide-fan");
    expect(css).toContain(".living-tree-deck-fan-slide");
    expect(css).toContain(".living-tree-deck-pptx-chip");
    expect(css).toContain("@keyframes living-tree-deck-fan-left");
    expect(css).toContain("@keyframes living-tree-deck-fan-right");
    expect(css).toContain("@keyframes living-tree-deck-fan-float");
    expect(css).not.toContain(".living-tree-deck-slide-tiles");
    expect(css).not.toContain("@keyframes living-tree-deck-tile-wave");
    expect(deckPptxArtRule).toContain("border: none");
    expect(deckPptxArtRule).toContain("background: transparent");
    expect(deckPptxArtRule).toContain("box-shadow: none");
    expect(css).not.toContain("grid-template-columns: minmax(0, 1fr) 236px");
    expect(css).toContain(".living-tree-deck-completed-copy");
    expect(deckButtonRule).toContain("width: 100%");
    expect(deckButtonRule).toContain("min-width: 0");
  });

  it("does not synthesize duplicate generated Slides when slide nodes already exist", () => {
    const snapshot: VibeTreeSnapshot = {
      stage: "rendering",
      actions: [],
      tree: {
        id: "tree-existing-slides",
        rootId: "root",
        title: "Existing slides",
        nodes: [
          { id: "root", kind: "root", title: "Existing slides" },
          { id: "branch", parentId: "root", kind: "branch", title: "Problem" },
          { id: "chapter", parentId: "branch", kind: "slide_group", title: "Chapter" },
          { id: "slide-01", parentId: "chapter", kind: "slide", title: "P1", slideNumber: 1 },
          { id: "slide-02", parentId: "chapter", kind: "slide", title: "P2", slideNumber: 2 },
        ],
      },
    };

    const flowModel = buildVibeFlowModel(snapshot);
    const generatedSlides = flowModel.nodes.filter((node) => node.data.kind === "generated_slide");

    expect(generatedSlides.map((node) => node.id)).toEqual(["slide-01", "slide-02"]);
    expect(flowModel.nodes.some((node) => node.id.startsWith("generated-slide-"))).toBe(false);
  });

  it("marks generated slides and deck for assembly motion while rendering", () => {
    const task: DesktopTask = {
      id: "task-vibe-rendering-motion",
      conversationId: "task-vibe-rendering-motion",
      status: "running",
      documentType: "pptx",
      events: [],
      vibeTree: {
        stage: "rendering",
        actions: [],
        tree: {
          id: "tree-rendering-motion",
          rootId: "root",
          title: "Deck assembly",
          nodes: [
            { id: "root", kind: "root", title: "Idea" },
            { id: "branch", parentId: "root", kind: "branch", title: "Story Beat" },
            { id: "chapter", parentId: "branch", kind: "slide_group", title: "Chapter" },
            { id: "outline-01", parentId: "chapter", kind: "outline", title: "P1" },
            { id: "slide-01", parentId: "outline-01", kind: "slide", title: "P1", slideNumber: 1 },
          ],
        },
      },
    };

    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    expect(document.querySelector(".living-tree-flow-shell")?.classList.contains("is-deck-assembling")).toBe(true);
    expect(flowNodeCard("slide-01")?.classList.contains("is-assembling")).toBe(true);
    // Deck node is hidden in the PPTist embed view during rendering stage
    expect(flowNodeCard("deck")).toBeNull();
  });

  it("turns completed Vibe PPTX into an Edit with AI workspace after every page is generated", async () => {
    const onPreview = vi.fn();
    const onContinueModify = vi.fn();
    const artifact = {
      taskId: "task-vibe-completed",
      filePath: "/tmp/internal-knowledge-base.pptx",
      fileName: "internal-knowledge-base.pptx",
      documentType: "pptx",
    };
    const task: DesktopTask = {
      id: "task-vibe-completed",
      conversationId: "task-vibe-completed",
      status: "completed",
      documentType: "pptx",
      topic: "Rebuild Internal Knowledge Base",
      events: [
        { task_id: "task-vibe-completed", type: "task.started", payload: { document_type: "pptx", topic: "Rebuild Internal Knowledge Base" } },
        { task_id: "task-vibe-completed", type: "task.vibe_tree", payload: { stage: "completed" } },
        { task_id: "task-vibe-completed", type: "task.completed", payload: { message: "done" } },
      ],
      artifact,
      vibeTree: {
        stage: "completed",
        actions: [],
        tree: {
          id: "tree-completed",
          rootId: "root",
          title: "I want to explain why we need to rebuild our internal knowledge base",
          nodes: [
            { id: "root", kind: "root", title: "I want to explain why we need to rebuild our internal knowledge base" },
            { id: "branch", parentId: "root", kind: "branch", title: "Problem" },
            { id: "chapter", parentId: "branch", kind: "slide_group", title: "Problem Breakdown" },
            { id: "outline-01", parentId: "chapter", kind: "outline", title: "P1" },
            { id: "slide-01", parentId: "outline-01", kind: "slide", title: "Legacy knowledge base is creating decision friction", slideNumber: 1 },
            { id: "deck", kind: "deck", title: "Complete PPTX Deck", summary: "All pages assembled into deliverable PPTX." },
          ],
        },
      },
    };

    render(<DialogueScreen {...baseProps({ onPreview, onContinueModify })} tasks={[task]} />);

    expect(document.querySelector(".conversation-layout.is-vibe-canvas-focus")).toBeTruthy();
    expect(screen.getByText("Living Tree Cockpit")).toBeTruthy();
    expect(document.querySelector(".chat-thread")).toBeNull();
    expect(document.querySelector(".conversation-footer")).toBeNull();
    expect(screen.queryByText("Generation Complete")).toBeNull();

    // When a PPTX file artifact exists, the animated PPTist surface owns the
    // completed-state artifact actions while the Deck node stays hidden.
    const pptxToolbar = document.querySelector(".living-tree-pptx-toolbar");
    const pptistEmbed = document.querySelector(".living-tree-pptist-embed");
    expect(pptxToolbar).toBeTruthy();
    expect(pptxToolbar?.parentElement?.classList.contains("living-tree-header")).toBe(true);
    expect(pptistEmbed?.previousElementSibling).not.toBe(pptxToolbar);
    expect(document.querySelector(".living-tree-completed-bar")).toBeNull();
    expect(pptistEmbed).toBeTruthy();
    expect(flowNodeCard("deck")).toBeNull();
    expect(screen.getAllByText("I want to explain why we need to rebuild our internal knowledge base").length).toBeGreaterThan(0);
    expect(screen.queryByText("0/1 pages generated")).toBeNull();
    const openFileButton = screen.getByRole("button", { name: "Open internal-knowledge-base.pptx" });
    const openCanvasTreeButton = screen.getByRole("button", { name: "Open canvas tree" });
    const exportButton = screen.getByRole("button", { name: "Export PPTX" }) as HTMLButtonElement;
    const showInFolderButton = screen.getByRole("button", { name: "Show in folder" }) as HTMLButtonElement;
    const openPreviewButton = screen.getByRole("button", { name: "Open Preview" }) as HTMLButtonElement;
    expect(openPreviewButton.textContent).toBe("");
    expect(openFileButton).toHaveAttribute("title", "Open internal-knowledge-base.pptx");
    expect(screen.queryByRole("button", { name: "AI conversation" })).toBeNull();
    expect(openCanvasTreeButton).toHaveAttribute("title", "Open canvas tree");
    expect(exportButton).toHaveAttribute("title", "Export PPTX");
    expect(showInFolderButton).toHaveAttribute("title", "Show in folder");
    expect(openPreviewButton).toHaveAttribute("title", "Open Preview");
    fireEvent.click(openFileButton);
    expect(openPathSpy).toHaveBeenCalledWith(artifact.filePath);
    expect(exportButton.disabled).toBe(true);
    expect(showInFolderButton.disabled).toBe(false);
    fireEvent.click(showInFolderButton);
    expect(showItemInFolderSpy).toHaveBeenCalledWith(artifact.filePath);
    expect(openPreviewButton.disabled).toBe(false);
    fireEvent.click(openPreviewButton);
    expect(onPreview).toHaveBeenCalledWith(artifact);
    expect(screen.getByText("Edit with AI")).toBeTruthy();
    const editInput = screen.getByPlaceholderText("Ask to modify this PPT...");
    const sendButton = screen.getByRole("button", { name: "Send edit request" }) as HTMLButtonElement;
    expect(editInput).toBeDisabled();
    expect(sendButton.disabled).toBe(true);
    expect(showInFolderButton.disabled).toBe(false);
    expect(exportButton.disabled).toBe(true);
    expect(screen.queryByText("PPTX generated: internal-knowledge-base.pptx")).toBeNull();
	    expect(screen.getByText("The deck is generated. Preparing the editor for follow-up edits...")).toBeTruthy();
		    const iframe = pptistEmbed?.querySelector("iframe") as HTMLIFrameElement;
		    await act(async () => {
		      window.dispatchEvent(new MessageEvent("message", {
		        data: { type: "pptist:embed-ready" },
		        source: iframe.contentWindow,
		      }));
		    });
	    await act(async () => {
	      window.dispatchEvent(new MessageEvent("message", {
	        data: {
	          type: "pptist:slides-loaded",
	          slides: [{ id: "Bbczix9SNA", elements: [{ id: "title", type: "text", content: "<p>Imported</p>" }] }],
	        },
	        source: iframe.contentWindow,
	      }));
	    });

	    expect(editInput).toBeEnabled();
		    await act(async () => {
	      window.dispatchEvent(new MessageEvent("message", {
	        data: { type: "pptist:slide-typed", index: 0, slideId: "generated-slide-01" },
	        source: iframe.contentWindow,
	      }));
	    });

	    expect(screen.queryByText("1/1 pages generated")).toBeNull();
	    await act(async () => {
	      window.dispatchEvent(new MessageEvent("message", {
	        data: {
	          type: "pptist:selection-changed",
	          selection: {
	            slideId: "generated-slide-01",
	            slideIndex: 0,
	            elementIds: ["shape-1"],
	            elements: [{ id: "shape-1", type: "shape", textPreview: "Main point", fill: "#112233" }],
	          },
	        },
	        source: iframe.contentWindow,
	      }));
	    });
	    const selectionChip = screen.getByRole("button", { name: "Show referenced shape: Shape Main point" });
	    expect(selectionChip.closest(".living-tree-pptx-edit-composer")).toBeTruthy();
	    expect(selectionChip).toHaveClass("living-tree-pptx-reference-chip-main");
	    expect(selectionChip.closest(".living-tree-pptx-reference-chip")).toBeTruthy();
	    expect(selectionChip.closest(".living-tree-pptx-edit-composer")).toHaveClass("has-inline-reference");
	    expect(screen.queryByText("PPT reference")).toBeNull();
	    expect(screen.queryByText("Locate")).toBeNull();
	    expect(screen.queryByRole("button", { name: "Use selection" })).toBeNull();
	    const postMessage = vi.spyOn(iframe.contentWindow!, "postMessage");
	    fireEvent.click(selectionChip);
	    expect(postMessage).toHaveBeenCalledWith({
	      type: "pptist:select-elements",
	      slideId: "generated-slide-01",
	      slideIndex: 0,
	      elementIds: ["shape-1"],
	    }, "*");
	    await act(async () => {
	      window.dispatchEvent(new MessageEvent("message", {
	        data: {
	          type: "pptist:selection-changed",
	          selection: {
	            slideId: "generated-slide-02",
	            slideIndex: 1,
	            elementIds: [],
	            elements: [],
	          },
	        },
	        source: iframe.contentWindow,
	      }));
	    });
	    expect(screen.getByRole("button", { name: "Show referenced shape: Shape Main point" })).toBeTruthy();
	    const removeSelectionButton = screen.getByRole("button", { name: "Remove referenced shape: Shape Main point" });
	    expect(removeSelectionButton).toHaveClass("living-tree-pptx-reference-chip-remove");
	    postMessage.mockClear();
	    fireEvent.click(removeSelectionButton);
	    expect(screen.queryByRole("button", { name: "Show referenced shape: Shape Main point" })).toBeNull();
	    expect(screen.queryByRole("button", { name: "Remove referenced shape: Shape Main point" })).toBeNull();
	    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "pptist:select-elements" }), "*");
	    await act(async () => {
	      window.dispatchEvent(new MessageEvent("message", {
	        data: {
	          type: "pptist:selection-changed",
	          selection: {
	            slideId: "generated-slide-01",
	            slideIndex: 0,
	            elementIds: ["shape-1"],
	            elements: [{ id: "shape-1", type: "shape", textPreview: "Main point", fill: "#112233" }],
	          },
	        },
	        source: iframe.contentWindow,
	      }));
	    });
			    fireEvent.change(editInput, { target: { value: "Make slide 1 more executive." } });
			    expect(sendButton.disabled).toBe(false);
			    fireEvent.click(sendButton);
			    expect(screen.queryByRole("button", { name: "Show referenced shape: Shape Main point" })).toBeNull();
			    expect(screen.queryByRole("button", { name: "Remove referenced shape: Shape Main point" })).toBeNull();
			    expectDialogueBubble("Make slide 1 more executive.", "user");
			    expectDialogueBubble("Reading the current PPTist deck...", "ai");
			    const snapshotMessage = postMessage.mock.calls.find(([msg]) => (msg as { type?: string }).type === "pptist:get-snapshot")?.[0] as { requestId: string };
			    expect(snapshotMessage.requestId).toBeTruthy();
	    await act(async () => {
	      window.dispatchEvent(new MessageEvent("message", {
	        source: iframe.contentWindow,
	        data: {
	          type: "pptist:snapshot-result",
	          requestId: snapshotMessage.requestId,
	          snapshot: {
	            slides: [{ id: "generated-slide-01", elements: [{ id: "title", type: "text", content: "<p>Old</p>" }] }],
	            title: "Deck",
	            theme: {},
	            viewportSize: 1000,
	            viewportRatio: 0.5625,
	            slideIndex: 0,
	          },
	        },
		      }));
		    });
			    const internalExportMessage = postMessage.mock.calls.find(([msg]) => (msg as { type?: string }).type === "pptist:export-pptx")?.[0] as { requestId: string; fileName?: string; targetFilePath?: string };
	    expect(internalExportMessage.requestId).toBeTruthy();
	    expect(internalExportMessage.fileName).toBe(artifact.fileName);
	    expect(internalExportMessage.targetFilePath).toBeUndefined();
	    await act(async () => {
	      window.dispatchEvent(new MessageEvent("message", {
	        source: iframe.contentWindow,
	        data: {
	          type: "pptist:export-result",
	          requestId: internalExportMessage.requestId,
	          buffer: new Uint8Array([80, 75, 3, 4]).buffer,
	          fileName: artifact.fileName,
	        },
		      }));
		      await Promise.resolve();
		    });
			    await waitFor(() => expectDialogueBubble("Planning edits from the current PPTist content...", "ai"));
			    await waitFor(() => expect(modifyPptistDeckSpy).toHaveBeenCalledWith(expect.objectContaining({
		      prompt: "Make slide 1 more executive.",
	      snapshot: expect.objectContaining({ title: "Deck" }),
	      selectedSlideId: "generated-slide-01",
	      selectedElementIds: ["shape-1"],
		      pptxDataBase64: "UEsDBA==",
			    })));
			    expectDialogueBubble("Updated title", "ai");
			    expectDialogueBubbleNotLoading("Reading the current PPTist deck...");
			    expectDialogueBubbleNotLoading("Planning edits from the current PPTist content...");
			    const applyMessage = postMessage.mock.calls.find(([msg]) => (msg as { type?: string }).type === "pptist:apply-edit-ops")?.[0] as { runId: string; ops: unknown[] };
				    expect(applyMessage.ops).toEqual([{
				      type: "element:update-text",
				      slideId: "generated-slide-01",
				      elementId: "title",
				      text: "Executive title",
				      preserveStyle: true,
				      animation: { mode: "typewriter", clearFirst: true, showCaret: true },
				    }]);
		    await act(async () => {
		      window.dispatchEvent(new MessageEvent("message", {
		        source: iframe.contentWindow,
		        data: { type: "pptist:edit-op-started", runId: applyMessage.runId, index: 0, op: applyMessage.ops[0] },
		      }));
		      await Promise.resolve();
		    });
			    await waitFor(() => expectDialogueBubble("Applying edit 1 in PPTist...", "ai"));
		    vi.useFakeTimers();
		    await act(async () => {
		      window.dispatchEvent(new MessageEvent("message", {
		        source: iframe.contentWindow,
		        data: { type: "pptist:edit-run-completed", runId: applyMessage.runId, ok: true, applied: 1 },
		      }));
		      await Promise.resolve();
			    });
		    expectDialogueBubbleNotLoading("Applying edit 1 in PPTist...");
		    const autosaveMessage = postMessage.mock.calls.find(([msg]) => {
		      const payload = msg as { type?: string; requestId?: string; targetFilePath?: string };
		      return payload.type === "pptist:export-pptx" && payload.targetFilePath === artifact.filePath;
		    })?.[0] as { requestId: string; fileName?: string; targetFilePath: string };
		    expect(autosaveMessage.requestId).toBeTruthy();
		    expect(autosaveMessage.fileName).toBe(artifact.fileName);
		    await act(async () => {
		      window.dispatchEvent(new MessageEvent("message", {
		        source: iframe.contentWindow,
		        data: {
		          type: "pptist:export-result",
		          requestId: autosaveMessage.requestId,
		          targetFilePath: artifact.filePath,
		          buffer: new Uint8Array([1, 2, 3]).buffer,
		          fileName: artifact.fileName,
		        },
		      }));
		      await Promise.resolve();
		    });
		    expect(savePptxSpy).toHaveBeenCalledWith(
		      new Uint8Array([1, 2, 3]),
		      artifact.fileName,
		      { targetFilePath: artifact.filePath },
		    );
		    expect(screen.getByText("Saved locally.")).toBeTruthy();
	    fireEvent.change(editInput, { target: { value: "Make the deck shorter." } });
	    expect(sendButton.disabled).toBe(false);
	    expect(exportButton.disabled).toBe(false);
	    fireEvent.click(exportButton);
	    const exportMessages = postMessage.mock.calls.filter(([msg]) => (msg as { type?: string }).type === "pptist:export-pptx");
	    const exportMessage = exportMessages[exportMessages.length - 1]?.[0] as { requestId?: string; targetFilePath?: string; fileName?: string };
	    expect(exportMessage.requestId).toBeUndefined();
	    expect(exportMessage.fileName).toBe(artifact.fileName);
	    expect(exportMessage.targetFilePath).toBeUndefined();
	    await act(async () => {
	      window.dispatchEvent(new MessageEvent("message", {
	        source: iframe.contentWindow,
	        data: { type: "pptist:export-result", buffer: new Uint8Array([1, 2, 3]).buffer, fileName: artifact.fileName },
	      }));
	      await Promise.resolve();
	    });
	    expect(savePptxSpy).toHaveBeenLastCalledWith(new Uint8Array([1, 2, 3]), artifact.fileName, undefined);
	    expect(onContinueModify).not.toHaveBeenCalled();
	    expect(showInFolderButton.disabled).toBe(false);
	  });

  it("enables PPTist follow-up edits after importing a completed artifact even without generated slide tree nodes", async () => {
    const artifact = {
      taskId: "task-vibe-artifact-only",
      filePath: "/tmp/launch-strategy-demo.pptx",
      fileName: "launch-strategy-demo.pptx",
      documentType: "pptx",
    };
    const task: DesktopTask = {
      id: "task-vibe-artifact-only",
      conversationId: "task-vibe-artifact-only",
      status: "completed",
      documentType: "pptx",
      topic: "Launch Strategy",
      events: [],
      artifact,
      vibeTree: {
        stage: "completed",
        actions: [],
        tree: {
          id: "tree-artifact-only",
          rootId: "root",
          title: "Launch Strategy",
          nodes: [
            { id: "root", kind: "root", title: "Launch Strategy" },
          ],
        },
      },
    };

    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    const pptistEmbed = document.querySelector(".living-tree-pptist-embed");
    const iframe = pptistEmbed?.querySelector("iframe") as HTMLIFrameElement;
    const editInput = screen.getByPlaceholderText("Ask to modify this PPT...");
    expect(editInput).toBeDisabled();

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "pptist:slides-loaded",
          slides: [{ id: "Bbczix9SNA", elements: [{ id: "title", type: "text", content: "<p>Launch</p>" }] }],
        },
        source: iframe.contentWindow,
      }));
    });

    expect(editInput).toBeEnabled();
  });

  it("renders referenced PPT shapes as inline composer tokens without nested input chrome", () => {
    const css = readFileSync("src/renderer/styles/dialogue.css", "utf8");
    const inlineComposerRule = css.match(/\.living-tree-pptx-edit-composer\.has-inline-reference\s*\{[^}]*\}/)?.[0] ?? "";
    const inlineInputRule = css.match(/\.living-tree-pptx-edit-composer\.has-inline-reference \.living-tree-pptx-edit-input\s*\{[^}]*\}/)?.[0] ?? "";
    const chipRule = css.match(/\.living-tree-pptx-reference-chip\s*\{[^}]*\}/)?.[0] ?? "";

    expect(inlineComposerRule).toContain("background: var(--n-canvas)");
    expect(inlineInputRule).toContain("background: transparent");
    expect(inlineInputRule).toContain("background-color: transparent");
    expect(inlineInputRule).toContain("box-shadow: none");
    expect(inlineInputRule).toContain("outline: none");
    expect(chipRule).toContain("#2563eb");
    expect(chipRule).not.toContain("var(--n-surface)");
  });

	  it("asks for confirmation before applying a low-confidence PPTist AI edit", async () => {
    modifyPptistDeckSpy.mockResolvedValueOnce({
      summary: "This may affect multiple title-like elements.",
      confidence: "low",
      requiresConfirmation: true,
      confirmation: {
        title: "Confirm AI edit",
        message: "Update the first slide title while preserving style.",
        target: "Slide 1 title",
        changes: ["Set text to 石墨文档介绍123"],
        preserved: ["Font", "Color"],
      },
      ops: [{ type: "element:update-text", slideId: "generated-slide-01", elementId: "title", text: "石墨文档介绍123", preserveStyle: true }],
    });
    const artifact = {
      taskId: "task-vibe-confirm",
      filePath: "/tmp/confirm.pptx",
      fileName: "confirm.pptx",
      documentType: "pptx",
    };
    const task: DesktopTask = {
      id: "task-vibe-confirm",
      conversationId: "task-vibe-confirm",
      status: "completed",
      documentType: "pptx",
      topic: "Confirm Edit",
      artifact,
      events: [
        { task_id: "task-vibe-confirm", type: "task.started", payload: { document_type: "pptx", topic: "Confirm Edit" } },
        { task_id: "task-vibe-confirm", type: "task.vibe_tree", payload: { stage: "completed" } },
        { task_id: "task-vibe-confirm", type: "task.completed", payload: { message: "done" } },
      ],
      vibeTree: {
        stage: "completed",
        actions: [],
        tree: {
          id: "tree-confirm",
          rootId: "root",
          title: "Confirm Edit",
          nodes: [
            { id: "root", kind: "root", title: "Confirm Edit" },
            { id: "slide-01", parentId: "root", kind: "slide", title: "Slide 1", slideNumber: 1 },
          ],
        },
      },
    };

	    render(<DialogueScreen {...baseProps()} tasks={[task]} />);
	    const iframe = document.querySelector(".living-tree-pptist-embed iframe") as HTMLIFrameElement;
	    await act(async () => {
	      window.dispatchEvent(new MessageEvent("message", { data: { type: "pptist:embed-ready" }, source: iframe.contentWindow }));
	      window.dispatchEvent(new MessageEvent("message", { data: { type: "pptist:slide-typed", index: 0, slideId: "generated-slide-01" }, source: iframe.contentWindow }));
	    });
	    const postMessage = vi.spyOn(iframe.contentWindow!, "postMessage");
    const editInput = screen.getByPlaceholderText("Ask to modify this PPT...");
    fireEvent.change(editInput, { target: { value: "把第一页的标题改为石墨文档介绍123，但字体和颜色不变" } });
    fireEvent.click(screen.getByRole("button", { name: "Send edit request" }));

    const snapshotMessage = await waitFor(() => postMessage.mock.calls.find(([msg]) => (msg as { type?: string }).type === "pptist:get-snapshot")?.[0] as { requestId: string });
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        source: iframe.contentWindow,
        data: {
          type: "pptist:snapshot-result",
          requestId: snapshotMessage.requestId,
          snapshot: {
            slides: [{ id: "generated-slide-01", elements: [{ id: "title", type: "text", content: "<p><span style=\"color:#f00\">Old</span></p>" }] }],
            slideIndex: 0,
          },
        },
      }));
    });
    const internalExportMessage = await waitFor(() => postMessage.mock.calls.find(([msg]) => (msg as { type?: string }).type === "pptist:export-pptx")?.[0] as { requestId: string; fileName?: string; targetFilePath?: string });
    expect(internalExportMessage.fileName).toBe(artifact.fileName);
    expect(internalExportMessage.targetFilePath).toBeUndefined();
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        source: iframe.contentWindow,
        data: {
          type: "pptist:export-result",
          requestId: internalExportMessage.requestId,
          buffer: new Uint8Array([80, 75, 3, 4]).buffer,
          fileName: artifact.fileName,
        },
      }));
      await Promise.resolve();
    });
    await waitFor(() => expect(modifyPptistDeckSpy).toHaveBeenCalledWith(expect.objectContaining({
      pptxDataBase64: "UEsDBA==",
    })));

	    await waitFor(() => expect(screen.getByText("Confirm AI edit")).toBeTruthy());
	    expectDialogueBubble("This may affect multiple title-like elements.", "ai");
	    expect(screen.getByText("Slide 1 title")).toBeTruthy();
    expect(postMessage.mock.calls.some(([msg]) => (msg as { type?: string }).type === "pptist:apply-edit-ops")).toBe(false);
    expect(editInput).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Apply edit" }));
    const applyMessage = await waitFor(() => postMessage.mock.calls.find(([msg]) => (msg as { type?: string }).type === "pptist:apply-edit-ops")?.[0] as { ops: unknown[] });
			    expect(applyMessage.ops).toEqual([{
			      type: "element:update-text",
			      slideId: "generated-slide-01",
			      elementId: "title",
			      text: "石墨文档介绍123",
			      preserveStyle: true,
			      animation: { mode: "typewriter", clearFirst: true, showCaret: true },
			    }]);
	  });

	  it("shows a failed PPTist follow-up edit as an AI workflow bubble", async () => {
	    modifyPptistDeckSpy.mockRejectedValueOnce(new Error("Planner unavailable"));
	    const artifact = {
	      taskId: "task-vibe-failed-edit",
	      filePath: "/tmp/failed-edit.pptx",
	      fileName: "failed-edit.pptx",
	      documentType: "pptx",
	    };
	    const task: DesktopTask = {
	      id: "task-vibe-failed-edit",
	      conversationId: "task-vibe-failed-edit",
	      status: "completed",
	      documentType: "pptx",
	      topic: "Failed Edit",
	      artifact,
	      events: [
	        { task_id: "task-vibe-failed-edit", type: "task.started", payload: { document_type: "pptx", topic: "Failed Edit" } },
	        { task_id: "task-vibe-failed-edit", type: "task.vibe_tree", payload: { stage: "completed" } },
	        { task_id: "task-vibe-failed-edit", type: "task.completed", payload: { message: "done" } },
	      ],
	      vibeTree: {
	        stage: "completed",
	        actions: [],
	        tree: {
	          id: "tree-failed-edit",
	          rootId: "root",
	          title: "Failed Edit",
	          nodes: [
	            { id: "root", kind: "root", title: "Failed Edit" },
	            { id: "slide-01", parentId: "root", kind: "slide", title: "Slide 1", slideNumber: 1 },
	          ],
	        },
	      },
	    };

	    render(<DialogueScreen {...baseProps()} tasks={[task]} />);
	    const iframe = document.querySelector(".living-tree-pptist-embed iframe") as HTMLIFrameElement;
	    await act(async () => {
	      window.dispatchEvent(new MessageEvent("message", { data: { type: "pptist:embed-ready" }, source: iframe.contentWindow }));
	      window.dispatchEvent(new MessageEvent("message", { data: { type: "pptist:slide-typed", index: 0, slideId: "generated-slide-01" }, source: iframe.contentWindow }));
	    });
		    const postMessage = vi.spyOn(iframe.contentWindow!, "postMessage");
	    const editInput = screen.getByPlaceholderText("Ask to modify this PPT...");
	    fireEvent.change(editInput, { target: { value: "Make it clearer." } });
	    fireEvent.click(screen.getByRole("button", { name: "Send edit request" }));
	    expectDialogueBubble("Make it clearer.", "user");

	    const snapshotMessage = await waitFor(() => postMessage.mock.calls.find(([msg]) => (msg as { type?: string }).type === "pptist:get-snapshot")?.[0] as { requestId: string });
	    await act(async () => {
	      window.dispatchEvent(new MessageEvent("message", {
	        source: iframe.contentWindow,
	        data: {
	          type: "pptist:snapshot-result",
	          requestId: snapshotMessage.requestId,
	          snapshot: {
	            slides: [{ id: "generated-slide-01", elements: [{ id: "title", type: "text", content: "<p>Old</p>" }] }],
	            slideIndex: 0,
	          },
	        },
	      }));
	    });
	    const internalExportMessage = await waitFor(() => postMessage.mock.calls.find(([msg]) => (msg as { type?: string }).type === "pptist:export-pptx")?.[0] as { requestId: string; fileName?: string });
	    await act(async () => {
	      window.dispatchEvent(new MessageEvent("message", {
	        source: iframe.contentWindow,
	        data: {
	          type: "pptist:export-result",
	          requestId: internalExportMessage.requestId,
	          buffer: new Uint8Array([80, 75, 3, 4]).buffer,
	          fileName: artifact.fileName,
	        },
	      }));
	      await Promise.resolve();
	    });

	    await waitFor(() => expect(modifyPptistDeckSpy).toHaveBeenCalled());
	    expectDialogueBubble("Edit failed. The current PPTist deck was kept.", "ai");
	    expect(postMessage.mock.calls.some(([msg]) => (msg as { type?: string }).type === "pptist:apply-edit-ops")).toBe(false);
	  });

	  it("keeps the Vibe PPTX workspace while a follow-up edit is running", () => {
    const artifact = {
      taskId: "task-vibe-completed",
      filePath: "/tmp/internal-knowledge-base.pptx",
      fileName: "internal-knowledge-base.pptx",
      documentType: "pptx",
    };
    const vibeTask: DesktopTask = {
      id: "task-vibe-completed",
      conversationId: "conversation-vibe",
      status: "completed",
      documentType: "pptx",
      topic: "Rebuild Internal Knowledge Base",
      events: [
        { task_id: "task-vibe-completed", type: "task.started", payload: { document_type: "pptx", topic: "Rebuild Internal Knowledge Base" } },
        { task_id: "task-vibe-completed", type: "task.vibe_tree", payload: { stage: "completed" } },
        { task_id: "task-vibe-completed", type: "task.completed", payload: { message: "done" } },
      ],
      artifact,
      vibeTree: {
        stage: "completed",
        actions: [],
        tree: {
          id: "tree-completed",
          rootId: "root",
          title: "I want to explain why we need to rebuild our internal knowledge base",
          nodes: [
            { id: "root", kind: "root", title: "I want to explain why we need to rebuild our internal knowledge base" },
            { id: "outline-01", parentId: "root", kind: "outline", title: "P1" },
            { id: "slide-01", parentId: "outline-01", kind: "slide", title: "Legacy knowledge base is creating decision friction", slideNumber: 1 },
            { id: "deck", kind: "deck", title: "Complete PPTX Deck" },
          ],
        },
      },
    };
    const editTask: DesktopTask = {
      id: "task-edit-running",
      conversationId: "conversation-vibe",
      parentTaskId: "task-vibe-completed",
      status: "running",
      documentType: "pptx",
      topic: "Make slide 1 more executive.",
      events: [
        { task_id: "task-edit-running", type: "task.started", payload: { document_type: "pptx", topic: "Make slide 1 more executive." } },
        { task_id: "task-edit-running", type: "task.progress", payload: { step: "modify_pptx", status: "calling_llm" } },
      ],
      userInput: {
        prompt: "Make slide 1 more executive.",
        sourceFile: artifact.filePath,
      },
    };

    render(<DialogueScreen {...baseProps()} tasks={[vibeTask, editTask]} />);

    expect(document.querySelector(".conversation-layout.is-vibe-canvas-focus")).toBeTruthy();
    expect(screen.getByText("Living Tree Cockpit")).toBeTruthy();
    expect(document.querySelector(".chat-thread")).toBeNull();
    expect(document.querySelector(".conversation-footer")).toBeNull();
    expect(screen.queryByText("Generation Complete")).toBeNull();
    expect(screen.queryByText("Generating PPTX...")).toBeNull();
    expect(screen.getByRole("button", { name: "Open internal-knowledge-base.pptx" })).toBeTruthy();
    expect(screen.getByText("Edit with AI")).toBeTruthy();
  });

  it("keeps the Vibe PPTX workspace on the modified artifact after a follow-up edit completes", async () => {
    const originalArtifact = {
      taskId: "task-vibe-completed",
      filePath: "/tmp/internal-knowledge-base.pptx",
      fileName: "internal-knowledge-base.pptx",
      documentType: "pptx",
    };
    const modifiedArtifact = {
      taskId: "task-edit-completed",
      filePath: "/tmp/internal-knowledge-base.modified.pptx",
      fileName: "internal-knowledge-base.modified.pptx",
      documentType: "pptx",
    };
    const vibeTask: DesktopTask = {
      id: "task-vibe-completed",
      conversationId: "conversation-vibe",
      status: "completed",
      documentType: "pptx",
      topic: "Rebuild Internal Knowledge Base",
      events: [
        { task_id: "task-vibe-completed", type: "task.started", payload: { document_type: "pptx", topic: "Rebuild Internal Knowledge Base" } },
        { task_id: "task-vibe-completed", type: "task.vibe_tree", payload: { stage: "completed" } },
        { task_id: "task-vibe-completed", type: "task.completed", payload: { message: "done" } },
      ],
      artifact: originalArtifact,
      vibeTree: {
        stage: "completed",
        actions: [],
        tree: {
          id: "tree-completed",
          rootId: "root",
          title: "I want to explain why we need to rebuild our internal knowledge base",
          nodes: [
            { id: "root", kind: "root", title: "I want to explain why we need to rebuild our internal knowledge base" },
            { id: "outline-01", parentId: "root", kind: "outline", title: "P1" },
            { id: "slide-01", parentId: "outline-01", kind: "slide", title: "Legacy knowledge base is creating decision friction", slideNumber: 1 },
            { id: "deck", kind: "deck", title: "Complete PPTX Deck" },
          ],
        },
      },
    };
    const editTask: DesktopTask = {
      id: "task-edit-completed",
      conversationId: "conversation-vibe",
      parentTaskId: "task-vibe-completed",
      status: "completed",
      documentType: "pptx",
      topic: "Make slide 1 more executive.",
      events: [
        { task_id: "task-edit-completed", type: "task.started", payload: { document_type: "pptx", topic: "Make slide 1 more executive." } },
        { task_id: "task-edit-completed", type: "task.completed", payload: { result: { file_path: modifiedArtifact.filePath, file_name: modifiedArtifact.fileName, document_type: "pptx" } } },
      ],
      artifact: modifiedArtifact,
      userInput: {
        prompt: "Make slide 1 more executive.",
        sourceFile: originalArtifact.filePath,
      },
    };

    render(<DialogueScreen {...baseProps()} tasks={[vibeTask, editTask]} />);

    expect(document.querySelector(".conversation-layout.is-vibe-canvas-focus")).toBeTruthy();
    expect(document.querySelector(".chat-thread")).toBeNull();
    expect(screen.queryByText("Generation Complete")).toBeNull();
    expect(screen.getByRole("button", { name: "Open internal-knowledge-base.modified.pptx" })).toBeTruthy();
  });

  it("keeps the animated PPTist embed after the final PPTX artifact exists when streamed slides are available", () => {
    const artifact = {
      taskId: "task-vibe-completed-streamed",
      filePath: "/tmp/internal-knowledge-base.pptx",
      fileName: "internal-knowledge-base.pptx",
      documentType: "pptx",
    };
    const slide: PptistSlide = {
      id: "backend-slide-01",
      elements: [
        {
          id: "title-01",
          type: "text",
          left: 80,
          top: 80,
          width: 420,
          height: 60,
          content: "<p>Legacy knowledge base is creating decision friction</p>",
        },
      ],
    };
    const task: DesktopTask = {
      id: "task-vibe-completed-streamed",
      conversationId: "task-vibe-completed-streamed",
      status: "completed",
      documentType: "pptx",
      topic: "Rebuild Internal Knowledge Base",
      events: [
        { task_id: "task-vibe-completed-streamed", type: "task.started", payload: { document_type: "pptx", topic: "Rebuild Internal Knowledge Base" } },
        { task_id: "task-vibe-completed-streamed", type: "task.vibe_tree", payload: { stage: "completed" } },
        { task_id: "task-vibe-completed-streamed", type: "task.vibe_slide", payload: { index: 0, slide } },
        { task_id: "task-vibe-completed-streamed", type: "task.completed", payload: { message: "done" } },
      ],
      artifact,
      vibeSlides: [slide],
      vibeTree: {
        stage: "completed",
        actions: [],
        tree: {
          id: "tree-completed-streamed",
          rootId: "root",
          title: "I want to explain why we need to rebuild our internal knowledge base",
          nodes: [
            { id: "root", kind: "root", title: "I want to explain why we need to rebuild our internal knowledge base" },
            { id: "branch", parentId: "root", kind: "branch", title: "Problem" },
            { id: "chapter", parentId: "branch", kind: "slide_group", title: "Problem Breakdown" },
            { id: "outline-01", parentId: "chapter", kind: "outline", title: "P1" },
            { id: "slide-01", parentId: "outline-01", kind: "slide", title: "Legacy knowledge base is creating decision friction", slideNumber: 1 },
            { id: "outline-02", parentId: "chapter", kind: "outline", title: "P2" },
            { id: "slide-02", parentId: "outline-02", kind: "slide", title: "Search and ownership gaps", slideNumber: 2 },
            { id: "outline-03", parentId: "chapter", kind: "outline", title: "P3" },
            { id: "slide-03", parentId: "outline-03", kind: "slide", title: "Rebuild proposal", slideNumber: 3 },
            { id: "deck", kind: "deck", title: "Complete PPTX Deck", summary: "All pages assembled into deliverable PPTX." },
          ],
        },
      },
    };

    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    expect(document.querySelector(".living-tree-pptist-embed")).toBeTruthy();
    expect(document.querySelector(".living-tree-pptx-toolbar")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open internal-knowledge-base.pptx" })).toBeTruthy();
    expect(screen.getByText("Edit with AI")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Preview" }).textContent).toBe("");
    expect(screen.getByRole("button", { name: "Show in folder" })).toBeTruthy();
    expect(flowNodeCard("deck")).toBeNull();
    expect(document.querySelector(".living-tree-slide-preview-iframe")).toBeNull();
  });

  it("defaults completed Vibe PPTX tasks to the PPTist review layout with a summonable canvas tree", () => {
    const artifact = {
      taskId: "task-vibe-completed-review",
      filePath: "/tmp/internal-knowledge-base.pptx",
      fileName: "internal-knowledge-base.pptx",
      documentType: "pptx",
    };
    const slide: PptistSlide = {
      id: "backend-slide-01",
      elements: [
        {
          id: "title-01",
          type: "text",
          left: 80,
          top: 80,
          width: 420,
          height: 60,
          content: "<p>Legacy knowledge base is creating decision friction</p>",
        },
      ],
    };
    const task: DesktopTask = {
      id: "task-vibe-completed-review",
      conversationId: "task-vibe-completed-review",
      status: "completed",
      documentType: "pptx",
      topic: "Rebuild Internal Knowledge Base",
      userInput: { prompt: "Build a ten page pitch about rebuilding the internal knowledge base." },
      events: [
        { task_id: "task-vibe-completed-review", type: "task.started", payload: { document_type: "pptx", topic: "Rebuild Internal Knowledge Base" } },
        { task_id: "task-vibe-completed-review", type: "task.vibe_tree", payload: { stage: "completed" } },
        { task_id: "task-vibe-completed-review", type: "task.vibe_slide", payload: { index: 0, slide } },
        { task_id: "task-vibe-completed-review", type: "task.completed", payload: { message: "done" } },
      ],
      artifact,
      vibeSlides: [slide],
      vibeTree: {
        stage: "completed",
        actions: [],
        tree: {
          id: "tree-completed-review",
          rootId: "root",
          title: "I want to explain why we need to rebuild our internal knowledge base",
          nodes: [
            { id: "root", kind: "root", title: "I want to explain why we need to rebuild our internal knowledge base" },
            { id: "branch", parentId: "root", kind: "branch", title: "Problem" },
            { id: "chapter", parentId: "branch", kind: "slide_group", title: "Problem Breakdown" },
            { id: "outline-01", parentId: "chapter", kind: "outline", title: "P1" },
            { id: "slide-01", parentId: "outline-01", kind: "slide", title: "Legacy knowledge base is creating decision friction", slideNumber: 1 },
            { id: "outline-02", parentId: "chapter", kind: "outline", title: "P2" },
            { id: "slide-02", parentId: "outline-02", kind: "slide", title: "Search and ownership gaps", slideNumber: 2 },
            { id: "outline-03", parentId: "chapter", kind: "outline", title: "P3" },
            { id: "slide-03", parentId: "outline-03", kind: "slide", title: "Rebuild proposal", slideNumber: 3 },
            { id: "deck", kind: "deck", title: "Complete PPTX Deck", summary: "All pages assembled into deliverable PPTX." },
          ],
        },
      },
    };

    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    const workbench = document.querySelector(".living-tree-workbench");
    const pptistEmbed = document.querySelector(".living-tree-pptist-embed");
    const toolbar = document.querySelector(".living-tree-pptx-toolbar");
    expect(workbench?.classList.contains("is-completed-review")).toBe(true);
    expect(document.querySelector(".living-tree-flow-shell")).toBeNull();
    expect(pptistEmbed?.getAttribute("aria-label")).toBe("PPT editor with slide thumbnails and current slide");
    expect(toolbar?.classList.contains("is-focus-toolbar")).toBe(true);
    expect(toolbar?.parentElement?.classList.contains("living-tree-header")).toBe(true);
    expect(pptistEmbed?.previousElementSibling).not.toBe(toolbar);
    expect(toolbar?.textContent).not.toContain("AI conversation");
    expect(toolbar?.textContent).not.toContain("internal-knowledge-base.pptx");
    expect(screen.queryByRole("list", { name: "Slide thumbnails" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open slide 1: Legacy knowledge base is creating decision friction" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open slide 2: Search and ownership gaps" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open slide 3: Rebuild proposal" })).toBeNull();
    expect(document.querySelector(".living-tree-pptx-ai-drawer")).toBeTruthy();
    expect(screen.getByText("Focus on follow-up edit instructions")).toBeTruthy();
    expect(screen.getByText("What would you like to change in this PPT?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "More sales-focused" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "AI conversation" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open internal-knowledge-base.pptx" })).toBeTruthy();
    expect(screen.queryByText("internal-knowledge-base.pptx")).toBeNull();
    expect(screen.queryByText("Build a ten page pitch about rebuilding the internal knowledge base.")).toBeNull();
    expect(screen.queryByText("PPTX generated: internal-knowledge-base.pptx")).toBeNull();
    expect(screen.queryByText("3/3 pages generated")).toBeNull();
    expect(screen.getByText("Edit with AI")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open canvas tree" }).textContent).toBe("");
    expect(screen.getByRole("button", { name: "Show in folder" }).textContent).toBe("");
    expect(screen.getByRole("button", { name: "Open Preview" }).textContent).toBe("");
    expect(screen.getByPlaceholderText("Ask to modify this PPT...")).toBeTruthy();

    const css = readFileSync("src/renderer/styles/dialogue.css", "utf8");
    const cockpitRule = css.match(/^\.living-tree-cockpit\s*\{(?<body>[^}]*)\}/m)?.groups?.body ?? "";
    const focusWorkbenchRule = css.match(/\.living-tree-workbench\.is-completed-review\s*\{(?<body>[^}]*)\}/s)?.groups?.body ?? "";
    const focusToolbarRule = css.match(/\.living-tree-header > \.living-tree-pptx-toolbar\.is-focus-toolbar\s*\{(?<body>[^}]*)\}/s)?.groups?.body ?? "";
    const aiDrawerRule = css.match(/\.living-tree-pptx-ai-drawer\s*\{(?<body>[^}]*)\}/s)?.groups?.body ?? "";
    const editPanelRule = css.match(/^\.living-tree-pptx-edit-panel\s*\{(?<body>[^}]*)\}/m)?.groups?.body ?? "";
    const openCanvasDrawerRule = css.match(/\.living-tree-workbench\.is-completed-review\.is-canvas-tree-open \.living-tree-flow-shell\.is-canvas-tree-drawer\s*\{(?<body>[^}]*)\}/s)?.groups?.body ?? "";
    const thumbnailRailRule = css.match(/^\.living-tree-pptx-thumbnail-rail\s*\{(?<body>[^}]*)\}/m)?.groups?.body ?? "";
	    const dialogueLogRule = css.match(/^\.living-tree-pptx-dialogue-log\s*\{(?<body>[^}]*)\}/m)?.groups?.body ?? "";
	    const dialogueHeadRule = css.match(/^\.living-tree-pptx-dialogue-log-head\s*\{(?<body>[^}]*)\}/m)?.groups?.body ?? "";
	    const dialogueBodyRule = css.match(/^\.living-tree-pptx-dialogue-log-body\s*\{(?<body>[^}]*)\}/m)?.groups?.body ?? "";
	    const dialogueWorkingBubbleRule = css.match(/^\.living-tree-pptx-dialogue-message\.is-ai\.is-working\s*\{(?<body>[^}]*)\}/m)?.groups?.body ?? "";
	    const dialogueFooterRule = css.match(/^\.living-tree-pptx-dialogue-footer\s*\{(?<body>[^}]*)\}/m)?.groups?.body ?? "";
	    const editRowRule = css.match(/^\.living-tree-pptx-edit-row\s*\{(?<body>[^}]*)\}/m)?.groups?.body ?? "";
    const actionCardRule = css.match(/^\.living-tree-pptx-action-card\s*\{(?<body>[^}]*)\}/m)?.groups?.body ?? "";
    const actionCardButtonsRule = css.match(/^\.living-tree-pptx-action-card-buttons\s*\{(?<body>[^}]*)\}/m)?.groups?.body ?? "";
    expect(cockpitRule).toContain("width: 100%");
    expect(cockpitRule).not.toContain("1360px");
    expect(focusWorkbenchRule).toContain("grid-template-columns: minmax(0, 1fr) minmax(380px, 420px)");
    expect(focusWorkbenchRule).toContain("grid-template-rows: minmax(0, 1fr)");
    expect(focusToolbarRule).toContain("position: static");
    expect(focusToolbarRule).toContain("margin-left: auto");
    expect(focusToolbarRule).toContain("max-width: min(360px, 42vw)");
    expect(aiDrawerRule).toContain("grid-column: 2");
    expect(aiDrawerRule).toContain("position: relative");
    expect(aiDrawerRule).toContain("width: 100%");
    expect(openCanvasDrawerRule).toContain("visibility: visible");
    expect(openCanvasDrawerRule).toContain("pointer-events: auto");
    expect(thumbnailRailRule).toBe("");
    expect(editPanelRule).toContain("height: 100%");
    expect(editPanelRule).toContain("overflow: hidden");
    expect(dialogueLogRule).toContain("flex: 1 1 0");
	    expect(dialogueLogRule).toContain("min-height: 0");
	    expect(dialogueHeadRule).toContain("min-height: 52px");
	    expect(dialogueBodyRule).toContain("flex: 1 1 auto");
	    expect(dialogueBodyRule).toContain("overflow-y: auto");
	    expect(dialogueWorkingBubbleRule).toContain("var(--n-primary-soft)");
	    expect(dialogueFooterRule).toContain("flex: 0 0 auto");
	    expect(editRowRule).toContain("flex: 0 0 auto");
    expect(actionCardRule).toContain("align-items: center");
    expect(actionCardRule).toContain("justify-content: flex-end");
    expect(actionCardRule).toContain("padding: 4px");
    expect(actionCardButtonsRule).toContain("display: flex");
    expect(actionCardButtonsRule).toContain("flex-wrap: nowrap");

    expect(document.querySelector(".living-tree-pptx-ai-drawer-close")).toBeNull();

    const iframe = pptistEmbed?.querySelector("iframe") as HTMLIFrameElement;
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "pptist:slide-changed", index: 1, slideId: "generated-slide-02" },
        source: iframe.contentWindow,
      }));
    });
    expect(document.querySelector(".living-tree-flow-shell")).toBeNull();
    expect(document.querySelector(".living-tree-popover")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open canvas tree" }));

    const openFlowShell = document.querySelector(".living-tree-flow-shell");
    expect(openFlowShell?.classList.contains("is-canvas-tree-drawer")).toBe(true);
    expect(openFlowShell?.getAttribute("aria-hidden")).toBe("false");
    expect(screen.getByRole("button", { name: "Close canvas tree" })).toBeTruthy();
    fireEvent.click(flowNodeCard("outline-02") as Element);
    expect(currentVibePopoverTitle()).toBe("P2");
  });

  it("loads the final PPTX artifact for animated PPTist replay when streamed slides are absent", async () => {
    const artifact = {
      taskId: "task-vibe-completed",
      filePath: "/tmp/internal-knowledge-base.pptx",
      fileName: "internal-knowledge-base.pptx",
      documentType: "pptx",
    };
    const task: DesktopTask = {
      id: "task-vibe-completed",
      conversationId: "task-vibe-completed",
      status: "completed",
      documentType: "pptx",
      topic: "Rebuild Internal Knowledge Base",
      events: [
        { task_id: "task-vibe-completed", type: "task.started", payload: { document_type: "pptx", topic: "Rebuild Internal Knowledge Base" } },
        { task_id: "task-vibe-completed", type: "task.vibe_tree", payload: { stage: "completed" } },
        { task_id: "task-vibe-completed", type: "task.completed", payload: { message: "done" } },
      ],
      artifact,
      vibeTree: {
        stage: "completed",
        actions: [],
        tree: {
          id: "tree-completed",
          rootId: "root",
          title: "I want to explain why we need to rebuild our internal knowledge base",
          nodes: [
            { id: "root", kind: "root", title: "I want to explain why we need to rebuild our internal knowledge base" },
            { id: "branch", parentId: "root", kind: "branch", title: "Problem" },
            { id: "chapter", parentId: "branch", kind: "slide_group", title: "Problem Breakdown" },
            { id: "outline-01", parentId: "chapter", kind: "outline", title: "P1" },
            { id: "slide-01", parentId: "outline-01", kind: "slide", title: "Legacy knowledge base is creating decision friction", slideNumber: 1 },
            { id: "deck", kind: "deck", title: "Complete PPTX Deck", summary: "All pages assembled into deliverable PPTX." },
          ],
        },
      },
    };

    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    expect(document.querySelector(".living-tree-pptist-embed")).toBeTruthy();
    expect(document.querySelector(".living-tree-pptx-toolbar")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open internal-knowledge-base.pptx" })).toBeTruthy();
    expect(screen.getByText("Edit with AI")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Preview" }).textContent).toBe("");
    expect(screen.getByRole("button", { name: "Show in folder" })).toBeTruthy();
    expect(flowNodeCard("deck")).toBeNull();
    expect(document.querySelector(".living-tree-slide-preview-iframe")).toBeNull();
    const iframe = document.querySelector(".living-tree-pptist-embed iframe") as HTMLIFrameElement;
    const postMessage = vi.spyOn(iframe.contentWindow!, "postMessage");
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "pptist:embed-ready" },
        source: iframe.contentWindow,
      }));
    });
    await waitFor(() => expect(postMessage.mock.calls.some(([msg]) => (msg as { type?: string }).type === "pptist:load-slides-cache")).toBe(true));
    const loadMessage = postMessage.mock.calls.find(([msg]) => (msg as { type?: string }).type === "pptist:load-slides-cache")?.[0] as { animate?: boolean };
    expect(loadMessage.animate).toBe(false);
  });

  it("does not replay PPTist generation animation for a completed task whose animation was already consumed", async () => {
    const artifact = {
      taskId: "task-vibe-completed",
      filePath: "/tmp/internal-knowledge-base.pptx",
      fileName: "internal-knowledge-base.pptx",
      documentType: "pptx",
    };
    localStorage.setItem("officedex.pptistAnimation.played.task-vibe-completed", "1");
    const task: DesktopTask = {
      id: "task-vibe-completed",
      conversationId: "task-vibe-completed",
      status: "completed",
      documentType: "pptx",
      topic: "Rebuild Internal Knowledge Base",
      events: [
        { task_id: "task-vibe-completed", type: "task.started", payload: { document_type: "pptx", topic: "Rebuild Internal Knowledge Base" } },
        { task_id: "task-vibe-completed", type: "task.vibe_tree", payload: { stage: "completed" } },
        { task_id: "task-vibe-completed", type: "task.completed", payload: { message: "done" } },
      ],
      artifact,
      vibeTree: {
        stage: "completed",
        actions: [],
        tree: {
          id: "tree-completed",
          rootId: "root",
          title: "I want to explain why we need to rebuild our internal knowledge base",
          nodes: [
            { id: "root", kind: "root", title: "I want to explain why we need to rebuild our internal knowledge base" },
            { id: "branch", parentId: "root", kind: "branch", title: "Problem" },
            { id: "chapter", parentId: "branch", kind: "slide_group", title: "Problem Breakdown" },
            { id: "outline-01", parentId: "chapter", kind: "outline", title: "P1" },
            { id: "slide-01", parentId: "outline-01", kind: "slide", title: "Legacy knowledge base is creating decision friction", slideNumber: 1 },
            { id: "deck", kind: "deck", title: "Complete PPTX Deck", summary: "All pages assembled into deliverable PPTX." },
          ],
        },
      },
    };

    render(<DialogueScreen {...baseProps()} tasks={[task]} />);
    const pptistEmbed = document.querySelector(".living-tree-pptist-embed") as HTMLElement;
    const iframe = pptistEmbed.querySelector("iframe") as HTMLIFrameElement;
    const postMessage = vi.spyOn(iframe.contentWindow!, "postMessage");

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "pptist:embed-ready" },
        source: iframe.contentWindow,
      }));
    });

    await waitFor(() => expect(postMessage.mock.calls.some(([msg]) => (msg as { type?: string }).type === "pptist:load-slides-cache")).toBe(true));
    const loadMessage = postMessage.mock.calls.find(([msg]) => (msg as { type?: string }).type === "pptist:load-slides-cache")?.[0] as { animate?: boolean };
    expect(loadMessage.animate).toBe(false);
  });

  it("does not replay PPTist generation animation by default for a completed task", async () => {
    const artifact = {
      taskId: "task-vibe-first-play",
      filePath: "/tmp/first-play.pptx",
      fileName: "first-play.pptx",
      documentType: "pptx",
    };
    const task: DesktopTask = {
      id: "task-vibe-first-play",
      conversationId: "task-vibe-first-play",
      status: "completed",
      documentType: "pptx",
      topic: "First play deck",
      events: [
        { task_id: "task-vibe-first-play", type: "task.started", payload: { document_type: "pptx", topic: "First play deck" } },
        { task_id: "task-vibe-first-play", type: "task.vibe_tree", payload: { stage: "completed" } },
        { task_id: "task-vibe-first-play", type: "task.completed", payload: { message: "done" } },
      ],
      artifact,
      vibeTree: {
        stage: "completed",
        actions: [],
        tree: {
          id: "tree-first-play",
          rootId: "root",
          title: "First play deck",
          nodes: [
            { id: "root", kind: "root", title: "First play deck" },
            { id: "outline-01", parentId: "root", kind: "outline", title: "P1" },
            { id: "slide-01", parentId: "outline-01", kind: "slide", title: "First slide", slideNumber: 1 },
            { id: "deck", kind: "deck", title: "Complete PPTX Deck" },
          ],
        },
      },
    };

    render(<DialogueScreen {...baseProps()} tasks={[task]} />);
    const iframe = document.querySelector(".living-tree-pptist-embed iframe") as HTMLIFrameElement;
    const postMessage = vi.spyOn(iframe.contentWindow!, "postMessage");

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "pptist:embed-ready" },
        source: iframe.contentWindow,
      }));
    });

    await waitFor(() => expect(postMessage.mock.calls.some(([msg]) => (msg as { type?: string }).type === "pptist:load-slides-cache")).toBe(true));
    const loadMessage = postMessage.mock.calls.find(([msg]) => (msg as { type?: string }).type === "pptist:load-slides-cache")?.[0] as { animate?: boolean };
    expect(loadMessage.animate).toBe(false);
    expect(localStorage.getItem("officedex.pptistAnimation.played.task-vibe-first-play")).toBeNull();
  });

  it("shows pptxgenjs assembling panel instead of empty PPTist when rendering without slides", () => {
    const task: DesktopTask = {
      id: "task-vibe-assembling",
      conversationId: "task-vibe-assembling",
      status: "running",
      documentType: "pptx",
      topic: "Rebuild Internal Knowledge Base",
      events: [
        { task_id: "task-vibe-assembling", type: "task.started", payload: { document_type: "pptx", topic: "Rebuild Internal Knowledge Base" } },
        { task_id: "task-vibe-assembling", type: "task.vibe_tree", payload: { stage: "completed" } },
        { task_id: "task-vibe-assembling", type: "task.progress", payload: { step: "assemble", status: "running", content: "Generating pptxgenjs code via LLM..." } },
      ],
      assembleProgress: { step: "assemble", status: "running", content: "Generating pptxgenjs code via LLM..." },
      vibeTree: {
        stage: "completed",
        actions: [],
        tree: {
          id: "tree-assembling",
          rootId: "root",
          title: "Rebuild Internal Knowledge Base",
          nodes: [
            { id: "root", kind: "root", title: "Rebuild Internal Knowledge Base" },
            { id: "branch", parentId: "root", kind: "branch", title: "Problem" },
            { id: "chapter", parentId: "branch", kind: "slide_group", title: "Problem Breakdown" },
            { id: "outline-01", parentId: "chapter", kind: "outline", title: "P1" },
            { id: "slide-01", parentId: "outline-01", kind: "slide", title: "Page 1", slideNumber: 1 },
          ],
        },
      },
    };

    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    expect(document.querySelector(".living-tree-pptx-toolbar")).toBeNull();
    expect(document.querySelector(".living-tree-pptist-embed")).toBeNull();
    expect(document.querySelector(".pptxgenjs-assembling-panel")).toBeTruthy();
    expect(screen.getByText(/Assembling your presentation/)).toBeTruthy();
    expect(screen.getByText(/Generating slide code/)).toBeTruthy();
  });

  it("submits direct Vibe node text edits through the node popover instead of the inspector", async () => {
    const task: DesktopTask = {
      id: "task-vibe-direction",
      conversationId: "task-vibe-direction",
      status: "question",
      documentType: "pptx",
      topic: "Rebuild Internal Knowledge Base",
      events: [
        { task_id: "task-vibe-direction", type: "task.started", payload: { document_type: "pptx", topic: "Rebuild Internal Knowledge Base" } },
        { task_id: "task-vibe-direction", type: "task.vibe_tree", payload: { stage: "story_ready" } },
        { task_id: "task-vibe-direction", type: "task.question", payload: { id: "vibe_story_ready", question: "Project Map generated", options: [{ id: "generate_outline", label: "Expand to Slide Leaves" }], allow_freeform: true } },
      ],
      question: {
        id: "vibe_story_ready",
        question: "Project Map generated. You can expand into a PPT outline, or type a message to adjust direction.",
        allowFreeform: true,
        options: [{ id: "generate_outline", label: "Expand to Slide Leaves", recommended: true }],
      },
      vibeTree: {
        stage: "story_ready",
        tree: {
          id: "tree-1",
          rootId: "root",
          title: "I want to explain why we need to rebuild our internal knowledge base",
          nodes: [
            { id: "root", kind: "root", title: "I want to explain why we need to rebuild our internal knowledge base", summary: "Raw request" },
            { id: "branch-status", parentId: "root", kind: "branch", title: "Current State", summary: "Knowledge scattered across multiple places" },
          ],
        },
        actions: [{ id: "generate_outline", label: "Expand to Slide Leaves" }],
      },
    };

    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    // Node Inspector is no longer rendered as a separate section
    expect(screen.queryByLabelText("Node Inspector")).toBeNull();

    await confirmInitialIdeaNode("Current State");
    respondSpy.mockClear();
    let popover = currentOpenVibePopover() as HTMLElement;
    const confirmButton = within(popover).getByRole("button", { name: "Confirm this node" });
    expect(within(popover).queryByText("Edit current content")).toBeNull();
    expect(within(popover).getByLabelText("Story Beat: Describe the key point this narrative segment advances")).toBeTruthy();
    expect(within(popover).queryByRole("button", { name: "Apply to current node" })).toBeNull();
    expect(within(popover).getAllByRole("button")).toHaveLength(1);
    expect(popover.dataset.nodeTitle).toBe("Current State");
    expect(popover.querySelector(":scope > strong")).toBeNull();
    expect(Array.from(popover.children).some((child) => child.tagName === "P" && child.textContent === `Rewrite with “23J”: First show the audience how legacy knowledge workflows have slowed collaboration.`)).toBe(false);
    expect(within(popover).queryByText("After confirming this node, it will be used to generate the next level of content.")).toBeNull();
    fireEvent.mouseEnter(confirmButton);
    await waitFor(() => expect(screen.getByText("After confirming this node, it will be used to generate the next level of content.")).toBeTruthy());
    expect(within(popover).queryByRole("button", { name: "Suggest Changes" })).toBeNull();
    expect(popover.lastElementChild?.querySelector("button")?.textContent).toBe("Confirm this node");

    const rootNode = flowNodeCard("root");
    expect(rootNode).toBeTruthy();
    fireEvent.click(rootNode as Element);
    await waitForVibePopoverTitle("I want to explain why we need to rebuild our internal knowledge base");
    popover = currentOpenVibePopover() as HTMLElement;
    expect(popover.dataset.nodeTitle).toBe("I want to explain why we need to rebuild our internal knowledge base");
    expect(popover.querySelector(":scope > strong")).toBeNull();
    expect(Array.from(popover.children).some((child) => child.tagName === "P" && child.textContent === "Raw request")).toBe(false);
    expect(within(popover).queryByRole("button", { name: "Suggest Changes" })).toBeNull();
    expect(within(popover).queryByText("Edit current content")).toBeNull();
    const input = within(popover).getByLabelText("Idea: Describe the core message of this PPT");
    expect(input).toHaveValue("I want to explain why we need to rebuild our internal knowledge base\n\nRaw request");
    fireEvent.change(input, { target: { value: "More like a version for the boss" } });
    clickCurrentOpenVibePopoverButton("Apply to current node");
    expect(respondSpy).not.toHaveBeenCalled();
    expect(screen.getByText("Editing this node will regenerate 1 downstream nodes.")).toBeTruthy();
    clickCurrentOpenVibePopoverButton("Confirm & regenerate downstream");

    await waitFor(() => expect(respondSpy).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task-vibe-direction",
      questionId: "vibe_story_ready",
      answer: JSON.stringify({
        kind: "vibe_node_feedback",
        nodeId: "root",
        feedback: "More like a version for the boss",
      }),
    })));
    expect(screen.queryByText("Q1")).toBeNull();
  });

  it("uses backend confirmation node ids instead of deriving confirmable nodes locally", async () => {
    const task: DesktopTask = {
      id: "task-vibe-confirmation",
      conversationId: "task-vibe-confirmation",
      status: "question",
      documentType: "pptx",
      events: [],
      question: {
        id: "vibe_story_ready",
        question: "Project Map generated.",
        allowFreeform: true,
        options: [{ id: "generate_outline", label: "Generate PPT Outline", recommended: true }],
      },
      vibeTree: {
        stage: "story_ready",
        tree: {
          id: "tree-confirmation",
          rootId: "root",
          title: "Confirmation Test",
          nodes: [
            { id: "root", kind: "root", title: "Confirmation Test" },
            { id: "branch-a", parentId: "root", kind: "branch", title: "Current State" },
            { id: "branch-b", parentId: "root", kind: "branch", title: "Problem" },
          ],
        },
        actions: [{ id: "generate_outline", label: "Generate PPT Outline" }],
        confirmation: { nodeIds: ["branch-a"] },
      },
    };

    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    expect(screen.getByText("Confirmed 0/1")).toBeTruthy();
    expect(flowNodeCard("branch-a")).toBeNull();
    await confirmInitialIdeaNode("Current State");
    fireEvent.click(flowNodeCard("branch-a") as Element);
    expect(document.querySelector(".living-tree-flow-node.is-confirmable.is-pending")).toBeTruthy();
    clickCurrentVibeConfirmButton();
    expect(screen.getByText("Confirmed 1/1")).toBeTruthy();
  });

  it("starts story_ready with only the Idea node and reveals Story Beats after confirming it", async () => {
    const now = new Date().toISOString();
    const task: DesktopTask = {
      id: "task-vibe-idea-first",
      conversationId: "task-vibe-idea-first",
      status: "question",
      documentType: "pptx",
      events: [{ task_id: "task-vibe-idea-first", type: "task.vibe_tree", ts: now, payload: { stage: "story_ready" } }],
      question: {
        id: "vibe_story_ready",
        question: "Project Map generated.",
        allowFreeform: true,
        options: [{ id: "generate_chapters", label: "Generate Chapters", recommended: true }],
      },
      vibeTree: {
        stage: "story_ready",
        tree: {
          id: "tree-idea-first",
          rootId: "root",
          title: "Auto-locate Test",
          nodes: [
            { id: "root", kind: "root", title: "Auto-locate Test" },
            { id: "branch-a", parentId: "root", kind: "branch", title: "Current State", summary: "Confirm current state first", outline: ["First current state point"], visualAssets: [{ kind: "image", description: "A current state illustration" }] },
            { id: "branch-b", parentId: "root", kind: "branch", title: "Problem", summary: "Then confirm problems" },
          ],
        },
        actions: [{ id: "generate_chapters", label: "Generate Chapters" }],
        confirmation: { nodeIds: ["branch-a", "branch-b"] },
      },
    };

    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    expect(flowNodeCard("root")).toBeTruthy();
    expect(flowNodeCard("branch-a")).toBeNull();
    expect(flowNodeCard("branch-b")).toBeNull();
    await waitForVibePopoverTitle("Auto-locate Test");
    expect(screen.getByText("Confirmed 0/1")).toBeTruthy();

    clickCurrentVibeConfirmButton();

    await waitFor(() => expect(respondSpy).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task-vibe-idea-first",
      questionId: "vibe_story_ready",
      answer: JSON.stringify({ kind: "vibe_node_confirmed", nodeId: "root" }),
    })));
    await waitFor(() => expect(flowNodeCard("branch-a")).toBeTruthy());
    expect(flowNodeCard("root")?.classList.contains("is-confirmed")).toBe(true);
    expect(flowNodeCard("branch-b")).toBeNull();
    await waitForVibePopoverTitle("Current State");
    expect(flowNodeCard("branch-b")).toBeTruthy();
    expect(screen.getByText("Confirmed 0/2")).toBeTruthy();
  });

  it("keeps node drawing slow enough to show the generation process", () => {
    expect(IDEA_NODE_DRAWING_MS).toBeGreaterThanOrEqual(1400);
  });

  it("draws newly generated Story Beat nodes one by one from top to bottom before opening their popover", async () => {
    vi.useFakeTimers();
    const now = new Date().toISOString();
    const task: DesktopTask = {
      id: "task-vibe-branch-drawing",
      conversationId: "task-vibe-branch-drawing",
      status: "question",
      documentType: "pptx",
      events: [{ task_id: "task-vibe-branch-drawing", type: "task.vibe_tree", ts: now, payload: { stage: "story_ready" } }],
      question: {
        id: "vibe_story_ready",
        question: "Project Map generated.",
        allowFreeform: true,
        options: [{ id: "generate_chapters", label: "Generate Chapters", recommended: true }],
      },
      vibeTree: {
        stage: "story_ready",
        tree: {
          id: "tree-branch-drawing",
          rootId: "root",
          title: "Node Drawing Test",
          nodes: [
            { id: "root", kind: "root", title: "Node Drawing Test" },
            { id: "branch-a", parentId: "root", kind: "branch", title: "Current State", summary: "Confirm current state first", outline: ["First current state point"], visualAssets: [{ kind: "image", description: "A current state illustration" }] },
            { id: "branch-b", parentId: "root", kind: "branch", title: "Problem", summary: "Then confirm problems" },
          ],
        },
        actions: [{ id: "generate_chapters", label: "Generate Chapters" }],
        confirmation: { nodeIds: ["branch-a", "branch-b"] },
      },
    };

    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    await act(async () => {
      vi.advanceTimersByTime(6000);
    });
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    clickCurrentVibeConfirmButton();
    await act(async () => undefined);

    expect(flowNodeCard("branch-a")?.classList.contains("is-node-drawing")).toBe(true);
    expect((document.querySelector(".living-tree-flow-shell") as HTMLElement)?.dataset.cameraFocusNodeId).toBe("branch-a");
    expect(flowNodeCard("branch-b")).toBeNull();
    expect(document.querySelector('.react-flow__node[data-id="branch-b"]')).toBeNull();
    expect(flowNodeCard("branch-a")?.dataset.motionRole).toBe("node-drawing");
    expect(flowNodeCard("branch-a")?.querySelectorAll(".living-tree-node-outline-rect").length).toBe(1);
    expect(flowNodeCard("branch-a")?.querySelector(".living-tree-node-outline-svg")).toBeTruthy();
    expect(flowNodeCard("branch-a")?.querySelectorAll(".living-tree-animated-line").length).toBeGreaterThanOrEqual(3);
    expect(flowNodeCard("branch-a")?.querySelectorAll(".living-tree-animated-char").length).toBe(0);
    expect(flowNodeCard("branch-a")?.querySelector("li.living-tree-animated-line")?.getAttribute("data-has-content")).toBe("false");
    expect(flowNodeCard("branch-a")?.querySelector(".living-tree-visual-asset-icon")).toBeNull();
    expect(flowNodeCard("branch-a")?.querySelector("strong")?.textContent).not.toBe("Current State");
    expect(hasOpenVibeConfirmationPopover()).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(flowNodeCard("branch-a")?.querySelector(".living-tree-animated-line.is-streaming")).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(flowNodeCard("branch-a")?.querySelector(".living-tree-animated-line.is-streaming")?.textContent ?? "").not.toBe("");

    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(flowNodeCard("branch-a")?.querySelector("strong")?.textContent).toBe("Current State");
    expect(flowNodeCard("branch-a")?.querySelector("li.living-tree-animated-line")?.getAttribute("data-has-content")).toBe("false");
    expect(flowNodeCard("branch-a")?.querySelector(".living-tree-visual-asset-icon")).toBeNull();

    for (let i = 0; i < 8 && flowNodeCard("branch-a")?.querySelector("li.living-tree-animated-line")?.getAttribute("data-has-content") !== "true"; i += 1) {
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
    }
    expect(flowNodeCard("branch-a")?.querySelector("li.living-tree-animated-line")?.getAttribute("data-has-content")).toBe("true");
    expect(flowNodeCard("branch-a")?.querySelector(".living-tree-visual-asset-icon")).toBeNull();

    for (let i = 0; i < 6 && !flowNodeCard("branch-a")?.querySelector(".living-tree-visual-asset-icon.is-image"); i += 1) {
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
    }
    expect(flowNodeCard("branch-a")?.querySelector(".living-tree-visual-asset-icon.is-image")).toBeTruthy();
    expect(hasOpenVibeConfirmationPopover()).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(flowNodeCard("branch-a")?.classList.contains("is-node-drawing")).toBe(false);
    expect(flowNodeCard("branch-b")?.classList.contains("is-node-drawing")).toBe(true);
    expect((document.querySelector(".living-tree-flow-shell") as HTMLElement)?.dataset.cameraFocusNodeId).toBe("branch-b");
    expect(flowNodeCard("branch-b")?.querySelectorAll(".living-tree-node-outline-rect").length).toBe(1);
    expect(flowNodeCard("branch-b")?.querySelector(".living-tree-node-outline-svg")).toBeTruthy();
    expect(flowNodeCard("branch-b")?.querySelectorAll(".living-tree-animated-char").length).toBe(0);
    expect(flowNodeCard("branch-b")?.querySelector("strong")?.textContent).not.toBe("Problem");
    expect(hasOpenVibeConfirmationPopover()).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(flowNodeCard("branch-b")?.classList.contains("is-node-drawing")).toBe(false);
    expect(currentVibePopoverTitle()).toBe("Current State");
    vi.useRealTimers();
  });

  it("automatically opens the first pending Story Beat popover when a Vibe stage starts", async () => {
    const task: DesktopTask = {
      id: "task-vibe-auto-open",
      conversationId: "task-vibe-auto-open",
      status: "question",
      documentType: "pptx",
      events: [],
      question: {
        id: "vibe_story_ready",
        question: "Project Map generated.",
        allowFreeform: true,
        options: [{ id: "generate_chapters", label: "Generate Chapters", recommended: true }],
      },
      vibeTree: {
        stage: "story_ready",
        tree: {
          id: "tree-auto-open",
          rootId: "root",
          title: "Auto-locate Test",
          nodes: [
            { id: "root", kind: "root", title: "Auto-locate Test" },
            { id: "branch-a", parentId: "root", kind: "branch", title: "Current State", summary: "Confirm current state first" },
            { id: "branch-b", parentId: "root", kind: "branch", title: "Problem", summary: "Then confirm problems" },
          ],
        },
        actions: [{ id: "generate_chapters", label: "Generate Chapters" }],
        confirmation: { nodeIds: ["branch-a", "branch-b"] },
      },
    };

    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    await confirmInitialIdeaNode("Current State");
    expect(screen.getAllByRole("button", { name: "Confirm this node" }).length).toBeGreaterThan(0);
    expect(screen.getByText("Confirmed 0/2")).toBeTruthy();
  });

  it("opens the Vibe task card through a native active-stage button click", async () => {
    const task: DesktopTask = {
      id: "task-vibe-native-stage-click",
      conversationId: "task-vibe-native-stage-click",
      status: "question",
      documentType: "pptx",
      events: [],
      question: {
        id: "vibe_story_ready",
        question: "Project Map generated.",
        allowFreeform: true,
        options: [{ id: "generate_chapters", label: "Generate Chapters", recommended: true }],
      },
      vibeTree: {
        stage: "story_ready",
        tree: {
          id: "tree-native-stage-click",
          rootId: "root",
          title: "Native Stage Click",
          nodes: [
            { id: "root", kind: "root", title: "Native Stage Click", status: "story_ready" },
            { id: "branch-a", parentId: "root", kind: "branch", title: "Current State", status: "story_ready" },
          ],
        },
        actions: [{ id: "generate_chapters", label: "Generate Chapters" }],
        confirmation: { nodeIds: ["branch-a"] },
      },
    };

    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    await confirmInitialIdeaNode("Current State");
    const trigger = screen.getByRole("button", { name: "Open Story Beat task" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    trigger.click();
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
    expect(document.querySelector(".living-tree-step-popover")).not.toHaveStyle({ display: "none" });
  });

  it("moves the popover to the next pending node after each confirmation", async () => {
    const task: DesktopTask = {
      id: "task-vibe-auto-next",
      conversationId: "task-vibe-auto-next",
      status: "question",
      documentType: "pptx",
      events: [],
      question: {
        id: "vibe_story_ready",
        question: "Project Map generated.",
        allowFreeform: true,
        options: [{ id: "generate_chapters", label: "Generate Chapters", recommended: true }],
      },
      vibeTree: {
        stage: "story_ready",
        tree: {
          id: "tree-auto-next",
          rootId: "root",
          title: "Auto-locate Test",
          nodes: [
            { id: "root", kind: "root", title: "Auto-locate Test" },
            { id: "branch-a", parentId: "root", kind: "branch", title: "Current State", summary: "Confirm current state first" },
            { id: "branch-b", parentId: "root", kind: "branch", title: "Problem", summary: "Then confirm problems" },
            { id: "branch-c", parentId: "root", kind: "branch", title: "Solution", summary: "Finally confirm solution" },
          ],
        },
        actions: [{ id: "generate_chapters", label: "Generate Chapters" }],
        confirmation: { nodeIds: ["branch-a", "branch-b", "branch-c"] },
      },
    };

    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    await confirmInitialIdeaNode("Current State");
    clickCurrentVibeConfirmButton();

    await waitForVibePopoverTitle("Problem");
    // Open the task card popover by clicking the active step so the Confirmed text is rendered in the portal
    const activeStep = document.querySelector(".living-tree-step.is-active") as HTMLElement;
    if (activeStep) fireEvent.click(activeStep);
    await waitFor(() => expect(screen.getByText("Confirmed 1/3")).toBeTruthy());
  });

  it("closes the confirmation popover and enables the next stage action after the last pending node is confirmed", async () => {
    const task: DesktopTask = {
      id: "task-vibe-auto-complete",
      conversationId: "task-vibe-auto-complete",
      status: "question",
      documentType: "pptx",
      events: [],
      question: {
        id: "vibe_story_ready",
        question: "Project Map generated.",
        allowFreeform: true,
        options: [{ id: "generate_chapters", label: "Generate Chapters", recommended: true }],
      },
      vibeTree: {
        stage: "story_ready",
        tree: {
          id: "tree-auto-complete",
          rootId: "root",
          title: "Auto-locate Test",
          nodes: [
            { id: "root", kind: "root", title: "Auto-locate Test" },
            { id: "branch-a", parentId: "root", kind: "branch", title: "Current State" },
            { id: "branch-b", parentId: "root", kind: "branch", title: "Problem" },
          ],
        },
        actions: [{ id: "generate_chapters", label: "Generate Chapters" }],
        confirmation: { nodeIds: ["branch-a", "branch-b"] },
      },
    };

    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    expect(screen.queryByRole("button", { name: "Generate Chapters" })).toBeNull();
    await confirmInitialIdeaNode("Current State");
    const stageButton = screen.getByRole("button", { name: "Generate Chapters" });
    expect(stageButton.classList.contains("living-tree-stage-cta-ready")).toBe(false);

    clickCurrentVibeConfirmButton();
    await waitForVibePopoverTitle("Problem");
    clickCurrentVibeConfirmButton();

    await waitFor(() => expect(hasOpenVibeConfirmationPopover()).toBe(false));
    expect(screen.getByText("Confirmed 2/2")).toBeTruthy();
    expect(stageButton).not.toBeDisabled();
    expect(stageButton.classList.contains("living-tree-stage-cta-ready")).toBe(true);
  });

  it("dismisses the current task popover after Generate Slides is submitted", async () => {
    const actionResponse = deferred<void>();
    respondSpy.mockReturnValueOnce(actionResponse.promise);
    const task: DesktopTask = {
      id: "task-vibe-generate-slides",
      conversationId: "task-vibe-generate-slides",
      status: "question",
      documentType: "pptx",
      events: [],
      question: {
        id: "vibe_refined_ready",
        question: "Outlines confirmed.",
        allowFreeform: true,
        options: [{ id: "generate_slides", label: "Generate Slides", recommended: true }],
      },
      vibeTree: {
        stage: "refined_ready",
        tree: {
          id: "tree-generate-slides",
          rootId: "root",
          title: "Generate Slides Test",
          nodes: [
            { id: "root", kind: "root", title: "Generate Slides Test" },
            { id: "branch-a", parentId: "root", kind: "branch", title: "Story Beat" },
            { id: "group-a", parentId: "branch-a", kind: "slide_group", title: "Chapter" },
            { id: "outline-01", parentId: "group-a", kind: "outline", title: "Page 1" },
          ],
        },
        actions: [{ id: "generate_slides", label: "Generate Slides" }],
        confirmation: { nodeIds: ["outline-01"] },
      },
    };

    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    await waitForVibePopoverTitle("Page 1");
    clickCurrentVibeConfirmButton();
    await waitFor(() => expect(activeVibeStepOwnsOpenPopover()).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Generate Slides" }));

    await waitFor(() => expect(activeVibeStepOwnsOpenPopover()).toBe(false));
    expect(screen.queryByRole("button", { name: "Generate Slides" })).toBeNull();

    actionResponse.resolve();
    await act(async () => {});

    expect(respondSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Generate Slides" })).toBeNull();
  });

  it("shows PPTX generation copy while a completed Vibe tree is still assembling the file", async () => {
    const task: DesktopTask = {
      id: "task-vibe-assembling-pptx",
      conversationId: "task-vibe-assembling-pptx",
      status: "running",
      documentType: "pptx",
      events: [],
      vibeTree: {
        stage: "completed",
        actions: [],
        tree: {
          id: "tree-assembling-pptx",
          rootId: "root",
          title: "Assembling PPTX Test",
          nodes: [
            { id: "root", kind: "root", title: "Assembling PPTX Test" },
            { id: "branch-a", parentId: "root", kind: "branch", title: "Story Beat" },
            { id: "group-a", parentId: "branch-a", kind: "slide_group", title: "Chapter" },
            { id: "outline-01", parentId: "group-a", kind: "outline", title: "Page 1" },
            { id: "slide-01", parentId: "outline-01", kind: "slide", title: "Page 1" },
            { id: "deck", parentId: "root", kind: "deck", title: "Full Deck" },
          ],
        },
      },
    };

    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    await waitFor(() => expect(screen.getByText("Generating PPTX")).toBeTruthy());
    expect(screen.queryByText("PPTX Completed")).toBeNull();
    expect(screen.queryByText("Completed")).toBeNull();
    expect(screen.queryByText("Confirmed 1/1")).toBeNull();
  });

  it("automatically focuses the first pending Chapter during outline_ready instead of completed Story Beats", async () => {
    const task: DesktopTask = {
      id: "task-vibe-auto-chapter",
      conversationId: "task-vibe-auto-chapter",
      status: "question",
      documentType: "pptx",
      events: [],
      question: {
        id: "vibe_outline_ready",
        question: "Chapters generated.",
        allowFreeform: true,
        options: [{ id: "generate_outline", label: "Generate Outline", recommended: true }],
      },
      vibeTree: {
        stage: "outline_ready",
        tree: {
          id: "tree-auto-chapter",
          rootId: "root",
          title: "Auto-locate Test",
          nodes: [
            { id: "root", kind: "root", title: "Auto-locate Test" },
            { id: "branch-a", parentId: "root", kind: "branch", title: "Current State" },
            { id: "group-a", parentId: "branch-a", kind: "slide_group", title: "Context Setting" },
            { id: "group-b", parentId: "branch-a", kind: "slide_group", title: "Problem Breakdown" },
          ],
        },
        actions: [{ id: "generate_outline", label: "Generate Outline" }],
        confirmation: { nodeIds: ["group-a", "group-b"] },
      },
    };

    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    await waitForVibePopoverTitle("Context Setting");
    expect(screen.getByRole("button", { name: "Confirm this node" })).toBeTruthy();
  });

  it("draws newly generated Chapter nodes one by one before opening their popover", async () => {
    vi.useFakeTimers();
    const now = new Date().toISOString();
    const task: DesktopTask = {
      id: "task-vibe-chapter-drawing",
      conversationId: "task-vibe-chapter-drawing",
      status: "question",
      documentType: "pptx",
      events: [{ task_id: "task-vibe-chapter-drawing", type: "task.vibe_tree", ts: now, payload: { stage: "outline_ready" } }],
      question: {
        id: "vibe_outline_ready",
        question: "Chapters generated.",
        allowFreeform: true,
        options: [{ id: "generate_outline", label: "Generate Outline", recommended: true }],
      },
      vibeTree: {
        stage: "outline_ready",
        tree: {
          id: "tree-chapter-drawing",
          rootId: "root",
          title: "Chapter Drawing Test",
          nodes: [
            { id: "root", kind: "root", title: "Chapter Drawing Test" },
            { id: "branch-a", parentId: "root", kind: "branch", title: "Current State" },
            { id: "group-a", parentId: "branch-a", kind: "slide_group", title: "Context Setting" },
            { id: "group-b", parentId: "branch-a", kind: "slide_group", title: "Problem Breakdown" },
          ],
        },
        actions: [{ id: "generate_outline", label: "Generate Outline" }],
        confirmation: { nodeIds: ["group-a", "group-b"] },
      },
    };

    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    expect(flowNodeCard("group-a")?.classList.contains("is-node-drawing")).toBe(true);
    expect(flowNodeCard("group-b")).toBeNull();
    expect(document.querySelector('.react-flow__node[data-id="group-b"]')).toBeNull();
    expect(flowNodeCard("group-a")?.dataset.motionRole).toBe("node-drawing");
    expect(hasOpenVibeConfirmationPopover()).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(flowNodeCard("group-a")?.classList.contains("is-node-drawing")).toBe(false);
    expect(flowNodeCard("group-b")?.classList.contains("is-node-drawing")).toBe(true);
    expect(hasOpenVibeConfirmationPopover()).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(flowNodeCard("group-b")?.classList.contains("is-node-drawing")).toBe(false);
    expect(currentVibePopoverTitle()).toBe("Context Setting");
    vi.useRealTimers();
  });

  it("continues automatic guidance after the user manually inspects a non-pending node", async () => {
    const task: DesktopTask = {
      id: "task-vibe-auto-manual",
      conversationId: "task-vibe-auto-manual",
      status: "question",
      documentType: "pptx",
      events: [],
      question: {
        id: "vibe_story_ready",
        question: "Project Map generated.",
        allowFreeform: true,
        options: [{ id: "generate_chapters", label: "Generate Chapters", recommended: true }],
      },
      vibeTree: {
        stage: "story_ready",
        tree: {
          id: "tree-auto-manual",
          rootId: "root",
          title: "Auto-locate Test",
          nodes: [
            { id: "root", kind: "root", title: "Auto-locate Test" },
            { id: "branch-a", parentId: "root", kind: "branch", title: "Current State" },
            { id: "branch-b", parentId: "root", kind: "branch", title: "Problem" },
          ],
        },
        actions: [{ id: "generate_chapters", label: "Generate Chapters" }],
        confirmation: { nodeIds: ["branch-a", "branch-b"] },
      },
    };

    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    await confirmInitialIdeaNode("Current State");
    // Popover should be at first pending branch
    expect(currentVibePopoverTitle()).toBe("Current State");
    // Click root node to manually inspect it
    fireEvent.click(flowNodeCard("root") as Element);
    await waitForVibePopoverTitle("Auto-locate Test");

    // Click branch-a to return to it and confirm
    fireEvent.click(flowNodeCard("branch-a") as Element);
    await waitForVibePopoverTitle("Current State");
    clickCurrentVibeConfirmButton();
    await waitForVibePopoverTitle("Problem");
    expect(currentVibePopoverTitle()).toBe("Problem");
  });

  it("preserves confirmed Outline nodes after same-stage node feedback refreshes the tree snapshot", async () => {
    vi.useFakeTimers();
    const makeOutlineTask = (treeId: string, p4Title = "P4: The new knowledge base must upgrade from a document repository to a decision system"): DesktopTask => ({
      id: "task-vibe-outline-feedback",
      conversationId: "task-vibe-outline-feedback",
      status: "question",
      documentType: "pptx",
      events: [],
      question: {
        id: "vibe_refined_ready",
        question: "Outline generated.",
        allowFreeform: true,
        options: [{ id: "generate_slides", label: "Generate Slides", recommended: true }],
      },
      vibeTree: {
        stage: "refined_ready",
        tree: {
          id: treeId,
          rootId: "root",
          title: "Confirmation Test",
          nodes: [
            { id: "root", kind: "root", title: "Confirmation Test" },
            { id: "branch-a", parentId: "root", kind: "branch", title: "Solution" },
            { id: "group-a", parentId: "branch-a", kind: "slide_group", title: "Solution Closure" },
            { id: "outline-01", parentId: "group-a", kind: "outline", title: "P1: Rebuilding the knowledge base is essential for decision efficiency" },
            { id: "outline-02", parentId: "group-a", kind: "outline", title: "P2: Legacy knowledge workflows are creating alignment costs" },
            { id: "outline-03", parentId: "group-a", kind: "outline", title: "P3: Hidden cost 1: Search and repeated questions consume attention" },
            { id: "outline-04", parentId: "group-a", kind: "outline", title: p4Title },
          ],
        },
        actions: [{ id: "generate_slides", label: "Generate Slides" }],
        confirmation: { nodeIds: ["outline-01", "outline-02", "outline-03", "outline-04"] },
      },
    });

    const { rerender } = render(<DialogueScreen {...baseProps()} tasks={[makeOutlineTask("tree-outline-before")]} />);

    await act(async () => {
      vi.advanceTimersByTime(6000);
    });
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });
    await act(async () => {});
    expect(currentVibePopoverTitle()).toBe("P1: Rebuilding the knowledge base is essential for decision efficiency");
    clickCurrentVibeConfirmButton();
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    await act(async () => {});
    expect(currentVibePopoverTitle()).toBe("P2: Legacy knowledge workflows are creating alignment costs");
    clickCurrentVibeConfirmButton();
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    await act(async () => {});
    expect(currentVibePopoverTitle()).toBe("P3: Hidden cost 1: Search and repeated questions consume attention");
    clickCurrentVibeConfirmButton();
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    await act(async () => {});
    expect(currentVibePopoverTitle()).toBe("P4: The new knowledge base must upgrade from a document repository to a decision system");
    // Open the task card popover by clicking the active step so the Confirmed text is rendered in the portal
    const activeStep = document.querySelector(".living-tree-step.is-active") as HTMLElement;
    if (activeStep) fireEvent.click(activeStep);
    expect(screen.getByText("Confirmed 3/4")).toBeTruthy();

    expect(screen.queryByRole("button", { name: "Suggest Changes" })).toBeNull();
    const currentPopover = currentOpenVibePopover() as HTMLElement;
    expect(within(currentPopover).queryByText("Edit current content")).toBeNull();
    const editInput = within(currentPopover).getByLabelText("Outline: Describe the key content this page presents");
    expect(editInput).toHaveValue("P4: The new knowledge base must upgrade from a document repository to a decision system");
    fireEvent.change(editInput, {
      target: { value: "Make this page more like a version for the boss" },
    });
    expect(within(currentPopover).queryByRole("button", { name: "Apply to current node" })).toBeNull();
    expect(within(currentPopover).getAllByRole("button")).toHaveLength(1);
    clickCurrentOpenVibePopoverButton("Confirm this node");

    expect(respondSpy).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task-vibe-outline-feedback",
      questionId: "vibe_refined_ready",
      answer: JSON.stringify({
        kind: "vibe_node_feedback",
        nodeId: "outline-04",
        feedback: "Make this page more like a version for the boss",
      }),
    }));

    rerender(<DialogueScreen {...baseProps()} tasks={[makeOutlineTask("tree-outline-after", "P4: Upgrade the knowledge base to a decision system for executives")]} />);

    await act(async () => {
      vi.advanceTimersByTime(6000);
    });
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });
    await act(async () => {});
    expect(currentVibePopoverTitle()).toBe("P4: Upgrade the knowledge base to a decision system for executives");
    // Re-open the task card popover after rerender so the Confirmed text is in the portal
    const activeStep2 = document.querySelector(".living-tree-step.is-active") as HTMLElement;
    if (activeStep2) fireEvent.click(activeStep2);
    expect(screen.getByText("Confirmed 3/4")).toBeTruthy();
    expect(flowNodeCard("outline-01")?.classList.contains("is-confirmed")).toBe(true);
    expect(flowNodeCard("outline-02")?.classList.contains("is-confirmed")).toBe(true);
    expect(flowNodeCard("outline-03")?.classList.contains("is-confirmed")).toBe(true);
    expect(flowNodeCard("outline-04")?.classList.contains("is-pending")).toBe(true);
    vi.useRealTimers();
  });

  it("uses yellow for pending nodes and green for confirmed nodes instead of reusing story orange", () => {
    const css = readFileSync("src/renderer/styles/dialogue.css", "utf8");
    const pendingRule = css.match(/\.living-tree-flow-node\.is-pending\s*\{(?<body>[^}]*)\}/s)?.groups?.body ?? "";
    const confirmedRule = css.match(/\.living-tree-flow-node\.is-confirmed:not\(\.is-deck\)\s*\{(?<body>[^}]*)\}/s)?.groups?.body ?? "";
    const drawingBeforeRule = css.match(/\.living-tree-flow-node\.is-node-drawing::before,\r?\n\.living-tree-flow-node\.is-idea-drawing::before\s*\{(?<body>[^}]*)\}/s)?.groups?.body ?? "";
    const drawingPendingRule = css.match(/\.living-tree-flow-node\.is-node-drawing\.is-pending,\r?\n\.living-tree-flow-node\.is-idea-drawing\.is-pending\s*\{(?<body>[^}]*)\}/s)?.groups?.body ?? "";
    const drawingOutlineRule = css.match(/\.living-tree-node-outline-rect\s*\{(?<body>[^}]*)\}/s)?.groups?.body ?? "";
    const visualAssetIconRule = css.match(/^\.living-tree-visual-asset-icon\s*\{(?<body>[^}]*)\}/m)?.groups?.body ?? "";
    const slideThumbnailRule = css.match(/^\.living-tree-flow-node\.is-generated_slide\s*\{(?<body>[^}]*)\}/m)?.groups?.body ?? "";
    const outlineKeyframes = css.match(/@keyframes living-tree-node-outline-draw\s*\{(?<body>.*?)\r?\n\}/s)?.groups?.body ?? "";

    expect(pendingRule).toContain("245, 196, 0");
    expect(pendingRule).not.toContain("221, 91, 0");
    expect(confirmedRule).toContain("22, 163, 74");
    expect(drawingBeforeRule).toContain("content: none");
    expect(drawingPendingRule).toContain("border-color: transparent");
    expect(drawingPendingRule).toContain("background: transparent");
    expect(drawingPendingRule).toContain("box-shadow: none");
    expect(drawingPendingRule).not.toContain("86, 69, 212");
    expect(drawingPendingRule).not.toContain("245, 196, 0");
    expect(drawingOutlineRule).toContain("245, 196, 0");
    expect(drawingOutlineRule).toContain("stroke-dasharray: 1");
    expect(drawingOutlineRule).toContain("stroke-dashoffset: 1");
    expect(visualAssetIconRule).toContain("width: 52px");
    expect(visualAssetIconRule).toContain("height: 34px");
    expect(visualAssetIconRule).toContain("font-size: 20px");
    expect(slideThumbnailRule).toContain("width: 416px");
    expect(slideThumbnailRule).toContain("min-height: 234px");
    expect(outlineKeyframes).toContain("stroke-dashoffset: 0");
    expect(css).toContain('.living-tree-flow-node li.living-tree-animated-line[data-has-content="true"]::before');
    expect(css).toContain(".living-tree-flow-node.is-node-drawing .react-flow__handle");
    expect(css).toContain(".living-tree-node-outline-svg");
    expect(css).not.toContain(".living-tree-node-outline-top");
    expect(css).not.toContain(".living-tree-node-outline-right");
    expect(css).not.toContain(".living-tree-node-outline-bottom");
    expect(css).not.toContain(".living-tree-node-outline-left");
  });

  it("gives the Living Tree minimap stable node dimensions and visible contrast", () => {
    const snapshot: VibeTreeSnapshot = {
      stage: "completed",
      actions: [],
      tree: {
        id: "tree-minimap",
        rootId: "root",
        title: "Minimap visibility",
        nodes: [
          { id: "root", kind: "root", title: "Minimap visibility" },
          { id: "branch", parentId: "root", kind: "branch", title: "Problem" },
          { id: "chapter", parentId: "branch", kind: "slide_group", title: "Chapter" },
          { id: "outline-01", parentId: "chapter", kind: "outline", title: "P1" },
          { id: "slide-01", parentId: "outline-01", kind: "slide", title: "P1", slideNumber: 1 },
          { id: "deck", kind: "deck", title: "Complete PPTX Deck" },
        ],
      },
    };
    const model = buildVibeFlowModel(snapshot);
    const rootNode = model.nodes.find((node) => node.id === "root");
    const deckNode = model.nodes.find((node) => node.id === "deck");
    const css = readFileSync("src/renderer/styles/dialogue.css", "utf8");

    expect(rootNode).toEqual(expect.objectContaining({ width: 320, height: 116 }));
    expect(deckNode).toEqual(expect.objectContaining({ width: 520, height: 320 }));
    expect(deckNode?.position.x).toBe(3024);
    expect(rootNode?.style).toEqual(expect.objectContaining({ width: 320, height: 116 }));
    expect(deckNode?.style).toEqual(expect.objectContaining({ width: 520, height: 320 }));
    expect(css).toMatch(/\.living-tree-flow-shell\s+\.react-flow__minimap-svg\s*\{/);
    expect(css).toMatch(/\.living-tree-flow-shell\s+\.react-flow__minimap-node\s*\{/);
    expect(css).toMatch(/\.living-tree-flow-shell\s+\.react-flow__minimap-mask\s*\{/);
  });

  it("expands PPT canvas nodes vertically when their text and visual assets need more room", () => {
    const snapshot: VibeTreeSnapshot = {
      stage: "refined_ready",
      actions: [],
      tree: {
        id: "tree-tall-node",
        rootId: "root",
        title: "Tall node test",
        nodes: [
          { id: "root", kind: "root", title: "Tall node test" },
          { id: "branch", parentId: "root", kind: "branch", title: "Problem" },
          { id: "chapter", parentId: "branch", kind: "slide_group", title: "Chapter" },
          {
            id: "outline-long",
            parentId: "chapter",
            kind: "slide",
            slideNumber: 2,
            title: "Legacy knowledge workflows have created a high-friction work environment",
            summary: "Illustrate knowledge scattering, search difficulty, and repeated verification through concrete scenarios.",
            outline: [
              "Materials scattered across chat, documents, meeting notes, and personal experience, causing increasing information fragmentation",
              "New members and cross-team colleagues must repeatedly ask to locate context, greatly reducing collaboration efficiency and team productivity",
              "Critical decisions rely on a few people's memory rather than reusable systems, posing serious knowledge loss and single point of failure risks",
            ],
            visualAssets: [{ kind: "image", description: "On-site workflow illustration" }],
          },
        ],
      },
    };

    const model = buildVibeFlowModel(snapshot);
    const tallNode = model.nodes.find((node) => node.id === "outline-long");
    const css = readFileSync("src/renderer/styles/dialogue.css", "utf8");
    const outlineRule = css.match(/\.living-tree-flow-node\.is-outline\s*\{(?<body>[^}]*)\}/s)?.groups?.body ?? "";
    const generatedSlideRule = css.match(/\.living-tree-flow-node\.is-generated_slide\s*\{(?<body>[^}]*)\}/s)?.groups?.body ?? "";

    expect(tallNode?.height).toBeGreaterThan(258);
    expect(tallNode?.style).toEqual(expect.objectContaining({ width: 320, height: tallNode?.height }));
    expect(outlineRule).not.toContain("overflow: hidden");
    expect(generatedSlideRule).not.toContain("overflow: hidden");
  });

  it("shows upstream Story Beat nodes as confirmed after Chapters are generated", () => {
    const task: DesktopTask = {
      id: "task-vibe-upstream-confirmed",
      conversationId: "task-vibe-upstream-confirmed",
      status: "question",
      documentType: "pptx",
      events: [],
      question: {
        id: "vibe_outline_ready",
        question: "Chapters generated.",
        allowFreeform: true,
        options: [{ id: "generate_outline", label: "Generate Outline", recommended: true }],
      },
      vibeTree: {
        stage: "outline_ready",
        tree: {
          id: "tree-upstream-confirmed",
          rootId: "root",
          title: "Confirmation Test",
          nodes: [
            { id: "root", kind: "root", title: "Confirmation Test" },
            { id: "branch-a", parentId: "root", kind: "branch", title: "Current State" },
            { id: "group-a", parentId: "branch-a", kind: "slide_group", title: "Context Setting" },
          ],
        },
        actions: [{ id: "generate_outline", label: "Generate Outline" }],
        confirmation: { nodeIds: ["group-a"] },
      },
    };

    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    const branch = flowNodeCard("branch-a");
    const chapter = flowNodeCard("group-a");
    expect(branch?.classList.contains("is-confirmed")).toBe(true);
    expect(branch?.classList.contains("is-pending")).toBe(false);
    expect(chapter?.classList.contains("is-pending")).toBe(true);
  });

  it("lets users confirm the current Chapter from a selected Outline child without typing feedback", async () => {
    vi.useFakeTimers();
    const now = new Date().toISOString();
    const task: DesktopTask = {
      id: "task-vibe-outline-child",
      conversationId: "task-vibe-outline-child",
      status: "question",
      documentType: "pptx",
      events: [{ task_id: "task-vibe-outline-child", type: "task.vibe_tree", ts: now, payload: { stage: "outline_ready" } }],
      question: {
        id: "vibe_outline_ready",
        question: "Outline generated.",
        allowFreeform: true,
        options: [{ id: "refine_slides", label: "Refine Page Content", recommended: true }],
      },
      vibeTree: {
        stage: "outline_ready",
        tree: {
          id: "tree-outline-child",
          rootId: "root",
          title: "Confirmation Test",
          nodes: [
            { id: "root", kind: "root", title: "Confirmation Test" },
            { id: "branch-a", parentId: "root", kind: "branch", title: "Solution" },
            { id: "group-a", parentId: "branch-a", kind: "slide_group", title: "Solution Closure" },
            { id: "outline-a-1", parentId: "group-a", kind: "outline", title: "Implementation Path and Expected Benefits" },
          ],
        },
        actions: [{ id: "refine_slides", label: "Refine Page Content" }],
        confirmation: { nodeIds: ["group-a"] },
      },
    };

    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    expect(screen.getByText("Confirmed 0/1")).toBeTruthy();
    fireEvent.click(screen.getByText("Implementation Path and Expected Benefits"));
    expect(screen.queryByText("Current stage confirmation target: Solution Closure")).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    fireEvent.click(screen.getByText("Implementation Path and Expected Benefits"));
    expect(screen.getByText("Current stage confirmation target: Solution Closure")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm parent Chapter" }));
    expect(screen.getByText("Confirmed 1/1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refine Page Content" })).not.toBeDisabled();
  });

  it("shows a cancel action inside the Vibe canvas task card", async () => {
    const onForceCancel = vi.fn();
    const task: DesktopTask = {
      id: "task-vibe-cancel",
      conversationId: "task-vibe-cancel",
      status: "question",
      documentType: "pptx",
      events: [],
      question: {
        id: "vibe_story_ready",
        question: "Project Map generated.",
        allowFreeform: true,
        options: [{ id: "generate_outline", label: "Generate PPT Outline", recommended: true }],
      },
      vibeTree: {
        stage: "story_ready",
        tree: {
          id: "tree-cancel",
          rootId: "root",
          title: "Cancel Test",
          nodes: [
            { id: "root", kind: "root", title: "Cancel Test" },
            { id: "branch-a", parentId: "root", kind: "branch", title: "Current State" },
          ],
        },
        actions: [{ id: "generate_outline", label: "Generate PPT Outline" }],
        confirmation: { nodeIds: ["branch-a"] },
      },
    };

    render(<DialogueScreen {...baseProps({ onForceCancel })} tasks={[task]} />);

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() => expect(cancelSpy).toHaveBeenCalledWith("task-vibe-cancel"));
    expect(onForceCancel).toHaveBeenCalledWith("task-vibe-cancel");
  });

  it("uses the animated loading surface as the only visible generation bubble", () => {
    const task = makeRunningTask({
      documentType: "pptx",
      userInput: {
        prompt: "Make a 10-slide onboarding deck",
        generationMode: "plan",
      },
    });

    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    const loadingMessage = document.querySelector(".generation-loading-message");
    expect(loadingMessage).toBeTruthy();
    expect(loadingMessage?.classList.contains("message")).toBe(false);
    expect(loadingMessage?.classList.contains("ai-message")).toBe(false);
    expect(loadingMessage?.querySelector(".generation-loading-visual")).toBeTruthy();
  });

  it("does not draw a lined background bubble behind the generation animation", () => {
    const css = readFileSync("src/renderer/styles/dialogue.css", "utf8");
    const visualRule = css.match(/\.generation-loading-visual\s*\{(?<body>[^}]*)\}/s)?.groups?.body ?? "";

    expect(visualRule).not.toMatch(/\bborder(?:-radius)?:/);
    expect(visualRule).not.toMatch(/\bbackground(?:-size)?:/);
    expect(visualRule).not.toMatch(/overflow:\s*hidden;/);
  });

  it("keeps active conversation bubbles clear of the scrollbar and loading art aligned", () => {
    const css = readFileSync("src/renderer/styles/dialogue.css", "utf8");
    const chatThreadRule = css.match(/\.chat-thread\s*\{(?<body>[^}]*)\}/s)?.groups?.body ?? "";
    const visualRule = css.match(/\.generation-loading-visual\s*\{(?<body>[^}]*)\}/s)?.groups?.body ?? "";

    expect(chatThreadRule).toMatch(/padding-right:\s*(?:1[2-9]|[2-9]\d)px;/);
    expect(visualRule).toMatch(/justify-items:\s*start;/);
    expect(visualRule).not.toMatch(/place-items:\s*center;/);
  });

  it("renders the target document animation after a reviewed plan returns to running", () => {
    const task = makeRunningTask({
      documentType: "pptx",
      userInput: {
        prompt: "Make a 10-slide onboarding deck",
        generationMode: "plan",
      },
      plan: {
        id: "plan-1",
        markdown: "# Plan\n\n- Build the deck.",
        revision: 1,
      },
    });

    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    expect(screen.getByText("Generating PPTX...")).toBeTruthy();
    expect(document.querySelector(".generation-loading-pptx")).toBeTruthy();
    expect(document.querySelector(".generation-loading-plan")).toBeNull();
  });

  it.each(["img", "gif"])("keeps the thinking fallback for %s running tasks", (documentType) => {
    render(<DialogueScreen {...baseProps()} tasks={[makeRunningTask({ documentType })]} />);

    expect(screen.getByText("Thinking...")).toBeTruthy();
    expect(document.querySelector(".generation-loading-message")).toBeNull();
  });

  it("Plan review state waits for explicit approval or revision after showing the execution prompt", async () => {
    const longPlanMarkdown = [
      "# Proposed Plan",
      "",
      "- Build a concise deck after approval.",
      ...Array.from({ length: 30 }, (_, index) => `- Restored plan detail ${index + 1}: keep the review card usable after restart.`),
    ].join("\n");
    const task: DesktopTask = {
      id: "task-plan",
      conversationId: "task-plan",
      status: "plan_review",
      events: [],
      stages: [
        { id: "analyze", label: "Analyzing request", status: "completed" },
        { id: "format", label: "Formatting & export", status: "active" },
      ],
      runtimeSnapshot: { mode: "hosted" },
      plan: {
        id: "plan-1",
        markdown: longPlanMarkdown,
        revision: 1,
        executionPrompt: "Generate a concise deck after the user reviews this prompt.",
      },
    };
    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    expect(screen.getByText("Execution plan")).toBeTruthy();
    expect(screen.getByText(/Build a concise deck after approval/i)).toBeTruthy();
    expect(screen.getByText("Full execution prompt")).toBeTruthy();
    expect(screen.getByText("Generate a concise deck after the user reviews this prompt.")).toBeTruthy();
    const card = document.querySelector(".plan-review-card");
    expect(card).toBeTruthy();
    expect(card?.classList.contains("is-expanded")).toBe(false);
    const expandButton = screen.getByRole("button", { name: /show full plan/i });
    expect(expandButton).toBeTruthy();
    expect(document.querySelector(".plan-review-card .plan-review-actions-panel")).toBeNull();
    const composer = document.querySelector(".conversation-footer .plan-review-composer") as HTMLElement | null;
    expect(composer).toBeTruthy();
    expect(composer?.querySelector(".plan-review-actions-panel")).toBeTruthy();
    expect(composer?.querySelector(".plan-review-option-row")).toBeTruthy();
    expect(composer?.querySelector(".plan-review-action-index")).toBeNull();
    expect(composer?.querySelector(".plan-review-composer-row")).toBeTruthy();
    expect(within(composer as HTMLElement).getByRole("button", { name: /start execution/i }).classList.contains("plan-review-option-row")).toBe(true);
    expect(within(composer as HTMLElement).getByRole("button", { name: /submit/i })).toBeDisabled();
    expect(within(composer as HTMLElement).getByRole("button", { name: /cancel/i })).toBeTruthy();
    expect(document.querySelector(".plan-review-expand-chin")).toBeTruthy();
    expect(document.querySelector(".codex-plan-review")).toBeNull();
    expect(document.querySelector(".fluid-progress-panel")).toBeNull();
    expect(document.querySelector("[data-testid='task-runtime-panel']")).toBeNull();
    expect(screen.queryByText("Runtime used")).toBeNull();
    expect(screen.queryByText("Formatting & export")).toBeNull();
    expect(respondSpy).not.toHaveBeenCalled();

    fireEvent.click(expandButton);
    expect(card?.classList.contains("is-expanded")).toBe(true);
    expect(screen.queryByRole("button", { name: /show full plan/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /collapse plan/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /start execution/i }));
    await waitFor(() => expect(respondSpy).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-plan", questionId: "plan-1", optionId: "approve" }),
    ));
    respondSpy.mockClear();

    fireEvent.change(screen.getByPlaceholderText(/tell officedex/i), { target: { value: "Add one risk slide." } });
    expect(within(composer as HTMLElement).getByRole("button", { name: /submit/i })).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    await waitFor(() => expect(respondSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-plan",
        questionId: "plan-1",
        optionId: "revise",
        answer: "Add one risk slide.",
      }),
    ));
  });

  it("renders plan review markdown as formatted content instead of source text", () => {
    const task: DesktopTask = {
      id: "task-plan-markdown",
      conversationId: "task-plan-markdown",
      status: "plan_review",
      events: [],
      plan: {
        id: "plan-markdown",
        markdown: [
          "# Proposed Plan",
          "",
          "- **Task type**: New document",
          "- Use `pptx` output",
          "",
          "Keep the review readable.",
        ].join("\n"),
        revision: 1,
        executionPrompt: "Generate the document after approval.",
      },
    };

    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    const markdown = document.querySelector(".plan-review-markdown");
    expect(markdown).toBeTruthy();
    expect(within(markdown as HTMLElement).getByRole("heading", { name: "Proposed Plan" })).toBeTruthy();
    expect(within(markdown as HTMLElement).getByText("Task type").tagName).toBe("STRONG");
    expect(within(markdown as HTMLElement).getByText("Use", { exact: false }).closest("li")).toBeTruthy();
    expect(markdown?.querySelector("code")?.textContent).toBe("pptx");
    expect(markdown?.textContent).not.toContain("# Proposed Plan");
    expect(markdown?.textContent).not.toContain("**Task type**");
  });

  it("keeps a reviewed plan expanded after the same plan card remounts", () => {
    const task: DesktopTask = {
      id: "task-plan-persist",
      conversationId: "task-plan-persist",
      status: "plan_review",
      events: [],
      plan: {
        id: "plan-persist",
        markdown: [
          "# Proposed Plan",
          "",
          ...Array.from({ length: 24 }, (_, index) => `- Persisted expanded detail ${index + 1}.`),
        ].join("\n"),
        revision: 2,
        executionPrompt: "Execute only after this persisted plan review is approved.",
      },
    };

    const rendered = render(<DialogueScreen {...baseProps()} tasks={[task]} />);
    fireEvent.click(screen.getByRole("button", { name: /show full plan/i }));
    expect(document.querySelector(".plan-review-card")?.classList.contains("is-expanded")).toBe(true);
    expect(screen.queryByRole("button", { name: /show full plan/i })).toBeNull();

    rendered.unmount();
    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    expect(document.querySelector(".plan-review-card")?.classList.contains("is-expanded")).toBe(true);
    expect(screen.queryByRole("button", { name: /show full plan/i })).toBeNull();
  });

  it("keeps restored plan review actions visible below scrollable plan content", () => {
    const css = readFileSync("src/renderer/styles/dialogue.css", "utf8");
    const cardRule = css.match(/\.plan-review-card\s*\{[^}]*\}/s)?.[0] ?? "";
    const bodyRule = css.match(/\.plan-review-card-body\s*\{[^}]*\}/s)?.[0] ?? "";
    const markdownRule = css.match(/\.plan-review-markdown\s*\{[^}]*\}/s)?.[0] ?? "";
    const promptRule = css.match(/\.plan-execution-prompt\s*\{[^}]*\}/s)?.[0] ?? "";
    const actionsRule = css.match(/\.plan-review-actions-panel\s*\{[^}]*\}/s)?.[0] ?? "";
    const composerRule = css.match(/\.plan-review-composer\s*\{[^}]*\}/s)?.[0] ?? "";
    const optionRowRule = css.match(/\.plan-review-option-row\s*\{[^}]*\}/s)?.[0] ?? "";
    const composerRowRule = css.match(/\.plan-review-composer-row\s*\{[^}]*\}/s)?.[0] ?? "";
    const approveRule = css.match(/\.plan-review-approve\s*\{[^}]*\}/s)?.[0] ?? "";
    const cancelRule = css.match(/\.plan-review-cancel\s*\{[^}]*\}/s)?.[0] ?? "";
    const chinRule = css.match(/\.plan-review-expand-chin\s*\{[^}]*\}/s)?.[0] ?? "";
    const expandedCardRule = css.match(/\.plan-review-card\.is-expanded\s*\{[^}]*\}/s)?.[0] ?? "";
    const expandedBodyRule = css.match(/\.plan-review-card\.is-expanded\s+\.plan-review-card-body\s*\{[^}]*\}/s)?.[0] ?? "";
    const chinHoverRule = css.match(/\.plan-review-expand-chin:hover[^{]*\{[^}]*\}/s)?.[0] ?? "";

    expect(cardRule).toContain("align-self: flex-start;");
    expect(cardRule).not.toContain("align-self: center;");
    expect(cardRule).toContain("flex: 0 0 auto;");
    expect(cardRule).toContain("display: grid;");
    expect(cardRule).toContain("grid-template-rows: auto minmax(0, 1fr) auto;");
    expect(cardRule).toContain("max-height: calc(100vh - 260px);");
    expect(bodyRule).toContain("min-height: 0;");
    expect(bodyRule).toContain("overflow-y: auto;");
    expect(markdownRule).not.toContain("max-height:");
    expect(markdownRule).not.toContain("overflow-y:");
    expect(promptRule).not.toContain("max-height:");
    expect(promptRule).not.toContain("overflow-y:");
    expect(actionsRule).toContain("position: relative;");
    expect(actionsRule).not.toContain("grid-row:");
    expect(actionsRule).not.toContain("border-top:");
    expect(actionsRule).toContain("background: transparent;");
    expect(composerRule).toContain("width: min(100%, 980px);");
    expect(composerRule).toContain("box-shadow:");
    expect(optionRowRule).toContain("width: 100%;");
    expect(optionRowRule).toContain("justify-content: flex-start;");
    expect(composerRowRule).toContain("grid-template-columns: minmax(0, 1fr) auto auto;");
    expect(approveRule).not.toContain("grid-column: 1 / -1;");
    expect(approveRule).toContain("width: 100%;");
    expect(approveRule).toContain("border-color: var(--n-primary) !important;");
    expect(approveRule).toContain("background: var(--n-primary) !important;");
    expect(approveRule).toContain("color: var(--n-on-primary) !important;");
    expect(cancelRule).not.toContain("grid-column: 1 / -1;");
    expect(cancelRule).toContain("justify-self: end;");
    expect(chinRule).toContain("width: 100%;");
    expect(chinRule).not.toContain("position: absolute;");
    expect(chinRule).not.toContain("transform:");
    expect(chinHoverRule).toContain("background:");
    expect(expandedCardRule).toContain("display: block;");
    expect(expandedCardRule).toContain("max-height: none;");
    expect(expandedCardRule).toContain("min-height: 0;");
    expect(expandedCardRule).not.toContain("grid-template-rows:");
    expect(expandedCardRule).toContain("overflow: hidden;");
    expect(expandedBodyRule).toContain("display: block;");
    expect(expandedBodyRule).toContain("height: auto;");
    expect(expandedBodyRule).toContain("max-height: none;");
    expect(expandedBodyRule).toContain("overflow: visible;");
  });

  it("Plan review cancel marks the task cancelled locally after bridge cancel succeeds", async () => {
    const onForceCancel = vi.fn();
    const task: DesktopTask = {
      id: "task-plan-cancel",
      conversationId: "task-plan-cancel",
      status: "plan_review",
      events: [],
      plan: {
        id: "plan-cancel",
        markdown: "# Proposed Plan\n\n- Review before execution.",
        revision: 1,
      },
    };
    render(<DialogueScreen {...baseProps({ onForceCancel })} tasks={[task]} />);

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() => expect(cancelSpy).toHaveBeenCalledWith("task-plan-cancel"));
    expect(onForceCancel).toHaveBeenCalledWith("task-plan-cancel");
  });

  it("Plan review revision input cancels with Escape to match the visible hint", async () => {
    const onForceCancel = vi.fn();
    const task: DesktopTask = {
      id: "task-plan-escape",
      conversationId: "task-plan-escape",
      status: "plan_review",
      events: [],
      plan: {
        id: "plan-escape",
        markdown: "# Proposed Plan\n\n- Review before execution.",
        revision: 1,
      },
    };
    render(<DialogueScreen {...baseProps({ onForceCancel })} tasks={[task]} />);

    fireEvent.keyDown(screen.getByPlaceholderText(/tell officedex/i), { key: "Escape" });

    await waitFor(() => expect(cancelSpy).toHaveBeenCalledWith("task-plan-escape"));
    expect(onForceCancel).toHaveBeenCalledWith("task-plan-escape");
  });

  it("Cancelled terminal tasks do not show bridge event context", () => {
    const task: DesktopTask = {
      id: "task-cancelled",
      conversationId: "task-cancelled",
      status: "cancelled",
      events: [
        { task_id: "task-cancelled", type: "task.started", ts: "2026-06-12T03:09:32Z", payload: {} },
        { task_id: "task-cancelled", type: "task.progress", ts: "2026-06-12T03:09:48Z", payload: { status: "waiting_input" } },
        { task_id: "task-cancelled", type: "task.cancelled", ts: "2026-06-12T03:10:00Z", payload: {} },
      ],
    };

    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    expect(screen.getByText("Task Cancelled")).toBeTruthy();
    expect(screen.queryByText("Bridge event context")).toBeNull();
    expect(screen.queryByText("task.started")).toBeNull();
  });

  it("shows one reviewed plan on terminal task history", () => {
    const task: DesktopTask = {
      id: "task-plan-history",
      conversationId: "task-plan-history",
      status: "completed",
      events: [{ task_id: "task-plan-history", type: "task.completed", ts: "2026-06-12T03:00:00Z", payload: { message: "done" } }],
      plan: {
        id: "plan-history",
        markdown: "# Reviewed Plan\n\n- Build the approved outline.",
        revision: 2,
        executionPrompt: "Execute the reviewed plan.",
      },
    };
    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    expect(document.querySelectorAll(".history-plan-details")).toHaveLength(1);
    expect(screen.getByText("View reviewed plan")).toBeTruthy();
    expect(screen.getByText("Execution prompt")).toBeTruthy();
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
        filePath: "/tmp/render-banner.png",
        fileName: "render-banner.png",
        documentType: "img",
      },
    };
    render(<DialogueScreen {...baseProps()} tasks={[task]} />);
    expect(screen.getByText("Generation Complete")).toBeTruthy();
    expect(screen.getAllByText("render-banner.png").length).toBeGreaterThan(0);
    const openButtons = screen.getAllByRole("button", { name: /open/i });
    expect(openButtons.length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /show in folder/i })).toBeTruthy();
  });

  it("shows paid users that image watermarks can be disabled in Settings", () => {
    const task = makeCompletedImageTask({
      imageWatermark: { applied: true, paidEntitlement: true, canDisable: true },
    });
    render(<DialogueScreen {...baseProps()} tasks={[task]} />);
    expect(screen.getByText(/You're a paid user/i)).toBeTruthy();
    expect(screen.getByText(/turn off the image watermark in Settings/i)).toBeTruthy();
  });

  it("shows unpaid users that buying any credits unlocks watermark control", () => {
    const task = makeCompletedImageTask({
      imageWatermark: { applied: true, paidEntitlement: false, canDisable: false },
    });
    render(<DialogueScreen {...baseProps()} tasks={[task]} />);
    expect(screen.getByText(/This image includes an OfficeDex watermark/i)).toBeTruthy();
    expect(screen.getByText(/Buy any amount of credits/i)).toBeTruthy();
  });

  it("keeps more actions directly beside Show in folder on completed image cards", () => {
    const task = makeCompletedImageTask({
      events: [{ task_id: "task-img", type: "task.completed", request_id: "req-img-1", payload: { message: "done" } }],
    });
    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    const showInFolder = screen.getByRole("button", { name: /show in folder/i });
    const moreActions = screen.getByRole("button", { name: /more actions/i });
    const fileActions = showInFolder.closest(".result-image-file-actions");

    expect(fileActions).toBeTruthy();
    expect(fileActions?.contains(moreActions)).toBe(true);
  });

  it("renders completed image actions in a compact single-row toolbar", () => {
    const task = makeCompletedImageTask({
      events: [{ task_id: "task-img", type: "task.completed", request_id: "req-img-1", payload: { message: "done" } }],
    });
    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    const continueEditing = screen.getByRole("button", { name: /continue editing/i });
    const actions = continueEditing.closest(".result-image-actions");

    expect(actions).toBeTruthy();
    expect(actions?.classList.contains("result-image-actions-single-row")).toBe(true);
    const buttons = within(actions as HTMLElement).getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label") || button.textContent?.trim())).toEqual([
      "Open",
      "Continue editing",
      "Show in folder",
      "More actions",
    ]);
    const openButton = within(actions as HTMLElement).getByRole("button", { name: /^open$/i });
    expect(openButton.dataset.variant === "primary").toBe(false);
    expect(within(actions as HTMLElement).getByRole("button", { name: /show in folder/i })).toBeTruthy();
    expect(within(actions as HTMLElement).getByRole("button", { name: /more actions/i })).toBeTruthy();
  });

  it("submits a completed image task and private template for public review", async () => {
    listImageTemplatesSpy.mockResolvedValueOnce([
      { id: 7, slug: "public-poster", title: "Public Poster", description: "", promptPreset: "Public prompt", sortOrder: 0, enabled: true, visibility: "platform_public" },
      { id: 17, slug: "my-poster", title: "My Poster", description: "", promptPreset: "Generated prompt", sortOrder: 0, enabled: true, visibility: "user_private" },
    ]);
    const task = makeCompletedImageTask({
      events: [{ task_id: "task-img", type: "task.completed", request_id: "req-img-1", payload: { message: "done" } }],
    });
    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    expect(screen.queryByRole("button", { name: /submit template for review/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /submit template for review/i }));
    expect(await screen.findByText("Publish as public template")).toBeTruthy();
    fireEvent.change(await screen.findByRole("combobox", { name: "Private template" }), { target: { value: "17" } });
    fireEvent.click(screen.getByRole("button", { name: /^Submit for review$/i }));

    await waitFor(() => expect(createImageTemplatePublishRequestSpy).toHaveBeenCalledWith({
      privateTemplateID: 17,
      requestID: "req-img-1",
      submitterNote: "",
    }));
    expect(antdMessage.success).toHaveBeenCalledWith("Submitted for review");
  });

  it("copies generated images through the desktop clipboard bridge", async () => {
    render(<DialogueScreen {...baseProps()} tasks={[makeCompletedImageTask()]} />);

    await waitFor(() => expect(issuePreviewTokenSpy).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByAltText("banner.png"));
    fireEvent.click(await screen.findByRole("button", { name: /copy image/i }));

    await waitFor(() => expect(copyImageToClipboardSpy).toHaveBeenCalledWith("/tmp/banner.png"));
    expect(await screen.findByText("Copied")).toBeTruthy();
    expect(antdMessage.success).toHaveBeenCalledWith("Copied");
  });

  it("shows top error feedback when generated image copy fails", async () => {
    copyImageToClipboardSpy.mockRejectedValueOnce(new Error("native clipboard failed"));
    render(<DialogueScreen {...baseProps()} tasks={[makeCompletedImageTask()]} />);

    await waitFor(() => expect(issuePreviewTokenSpy).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByAltText("banner.png"));
    fireEvent.click(await screen.findByRole("button", { name: /copy image/i }));

    await waitFor(() => expect(antdMessage.error).toHaveBeenCalledWith("Copy failed"));
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

  it("copies the user message prompt from the conversation bubble", async () => {
    const task: DesktopTask = {
      id: "task-user-copy",
      conversationId: "task-user-copy",
      status: "completed",
      events: [{ task_id: "task-user-copy", type: "task.completed", payload: { message: "done" } }],
      userInput: { prompt: "Build a quarterly planning deck" },
    };
    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    fireEvent.click(screen.getByRole("button", { name: /copy user message/i }));

    await waitFor(() => expect(writeTextSpy).toHaveBeenCalledWith("Build a quarterly planning deck"));
    expect(antdMessage.success).toHaveBeenCalledWith("Copied");
  });

  it("shows top error feedback when conversation bubble copy fails", async () => {
    writeTextSpy.mockRejectedValueOnce(new Error("clipboard denied"));
    const task: DesktopTask = {
      id: "task-user-copy-fail",
      conversationId: "task-user-copy-fail",
      status: "completed",
      events: [{ task_id: "task-user-copy-fail", type: "task.completed", payload: { message: "done" } }],
      userInput: { prompt: "Build a quarterly planning deck" },
    };
    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    fireEvent.click(screen.getByRole("button", { name: /copy user message/i }));

    await waitFor(() => expect(antdMessage.error).toHaveBeenCalledWith("Copy failed"));
  });

  it("copies the assistant result message from the conversation bubble", async () => {
    const task: DesktopTask = {
      id: "task-ai-copy",
      conversationId: "task-ai-copy",
      status: "completed",
      events: [{ task_id: "task-ai-copy", type: "task.completed", payload: { message: "Deck generated successfully" } }],
    };
    render(<DialogueScreen {...baseProps()} tasks={[task]} />);

    fireEvent.click(screen.getByRole("button", { name: /copy assistant message/i }));

    await waitFor(() => expect(writeTextSpy).toHaveBeenCalledWith("Deck generated successfully"));
    expect(antdMessage.success).toHaveBeenCalledWith("Copied");
  });

  it("image generation inserts template prompt and submits edited prompt only", async () => {
    listImageTemplatesSpy.mockResolvedValueOnce([
      { id: 7, slug: "poster", title: "Poster", description: "Cinematic poster", promptPreset: "Template prompt: replace PRODUCT", thumbnailUrl: "/api/image-templates/7/thumbnail", sortOrder: 10, enabled: true },
    ]);
    const onSubmit = vi.fn(async (_values: GenerateInput) => undefined);
    render(<DialogueScreen {...baseProps({ onSubmit })} newGenerationDraft={{ documentType: "img", topic: "", prompt: "" }} />);

    expect(await screen.findByText("Poster")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Poster/i }));
    const textarea = screen.getByPlaceholderText(/Enter what you want to generate/i);
    const picker = document.querySelector(".image-template-picker");
    expect(picker).toBeTruthy();
    expect(Boolean(picker!.compareDocumentPosition(textarea) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect((textarea as HTMLTextAreaElement).value).toBe("Template prompt: replace PRODUCT");
    expect(screen.getByText(/Template text has been inserted/i)).toBeTruthy();
    fireEvent.change(textarea, { target: { value: "A red bicycle" } });
    fireEvent.submit(textarea.closest("form")!);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const submitted = onSubmit.mock.calls[0][0];
    expect(submitted).toEqual(expect.objectContaining({ documentType: "img", prompt: "A red bicycle" }));
    expect(submitted).not.toHaveProperty("promptTemplateId");
  });

  it("aggregates and filters image templates by one tag", async () => {
    listImageTemplatesSpy.mockResolvedValueOnce([
      { id: 1, slug: "hero", title: "Hero", description: "", promptPreset: "hero", sortOrder: 1, enabled: true, tags: ["Ecommerce", "Studio"] },
      { id: 2, slug: "macro", title: "Macro", description: "", promptPreset: "macro", sortOrder: 2, enabled: true, tags: ["studio", "Product Detail"] },
      { id: 3, slug: "ugc", title: "UGC", description: "", promptPreset: "ugc", sortOrder: 3, enabled: true, tags: ["Social Media"] },
    ]);
    render(<DialogueScreen {...baseProps()} newGenerationDraft={{ documentType: "img", topic: "", prompt: "" }} />);

    expect(await screen.findByRole("button", { name: /All.*3/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Studio.*2/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Studio.*2/i }));
    expect(screen.getByText("Hero")).toBeTruthy();
    expect(screen.getByText("Macro")).toBeTruthy();
    expect(screen.queryByText("UGC")).toBeNull();
  });

  it("uses compact tag chips without a visible native horizontal scrollbar", () => {
    const css = readFileSync("src/renderer/styles/dialogue.css", "utf8");
    const rowRule = css.match(/\.image-template-tag-filters\s*\{[^}]*\}/s)?.[0] ?? "";
    const chipRule = css.match(/\.image-template-tag-filters button\s*\{[^}]*\}/s)?.[0] ?? "";
    const countRule = css.match(/\.image-template-tag-filters button b\s*\{[^}]*\}/s)?.[0] ?? "";
    const interactiveCountRule = css.match(/\.image-template-tag-filters button:hover b,\s*\.image-template-tag-filters button\.is-selected b\s*\{[^}]*\}/s)?.[0] ?? "";
    const webkitScrollbarRule = css.match(/\.image-template-tag-filters::\-webkit-scrollbar\s*\{[^}]*\}/s)?.[0] ?? "";

    expect(rowRule).toContain("overflow-x: auto;");
    expect(rowRule).toContain("scrollbar-width: none;");
    expect(rowRule).toContain("-webkit-overflow-scrolling: touch;");
    expect(chipRule).toContain("min-height: 26px;");
    expect(chipRule).toContain("gap: 4px;");
    expect(chipRule).toContain("padding: 2px 8px;");
    expect(chipRule).toContain("font-size: 12px;");
    expect(chipRule).toContain("font-weight: 500;");
    expect(chipRule).toContain("line-height: 1.2;");
    expect(countRule).toContain("color: var(--n-muted);");
    expect(countRule).toContain("font-size: 10px;");
    expect(countRule).toContain("font-weight: 500;");
    expect(interactiveCountRule).toContain("color: inherit;");
    expect(webkitScrollbarRule).toContain("display: none;");
  });

  it("keeps the selected template and edited prompt when the tag filter changes", async () => {
    listImageTemplatesSpy.mockResolvedValueOnce([
      { id: 1, slug: "hero", title: "Hero", description: "", promptPreset: "hero", sortOrder: 1, enabled: true, tags: ["Studio"] },
      { id: 2, slug: "ugc", title: "UGC", description: "", promptPreset: "ugc", sortOrder: 2, enabled: true, tags: ["Social Media"] },
    ]);
    render(<DialogueScreen {...baseProps()} newGenerationDraft={{ documentType: "img", topic: "", prompt: "" }} />);

    fireEvent.click(await screen.findByRole("button", { name: /^Hero$/i }));
    const textarea = screen.getByPlaceholderText(/Enter what you want to generate/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "edited prompt" } });
    fireEvent.click(screen.getByRole("button", { name: /Social Media.*1/i }));
    expect(textarea.value).toBe("edited prompt");
    expect(screen.getByText(/Template text has been inserted/i)).toBeTruthy();
  });

  it("returns to All when refresh removes the selected tag", async () => {
    listImageTemplatesSpy
      .mockResolvedValueOnce([
        { id: 1, slug: "hero", title: "Hero", description: "", promptPreset: "hero", sortOrder: 1, enabled: true, tags: ["Studio"] },
      ])
      .mockResolvedValueOnce([
        { id: 2, slug: "ugc", title: "UGC", description: "", promptPreset: "ugc", sortOrder: 2, enabled: true, tags: ["Social Media"] },
      ]);
    render(<DialogueScreen {...baseProps()} newGenerationDraft={{ documentType: "img", topic: "", prompt: "" }} />);

    fireEvent.click(await screen.findByRole("button", { name: /Studio.*1/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Refresh$/i }));

    expect(await screen.findByText("UGC")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("button", { name: /All.*1/i })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.queryByRole("button", { name: /Studio.*1/i })).toBeNull();
  });

  it("keeps dropped reference images when submitting an image template", async () => {
    listImageTemplatesSpy.mockResolvedValueOnce([
      { id: 7, slug: "poster", title: "Poster", description: "Cinematic poster", promptPreset: "Template prompt: replace PRODUCT", thumbnailUrl: "/api/image-templates/7/thumbnail", sortOrder: 10, enabled: true },
    ]);
    const onSubmit = vi.fn(async (_values: GenerateInput) => undefined);
    render(<DialogueScreen {...baseProps({ onSubmit })} newGenerationDraft={{ documentType: "img", topic: "", prompt: "" }} />);

    expect(await screen.findByText("Poster")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Poster/i }));
    expect(screen.queryByRole("button", { name: /Attach reference images/i })).toBeNull();
    await waitFor(() => expect((screen.getByPlaceholderText(/Enter what you want to generate/i) as HTMLTextAreaElement).value).toBe("Template prompt: replace PRODUCT"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const dropTarget = document.querySelector(".fluid-new-task") as HTMLElement;
    const form = document.querySelector(".fluid-command-bar") as HTMLFormElement;
    const droppedFile = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "reference.png", { type: "image/png" });
    fireDropWithFile(dropTarget, droppedFile);

    await waitFor(() => expect(savePastedImageSpy).toHaveBeenCalledWith(expect.any(Uint8Array), "png"));

    const textarea = screen.getByPlaceholderText(/Enter what you want to generate/i);
    fireEvent.change(textarea, { target: { value: "A red bicycle using the reference image" } });
    fireEvent.submit(form);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toEqual(expect.objectContaining({
      documentType: "img",
      prompt: "A red bicycle using the reference image",
      referenceImages: ["/tmp/dropped-template-reference.png"],
    }));
  });

  it("prepends enabled local image templates before platform templates", async () => {
    localStorage.setItem("officedex:local-image-templates", JSON.stringify({
      version: 1,
      templates: [
        { slug: "local-admission", title: "Local Admission", description: "Stored locally", promptPreset: "Local prompt", enabled: true },
        { slug: "disabled-local", title: "Disabled Local", description: "", promptPreset: "Disabled prompt", enabled: false },
      ],
    }));
    listImageTemplatesSpy.mockResolvedValueOnce([
      { id: 7, slug: "poster", title: "Poster", description: "Cinematic poster", promptPreset: "Platform prompt", thumbnailUrl: "/api/image-templates/7/thumbnail", sortOrder: 10, enabled: true, visibility: "platform_public" },
    ]);

    render(<DialogueScreen {...baseProps()} newGenerationDraft={{ documentType: "img", topic: "", prompt: "" }} />);

    const localTitle = await screen.findByText("Local Admission");
    const platformTitle = await screen.findByText("Poster");
    expect(Boolean(localTitle.compareDocumentPosition(platformTitle) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(screen.queryByLabelText("Local")).toBeNull();
    expect(screen.queryByText("Disabled Local")).toBeNull();
  });

  it("shows image-template wall cards with only thumbnails and titles", async () => {
    listImageTemplatesSpy.mockResolvedValueOnce([
      { id: 7, slug: "public-poster", title: "Public Poster", description: "Cinematic poster", promptPreset: "Public prompt", thumbnailUrl: "/api/image-templates/7/thumbnail", sortOrder: 10, enabled: true, visibility: "platform_public" },
      { id: 8, slug: "private-poster", title: "Private Poster", description: "Private poster", promptPreset: "Private prompt", thumbnailUrl: "/api/image-templates/8/thumbnail", sortOrder: 20, enabled: true, visibility: "user_private" },
    ]);

    render(<DialogueScreen {...baseProps()} newGenerationDraft={{ documentType: "img", topic: "", prompt: "" }} />);

    expect(await screen.findByText("Public Poster")).toBeTruthy();
    expect(screen.getByText("Private Poster")).toBeTruthy();
    expect(screen.queryByText("Public")).toBeNull();
    expect(screen.queryByText("My template")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Copy to my templates$/i })).toBeNull();
    expect(screen.queryByLabelText("Public")).toBeNull();
    expect(screen.queryByLabelText("My template")).toBeNull();
    expect(screen.queryByText("Cinematic poster")).toBeNull();
    expect(screen.queryByText("Private poster")).toBeNull();
    expect(document.querySelectorAll(".image-template-card-title")).toHaveLength(2);
    expect((document.querySelector(".image-template-thumb img") as HTMLImageElement).style.objectFit).toBe("");

    const css = readFileSync("src/renderer/styles/dialogue.css", "utf8");
    const thumbImgRule = css.match(/\.image-template-thumb img\s*\{[^}]*\}/s)?.[0] ?? "";
    const workspaceCardRule = css.match(/\.image-template-workspace \.image-template-card\s*\{[^}]*\}/s)?.[0] ?? "";
    const cardMainRule = css.match(/\.image-template-card-main\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(thumbImgRule).toContain("height: auto;");
    expect(thumbImgRule).not.toContain("height: 100%");
    expect(workspaceCardRule).toContain("align-self: start;");
    expect(cardMainRule).toContain("align-content: start;");
    expect(css).not.toMatch(/\.image-template-workspace \.image-template-card:nth-child\([^)]*\) \.image-template-thumb\s*\{[^}]*aspect-ratio:/s);
  });

  it("shows a polished placeholder for local image templates without thumbnails", async () => {
    localStorage.setItem("officedex:local-image-templates", JSON.stringify({
      version: 1,
      templates: [
        { slug: "local-admission", title: "Local Admission", description: "Stored locally", promptPreset: "Local prompt", enabled: true },
      ],
    }));
    listImageTemplatesSpy.mockResolvedValueOnce([]);

    render(<DialogueScreen {...baseProps()} newGenerationDraft={{ documentType: "img", topic: "", prompt: "" }} />);

    expect(await screen.findByText("Local Admission")).toBeTruthy();
    const placeholder = document.querySelector(".image-template-thumb-placeholder");
    expect(placeholder).toBeTruthy();
    expect(placeholder?.querySelector(".material-symbol")).toBeNull();
    expect(document.querySelector(".image-template-thumb img")).toBeNull();
  });

  it("does not show local template management controls in the photo wall", async () => {
    localStorage.setItem("officedex:local-image-templates", JSON.stringify({
      version: 1,
      templates: [
        { slug: "local-admission", title: "Local Admission", description: "Stored locally", promptPreset: "Local prompt", enabled: true },
        { slug: "local-poster", title: "Local Poster", description: "", promptPreset: "Poster prompt", enabled: true },
      ],
    }));
    listImageTemplatesSpy.mockResolvedValueOnce([
      { id: 7, slug: "poster", title: "Poster", description: "Cinematic poster", promptPreset: "Platform prompt", thumbnailUrl: "/api/image-templates/7/thumbnail", sortOrder: 10, enabled: true, visibility: "platform_public" },
    ]);

    render(<DialogueScreen {...baseProps()} newGenerationDraft={{ documentType: "img", topic: "", prompt: "" }} />);

    expect(await screen.findByText("Local Admission")).toBeTruthy();
    expect(screen.getByText("Local Poster")).toBeTruthy();
    expect(screen.getByText("Poster")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Delete local template Local Admission$/i })).toBeNull();
    expect(screen.queryByText("Stored locally")).toBeNull();
    expect(listImageTemplatesSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem("officedex:local-image-templates") ?? "{}").templates).toHaveLength(2);
  });

  it("replaces failed image-template thumbnails with the same placeholder", async () => {
    listImageTemplatesSpy.mockResolvedValueOnce([
      { id: 7, slug: "poster", title: "Poster", description: "Cinematic poster", promptPreset: "Template prompt", thumbnailUrl: "/missing-thumbnail.png", sortOrder: 10, enabled: true },
    ]);

    render(<DialogueScreen {...baseProps()} newGenerationDraft={{ documentType: "img", topic: "", prompt: "" }} />);

    expect(await screen.findByText("Poster")).toBeTruthy();
    const image = document.querySelector(".image-template-thumb img") as HTMLImageElement;
    expect(image).toBeTruthy();
    fireEvent.error(image);
    await waitFor(() => {
      expect(document.querySelector(".image-template-thumb-placeholder")).toBeTruthy();
      expect(document.querySelector(".image-template-thumb img")).toBeNull();
    });
  });

  it("keeps local image-template management out of the picker", async () => {
    listImageTemplatesSpy.mockResolvedValue([]);
    render(<DialogueScreen {...baseProps()} newGenerationDraft={{ documentType: "img", topic: "", prompt: "" }} />);

    expect(await screen.findByText(/No image templates are configured yet/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Import JSON/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Export JSON/i })).toBeNull();
    expect(document.querySelector(".image-template-file-input")).toBeNull();
  });

  it("submits the selected image ratio for new image generation only", async () => {
    const onSubmit = vi.fn(async (_values: GenerateInput) => undefined);
    render(<DialogueScreen {...baseProps({ onSubmit })} newGenerationDraft={{ documentType: "img", topic: "", prompt: "", imageRatio: "square" }} />);

    expect(screen.getByText("Image ratio")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Landscape"));
    fireEvent.change(screen.getByPlaceholderText(/Enter what you want to generate/i), {
      target: { value: "A launch banner" },
    });
    fireEvent.submit(screen.getByPlaceholderText(/Enter what you want to generate/i).closest("form")!);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toEqual(expect.objectContaining({
      documentType: "img",
      prompt: "A launch banner",
      imageRatio: "landscape",
    }));
  });

  it("does not submit imageRatio for non-image generation", async () => {
    const onSubmit = vi.fn(async (_values: GenerateInput) => undefined);
    render(<DialogueScreen {...baseProps({ onSubmit })} newGenerationDraft={{ documentType: "pptx", topic: "", prompt: "", imageRatio: "portrait" }} />);

    expect(screen.queryByText("Image ratio")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText(/Enter what you want to generate/i), {
      target: { value: "Build a deck" },
    });
    fireEvent.submit(screen.getByPlaceholderText(/Enter what you want to generate/i).closest("form")!);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toEqual(expect.objectContaining({ documentType: "pptx", prompt: "Build a deck", generationMode: "plan" }));
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("imageRatio");
  });

  it("keeps the non-image new generation composer fixed to the bottom", () => {
    const css = readFileSync("src/renderer/styles/dialogue.css", "utf8");
    const startRule = css.match(/\.fluid-new-task:not\(\.image-template-workspace\)\s+\.fluid-start-card\s*\{[^}]*\}/s)?.[0] ?? "";
    const footerRule = css.match(/\.fluid-new-task:not\(\.image-template-workspace\)\s+\.fluid-command-footer\s*\{[^}]*\}/s)?.[0] ?? "";

    expect(startRule).toContain("flex: 1 1 auto;");
    expect(startRule).toContain("align-content: center;");
    expect(footerRule).toContain("position: sticky;");
    expect(footerRule).toContain("bottom: 0;");
    expect(footerRule).toContain("flex: 0 0 auto;");
  });

  it("keeps the non-image start content scrollable above the fixed composer on mobile", () => {
    const css = readFileSync("src/renderer/styles/dialogue.css", "utf8");
    const mobileStartRule = css.match(/@media \(max-width: 760px\)[\s\S]*?\.fluid-new-task:not\(\.image-template-workspace\)\s+\.fluid-start-card\s*\{[^}]*\}/s)?.[0] ?? "";

    expect(mobileStartRule).toContain("align-content: start;");
    expect(mobileStartRule).toContain("overflow-y: auto;");
  });

  it("shows GIF in new generation and submits fps for GIF drafts", async () => {
    const onSubmit = vi.fn(async (_values: GenerateInput) => undefined);
    render(<DialogueScreen {...baseProps({ onSubmit })} newGenerationDraft={{ documentType: "gif", topic: "", prompt: "", fps: 16 }} />);

    expect(screen.getByText("GIF")).toBeTruthy();
    expect(screen.getByText("GIF FPS")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/Enter what you want to generate/i), {
      target: { value: "Make a launch animation" },
    });
    fireEvent.submit(screen.getByPlaceholderText(/Enter what you want to generate/i).closest("form")!);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toEqual(expect.objectContaining({
      documentType: "gif",
      prompt: "Make a launch animation",
      fps: 16,
    }));
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("imageRatio");
  });

  it("hides generation mode and submits plan generationMode without runtimeMode", async () => {
    const onSubmit = vi.fn(async (_values: GenerateInput) => undefined);
    render(<DialogueScreen {...baseProps({ onSubmit })} newGenerationDraft={{ documentType: "docx", topic: "", prompt: "", generationMode: "fast" }} />);

    expect(screen.queryByText(/^Mode$/)).toBeNull();
    expect(screen.queryByRole("radio", { name: "Fast" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Plan" })).toBeNull();
    fireEvent.change(screen.getByPlaceholderText(/Enter what you want to generate/i), {
      target: { value: "Write a plan-mode document" },
    });
    fireEvent.submit(screen.getByPlaceholderText(/Enter what you want to generate/i).closest("form")!);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toEqual(expect.objectContaining({
      documentType: "docx",
      prompt: "Write a plan-mode document",
      generationMode: "plan",
    }));
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("runtimeMode");
  });

  it("image generation confirms before replacing an existing prompt with a template", async () => {
    listImageTemplatesSpy.mockResolvedValueOnce([
      { id: 7, slug: "poster", title: "Poster", description: "Cinematic poster", promptPreset: "Template prompt: replace PRODUCT", thumbnailUrl: "/api/image-templates/7/thumbnail", sortOrder: 10, enabled: true },
    ]);
    render(<DialogueScreen {...baseProps()} newGenerationDraft={{ documentType: "img", topic: "", prompt: "Existing prompt" }} />);

    expect(await screen.findByText("Poster")).toBeTruthy();
    const textarea = screen.getByPlaceholderText(/Enter what you want to generate/i);
    expect((textarea as HTMLTextAreaElement).value).toBe("Existing prompt");

    fireEvent.click(screen.getByRole("button", { name: /Poster/i }));
    expect((await screen.findAllByText("Replace current prompt?")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/i }));
    await waitFor(() => expect(screen.queryAllByText("Replace current prompt?")).toHaveLength(0));
    expect((textarea as HTMLTextAreaElement).value).toBe("Existing prompt");
    expect(screen.queryByText(/Template text has been inserted/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Poster/i }));
    expect((await screen.findAllByText("Replace current prompt?")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /^Replace$/i }));
    await waitFor(() => expect((screen.getByPlaceholderText(/Enter what you want to generate/i) as HTMLTextAreaElement).value).toBe("Template prompt: replace PRODUCT"));
    expect(screen.getByText(/Template text has been inserted/i)).toBeTruthy();
  });

  it("image generation shows an empty state when no templates are configured", async () => {
    listImageTemplatesSpy.mockResolvedValueOnce([]);
    render(<DialogueScreen {...baseProps()} newGenerationDraft={{ documentType: "img", topic: "", prompt: "" }} />);

    expect(await screen.findByText(/No image templates are configured yet/i)).toBeTruthy();
  });

  it("replaces the start presets with the image template list when Image is selected", async () => {
    listImageTemplatesSpy.mockResolvedValueOnce([
      { id: 7, slug: "poster", title: "Poster", description: "Cinematic poster", promptPreset: "Template prompt", thumbnailUrl: "/api/image-templates/7/thumbnail", sortOrder: 10, enabled: true },
    ]);
    render(<DialogueScreen {...baseProps()} newGenerationDraft={{ documentType: "pptx", topic: "", prompt: "" }} />);

    expect(screen.getByText("Quarterly Analysis Report")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Image"));

    expect(await screen.findByText("Poster")).toBeTruthy();
    expect(screen.queryByText("Quarterly Analysis Report")).toBeNull();
    expect(screen.queryByText(/Choose a preset scenario/i)).toBeNull();
    expect(document.querySelectorAll(".image-template-picker")).toHaveLength(1);
    expect(document.querySelector(".fluid-start-card .image-template-picker")).toBeTruthy();
    expect(document.querySelector(".fluid-command-bar .image-template-picker")).toBeNull();
  });

  it("places a full-width scratch generation card before image templates", async () => {
    listImageTemplatesSpy.mockResolvedValueOnce([SLOTTED_TEMPLATE]);
    render(<DialogueScreen {...baseProps()} newGenerationDraft={{ documentType: "img", topic: "", prompt: "" }} />);

    const scratchCard = await screen.findByRole("button", { name: /Start from scratch/i });
    const picker = document.querySelector(".image-template-picker");
    const templateTitle = await screen.findByText("Promo");
    expect(picker?.firstElementChild).toBe(scratchCard);
    expect(Boolean(scratchCard.compareDocumentPosition(templateTitle) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(scratchCard.classList.contains("image-template-scratch-card")).toBe(true);
    expect(within(scratchCard).getByText("Blank prompt, no template constraints")).toBeTruthy();
    expect(within(scratchCard).getByText("Selected")).toBeTruthy();
    expect(screen.getByText("No reference images yet")).toBeTruthy();
    expect(screen.getByText("Output preview will appear here")).toBeTruthy();
    expect(document.querySelector(".image-template-reference-empty .image-template-reference-icon")).toBeTruthy();
    expect(document.querySelector(".image-template-reference-empty .image-template-reference-slots")).toBeNull();
    expect(screen.queryByText("Visual brief")).toBeNull();
    expect(screen.queryByText("Style notes")).toBeNull();
    expect(screen.queryByText("Negative prompt")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Add reference images$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Attach reference images/i })).toBeNull();
    expect(document.querySelector(".image-template-actions-footer .reference-image-upload-button")).toBeNull();
    expect(document.querySelector(".image-template-actions-footer .material-symbol")).toBeNull();

    const css = readFileSync("src/renderer/styles/dialogue.css", "utf8");
    const pickerRule = css.match(/\.image-template-workspace \.image-template-picker\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(pickerRule).toContain("padding-top: 1px;");

    fireEvent.click(screen.getByRole("button", { name: /Promo/i }));
    expect(document.querySelector(".image-template-form-title")?.textContent).toBe("What should we work on?");
    expect(screen.getByText("Fill in the template")).toBeTruthy();
    expect(screen.queryByText("No reference images yet")).toBeNull();

    const selectedSummary = document.querySelector(".image-template-selected-template-card") as HTMLElement;
    const templateComposer = document.querySelector(".image-template-template-composer");
    expect(selectedSummary).toBeTruthy();
    expect(templateComposer?.contains(selectedSummary)).toBe(true);
    expect(within(selectedSummary).getByText("Promo")).toBeTruthy();
    expect(within(selectedSummary).getByText("Template selected from the left. The form below can grow without pushing the footer away.")).toBeTruthy();
    expect(document.querySelector(".image-template-template-form-scroll")?.contains(document.querySelector(".template-slot-form"))).toBe(true);

    fireEvent.click(within(selectedSummary).getByRole("button", { name: /Start from scratch/i }));
    expect(document.querySelector(".image-template-form-title")?.textContent).toBe("What should we work on?");
    expect(screen.queryByText("Fill in the template")).toBeNull();
    expect(screen.getByText("No reference images yet")).toBeTruthy();
    expect((screen.getByPlaceholderText(/Enter what you want to generate/i) as HTMLTextAreaElement).value).toBe("");
  });

  it("accepts dropped reference images on the scratch reference drop zone", async () => {
    const onDraftChange = vi.fn();
    render(<DialogueScreen {...baseProps({ onNewGenerationDraftChange: onDraftChange })} newGenerationDraft={{ documentType: "img", topic: "", prompt: "" }} />);

    const dropZone = await screen.findByRole("region", { name: /Drop reference images/i });
    const droppedFile = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "reference.png", { type: "image/png" });

    fireEvent.dragOver(dropZone, {
      dataTransfer: {
        files: [droppedFile],
        items: [],
        types: ["Files"],
        dropEffect: "copy",
      },
    });

    expect(dropZone.classList.contains("image-template-reference-drop-zone-active")).toBe(true);

    fireEvent.drop(dropZone, {
      dataTransfer: {
        files: [droppedFile],
        items: [],
        types: ["Files"],
        dropEffect: "copy",
      },
    });

    await waitFor(() => expect(savePastedImageSpy).toHaveBeenCalledWith(expect.any(Uint8Array), "png"));
    expect(onDraftChange).toHaveBeenCalledWith({ sourceFile: undefined, referenceImages: ["/tmp/dropped-template-reference.png"] });
  });

  it("accepts pasted reference images directly on the scratch reference drop zone", async () => {
    const onDraftChange = vi.fn();
    render(<DialogueScreen {...baseProps({ onNewGenerationDraftChange: onDraftChange })} newGenerationDraft={{ documentType: "img", topic: "", prompt: "" }} />);

    const dropZone = await screen.findByRole("region", { name: /Drop reference images/i });
    const pastedFile = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "clipboard.png", { type: "image/png" });
    firePasteWithFile(dropZone, pastedFile);

    await waitFor(() => expect(savePastedImageSpy).toHaveBeenCalledWith(expect.any(Uint8Array), "png"));
    expect(onDraftChange).toHaveBeenCalledWith({ sourceFile: undefined, referenceImages: ["/tmp/dropped-template-reference.png"] });
  });

  it("shows a release hint when file drags do not expose files before drop", async () => {
    render(<DialogueScreen {...baseProps()} newGenerationDraft={{ documentType: "img", topic: "", prompt: "" }} />);

    const dropZone = await screen.findByRole("region", { name: /Drop reference images/i });
    fireEvent.dragOver(dropZone, {
      dataTransfer: {
        files: [],
        items: [],
        types: ["Files"],
        dropEffect: "copy",
      },
    });

    expect(dropZone.classList.contains("image-template-reference-drop-zone-active")).toBe(true);
    expect(screen.getByText("Release to add reference images")).toBeTruthy();
  });

  it("clears the release hint after a Wails native file drop completes", async () => {
    const onDraftChange = vi.fn();
    render(<DialogueScreen {...baseProps({ onNewGenerationDraftChange: onDraftChange })} newGenerationDraft={{ documentType: "img", topic: "", prompt: "" }} />);

    const dropZone = await screen.findByRole("region", { name: /Drop reference images/i });
    fireEvent.dragOver(dropZone, {
      dataTransfer: {
        files: [],
        items: [],
        types: ["Files"],
        dropEffect: "copy",
      },
    });
    expect(screen.getByText("Release to add reference images")).toBeTruthy();

    act(() => {
      fileDropCallback?.(["/tmp/reference.png"]);
    });

    await waitFor(() => expect(screen.queryByText("Release to add reference images")).toBeNull());
    expect(dropZone.classList.contains("image-template-reference-drop-zone-active")).toBe(false);
    expect(onDraftChange).toHaveBeenCalledWith({ sourceFile: undefined, referenceImages: ["/tmp/reference.png"] });
  });

  it("renders dropped reference image paths as thumbnails after the draft updates", async () => {
    const onDraftChange = vi.fn();
    const { rerender } = render(
      <DialogueScreen {...baseProps({ onNewGenerationDraftChange: onDraftChange })} newGenerationDraft={{ documentType: "img", topic: "", prompt: "" }} />,
    );

    await screen.findByRole("region", { name: /Drop reference images/i });
    act(() => {
      fileDropCallback?.(["/tmp/reference.png"]);
    });
    await waitFor(() => expect(onDraftChange).toHaveBeenCalledWith({ sourceFile: undefined, referenceImages: ["/tmp/reference.png"] }));

    rerender(
      <DialogueScreen
        {...baseProps({ onNewGenerationDraftChange: onDraftChange })}
        newGenerationDraft={{ documentType: "img", topic: "", prompt: "", referenceImages: ["/tmp/reference.png"] }}
      />,
    );

    await waitFor(() => expect(readLocalImageSpy).toHaveBeenCalledWith("/tmp/reference.png"));
    expect(await screen.findByRole("img", { name: "reference.png" })).toBeTruthy();
  });

  it("labels added reference image cards with a semantic panel header and card badges", async () => {
    const maxCount = getAttachmentSpec("img", "referenceImages")?.maxCount ?? 6;
    render(
      <DialogueScreen
        {...baseProps()}
        newGenerationDraft={{
          documentType: "img",
          topic: "",
          prompt: "",
          referenceImages: ["/tmp/reference.png", "/tmp/style.png"],
        }}
      />,
    );

    expect(await screen.findByRole("img", { name: "reference.png" })).toBeTruthy();
    expect(screen.getByText("Reference images")).toBeTruthy();
    expect(screen.getByText(`2 / ${maxCount}`)).toBeTruthy();
    expect(screen.getByText("Used as style references")).toBeTruthy();
    expect(screen.getAllByText("Reference")).toHaveLength(2);
  });

  it("updates the reference image count and returns to the empty state after removals", async () => {
    const maxCount = getAttachmentSpec("img", "referenceImages")?.maxCount ?? 6;
    const onDraftChange = vi.fn();
    const { rerender } = render(
      <DialogueScreen
        {...baseProps({ onNewGenerationDraftChange: onDraftChange })}
        newGenerationDraft={{
          documentType: "img",
          topic: "",
          prompt: "",
          referenceImages: ["/tmp/reference.png", "/tmp/style.png"],
        }}
      />,
    );

    expect(await screen.findByText(`2 / ${maxCount}`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /remove reference.png/i }));
    expect(onDraftChange).toHaveBeenCalledWith({ sourceFile: undefined, referenceImages: ["/tmp/style.png"] });

    rerender(
      <DialogueScreen
        {...baseProps({ onNewGenerationDraftChange: onDraftChange })}
        newGenerationDraft={{ documentType: "img", topic: "", prompt: "", referenceImages: ["/tmp/style.png"] }}
      />,
    );

    expect(await screen.findByText(`1 / ${maxCount}`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /remove style.png/i }));
    expect(onDraftChange).toHaveBeenCalledWith({ sourceFile: undefined, referenceImages: [] });

    rerender(
      <DialogueScreen
        {...baseProps({ onNewGenerationDraftChange: onDraftChange })}
        newGenerationDraft={{ documentType: "img", topic: "", prompt: "", referenceImages: [] }}
      />,
    );

    expect(screen.queryByText("Reference images")).toBeNull();
    expect(screen.getByText("No reference images yet")).toBeTruthy();
  });

  it("keeps reference cards removable when thumbnail preview fails", async () => {
    const onDraftChange = vi.fn();
    readLocalImageSpy.mockRejectedValueOnce(new Error("cannot read image"));
    render(
      <DialogueScreen
        {...baseProps({ onNewGenerationDraftChange: onDraftChange })}
        newGenerationDraft={{ documentType: "img", topic: "", prompt: "", referenceImages: ["/tmp/broken.png"] }}
      />,
    );

    expect(await screen.findByText("Preview unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /remove broken.png/i }));

    expect(onDraftChange).toHaveBeenCalledWith({ sourceFile: undefined, referenceImages: [] });
  });

  it("shows the reference image limit state while dragging over a full drop zone", async () => {
    const maxCount = getAttachmentSpec("img", "referenceImages")?.maxCount ?? 6;
    render(
      <DialogueScreen
        {...baseProps()}
        newGenerationDraft={{
          documentType: "img",
          topic: "",
          prompt: "",
          referenceImages: Array.from({ length: maxCount }, (_, index) => `/tmp/reference-${index}.png`),
        }}
      />,
    );

    const dropZone = await screen.findByRole("region", { name: /Drop reference images/i });
    fireEvent.dragOver(dropZone, {
      dataTransfer: {
        files: [],
        items: [],
        types: ["Files"],
        dropEffect: "copy",
      },
    });

    expect(screen.getByText("Reference images limit reached")).toBeTruthy();
  });

  it("adds Wails native dropped image paths to scratch reference images", async () => {
    const onDraftChange = vi.fn();
    render(<DialogueScreen {...baseProps({ onNewGenerationDraftChange: onDraftChange })} newGenerationDraft={{ documentType: "img", topic: "", prompt: "" }} />);

    await screen.findByRole("region", { name: /Drop reference images/i });
    expect(onFileDropSpy).toHaveBeenCalled();
    expect(fileDropCallback).toBeTruthy();

    act(() => {
      fileDropCallback?.(["/tmp/reference.png", "/tmp/notes.txt"]);
    });

    await waitFor(() => expect(onDraftChange).toHaveBeenCalledWith({ sourceFile: undefined, referenceImages: ["/tmp/reference.png"] }));
    expect(savePastedImageSpy).not.toHaveBeenCalled();
  });

  it("lays out image templates as a 1:1 photo wall and form workspace", async () => {
    const masonryTemplates = [0, 1, 2, 3].map((index) => ({
      ...SLOTTED_TEMPLATE,
      id: 80 + index,
      slug: `promo-${index + 1}`,
      title: `Promo ${index + 1}`,
    }));
    listImageTemplatesSpy.mockResolvedValueOnce(masonryTemplates);
    render(<DialogueScreen {...baseProps()} newGenerationDraft={{ documentType: "img", topic: "", prompt: "" }} />);

    expect(await screen.findByText("Promo 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Promo 1/i }));

    const workspace = document.querySelector(".image-template-workspace");
    const galleryPane = document.querySelector(".image-template-gallery-pane");
    const formPane = document.querySelector(".image-template-form-pane");
    const actionsFooter = document.querySelector(".image-template-actions-footer");
    const commandBar = document.querySelector(".fluid-command-bar");
    const templateComposer = document.querySelector(".image-template-template-composer");
    const templateFormScroll = document.querySelector(".image-template-template-form-scroll");
    const templateGrid = document.querySelector(".image-template-grid");
    const masonryColumns = document.querySelectorAll(".image-template-masonry-column");
    const generateButton = screen.getByRole("button", { name: /Generate$/i });

    expect(workspace).toBeTruthy();
    expect(galleryPane).toBeTruthy();
    expect(formPane).toBeTruthy();
    expect(actionsFooter).toBeTruthy();
    expect(commandBar).toBeTruthy();
    expect(templateComposer).toBeTruthy();
    expect(templateFormScroll).toBeTruthy();
    expect(workspace?.contains(galleryPane)).toBe(true);
    expect(workspace?.contains(formPane)).toBe(true);
    expect(formPane?.contains(commandBar)).toBe(true);
    expect(formPane?.contains(actionsFooter)).toBe(true);
    expect(commandBar?.contains(templateComposer)).toBe(true);
    expect(templateComposer?.contains(templateFormScroll)).toBe(true);
    expect(templateFormScroll?.contains(actionsFooter)).toBe(false);
    expect(actionsFooter?.parentElement).toBe(formPane);
    expect(actionsFooter?.contains(generateButton)).toBe(true);
    expect(screen.queryByRole("button", { name: /Attach reference images/i })).toBeNull();
    expect(document.querySelector(".image-template-actions-footer .reference-image-upload-button")).toBeNull();
    expect(document.querySelector(".image-template-actions-footer .material-symbol")).toBeNull();
    expect(templateGrid?.classList.contains("image-template-vertical-wall")).toBe(true);
    expect(masonryColumns).toHaveLength(3);
    expect(masonryColumns[0].textContent).toContain("Promo 1");
    expect(masonryColumns[0].textContent).toContain("Promo 4");
    expect(masonryColumns[1].textContent).toContain("Promo 2");
    expect(masonryColumns[2].textContent).toContain("Promo 3");
    expect(document.querySelector(".image-template-form-title")?.textContent).toBe("What should we work on?");

    const css = readFileSync("src/renderer/styles/dialogue.css", "utf8");
    const galleryGridRule = css.match(/\.image-template-workspace \.image-template-grid\s*\{[^}]*\}/s)?.[0] ?? "";
    const galleryCardRule = css.match(/\.image-template-workspace \.image-template-card\s*\{[^}]*\}/s)?.[0] ?? "";
    const masonryColumnRule = css.match(/\.image-template-masonry-column\s*\{[^}]*\}/s)?.[0] ?? "";
    const actionsRule = css.match(/\.image-template-actions-footer\s*\{[^}]*\}/s)?.[0] ?? "";
    const actionsOverrideRule = css.match(/\.composer-actions\.image-template-actions-footer\s*\{[^}]*\}/s)?.[0] ?? "";
    const templateComposerRule = css.match(/\.image-template-template-composer\s*\{[^}]*\}/s)?.[0] ?? "";
    const formScrollRule = css.match(/\.image-template-template-form-scroll\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(galleryGridRule).toContain("display: grid;");
    expect(galleryGridRule).toContain("grid-template-columns: repeat(3, minmax(0, 1fr));");
    expect(galleryGridRule).not.toContain("column-count:");
    expect(masonryColumnRule).toContain("display: grid;");
    expect(masonryColumnRule).toContain("align-content: start;");
    expect(galleryCardRule).toContain("break-inside: avoid;");
    expect(templateComposerRule).toContain("grid-template-rows: auto minmax(0, 1fr);");
    expect(formScrollRule).toContain("overflow-y: auto;");
    expect(actionsRule).toContain("grid-template-columns: minmax(0, 1fr) auto;");
    expect(actionsOverrideRule).toContain("display: grid;");
  });

  it("places the image-template headline and document format selector in a compact full-width toolbar", async () => {
    listImageTemplatesSpy.mockResolvedValueOnce([SLOTTED_TEMPLATE]);
    render(
      <DialogueScreen
        {...baseProps({
          workspaces: [{ id: "ws-1", path: "/tmp/ppt-test", name: "ppt-test", active: true, conversations: [] }],
          newChatTarget: { kind: "workspace", workspaceId: "ws-1" },
        })}
        newGenerationDraft={{ documentType: "img", topic: "", prompt: "" }}
      />,
    );

    expect(await screen.findByText("Promo")).toBeTruthy();
    const workspace = document.querySelector(".image-template-workspace");
    const fullWidthHeader = document.querySelector(".image-template-prompt-header");
    const formPane = document.querySelector(".image-template-form-pane");
    const galleryPane = document.querySelector(".image-template-gallery-pane");
    const formatRow = fullWidthHeader?.querySelector(".format-row");

    expect(workspace?.firstElementChild).toBe(fullWidthHeader);
    expect(fullWidthHeader?.contains(document.querySelector(".image-template-form-title"))).toBe(true);
    expect(formatRow).toBeTruthy();
    expect(formPane?.contains(fullWidthHeader)).toBe(false);
    expect(formPane?.querySelector(".format-row")).toBeNull();
    expect(galleryPane).toBeTruthy();
    expect(fullWidthHeader).toBeTruthy();
    expect(galleryPane!.compareDocumentPosition(fullWidthHeader!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();

    const css = readFileSync("src/renderer/styles/dialogue.css", "utf8");
    const workspaceRule = css.match(/\.image-template-workspace\s*\{[^}]*\}/s)?.[0] ?? "";
    const headerRule = css.match(/\.image-template-prompt-header\s*\{[^}]*\}/s)?.[0] ?? "";
    const galleryPaneRule = css.match(/\.image-template-workspace \.image-template-gallery-pane\s*\{[^}]*\}/s)?.[0] ?? "";
    const formPaneRule = css.match(/\.image-template-form-pane\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(workspaceRule).toContain("grid-template-rows: auto minmax(0, 1fr);");
    expect(headerRule).toContain("grid-column: 1 / -1;");
    expect(headerRule).toContain("grid-row: 1;");
    expect(headerRule).toContain("display: flex;");
    expect(headerRule).toContain("justify-content: space-between;");
    expect(headerRule).toContain("text-align: left;");
    expect(galleryPaneRule).toContain("grid-row: 2;");
    expect(formPaneRule).toContain("grid-row: 2;");

    const formatRowRule = css.match(/\.image-template-prompt-header \.format-row\s*\{[^}]*\}/s)?.[0] ?? "";
    const titleRule = css.match(/\.image-template-prompt-header \.fluid-start-title\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(formatRowRule).toContain("justify-content: flex-end;");
    expect(titleRule).toContain("justify-content: flex-start;");
  });

  it("uses the project headline in the image-template form header", async () => {
    listImageTemplatesSpy.mockResolvedValueOnce([SLOTTED_TEMPLATE]);
    render(
      <DialogueScreen
        {...baseProps({
          workspaces: [{ id: "ws-1", path: "/tmp/ppt-test", name: "ppt-test", active: true, conversations: [] }],
          newChatTarget: { kind: "workspace", workspaceId: "ws-1" },
        })}
        newGenerationDraft={{ documentType: "img", topic: "", prompt: "" }}
      />,
    );

    expect(await screen.findByText("Promo")).toBeTruthy();
    const header = document.querySelector(".image-template-form-header")!;
    expect(within(header as HTMLElement).getByText("What should we work on in")).toBeTruthy();
    expect(within(header as HTMLElement).getByRole("button", { name: "ppt-test" })).toBeTruthy();
    expect(within(header as HTMLElement).queryByText(/^Image templates$/i)).toBeNull();
  });

  it("shows a spinner and loading text while image templates are pending", async () => {
    const pending = deferred<Awaited<ReturnType<DesktopAPI["listImageTemplates"]>>>();
    listImageTemplatesSpy.mockReturnValueOnce(pending.promise);
    render(<DialogueScreen {...baseProps()} newGenerationDraft={{ documentType: "img", topic: "", prompt: "" }} />);

    const loadingStatus = document.querySelector(".image-template-status")!;
    expect(loadingStatus.querySelector(".ui-loading")).toBeTruthy();
    const loadingText = Array.from(loadingStatus.children).find((child) => !child.classList.contains("ui-loading"));
    expect(loadingText?.textContent).toBe("Loading image templates…");

    await act(async () => {
      pending.resolve([
        { id: 7, slug: "poster", title: "Poster", description: "Cinematic poster", promptPreset: "Template prompt", thumbnailUrl: "/api/image-templates/7/thumbnail", sortOrder: 10, enabled: true },
      ]);
      await pending.promise;
    });
    expect(await screen.findByText("Poster")).toBeTruthy();
  });

  it("refreshes the image-template list from the picker head", async () => {
    listImageTemplatesSpy
      .mockResolvedValueOnce([
        { id: 7, slug: "poster", title: "Poster", description: "Cinematic poster", promptPreset: "Template prompt", thumbnailUrl: "/api/image-templates/7/thumbnail", sortOrder: 10, enabled: true },
      ])
      .mockResolvedValueOnce([
        { id: 8, slug: "banner", title: "Banner", description: "Hero banner", promptPreset: "Second prompt", thumbnailUrl: "/api/image-templates/8/thumbnail", sortOrder: 20, enabled: true },
      ]);
    render(<DialogueScreen {...baseProps()} newGenerationDraft={{ documentType: "img", topic: "", prompt: "" }} />);

    expect(await screen.findByText("Poster")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Refresh$/i }));

    await waitFor(() => expect(listImageTemplatesSpy).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Banner")).toBeTruthy();
  });

  it("does not expose image-template copy controls in the picker", async () => {
    listImageTemplatesSpy.mockResolvedValueOnce([
      { id: 7, slug: "poster", title: "Poster", description: "Cinematic poster", promptPreset: "Template prompt", thumbnailUrl: "/api/image-templates/7/thumbnail", sortOrder: 10, enabled: true, visibility: "platform_public" },
    ]);
    render(<DialogueScreen {...baseProps()} newGenerationDraft={{ documentType: "img", topic: "", prompt: "" }} />);

    expect(await screen.findByText("Poster")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Copy to my templates$/i })).toBeNull();
    expect(createImageTemplateSpy).not.toHaveBeenCalled();
  });
});

function fireDropWithFile(target: HTMLElement, file: File) {
  fireEvent.dragOver(target, {
    dataTransfer: {
      files: [file],
      items: [],
      types: ["Files"],
      dropEffect: "copy",
    },
  });
  fireEvent.drop(target, {
    dataTransfer: {
      files: [file],
      items: [],
      types: ["Files"],
      dropEffect: "copy",
    },
  });
}

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

const SLOTTED_TEMPLATE = {
  id: 8,
  slug: "promo",
  title: "Promo",
  description: "Promo poster",
  promptPreset: "Poster for {{product}}, {{style}} style. Notes: {{notes}}",
  thumbnailUrl: "/api/image-templates/8/thumbnail",
  sortOrder: 5,
  enabled: true,
  slots: [
    { key: "product", label: "Product", defaultValue: "PRODUCT_HINT", required: true },
    { key: "style", label: "Style", defaultValue: "minimalist" },
    { key: "notes", label: "Notes", defaultValue: "NOTES_HINT", multiline: true },
  ] as ImagePromptSlot[],
};

async function selectSlottedTemplate(locale?: Locale, template = SLOTTED_TEMPLATE) {
  const screenNode = <DialogueScreen {...baseProps()} newGenerationDraft={{ documentType: "img", topic: "", prompt: "" }} />;
  render(locale ? <LocaleProvider value={locale}>{screenNode}</LocaleProvider> : screenNode);
  expect(await screen.findByText("Promo")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Promo/i }));
  return screen.getByPlaceholderText(template.slots[0].defaultValue!) as HTMLInputElement;
}

describe("assembleSlots (pure assembly)", () => {
  const slots: ImagePromptSlot[] = [
    { key: "product", label: "Product", defaultValue: "a gadget" },
    { key: "style", label: "Style" },
  ];

  it("uses the user value when provided", () => {
    expect(assembleSlots("Make {{product}} in {{style}}", slots, { product: "shoes", style: "retro" }))
      .toBe("Make shoes in retro");
  });

  it("falls back to defaultValue, then [label] — never the literal marker", () => {
    const out = assembleSlots("Make {{product}} in {{style}}", slots, {});
    expect(out).toBe("Make a gadget in [Style]");
    expect(out).not.toContain("{{");
  });

  it("treats a whitespace-only value as empty", () => {
    expect(assembleSlots("X {{product}}", slots, { product: "   " })).toBe("X a gadget");
  });

  it("leaves orphan markers (no matching slot) verbatim", () => {
    expect(assembleSlots("Has {{ghost}} marker", slots, {})).toBe("Has {{ghost}} marker");
  });
});

describe("Image template slots (guided fill-in)", () => {
  it("renders the slot form tab by default and switches to the prompt preview tab", async () => {
    listImageTemplatesSpy.mockResolvedValueOnce([SLOTTED_TEMPLATE]);
    await selectSlottedTemplate();

    expect(screen.getByText("Fill in the template")).toBeTruthy();
    const formTab = screen.getByRole("tab", { name: "Form" });
    const previewTab = screen.getByRole("tab", { name: "Preview" });
    expect(formTab.getAttribute("aria-selected")).toBe("true");
    expect(previewTab.getAttribute("aria-selected")).toBe("false");
    // multiline slot renders a <textarea>, single-line slots render <input>
    expect((screen.getByPlaceholderText("PRODUCT_HINT") as HTMLElement).tagName).toBe("INPUT");
    expect((screen.getByPlaceholderText("NOTES_HINT") as HTMLElement).tagName).toBe("TEXTAREA");
    expect((screen.getByPlaceholderText("PRODUCT_HINT") as HTMLInputElement).value).toBe("PRODUCT_HINT");
    expect((screen.getByPlaceholderText("NOTES_HINT") as HTMLTextAreaElement).value).toBe("NOTES_HINT");

    expect(document.querySelector(".template-slot-preview-body")).toBeNull();

    fireEvent.click(previewTab);

    const preview = document.querySelector(".template-slot-preview-body")!;
    expect(formTab.getAttribute("aria-selected")).toBe("false");
    expect(previewTab.getAttribute("aria-selected")).toBe("true");
    expect(preview.textContent).toBe("Poster for PRODUCT_HINT, minimalist style. Notes: NOTES_HINT");
    expect(preview.textContent).not.toContain("{{");
  });

  it("updates the preview live as slots are filled", async () => {
    listImageTemplatesSpy.mockResolvedValueOnce([SLOTTED_TEMPLATE]);
    const productInput = await selectSlottedTemplate();
    fireEvent.change(productInput, { target: { value: "sneakers" } });
    fireEvent.click(screen.getByRole("tab", { name: "Preview" }));

    const preview = document.querySelector(".template-slot-preview-body")!;
    expect(preview.textContent).toBe("Poster for sneakers, minimalist style. Notes: NOTES_HINT");
  });

  it("keeps the image template footer focused on Generate without upload or advanced buttons", async () => {
    listImageTemplatesSpy.mockResolvedValueOnce([SLOTTED_TEMPLATE]);
    await selectSlottedTemplate();

    expect(screen.queryByRole("button", { name: /Attach reference images/i })).toBeNull();
    expect(screen.queryByText(/Upload reference images/i)).toBeNull();
    expect(document.querySelector(".image-template-actions-footer .reference-image-upload-button")).toBeNull();
    expect(document.querySelector(".image-template-actions-footer .material-symbol")).toBeNull();
  });

  it("uses a required slot defaultValue when the user leaves it empty", async () => {
    listImageTemplatesSpy.mockResolvedValueOnce([SLOTTED_TEMPLATE]);
    const onSubmit = vi.fn(async (_values: GenerateInput) => undefined);
    render(<DialogueScreen {...baseProps({ onSubmit })} newGenerationDraft={{ documentType: "img", topic: "", prompt: "" }} />);
    expect(await screen.findByText("Promo")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Promo/i }));

    const productInput = screen.getByPlaceholderText("PRODUCT_HINT");
    fireEvent.submit(productInput.closest("form")!);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toEqual(expect.objectContaining({
      prompt: "Poster for PRODUCT_HINT, minimalist style. Notes: NOTES_HINT",
    }));
  });

  it("rejects a slot value containing double-brace markers", async () => {
    listImageTemplatesSpy.mockResolvedValueOnce([SLOTTED_TEMPLATE]);
    const onSubmit = vi.fn(async (_values: GenerateInput) => undefined);
    render(<DialogueScreen {...baseProps({ onSubmit })} newGenerationDraft={{ documentType: "img", topic: "", prompt: "" }} />);
    expect(await screen.findByText("Promo")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Promo/i }));

    const productInput = screen.getByPlaceholderText("PRODUCT_HINT");
    fireEvent.change(productInput, { target: { value: "evil {{inject}}" } });
    fireEvent.submit(productInput.closest("form")!);

    await waitFor(() => expect(screen.getAllByText(/double-brace markers/i).length).toBeGreaterThan(0));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits the assembled prompt (slots filled) with no promptTemplateId", async () => {
    listImageTemplatesSpy.mockResolvedValueOnce([SLOTTED_TEMPLATE]);
    const onSubmit = vi.fn(async (_values: GenerateInput) => undefined);
    render(<DialogueScreen {...baseProps({ onSubmit })} newGenerationDraft={{ documentType: "img", topic: "", prompt: "" }} />);
    expect(await screen.findByText("Promo")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Promo/i }));

    fireEvent.change(screen.getByPlaceholderText("PRODUCT_HINT"), { target: { value: "sneakers" } });
    fireEvent.change(screen.getByPlaceholderText("NOTES_HINT"), { target: { value: "bright colors" } });
    fireEvent.submit(screen.getByPlaceholderText("PRODUCT_HINT").closest("form")!);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const submitted = onSubmit.mock.calls[0][0];
    expect(submitted).toEqual(expect.objectContaining({
      documentType: "img",
      prompt: "Poster for sneakers, minimalist style. Notes: bright colors",
    }));
    expect(submitted).not.toHaveProperty("promptTemplateId");
  });

  it("renders zh slot labels and uses them in required warnings", async () => {
    const requiredNoDefaultTemplate = {
      ...SLOTTED_TEMPLATE,
      slots: [
        { key: "product", label: "Product", required: true },
        { key: "style", label: "Style", defaultValue: "minimalist" },
        { key: "notes", label: "Notes", defaultValue: "NOTES_HINT", multiline: true },
      ] as ImagePromptSlot[],
    };
    listImageTemplatesSpy.mockResolvedValueOnce([requiredNoDefaultTemplate]);
    const onSubmit = vi.fn(async (_values: GenerateInput) => undefined);
    render(
      <LocaleProvider value="zh">
        <DialogueScreen {...baseProps({ onSubmit })} newGenerationDraft={{ documentType: "img", topic: "", prompt: "" }} />
      </LocaleProvider>,
    );
    expect(await screen.findByText("Promo")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Promo/i }));

    expect(screen.getByText("产品")).toBeTruthy();
    expect(screen.getByText("风格")).toBeTruthy();
    expect(screen.getByText("备注")).toBeTruthy();

    fireEvent.submit(document.querySelector(".template-slot-form input")!.closest("form")!);
    await waitFor(() => expect(screen.getAllByText(/请填写产品/).length).toBeGreaterThan(0));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("falls back to the English slot label when a slug/key is not translated", async () => {
    const untranslatedTemplate = {
      ...SLOTTED_TEMPLATE,
      id: 9,
      slug: "untranslated",
      slots: [
        { key: "hero", label: "Hero Product", defaultValue: "HERO_HINT", required: true },
      ] as ImagePromptSlot[],
    };
    listImageTemplatesSpy.mockResolvedValueOnce([untranslatedTemplate]);
    render(
      <LocaleProvider value="zh">
        <DialogueScreen {...baseProps()} newGenerationDraft={{ documentType: "img", topic: "", prompt: "" }} />
      </LocaleProvider>,
    );
    expect(await screen.findByText("Promo")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Promo/i }));

    expect(screen.getByText("Hero Product")).toBeTruthy();
  });

  it("escape hatch: editing the raw prompt detaches slots, and reset re-attaches them", async () => {
    listImageTemplatesSpy.mockResolvedValueOnce([SLOTTED_TEMPLATE]);
    await selectSlottedTemplate();

    // Open the raw prompt editor, then edit it to decouple from the slots.
    fireEvent.click(screen.getByRole("button", { name: /Edit raw prompt/i }));
    const rawTextarea = screen.getByPlaceholderText(/Enter what you want to generate/i);
    fireEvent.change(rawTextarea, { target: { value: "fully custom raw prompt" } });

    expect(screen.getByText(/You're editing the raw prompt/i)).toBeTruthy();
    expect(screen.queryByText("Fill in the template")).toBeNull();

    // Reset re-seeds the guided form and restores the assembled prompt.
    fireEvent.click(screen.getByRole("button", { name: /Reset to template/i }));
    expect(screen.getByText("Fill in the template")).toBeTruthy();
    expect((screen.getByPlaceholderText(/Enter what you want to generate/i) as HTMLTextAreaElement).value)
      .toBe("Poster for PRODUCT_HINT, minimalist style. Notes: NOTES_HINT");
  });
});

describe("Conversation multi-round", () => {
  it("scrolls to the bottom after switching between completed conversations", async () => {
    const firstTask = makeCompletedImageTask({
      id: "task-img-1",
      conversationId: "conv-1",
      events: [{ task_id: "task-img-1", type: "task.completed", payload: { message: "done" } }],
      artifact: {
        taskId: "task-img-1",
        filePath: "/tmp/first.png",
        fileName: "first.png",
        documentType: "img",
      },
    });
    const secondTask = makeCompletedImageTask({
      id: "task-img-2",
      conversationId: "conv-2",
      events: [{ task_id: "task-img-2", type: "task.completed", payload: { message: "done" } }],
      artifact: {
        taskId: "task-img-2",
        filePath: "/tmp/second.png",
        fileName: "second.png",
        documentType: "img",
      },
    });
    const scrollIntoView = window.HTMLElement.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    const { rerender } = render(<DialogueScreen {...baseProps()} tasks={[firstTask]} />);

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    rerender(<DialogueScreen {...baseProps()} tasks={[secondTask]} />);

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(2));
  });

  it("sets the scroll container to the true bottom after switching conversations", async () => {
    const firstTask = makeCompletedImageTask({ id: "task-img-1", conversationId: "conv-1" });
    const secondTask = makeCompletedImageTask({ id: "task-img-2", conversationId: "conv-2" });
    const clientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
    const scrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return this instanceof HTMLElement && this.classList.contains("stage") ? 300 : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return this instanceof HTMLElement && this.classList.contains("stage") ? 1200 : 0;
      },
    });

    try {
      const { rerender } = render(
        <section className="stage" data-testid="stage-scroll">
          <DialogueScreen {...baseProps()} tasks={[firstTask]} />
        </section>,
      );
      const stage = screen.getByTestId("stage-scroll");

      await waitFor(() => expect(stage.scrollTop).toBe(900));
      stage.scrollTop = 120;
      rerender(
        <section className="stage" data-testid="stage-scroll">
          <DialogueScreen {...baseProps()} tasks={[secondTask]} />
        </section>,
      );

      await waitFor(() => expect(stage.scrollTop).toBe(900));
    } finally {
      if (clientHeightDescriptor) Object.defineProperty(HTMLElement.prototype, "clientHeight", clientHeightDescriptor);
      if (scrollHeightDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollHeight", scrollHeightDescriptor);
    }
  });

  it("keeps the continuation composer in a fixed footer outside the chat thread", async () => {
    render(<DialogueScreen {...baseProps()} tasks={[makeCompletedImageTask()]} />);
    const composer = screen.getByTestId("continuation-composer");
    const footer = composer.closest(".conversation-footer");
    const thread = document.querySelector(".chat-thread");

    expect(footer).toBeTruthy();
    expect(thread).toBeTruthy();
    expect(thread?.contains(composer)).toBe(false);
    expect(footer?.parentElement).toBe(document.querySelector(".conversation-layout"));
  });

  it("scrolls to a sentinel inside the chat thread instead of the fixed footer", async () => {
    render(<DialogueScreen {...baseProps()} tasks={[makeCompletedImageTask()]} />);
    const scrollIntoView = window.HTMLElement.prototype.scrollIntoView as ReturnType<typeof vi.fn>;

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());

    const thread = document.querySelector(".chat-thread");
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(thread?.lastElementChild);
  });

  it("scrolls again when restored conversation content resizes after preview loading", async () => {
    render(<DialogueScreen {...baseProps()} tasks={[makeCompletedImageTask()]} />);
    const scrollIntoView = window.HTMLElement.prototype.scrollIntoView as ReturnType<typeof vi.fn>;

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    const layout = document.querySelector(".conversation-layout");
    const layoutObserver = resizeObserverRecords.find((record) => record.observed.includes(layout!));
    expect(layoutObserver).toBeTruthy();

    act(() => {
      layoutObserver!.callback([], {} as ResizeObserver);
    });

    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

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
    const submitBtn = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);

    const textarea = screen.getByPlaceholderText(/describe what you want to generate/i);
    fireEvent.change(textarea, { target: { value: "Make sky brighter" } });
    expect(submitBtn.disabled).toBe(false);
  });

  it("T5: clicking submit calls onContinueGeneration with documentType, prompt, referenceImages, and imageRatio", () => {
    const onContinueGeneration = vi.fn();
    const task = makeCompletedImageTask();
    render(<DialogueScreen {...baseProps({ onContinueGeneration })} tasks={[task]} />);

    expect(screen.getByText("Image ratio")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Portrait"));
    const textarea = screen.getByPlaceholderText(/describe what you want to generate/i);
    fireEvent.change(textarea, { target: { value: "Add a sunset" } });
    const submitBtn = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    fireEvent.click(submitBtn);

    expect(onContinueGeneration).toHaveBeenCalledTimes(1);
    expect(onContinueGeneration).toHaveBeenCalledWith("img", "Add a sunset", undefined, "portrait");
  });

  it("continues GIF generation with fps and no imageRatio", () => {
    const onContinueGeneration = vi.fn();
    const task = makeCompletedGIFTask();
    render(<DialogueScreen {...baseProps({ onContinueGeneration })} tasks={[task]} />);

    expect(screen.getByText("GIF FPS")).toBeTruthy();
    expect(screen.queryByText("Image ratio")).toBeNull();
    const fpsInput = screen.getByRole("spinbutton", { name: /GIF FPS/i });
    fireEvent.change(fpsInput, { target: { value: "12" } });
    const textarea = screen.getByPlaceholderText(/describe what you want to generate/i);
    fireEvent.change(textarea, { target: { value: "Make the wink slower" } });
    const submitBtn = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    fireEvent.click(submitBtn);

    expect(onContinueGeneration).toHaveBeenCalledTimes(1);
    expect(onContinueGeneration).toHaveBeenCalledWith("gif", "Make the wink slower", undefined, undefined, 12);
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
    expect(onContinueGeneration).toHaveBeenCalledWith("img", "Brighten colors", undefined, "square");
  });

  it("adds a completed image as a continuation reference only after Continue editing is clicked", () => {
    const onContinueGeneration = vi.fn();
    const task = makeCompletedImageTask();
    render(<DialogueScreen {...baseProps({ onContinueGeneration })} tasks={[task]} />);

    fireEvent.click(screen.getByRole("button", { name: /continue editing/i }));
    fireEvent.click(screen.getByRole("button", { name: /continue editing/i }));

    expect(document.querySelectorAll(".reference-image-chip")).toHaveLength(1);
    const textarea = screen.getByPlaceholderText(/describe what you want to generate/i);
    fireEvent.change(textarea, { target: { value: "Add a sunset" } });
    const submitBtn = screen.getByRole("button", { name: "Send" });
    fireEvent.click(submitBtn);

    expect(onContinueGeneration).toHaveBeenCalledTimes(1);
    expect(onContinueGeneration).toHaveBeenCalledWith("img", "Add a sunset", ["/tmp/banner.png"], "square");
  });

  it("does not submit a generated image reference after it is removed from the continuation composer", () => {
    const onContinueGeneration = vi.fn();
    const task = makeCompletedImageTask();
    render(<DialogueScreen {...baseProps({ onContinueGeneration })} tasks={[task]} />);

    fireEvent.click(screen.getByRole("button", { name: /continue editing/i }));
    fireEvent.click(screen.getByRole("button", { name: /remove banner.png/i }));

    expect(document.querySelectorAll(".reference-image-chip")).toHaveLength(0);
    const textarea = screen.getByPlaceholderText(/describe what you want to generate/i);
    fireEvent.change(textarea, { target: { value: "Add a sunset" } });
    const submitBtn = screen.getByRole("button", { name: "Send" });
    fireEvent.click(submitBtn);

    expect(onContinueGeneration).toHaveBeenCalledTimes(1);
    expect(onContinueGeneration).toHaveBeenCalledWith("img", "Add a sunset", undefined, "square");
  });
});

describe("DialogueScreen solution catalog", () => {
  it("offers scenario solutions with their output type and estimate", () => {
    render(<DialogueScreen {...baseProps()} newGenerationDraft={{ documentType: "pptx", topic: "", prompt: "" }} />);

    expect(screen.getByText("Weekly Business Review")).toBeTruthy();
    expect(screen.getByText("Quarterly Business Review")).toBeTruthy();
    expect(screen.getByText("Competitive One-pager")).toBeTruthy();

    const card = screen.getByText("Weekly Business Review").closest("button");
    expect(card).toBeTruthy();
    expect(card?.querySelector(".fluid-prompt-meta")?.textContent).toContain("PPTX");
    expect(card?.querySelector(".fluid-prompt-meta")?.textContent).toContain("2 min");
  });

  it("enters the solution workflow with its document type and prompt prefilled", () => {
    const onNewGenerationDraftChange = vi.fn();
    render(
      <DialogueScreen
        {...baseProps()}
        newGenerationDraft={{ documentType: "pptx", topic: "", prompt: "" }}
        onNewGenerationDraftChange={onNewGenerationDraftChange}
      />,
    );

    fireEvent.click(screen.getByText("Competitive One-pager"));

    expect(onNewGenerationDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({ documentType: "docx", topic: "Competitive One-pager" }),
    );
  });
});
