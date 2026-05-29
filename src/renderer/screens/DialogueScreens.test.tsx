import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopAPI, DesktopTask, GenerateInput } from "../../shared/types";
import { officecli } from "../bridge";
import { LocaleProvider, type Locale } from "../i18n";
import { DialogueScreen, assembleSlots } from "./DialogueScreens";
import type { ImagePromptSlot } from "../../shared/types";

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
let listImageTemplatesSpy: ReturnType<typeof vi.fn>;
let originals: Partial<DesktopAPI>;

beforeEach(() => {
  installDomStubs();
  respondSpy = vi.fn(async () => undefined);
  cancelSpy = vi.fn(async () => undefined);
  listImageTemplatesSpy = vi.fn(async () => []);
  originals = {
    respond: officecli.respond,
    cancel: officecli.cancel,
    listImageTemplates: officecli.listImageTemplates,
  };
  officecli.respond = respondSpy as unknown as DesktopAPI["respond"];
  officecli.cancel = cancelSpy as unknown as DesktopAPI["cancel"];
  officecli.listImageTemplates = listImageTemplatesSpy as unknown as DesktopAPI["listImageTemplates"];
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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

  it("image generation inserts template prompt and submits edited prompt only", async () => {
    listImageTemplatesSpy.mockResolvedValueOnce([
      { id: 7, slug: "poster", title: "Poster", description: "Cinematic poster", promptPreset: "Template prompt: replace PRODUCT", thumbnailUrl: "/api/image-templates/7/thumbnail", sortOrder: 10, enabled: true },
    ]);
    const onSubmit = vi.fn(async (_values: GenerateInput) => undefined);
    render(<DialogueScreen {...baseProps({ onSubmit })} newGenerationDraft={{ documentType: "img", topic: "", prompt: "", mode: "fast" }} />);

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

  it("image generation confirms before replacing an existing prompt with a template", async () => {
    listImageTemplatesSpy.mockResolvedValueOnce([
      { id: 7, slug: "poster", title: "Poster", description: "Cinematic poster", promptPreset: "Template prompt: replace PRODUCT", thumbnailUrl: "/api/image-templates/7/thumbnail", sortOrder: 10, enabled: true },
    ]);
    render(<DialogueScreen {...baseProps()} newGenerationDraft={{ documentType: "img", topic: "", prompt: "Existing prompt", mode: "fast" }} />);

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
    await waitFor(() => expect((textarea as HTMLTextAreaElement).value).toBe("Template prompt: replace PRODUCT"));
    expect(screen.getByText(/Template text has been inserted/i)).toBeTruthy();
  });

  it("image generation shows an empty state when no templates are configured", async () => {
    listImageTemplatesSpy.mockResolvedValueOnce([]);
    render(<DialogueScreen {...baseProps()} newGenerationDraft={{ documentType: "img", topic: "", prompt: "", mode: "fast" }} />);

    expect(await screen.findByText(/No image templates are configured yet/i)).toBeTruthy();
  });

  it("shows an antd spinner and loading text while image templates are pending", async () => {
    const pending = deferred<Awaited<ReturnType<DesktopAPI["listImageTemplates"]>>>();
    listImageTemplatesSpy.mockReturnValueOnce(pending.promise);
    render(<DialogueScreen {...baseProps()} newGenerationDraft={{ documentType: "img", topic: "", prompt: "", mode: "fast" }} />);

    expect(document.querySelector(".ant-spin")).toBeTruthy();
    const loadingStatus = document.querySelector(".image-template-status")!;
    const loadingText = Array.from(loadingStatus.children).find((child) => !child.classList.contains("ant-spin"));
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
    render(<DialogueScreen {...baseProps()} newGenerationDraft={{ documentType: "img", topic: "", prompt: "", mode: "fast" }} />);

    expect(await screen.findByText("Poster")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Refresh$/i }));

    await waitFor(() => expect(listImageTemplatesSpy).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Banner")).toBeTruthy();
  });
});

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
    { key: "product", label: "Product", example: "PRODUCT_HINT", required: true },
    { key: "style", label: "Style", example: "STYLE_HINT", defaultValue: "minimalist" },
    { key: "notes", label: "Notes", example: "NOTES_HINT", multiline: true },
  ] as ImagePromptSlot[],
};

async function selectSlottedTemplate(locale?: Locale, template = SLOTTED_TEMPLATE) {
  const screenNode = <DialogueScreen {...baseProps()} newGenerationDraft={{ documentType: "img", topic: "", prompt: "", mode: "fast" }} />;
  render(locale ? <LocaleProvider value={locale}>{screenNode}</LocaleProvider> : screenNode);
  expect(await screen.findByText("Promo")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Promo/i }));
  return screen.getByPlaceholderText(template.slots[0].example!) as HTMLInputElement;
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
  it("renders the slot form with a multiline field and a live preview free of markers", async () => {
    listImageTemplatesSpy.mockResolvedValueOnce([SLOTTED_TEMPLATE]);
    await selectSlottedTemplate();

    expect(screen.getByText("Fill in the template")).toBeTruthy();
    // multiline slot renders a <textarea>, single-line slots render <input>
    expect((screen.getByPlaceholderText("PRODUCT_HINT") as HTMLElement).tagName).toBe("INPUT");
    expect((screen.getByPlaceholderText("NOTES_HINT") as HTMLElement).tagName).toBe("TEXTAREA");

    const preview = document.querySelector(".template-slot-preview-body")!;
    expect(preview.textContent).toBe("Poster for [Product], minimalist style. Notes: [Notes]");
    expect(preview.textContent).not.toContain("{{");
  });

  it("updates the preview live as slots are filled", async () => {
    listImageTemplatesSpy.mockResolvedValueOnce([SLOTTED_TEMPLATE]);
    const productInput = await selectSlottedTemplate();
    fireEvent.change(productInput, { target: { value: "sneakers" } });

    const preview = document.querySelector(".template-slot-preview-body")!;
    expect(preview.textContent).toBe("Poster for sneakers, minimalist style. Notes: [Notes]");
  });

  it("blocks submit when a required slot is empty", async () => {
    listImageTemplatesSpy.mockResolvedValueOnce([SLOTTED_TEMPLATE]);
    const onSubmit = vi.fn(async (_values: GenerateInput) => undefined);
    render(<DialogueScreen {...baseProps({ onSubmit })} newGenerationDraft={{ documentType: "img", topic: "", prompt: "", mode: "fast" }} />);
    expect(await screen.findByText("Promo")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Promo/i }));

    const productInput = screen.getByPlaceholderText("PRODUCT_HINT");
    fireEvent.submit(productInput.closest("form")!);

    await waitFor(() => expect(screen.getAllByText(/Please fill in Product/i).length).toBeGreaterThan(0));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("rejects a slot value containing double-brace markers", async () => {
    listImageTemplatesSpy.mockResolvedValueOnce([SLOTTED_TEMPLATE]);
    const onSubmit = vi.fn(async (_values: GenerateInput) => undefined);
    render(<DialogueScreen {...baseProps({ onSubmit })} newGenerationDraft={{ documentType: "img", topic: "", prompt: "", mode: "fast" }} />);
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
    render(<DialogueScreen {...baseProps({ onSubmit })} newGenerationDraft={{ documentType: "img", topic: "", prompt: "", mode: "fast" }} />);
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
    listImageTemplatesSpy.mockResolvedValueOnce([SLOTTED_TEMPLATE]);
    const onSubmit = vi.fn(async (_values: GenerateInput) => undefined);
    render(
      <LocaleProvider value="zh">
        <DialogueScreen {...baseProps({ onSubmit })} newGenerationDraft={{ documentType: "img", topic: "", prompt: "", mode: "fast" }} />
      </LocaleProvider>,
    );
    expect(await screen.findByText("Promo")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Promo/i }));

    expect(screen.getByText("产品")).toBeTruthy();
    expect(screen.getByText("风格")).toBeTruthy();
    expect(screen.getByText("备注")).toBeTruthy();

    fireEvent.submit(screen.getByPlaceholderText("PRODUCT_HINT").closest("form")!);
    await waitFor(() => expect(screen.getAllByText(/请填写产品/).length).toBeGreaterThan(0));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("falls back to the English slot label when a slug/key is not translated", async () => {
    const untranslatedTemplate = {
      ...SLOTTED_TEMPLATE,
      id: 9,
      slug: "untranslated",
      slots: [
        { key: "hero", label: "Hero Product", example: "HERO_HINT", required: true },
      ] as ImagePromptSlot[],
    };
    listImageTemplatesSpy.mockResolvedValueOnce([untranslatedTemplate]);
    render(
      <LocaleProvider value="zh">
        <DialogueScreen {...baseProps()} newGenerationDraft={{ documentType: "img", topic: "", prompt: "", mode: "fast" }} />
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
      .toBe("Poster for [Product], minimalist style. Notes: [Notes]");
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
    const submitBtn = document.querySelector(".composer-row .ant-btn-primary") as HTMLButtonElement;
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
    const submitBtn = document.querySelector(".composer-row .ant-btn-primary") as HTMLButtonElement;
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

  it("adds a completed image as a continuation reference only after Continue editing is clicked", () => {
    const onContinueGeneration = vi.fn();
    const task = makeCompletedImageTask();
    render(<DialogueScreen {...baseProps({ onContinueGeneration })} tasks={[task]} />);

    fireEvent.click(screen.getByRole("button", { name: /continue editing/i }));
    fireEvent.click(screen.getByRole("button", { name: /continue editing/i }));

    expect(document.querySelectorAll(".reference-image-chip")).toHaveLength(1);
    const textarea = screen.getByPlaceholderText(/describe what you want to generate/i);
    fireEvent.change(textarea, { target: { value: "Add a sunset" } });
    const submitBtn = document.querySelector(".composer-row .ant-btn-primary")!;
    fireEvent.click(submitBtn);

    expect(onContinueGeneration).toHaveBeenCalledTimes(1);
    expect(onContinueGeneration).toHaveBeenCalledWith("img", "Add a sunset", ["/tmp/banner.png"]);
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
    const submitBtn = document.querySelector(".composer-row .ant-btn-primary")!;
    fireEvent.click(submitBtn);

    expect(onContinueGeneration).toHaveBeenCalledTimes(1);
    expect(onContinueGeneration).toHaveBeenCalledWith("img", "Add a sunset", undefined);
  });
});
