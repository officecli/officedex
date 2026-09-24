import { beforeEach, describe, expect, it } from "vitest";
import { createDesktopUiPort } from "../createDesktopUiPort";
import { createFakeDesktopApi } from "./fakeDesktopApi";
import { describeUiPortContract } from "./uiPortContract";
import { NotImplementedError } from "../../shared/notImplemented";
import type { BridgeEvent, TaskHistoryEntry } from "../../shared/types";
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

  // The desktop produces gif and report too. They have no FileType, and a GIF
  // shown as a "document" would open an editor that cannot read it. A generated
  // picture does have one: filtering `img` out is what left a finished image
  // run on "No file open", because the shell could not find its artifact.
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

    expect(files.map((file) => file.type).sort()).toEqual(["doc", "image", "slides"]);
  });

  it("keeps a generated image findable by the task that produced it", async () => {
    const port = createDesktopUiPort({
      api: createFakeDesktopApi({
        documents: [{ fileName: "poster.png", documentType: "img", currentArtifactTaskId: "task-image" }],
      }),
      window: stubWindow(),
    });

    await expect(port.files.list()).resolves.toEqual([
      expect.objectContaining({ name: "poster.png", type: "image", artifactTaskId: "task-image" }),
    ]);
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

  // The Wails runtime reports native drops; the port only forwards them.
  it("forwards files dropped onto the window", async () => {
    const api = createFakeDesktopApi();
    const port = createDesktopUiPort({ api, window: stubWindow() });
    const seen: string[][] = [];

    const off = port.files.onDropFromDisk((paths) => seen.push(paths));
    api.dropFiles(["/Users/me/a.docx", "/Users/me/b.pptx"]);
    off();
    api.dropFiles(["/Users/me/c.xlsx"]);

    expect(seen).toEqual([["/Users/me/a.docx", "/Users/me/b.pptx"]]);
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

  /*
   * Removing a file has to remove the row the list shows.
   *
   * This used to forget the recent-files entry and nothing else, while `list`
   * reads the document projection — so the row returned on the next reload and
   * the sidebar's Remove looked like a dead control.
   */
  it("removes the file from the list, not just from recents", async () => {
    const api = createFakeDesktopApi({
      documents: [
        { fileName: "deck.pptx", documentType: "pptx" },
        { fileName: "plan.docx", documentType: "docx" },
      ],
    });
    const port = createDesktopUiPort({ api, window: stubWindow() });
    const target = (await port.files.list()).find((file) => file.name === "deck.pptx")!;

    await port.files.remove(target.id);

    expect((await port.files.list()).map((file) => file.name)).toEqual(["plan.docx"]);
  });

  // Pressing the same menu item twice is not a failure.
  it("treats removing an already-removed file as done", async () => {
    const api = createFakeDesktopApi({ documents: [{ fileName: "deck.pptx", documentType: "pptx" }] });
    const port = createDesktopUiPort({ api, window: stubWindow() });
    const target = (await port.files.list())[0];

    await port.files.remove(target.id);
    await expect(port.files.remove(target.id)).resolves.toBeUndefined();
  });

  // An older runtime has no document-level removal. A generated file can still
  // go through its task; an imported one cannot, and says so.
  it("names the gap when an older runtime cannot remove an imported file", async () => {
    const api = createFakeDesktopApi({ documents: [{ fileName: "deck.pptx", documentType: "pptx" }] });
    const { removeDocument: _dropped, ...older } = api;
    const port = createDesktopUiPort({ api: older as typeof api, window: stubWindow() });
    const target = (await port.files.list())[0];

    await expect(port.files.remove(target.id)).rejects.toThrow(NotImplementedError);
  });

  it("falls back to the task behind a generated file on an older runtime", async () => {
    const api = createFakeDesktopApi({
      documents: [{ fileName: "deck.pptx", documentType: "pptx", currentArtifactTaskId: "task-deck" }],
    });
    const { removeDocument: _dropped, ...older } = api;
    const port = createDesktopUiPort({ api: older as typeof api, window: stubWindow() });
    const target = (await port.files.list())[0];

    await expect(port.files.remove(target.id)).resolves.toBeUndefined();
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
    // The default, which is `full`: the only permission mode the runtime
    // honours, so it is the one a discarded value falls back to.
    expect(settings.permission).toBe("full");
  });

  // A stored mode the runtime cannot honour is dropped on read rather than
  // handed back. `unsupportedParts()` downgrades review to a direct write
  // anyway, so returning it would have the composer promise a gate and the run
  // quietly not keep it.
  it("discards a stored permission mode the runtime does not support", async () => {
    localStorage.setItem(
      "officedex.shell.settings",
      JSON.stringify({ permission: "review", enterToSend: false }),
    );
    const settings = await createPort().settings.get();

    expect(settings.permission).toBe("full");
    // Only the unsupported field is dropped; the rest of the value stands.
    expect(settings.enterToSend).toBe(false);
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

  /**
   * `agent.list` — what Home's "Continue working" band is drawn from.
   *
   * These exercise the recorded half of the service rather than the live half.
   * That half had no coverage at all: `getTaskHistory` returned `[]` from the
   * fake, so every existing test here replayed events the window had seen for
   * itself. For `list` that is the wrong half entirely — its whole purpose is
   * work from before this window opened.
   */
  describe("the task list", () => {
    /** A run the desktop already has on disk, as a history page would carry it. */
    const recorded = (
      taskId: string,
      { at, workspaceId, finished = true }: { at: string; workspaceId?: string; finished?: boolean },
    ): TaskHistoryEntry => ({
      taskId,
      createdAt: at,
      ...(workspaceId ? { workspaceId } : {}),
      events: [
        { ...started(taskId), ts: at },
        ...(finished
          ? [{ event_id: `${taskId}-done`, task_id: taskId, type: "task.completed", ts: at, payload: {} }]
          : []),
      ] as BridgeEvent[],
    });

    /**
     * The reason this method exists. `current` answers for one folder, so the
     * run the user started somewhere else vanishes the moment they switch —
     * off the one screen whose job is to say what they were doing.
     */
    it("lists runs from every folder, not just the one in scope", async () => {
      const { port } = agentPort({
        folders: [{ id: "folder-research", name: "Research", path: "/tmp/officedex/Research" }],
        taskHistory: [
          recorded("task-research", { at: "2026-09-18T12:00:00Z", workspaceId: "folder-research" }),
          recorded("task-default", { at: "2026-09-18T11:00:00Z" }),
        ],
      });

      const rows = await port.agent.list();
      expect(rows.map((row) => row.id)).toEqual(["task-research", "task-default"]);
      expect(rows.map((row) => row.folderId)).toEqual(["folder-research", "folder:default"]);

      // The same two runs asked for the old way: one folder, one answer.
      expect((await port.agent.current("folder-research"))?.id).toBe("task-research");
    });

    it("puts the most recently touched run first, whatever order history arrives in", async () => {
      const { port } = agentPort({
        taskHistory: [
          recorded("task-middle", { at: "2026-09-18T11:00:00Z" }),
          recorded("task-newest", { at: "2026-09-18T13:00:00Z" }),
          recorded("task-oldest", { at: "2026-09-18T09:00:00Z" }),
        ],
      });

      expect((await port.agent.list()).map((row) => row.id)).toEqual([
        "task-newest",
        "task-middle",
        "task-oldest",
      ]);
    });

    /**
     * History says what happened; live events say what is happening. A page
     * fetched mid-run is a snapshot of whatever the writer had flushed, so
     * letting it win would roll a running task back to "done" under the user.
     */
    it("does not let a recorded snapshot roll back a run that is still going", async () => {
      const { api, port } = agentPort({
        taskHistory: [
          recorded("task-1", { at: "2026-09-18T10:00:00Z" }),
          recorded("task-older", { at: "2026-09-18T09:00:00Z" }),
        ],
      });
      api.emitBridgeEvent(started("task-1"));

      const rows = await port.agent.list();
      // `task-older` is here to prove the page was read at all — without it
      // this passes just as well against a history that came back empty.
      expect(rows.map((row) => row.id)).toEqual(["task-1", "task-older"]);
      expect(rows[0].status).toBe("reading");
      expect(rows[1].status).toBe("done");
    });

    it("bounds the list, by default and on request", async () => {
      const { port } = agentPort({
        taskHistory: Array.from({ length: 10 }, (_, index) =>
          recorded(`task-${index}`, { at: `2026-09-18T${String(10 + index).padStart(2, "0")}:00:00Z` }),
        ),
      });

      expect(await port.agent.list()).toHaveLength(8);
      expect(await port.agent.list({ limit: 3 })).toHaveLength(3);
    });

    /**
     * The band is drawn without anyone asking for it, so a history page that
     * cannot be read must cost the user the rows it would have added and
     * nothing else — not the run they can see happening.
     */
    it("still lists live work when the history page cannot be read", async () => {
      const { api, port } = agentPort();
      api.emitBridgeEvent(started("task-live"));
      api.getTaskHistory = async () => {
        throw new Error("bridge is down");
      };

      expect((await port.agent.list()).map((row) => row.id)).toEqual(["task-live"]);
    });

    /**
     * Opening a folder is the user saying what they are working on; drawing a
     * list is not. If listing moved the target, Home would silently repoint
     * Pause, Resume and Finish at whichever run happened to sort first.
     */
    it("does not retarget the active run while drawing the list", async () => {
      const { api, port } = agentPort({
        taskHistory: [recorded("task-newer", { at: "2026-09-18T14:00:00Z" })],
      });
      api.emitBridgeEvent(started("task-mine"));
      await port.agent.current("folder:default");

      // `task-newer` sorts above `task-mine`, so a list that retargeted would
      // pause the wrong run here. Asserted rather than assumed: if the history
      // page were empty this test would pass without ever setting up its own
      // premise.
      const rows = await port.agent.list();
      expect(rows.map((row) => row.id)).toEqual(["task-newer", "task-mine"]);

      await port.agent.pause();

      expect(api.calls.filter((call) => call.method === "pausePptx")).toEqual([
        { method: "pausePptx", input: { taskId: "task-mine" } },
      ]);
    });

    // `updatedAt` is optional so a consumer can tell "the runtime did not say"
    // from a real timestamp. Sending 0 would date every undated run to 1970 and
    // sort it against runs that have a real time.
    it("omits updatedAt when nothing in the record carries a time", async () => {
      const { port } = agentPort({
        taskHistory: [{ taskId: "task-undated", events: [{ ...started("task-undated"), ts: "" }] as BridgeEvent[] }],
      });

      const [row] = await port.agent.list();
      expect(row.id).toBe("task-undated");
      expect("updatedAt" in row).toBe(false);
    });
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

  /*
   * The stage the agent spends most of a document run in.
   *
   * `toStatus` used to test `activeStageId.includes("draw") ||
   * .includes("write")` against ids `taskState.ts` assigns itself — no id
   * contains "draw", and "writing" does not contain "write", so the only match
   * was the two-second `write` step that copies the finished file to disk. A
   * document therefore read "Agent reading" for the whole minute the model was
   * writing it.
   */
  it("says the agent is writing while it generates content", async () => {
    const { api, port } = agentPort();
    const seen: string[] = [];
    port.agent.subscribe((event) => {
      if (event.kind === "task") seen.push(event.task.status);
    });

    api.emitBridgeEvent(started("task-1"));
    api.emitBridgeEvent({
      event_id: "task-1-generate",
      task_id: "task-1",
      type: "task.progress",
      ts: "2026-09-18T10:00:05Z",
      payload: { step: "generate_llm", status: "running", content: "Requesting DOCX content" },
    });

    expect(seen.at(-1)).toBe("writing");
  });

  it("stays on reading for a stage it does not recognise", async () => {
    const { api, port } = agentPort();
    const seen: string[] = [];
    port.agent.subscribe((event) => {
      if (event.kind === "task") seen.push(event.task.status);
    });

    api.emitBridgeEvent(started("task-1"));
    api.emitBridgeEvent({
      event_id: "task-1-odd",
      task_id: "task-1",
      type: "task.progress",
      ts: "2026-09-18T10:00:05Z",
      payload: { step: "something.new", status: "running" },
    });

    // Not `working`: that means "has not begun", and this run plainly has.
    expect(seen.at(-1)).toBe("reading");
  });

  // AgentStatus has no failure state, so a failed run is reported twice: the
  // task turns done, and an error event says why.
  it("reports a failure as done plus an error event", async () => {
    const { api, port } = agentPort();
    const events: string[] = [];
    port.agent.subscribe((event) => {
      if (event.kind === "task") events.push(`task:${event.task.status}`);
      else if (event.kind === "error") events.push(`error:${event.message}`);
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

  it("finishes a run before the first bridge event has arrived", async () => {
    const { api, port } = agentPort();
    await port.agent.send({
      text: "Write a deck",
      folderId: "folder:default",
      mentions: [],
      attachments: [],
      modelId: "official",
      permission: "full",
      activeFileId: null,
    });

    await port.agent.finish();

    expect(api.calls.filter((call) => call.method === "cancel")).toEqual([
      { method: "cancel", input: { taskId: "task-1" } },
    ]);
  });

  it("keeps finishing the run that was just sent, not an older recorded one", async () => {
    const { api, port } = agentPort({
      taskHistory: [{
        taskId: "task-stale",
        events: [started("task-stale")],
      }],
    });
    await port.agent.send({
      text: "Write a deck",
      folderId: "folder:default",
      mentions: [],
      attachments: [],
      modelId: "official",
      permission: "full",
      activeFileId: null,
    });
    await port.agent.current("folder:default");

    await port.agent.finish();

    expect(api.calls.filter((call) => call.method === "cancel")).toEqual([
      { method: "cancel", input: { taskId: "task-1" } },
    ]);
  });

  it("treats a missing bridge task as already finished", async () => {
    const { api, port } = agentPort();
    await port.agent.send({
      text: "Write a deck",
      folderId: "folder:default",
      mentions: [],
      attachments: [],
      modelId: "official",
      permission: "full",
      activeFileId: null,
    });
    api.failNextCancel(new Error("[kind:task] [code:task_not_found] bridge: task not found: task-1"));

    await expect(port.agent.finish()).resolves.toBeUndefined();
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

/*
 * One conversation, several runs.
 *
 * Every message typed into the panel used to go out with no conversation id,
 * and the desktop defaults a run's conversation to its own id — so each
 * follow-up was a conversation of its own: a new row on Home, a panel that
 * forgot everything said before it, and a runtime that was never told.
 */
describe("desktop agent conversations", () => {
  const FOLDER = "folder:default";

  function setup(seed: Parameters<typeof createFakeDesktopApi>[0] = {}) {
    const api = createFakeDesktopApi(seed);
    return { api, port: createDesktopUiPort({ api, window: stubWindow() }) };
  }

  const say = (text: string, extra: Record<string, unknown> = {}) => ({
    text,
    folderId: FOLDER,
    mentions: [],
    attachments: [],
    modelId: "official",
    permission: "full" as const,
    activeFileId: null,
    ...extra,
  });

  const completed = (taskId: string, payload: Record<string, unknown> = {}): BridgeEvent => ({
    event_id: `${taskId}-done`,
    task_id: taskId,
    type: "task.completed",
    ts: "2026-09-23T10:00:05Z",
    payload,
  });

  const generateCalls = (api: ReturnType<typeof createFakeDesktopApi>) =>
    api.calls.filter((call) => call.method === "generate" || call.method === "modify");

  it("sends a follow-up as part of the conversation the panel shows", async () => {
    const { api, port } = setup();
    await port.agent.send(say("Write a memo about the offsite"));
    api.emitBridgeEvent(completed("task-1"));
    await port.agent.send(say("Make it shorter"));

    const [first, second] = generateCalls(api);
    expect(first.input.conversationId).toBeUndefined();
    expect(second.input).toMatchObject({ conversationId: "task-1", parentTaskId: "task-1" });
  });

  it("tells the runtime what was said before, and shows only what was typed", async () => {
    const { api, port } = setup();
    await port.agent.send(say("Write a memo about the offsite"));
    api.emitBridgeEvent(completed("task-1"));
    await port.agent.send(say("Make it shorter"));

    const prompt = String(generateCalls(api)[1].input.prompt);
    expect(prompt.startsWith("Make it shorter")).toBe(true);
    expect(prompt).toContain("User: Write a memo about the offsite");

    const task = await port.agent.current(FOLDER);
    expect(task?.id).toBe("task-2");
    expect(task?.conversationId).toBe("task-1");
    expect(task?.messages.filter((message) => message.role === "user").map((message) => message.text)).toEqual([
      "Write a memo about the offsite",
      "Make it shorter",
    ]);
  });

  it("does not add a context block to the first message", async () => {
    const { api, port } = setup();
    await port.agent.send(say("Write a memo about the offsite"));
    expect(generateCalls(api)[0].input.prompt).toBe("Write a memo about the offsite");
  });

  it("lists a conversation once on Home, however many runs it has", async () => {
    const { api, port } = setup();
    await port.agent.send(say("Write a memo about the offsite"));
    api.emitBridgeEvent(completed("task-1"));
    await port.agent.send(say("Make it shorter"));

    const rows = await port.agent.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "task-1", conversationId: "task-1" });
  });

  it("starts a new conversation when the message says so", async () => {
    const { api, port } = setup();
    const cleared: string[] = [];
    port.agent.subscribe((event) => {
      if (event.kind === "cleared") cleared.push(event.folderId);
    });
    await port.agent.send(say("Write a memo about the offsite"));
    api.emitBridgeEvent(completed("task-1"));
    await port.agent.send(say("Plan the Q4 budget", { newConversation: true }));

    const second = generateCalls(api)[1];
    expect(second.input.conversationId).toBeUndefined();
    expect(second.input.prompt).toBe("Plan the Q4 budget");
    expect(cleared).toEqual([FOLDER]);
    expect((await port.agent.current(FOLDER))?.conversationId).toBe("task-2");
    expect(await port.agent.list()).toHaveLength(2);
  });

  it("empties the panel on New conversation, and the next message starts one", async () => {
    const { api, port } = setup();
    await port.agent.send(say("Write a memo about the offsite"));
    api.emitBridgeEvent(completed("task-1"));

    await port.agent.startConversation(FOLDER);
    expect(await port.agent.current(FOLDER)).toBeNull();

    await port.agent.send(say("Plan the Q4 budget"));
    expect(generateCalls(api)[1].input.conversationId).toBeUndefined();
  });

  it("changes what the conversation made when a follow-up has nothing open", async () => {
    const { api, port } = setup({
      documents: [{ fileName: "offsite memo.docx", documentType: "docx", currentArtifactTaskId: "task-1" }],
    });
    await port.agent.send(say("Write a memo about the offsite", { documentType: "docx" }));
    api.emitBridgeEvent(completed("task-1", {
      file_path: "/tmp/officedex/offsite memo.docx",
      file_name: "offsite memo.docx",
      document_type: "docx",
    }));
    await port.agent.send(say("Make it shorter"));

    const second = generateCalls(api)[1];
    expect(second.method).toBe("modify");
    expect(second.input).toMatchObject({
      sourceFile: "/tmp/officedex/offsite memo.docx",
      documentType: "docx",
      conversationId: "task-1",
    });
    expect(String(second.input.prompt)).toContain("Result: wrote offsite memo.docx");
  });

  it("still makes a new file when the follow-up names a type", async () => {
    const { api, port } = setup({
      documents: [{ fileName: "offsite memo.docx", documentType: "docx", currentArtifactTaskId: "task-1" }],
    });
    await port.agent.send(say("Write a memo about the offsite", { documentType: "docx" }));
    api.emitBridgeEvent(completed("task-1", { file_path: "/tmp/officedex/offsite memo.docx", document_type: "docx" }));
    await port.agent.send(say("Now turn it into slides", { documentType: "pptx" }));

    const second = generateCalls(api)[1];
    expect(second.method).toBe("generate");
    expect(second.input).toMatchObject({ documentType: "pptx", conversationId: "task-1" });
  });

  it("keeps an in-place edit in the thread and tells the runtime about it", async () => {
    const { api, port } = setup();
    await port.agent.send(say("Write a memo about the offsite"));
    api.emitBridgeEvent(completed("task-1"));
    await port.agent.recordExchange({
      folderId: FOLDER,
      messages: [
        // After the run, on the same clock the service stamps runs with.
        { id: "local-1", role: "user", text: "Bold the agenda", createdAt: Date.now() + 1000 },
        { id: "local-2", role: "agent", text: "Made the agenda bold.", createdAt: Date.now() + 2000 },
      ],
    });

    expect((await port.agent.current(FOLDER))?.messages.map((message) => message.text)).toEqual([
      "Write a memo about the offsite",
      "Bold the agenda",
      "Made the agenda bold.",
    ]);

    await port.agent.send(say("Now add a dress code line"));
    expect(String(generateCalls(api)[1].input.prompt)).toContain("User: Bold the agenda");
  });

  it("shows the message just sent before the runtime says anything", async () => {
    const { port } = setup();
    await port.agent.send(say("Write a memo about the offsite"));
    const task = await port.agent.current(FOLDER);
    expect(task?.messages.map((message) => message.text)).toEqual(["Write a memo about the offsite"]);
  });

  it("does not let a run in another conversation take over the panel", async () => {
    const { api, port } = setup();
    const focused: Array<[string, boolean | undefined]> = [];
    port.agent.subscribe((event) => {
      if (event.kind === "task") focused.push([event.task.id, event.focused]);
    });
    await port.agent.send(say("Write a memo about the offsite"));
    await port.agent.send(say("Plan the Q4 budget", { newConversation: true }));
    api.emitBridgeEvent(completed("task-1"));

    expect(focused.filter(([id]) => id === "task-1").at(-1)?.[1]).toBe(false);
    expect((await port.agent.current(FOLDER))?.id).toBe("task-2");
  });
});
