import { beforeEach, describe, expect, it } from "vitest";
import { createDesktopUiPort } from "../createDesktopUiPort";
import { createFakeDesktopApi } from "./fakeDesktopApi";
import { describeUiPortContract } from "./uiPortContract";
import { NotImplementedError } from "../../shared/notImplemented";
import type { WindowControls } from "../window";

function stubWindow(): WindowControls {
  return {
    close() {},
    minimize() {},
    toggleFullscreen() {},
    isFullscreen: () => false,
    onFullscreenChange: () => () => {},
  };
}

/**
 * The api behind the port `createPort` built last.
 *
 * The contract suite hands its arrange hooks a `UiPort`, which is all the UI
 * ever sees — but arming the file picker is a thing done to the desktop behind
 * it. The two are created together just below, so the most recent one is the
 * right one.
 */
let lastApi: ReturnType<typeof createFakeDesktopApi>;

function createPort() {
  lastApi = createFakeDesktopApi({
    folders: [{ id: "folder-research", name: "Research", path: "/tmp/officedex/Research" }],
    documents: [
      { fileName: "launch deck.pptx", documentType: "pptx", lastOpenedAt: "2026-09-10T09:00:00Z" },
      { fileName: "interviews.docx", documentType: "docx", workspaceId: "folder-research" },
      { fileName: "budget.xlsx", documentType: "xlsx", pinned: true },
    ],
  });
  return createDesktopUiPort({ api: lastApi, window: stubWindow() });
}

// The same suite the in-memory fake runs. One contract, two implementations.
describeUiPortContract("desktop services", createPort, {
  armFilePicker: () => lastApi.pickLocalFile("/Users/flora/Desktop/from-disk.docx"),
});

describe("desktop file service", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // The desktop produces img, gif and report too. They have no FileType, and a
  // GIF shown as a "document" would open an editor that cannot read it.
  it("leaves out document types the new IA has no place for", async () => {
    const port = createDesktopUiPort({
      api: createFakeDesktopApi({
        documents: [
          { fileName: "deck.pptx", documentType: "pptx" },
          { fileName: "poster.png", documentType: "img" },
          { fileName: "loop.gif", documentType: "gif" },
          { fileName: "summary.docx", documentType: "docx" },
        ],
      }),
      window: stubWindow(),
    });

    const files = await port.files.list();

    expect(files.map((file) => file.type).sort()).toEqual(["doc", "slides"]);
  });

  it("maps document types onto the three the shell knows", async () => {
    const files = await createPort().files.list();
    const byName = new Map(files.map((file) => [file.name, file.type]));
    expect(byName.get("launch deck.pptx")).toBe("slides");
    expect(byName.get("interviews.docx")).toBe("doc");
    expect(byName.get("budget.xlsx")).toBe("sheet");
  });

  it("keeps the producing task id on generated files", async () => {
    const port = createDesktopUiPort({
      api: createFakeDesktopApi({
        documents: [{ fileName: "generated.docx", documentType: "docx", currentArtifactTaskId: "task-generate" }],
      }),
      window: stubWindow(),
    });

    await expect(port.files.list()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "generated.docx", artifactTaskId: "task-generate" })]),
    );
  });

  // Documents filed nowhere belong to the default folder, which is a real
  // directory their files already sit in.
  it("puts unfiled documents in the default folder", async () => {
    const port = createPort();
    const [folders, files] = await Promise.all([port.folders.list(), port.files.list()]);
    const fallback = folders.find((folder) => folder.isDefault)!;
    const unfiled = files.find((file) => file.name === "launch deck.pptx");
    expect(unfiled?.folderId).toBe(fallback.id);
  });

  // lastOpenedAt lives in the recent-files list, not on the document row, so it
  // is null until something has actually opened the file.
  it("reports lastOpenedAt only for files that have been opened", async () => {
    const port = createPort();
    const files = await port.files.list();
    expect(files.find((file) => file.name === "launch deck.pptx")?.lastOpenedAt).toBeGreaterThan(0);
    expect(files.find((file) => file.name === "budget.xlsx")?.lastOpenedAt).toBeNull();

    const target = files.find((file) => file.name === "budget.xlsx")!;
    const opened = await port.files.open(target.id);
    expect(opened.lastOpenedAt).toBeGreaterThan(0);
  });

  it("resolves a local file path for desktop sharing", async () => {
    const port = createPort();
    const file = (await port.files.list())[0];
    expect(port.files.pathOf).toBeTypeOf("function");
    await expect(port.files.pathOf!(file.id)).resolves.toContain(file.name);
  });

  // dirty is a property of an open editor, not of a file on disk: persisting it
  // would leave every file permanently marked after a crash.
  it("tracks dirty in memory and clears it on save", async () => {
    const port = createDesktopUiPort({
      api: createFakeDesktopApi({ documents: [{ fileName: "deck.pptx", documentType: "pptx" }] }),
      window: stubWindow(),
    });
    const files = port.files as ReturnType<typeof createDesktopUiPort>["files"] & {
      setDirty(id: string, dirty: boolean): void;
    };
    const file = (await port.files.list())[0];
    expect(file.dirty).toBe(false);

    files.setDirty(file.id, true);
    expect((await port.files.list())[0].dirty).toBe(true);

    await port.files.save(file.id);
    expect((await port.files.list())[0].dirty).toBe(false);
  });

  // Cancelling a picker is an ordinary thing to do, and the two outcomes have to
  // stay distinguishable: null means "changed my mind", not "it did not work".
  it("reports a cancelled picker as null, not an error", async () => {
    const api = createFakeDesktopApi();
    const port = createDesktopUiPort({ api, window: stubWindow() });
    const before = (await port.files.list()).length;

    await expect(port.files.openFromDisk()).resolves.toBeNull();
    expect(await port.files.list()).toHaveLength(before);
  });

  // One path, one file. Opening the same document twice — or opening one the
  // agent generated earlier — must land on the entry that already exists rather
  // than show the user two rows for one file. The Go side guarantees this
  // (app_local_files_test.go); the fake mirrors it so the mapping is tested too.
  it("returns the existing file when the same one is opened twice", async () => {
    const api = createFakeDesktopApi({ documents: [{ fileName: "deck.pptx", documentType: "pptx" }] });
    const port = createDesktopUiPort({ api, window: stubWindow() });
    const existing = (await port.files.list())[0];

    api.pickLocalFile("/tmp/officedex/deck.pptx");
    const opened = await port.files.openFromDisk();

    expect(opened?.id).toBe(existing.id);
    expect(await port.files.list()).toHaveLength(1);
  });

  // The UI keeps the New-document menu item; pressing it has to say why nothing
  // happened. The shell branches on the error type, not on its wording, so that
  // is what this asserts.
  it("refuses to create a document as a named gap, not a failure", async () => {
    await expect(createPort().files.create("doc", "folder:default")).rejects.toThrow(NotImplementedError);
    await createPort().files.create("doc", "folder:default").catch((reason) => {
      expect((reason as NotImplementedError).feature).toBe("files.create");
    });
  });
});

describe("desktop settings service", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // Four of the five fields have no home in the desktop's settings file, which
  // is synced state a running task reads. A checkbox must not invalidate a
  // provider probe.
  it("keeps shell-only preferences out of the desktop settings", async () => {
    const api = createFakeDesktopApi();
    const port = createDesktopUiPort({ api, window: stubWindow() });

    await port.settings.patch({ reduceMotion: true, customInstructions: "Be brief" });

    const desktop = await api.getSettings();
    expect(JSON.stringify(desktop)).not.toContain("Be brief");
    expect(localStorage.getItem("officedex.shell.settings")).toContain("Be brief");
  });

  it("survives a corrupt local value", async () => {
    localStorage.setItem("officedex.shell.settings", "{not json");
    const settings = await createPort().settings.get();
    expect(settings.permission).toBe("review");
  });
});

describe("desktop model service", () => {
  // The desktop stores one provider, so the list is the built-in model plus at
  // most one custom entry — adding a second replaces the first.
  it("lists the built-in model, and the custom one when configured", async () => {
    const api = createFakeDesktopApi();
    const port = createDesktopUiPort({ api, window: stubWindow() });

    expect(await port.models.list()).toHaveLength(1);

    await port.models.addCustom({
      name: "House model",
      modelId: "gpt-6-astra",
      provider: "openai",
      baseUrl: "https://api.example.com",
      apiKey: "secret",
    });

    const models = await port.models.list();
    expect(models).toHaveLength(2);
    expect(models[1].custom).toBe(true);
    expect(models[1].name).toBe("gpt-6-astra");
    // The contract says the port decides where a key lives; it never comes back
    // out through the model list.
    expect(JSON.stringify(models)).not.toContain("secret");
  });

  it("keeps the stored key when an edit does not supply one", async () => {
    const api = createFakeDesktopApi();
    const port = createDesktopUiPort({ api, window: stubWindow() });
    await port.models.addCustom({
      name: "House", modelId: "m1", provider: "openai", baseUrl: "https://a", apiKey: "secret",
    });

    await port.models.updateCustom("custom", {
      name: "Renamed", modelId: "m1", provider: "openai", baseUrl: "https://a",
    });

    expect((await api.getSettings()).llmProvider?.apiKey).toBe("secret");
  });

  it("will not edit or remove the built-in model", async () => {
    const port = createPort();
    await expect(port.models.updateCustom("official", {
      name: "x", modelId: "x", provider: "openai", baseUrl: "https://a",
    })).rejects.toThrow();
    await expect(port.models.removeCustom("official")).rejects.toThrow();
  });
});

describe("desktop agent service", () => {
  function agentPort(seed: Parameters<typeof createFakeDesktopApi>[0] = {}) {
    const api = createFakeDesktopApi(seed);
    return { api, port: createDesktopUiPort({ api, window: stubWindow() }) };
  }

  const started = (taskId: string, workspaceId = "") => ({
    event_id: `${taskId}-start`,
    task_id: taskId,
    type: "task.started" as const,
    ts: "2026-09-18T10:00:00Z",
    payload: { document_type: "pptx", ...(workspaceId ? { workspace_id: workspaceId } : {}) },
  });

  it("reports no task for a folder that has never had one", async () => {
    expect(await agentPort().port.agent.current("folder:default")).toBeNull();
  });

  // A folder can hold several conversations and the contract has room for one.
  it("scopes the task to its folder", async () => {
    const { api, port } = agentPort({
      folders: [{ id: "folder-research", name: "Research", path: "/tmp/officedex/Research" }],
    });
    api.emitBridgeEvent(started("task-default"));
    api.emitBridgeEvent(started("task-research", "folder-research"));

    expect((await port.agent.current("folder:default"))?.id).toBe("task-default");
    expect((await port.agent.current("folder-research"))?.id).toBe("task-research");
  });

  // What is happening now matters more than what happened.
  it("prefers an active run over a finished one in the same folder", async () => {
    const { api, port } = agentPort();
    api.emitBridgeEvent(started("task-old"));
    api.emitBridgeEvent({
      event_id: "task-old-done", task_id: "task-old", type: "task.completed",
      ts: "2026-09-18T10:00:05Z", payload: {},
    });
    api.emitBridgeEvent(started("task-live"));

    expect((await port.agent.current("folder:default"))?.id).toBe("task-live");
  });

  it("pushes task updates to subscribers", async () => {
    const { api, port } = agentPort();
    const seen: string[] = [];
    const unsubscribe = port.agent.subscribe((event) => {
      if (event.kind === "task") seen.push(event.task.status);
    });

    api.emitBridgeEvent(started("task-1"));
    // A started run is already running, and the contract's two live states are
    // reading and writing — `working` is for one that has not begun.
    expect(seen).toContain("reading");

    unsubscribe();
    api.emitBridgeEvent(started("task-2"));
    expect(seen).toHaveLength(1);
  });

  // AgentStatus has no failure state, so a failed run is reported twice: the
  // task turns done, and an error event says why.
  it("reports a failure as done plus an error event", async () => {
    const { api, port } = agentPort();
    const events: string[] = [];
    port.agent.subscribe((event) => {
      events.push(event.kind === "task" ? `task:${event.task.status}` : `error:${event.message}`);
    });

    api.emitBridgeEvent(started("task-1"));
    api.emitBridgeEvent({
      event_id: "task-1-fail", task_id: "task-1", type: "task.failed",
      ts: "2026-09-18T10:00:09Z", payload: { message: "ran out of credits" },
    });

    expect(events).toContain("task:done");
    expect(events.some((entry) => entry.startsWith("error:"))).toBe(true);
  });

  it("maps a question to awaiting-review and shows it as an agent message", async () => {
    const { api, port } = agentPort();
    api.emitBridgeEvent(started("task-1"));
    api.emitBridgeEvent({
      event_id: "task-1-q", task_id: "task-1", type: "task.question",
      ts: "2026-09-18T10:00:03Z",
      payload: { id: "q1", question: "Who is the audience?", options: [] },
    });

    const task = await port.agent.current("folder:default");
    expect(task?.status).toBe("awaiting-review");
    expect(task?.messages.some((message) => message.role === "agent" && message.text.includes("audience"))).toBe(true);
  });

  /*
   * A blocked run is a door, not a remark.
   *
   * The question used to arrive as an agent message and nothing else: no way to
   * answer it, and the composer — the only text box on screen — started a
   * *second* run while the first stayed blocked forever, with nothing on screen
   * saying so. These four pin the way through.
   */
  const asks = (taskId: string, payload: Record<string, unknown>) => ({
    event_id: `${taskId}-q`, task_id: taskId, type: "task.question" as const,
    ts: "2026-09-18T10:00:03Z", payload,
  });

  it("exposes the pending question, with its options", async () => {
    const { api, port } = agentPort();
    api.emitBridgeEvent(started("task-1"));
    api.emitBridgeEvent(asks("task-1", {
      id: "q1",
      question: "Who is the audience?",
      options: [{ id: "exec", label: "Executives", recommended: true }, { id: "eng", label: "Engineers" }],
      allow_freeform: true,
    }));

    const task = await port.agent.current("folder:default");
    expect(task?.question).toMatchObject({ id: "q1", text: "Who is the audience?", allowFreeform: true });
    expect(task?.question?.options.map((option) => option.id)).toEqual(["exec", "eng"]);
    expect(task?.question?.options[0]).toMatchObject({ recommended: true });
  });

  it("answers the blocked run instead of starting a second one", async () => {
    const { api, port } = agentPort();
    api.emitBridgeEvent(started("task-1"));
    api.emitBridgeEvent(asks("task-1", { id: "q1", question: "Who is the audience?", options: [], allow_freeform: true }));

    await port.agent.send({
      text: "Executives",
      folderId: "folder:default",
      mentions: [], attachments: [], modelId: "official", permission: "review",
      activeFileId: null,
    });

    expect(api.calls.map((call) => call.method)).toEqual(["respond"]);
    expect(api.calls[0].input).toMatchObject({ taskId: "task-1", questionId: "q1", answer: "Executives" });
  });

  it("carries the picked option back with the question it belongs to", async () => {
    const { api, port } = agentPort();
    api.emitBridgeEvent(started("task-1"));
    api.emitBridgeEvent(asks("task-1", {
      id: "q1", question: "Who is the audience?",
      options: [{ id: "exec", label: "Executives" }], allow_freeform: false,
    }));

    await port.agent.answer({ optionId: "exec" });

    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].input).toMatchObject({ taskId: "task-1", questionId: "q1", optionId: "exec" });
  });

  // Typing where only options are accepted is a dead end, and saying so beats
  // silently starting something else.
  it("says so rather than starting a run when the question takes no typed answer", async () => {
    const { api, port } = agentPort();
    const notices: string[] = [];
    port.agent.subscribe((event) => {
      if (event.kind === "notice") notices.push(event.message);
    });
    api.emitBridgeEvent(started("task-1"));
    api.emitBridgeEvent(asks("task-1", {
      id: "q1", question: "Who is the audience?",
      options: [{ id: "exec", label: "Executives" }], allow_freeform: false,
    }));

    await port.agent.send({
      text: "Executives",
      folderId: "folder:default",
      mentions: [], attachments: [], modelId: "official", permission: "review",
      activeFileId: null,
    });

    expect(api.calls).toHaveLength(0);
    expect(notices.join(" ")).toMatch(/Pick one of the options/);
  });

  // The contract carries no document type, so a new run infers one from the
  // instruction — the same rule the old Home used.
  it("starts a new run when nothing is open", async () => {
    const { api, port } = agentPort();
    await port.agent.send({
      text: "Build a launch deck for the new pricing",
      folderId: "folder:default",
      mentions: [], attachments: [], modelId: "official", permission: "review",
      activeFileId: null,
    });

    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].method).toBe("generate");
    expect(api.calls[0].input).toMatchObject({ noProject: true });
  });

  it("edits the open document instead of starting a new run", async () => {
    const { api, port } = agentPort({
      documents: [{ fileName: "deck.pptx", documentType: "pptx" }],
    });
    const file = (await port.files.list())[0];

    await port.agent.send({
      text: "Tighten the intro",
      folderId: "folder:default",
      mentions: [], attachments: [], modelId: "official", permission: "review",
      activeFileId: file.id,
    });

    expect(api.calls[0].method).toBe("modify");
    expect(api.calls[0].input).toMatchObject({ prompt: "Tighten the intro", documentType: "pptx" });
  });

  it("files a run into the folder it was sent from", async () => {
    const { api, port } = agentPort({
      folders: [{ id: "folder-research", name: "Research", path: "/tmp/officedex/Research" }],
    });
    await port.agent.send({
      text: "Summarise the interviews",
      folderId: "folder-research",
      mentions: [], attachments: [], modelId: "official", permission: "review",
      activeFileId: null,
    });

    expect(api.calls[0].input).toMatchObject({ workspaceId: "folder-research" });
  });

  it("ignores an empty instruction", async () => {
    const { api, port } = agentPort();
    await port.agent.send({
      text: "   ", folderId: "folder:default",
      mentions: [], attachments: [], modelId: "official", permission: "review",
      activeFileId: null,
    });
    expect(api.calls).toHaveLength(0);
  });

  // Holding a run at a page boundary only exists for presentations. Saying so
  // beats a button that silently does nothing. Asserted as a gap below.
  it("pauses and resumes a presentation", async () => {
    const { api, port } = agentPort();
    api.emitBridgeEvent(started("task-deck"));

    await expect(port.agent.pause()).resolves.toBeUndefined();
    await expect(port.agent.resume()).resolves.toBeUndefined();
  });

  // The apply/undo model has no desktop counterpart at all. The card stays in
  // the UI and both buttons report the gap rather than vanishing.
  it("has no suggestion, and names the gap when asked to apply one", async () => {
    const { api, port } = agentPort();
    api.emitBridgeEvent(started("task-1"));

    expect((await port.agent.current("folder:default"))?.suggestion).toBeNull();
    await expect(port.agent.applySuggestion("any")).rejects.toThrow(NotImplementedError);
    await expect(port.agent.undoSuggestion("any")).rejects.toThrow(NotImplementedError);
  });

  // Pausing exists for presentations only. Same rule: a named gap, so the
  // control can say so instead of failing like a bug.
  it("reports pausing a non-presentation as a gap", async () => {
    const { api, port } = agentPort();
    api.emitBridgeEvent({
      event_id: "task-doc-start", task_id: "task-doc", type: "task.started",
      ts: "2026-09-18T10:00:00Z", payload: { document_type: "docx" },
    });

    await expect(port.agent.pause()).rejects.toThrow(NotImplementedError);
    await expect(port.agent.pause()).rejects.toThrow(/presentation/i);
  });

  // The composer gathers mentions and attachments and the generate path takes
  // neither. The run still goes ahead; what was dropped is said out loud.
  it("sends without the parts it cannot carry, and says which", async () => {
    const { api, port } = agentPort();
    const notices: string[] = [];
    port.agent.subscribe((event) => {
      if (event.kind === "notice") notices.push(event.message);
    });

    await port.agent.send({
      text: "Summarise this",
      folderId: "folder:default",
      mentions: [{ kind: "file", id: "f1", label: "notes.docx" }],
      attachments: [{ id: "a1", name: "chart.png", size: 1024 }],
      modelId: "official",
      permission: "review",
      activeFileId: null,
    });

    // The run happened.
    expect(api.calls).toHaveLength(1);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/attachments/);
  });

  it("carries native attachment paths into the agent prompt", async () => {
    const { api, port } = agentPort();
    const notices: string[] = [];
    port.agent.subscribe((event) => {
      if (event.kind === "notice") notices.push(event.message);
    });

    await port.agent.send({
      text: "Use the attached workbook",
      folderId: "folder:default",
      mentions: [],
      attachments: [{ id: "a1", name: "budget.xlsx", size: 0, path: "/tmp/budget.xlsx" }],
      modelId: "official",
      permission: "full",
      activeFileId: null,
    });

    expect(api.calls[0]?.input.prompt).toMatch(/budget\.xlsx/);
    expect(api.calls[0]?.input.prompt).toMatch(/\/tmp\/budget\.xlsx/);
    expect(notices).toEqual([]);
  });

  it("says nothing for a supported full-access run", async () => {
    const { port } = agentPort();
    const notices: string[] = [];
    port.agent.subscribe((event) => {
      if (event.kind === "notice") notices.push(event.message);
    });

    await port.agent.send({
      text: "Summarise this",
      folderId: "folder:default",
      mentions: [], attachments: [], modelId: "official", permission: "full",
      activeFileId: null,
    });

    expect(notices).toEqual([]);
  });

  it("does not warn for full access, which matches the direct-write runtime", async () => {
    const { port } = agentPort();
    const notices: string[] = [];
    port.agent.subscribe((event) => {
      if (event.kind === "notice") notices.push(event.message);
    });

    await port.agent.send({
      text: "Apply the edits",
      folderId: "folder:default",
      mentions: [],
      attachments: [],
      modelId: "official",
      permission: "full",
      activeFileId: null,
    });

    expect(notices).toEqual([]);
  });

  it("carries an editor selection into the runtime prompt", async () => {
    const { api, port } = agentPort();
    await port.agent.send({
      text: "Tighten this paragraph",
      folderId: "folder:default",
      mentions: [],
      attachments: [],
      modelId: "official",
      permission: "review",
      activeFileId: null,
      reference: {
        fileId: "file-notes",
        label: "notes.docx · Introduction",
        text: "This is the selected paragraph.",
      },
    });

    expect(api.calls[0]?.input.prompt).toContain("Selected passage from notes.docx · Introduction");
    expect(api.calls[0]?.input.prompt).toContain("This is the selected paragraph.");
  });

  it("carries mentioned file names into the runtime prompt", async () => {
    const { api, port } = agentPort();
    await port.agent.send({
      text: "Summarise these sources",
      folderId: "folder:default",
      mentions: [{ kind: "file", id: "file-notes", label: "notes.docx" }],
      attachments: [],
      modelId: "official",
      permission: "review",
      activeFileId: null,
    });

    expect(api.calls[0]?.input.prompt).toContain("Mentioned files or folders: @notes.docx");
  });
});
