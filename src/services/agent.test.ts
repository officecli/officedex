/**
 * The agent service over a scripted desktop API — what `send` decides, and
 * what the panel is told about it.
 *
 * These are the four 1.0.11 acceptance findings that share one root: `send`
 * chose its target and its format by heuristics, and run ids were mixed up
 * with conversation ids. Each test drives the service the way the shell does
 * (send, bridge events, Stop) and asserts on the calls the desktop received
 * and the events the panel got.
 */
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BridgeEvent, DesktopAPI, DocumentRecord, GenerateInput, ModifyInput } from "../shared/types";
import type { AgentEvent, AgentTask, SendInput } from "../shared/uiPort";
import { createAgentService, referencedFileIds, requestsFormatChoice, reviewRequestedBy } from "./agent";

interface Scripted {
  api: DesktopAPI;
  calls: { generate: GenerateInput[]; modify: ModifyInput[]; cancel: string[] };
  /** Delivers a bridge event as the Go side would. */
  push: (event: BridgeEvent) => void;
  addDocument: (record: Partial<DocumentRecord> & Pick<DocumentRecord, "id" | "filePath" | "documentType">) => DocumentRecord;
}

function scripted(startSerial = 0): Scripted {
  const listeners: Array<(event: BridgeEvent) => void> = [];
  const documents = new Map<string, DocumentRecord>();
  const calls: Scripted["calls"] = { generate: [], modify: [], cancel: [] };
  let serial = startSerial;
  const api = {
    onBridgeEvent(callback: (event: BridgeEvent) => void) {
      listeners.push(callback);
      return () => undefined;
    },
    async getTaskHistory() {
      return [];
    },
    async getSettings() {
      return { defaults: { documentType: "pptx", enableImages: false, enableWebSearch: false, imageQuality: "standard" } };
    },
    async getDocument(id: string) {
      const record = documents.get(id);
      if (!record) throw new Error(`no document ${id}`);
      return record;
    },
    async importLocalFile(path: string) {
      const record = [...documents.values()].find(item => item.filePath === path);
      if (!record) throw new Error(`missing file ${path}`);
      return record;
    },
    async listDocuments() {
      return { items: [...documents.values()], total: documents.size };
    },
    async generate(input: GenerateInput) {
      calls.generate.push(input);
      serial += 1;
      return { taskId: `task-${serial}`, sessionId: "session", status: "running" };
    },
    async modify(input: ModifyInput) {
      calls.modify.push(input);
      serial += 1;
      return { taskId: `task-${serial}`, sessionId: "session", status: "running", sourceSHA256: "a".repeat(64) };
    },
    async cancel(taskId: string) {
      calls.cancel.push(taskId);
      return {};
    },
    async respond() {
      return {};
    },
    async applyArtifactSuggestion() {},
    async undoArtifactSuggestion() {},
  } as unknown as DesktopAPI;
  return {
    api,
    calls,
    push: (event) => {
      for (const listener of listeners) listener(event);
    },
    addDocument: (record) => {
      const full: DocumentRecord = {
        fileName: record.filePath.split("/").pop() ?? record.filePath,
        createdAt: "2026-10-08T00:00:00Z",
        updatedAt: "2026-10-08T00:00:00Z",
        migrationSource: "",
        pinned: false,
        ...record,
      };
      documents.set(full.id, full);
      return full;
    },
  };
}

const FOLDER = "project:1";

function message(text: string, patch: Partial<SendInput> = {}): SendInput {
  return {
    text,
    folderId: FOLDER,
    mentions: [],
    attachments: [],
    modelId: "m",
    permission: "full",
    activeFileId: null,
    ...patch,
  };
}

const completed = (taskId: string, filePath: string, documentType: string): BridgeEvent => ({
  event_id: `${taskId}:done`,
  task_id: taskId,
  type: "task.completed",
  ts: new Date().toISOString(),
  payload: { result: { file_path: filePath, file_name: filePath.split("/").pop(), document_type: documentType } },
});

const running = (taskId: string): BridgeEvent => ({
  event_id: `${taskId}:start`,
  task_id: taskId,
  type: "task.started",
  ts: new Date().toISOString(),
  payload: {},
});

/** Collects what the panel would see. */
function listen(service: ReturnType<typeof createAgentService>) {
  const events: AgentEvent[] = [];
  service.subscribe((event) => events.push(event));
  return {
    events,
    tasks: () => events.filter((event): event is Extract<AgentEvent, { kind: "task" }> => event.kind === "task").map((event) => event.task),
    last: (): AgentTask | undefined => {
      const tasks = events.filter((event): event is Extract<AgentEvent, { kind: "task" }> => event.kind === "task");
      return tasks.at(-1)?.task;
    },
    errors: () => events.filter((event) => event.kind === "error").map((event) => (event as { message: string }).message),
    notices: () => events.filter((event) => event.kind === "notice").map((event) => (event as { message: string }).message),
  };
}

/** A conversation whose first run made a deck, as the F02 report had it. */
async function conversationWithDeck(desk: Scripted) {
  const service = createAgentService(desk.api);
  const panel = listen(service);
  await service.send(message("Make a launch deck", { newConversation: true }));
  const deckTask = desk.calls.generate.length ? "task-1" : "";
  desk.push(running(deckTask));
  const deck = desk.addDocument({ id: "doc-deck", filePath: "/p/Launch deck.pptx", documentType: "pptx", currentArtifactTaskId: deckTask });
  desk.push(completed(deckTask, deck.filePath, "pptx"));
  return { service, panel, deck, deckTask };
}

afterEach(() => {
  localStorage.clear();
});

describe("F02 — which file a follow-up edits", () => {
  it("edits the one file the message mentions, not the last file the conversation made", async () => {
    const desk = scripted();
    const { service } = await conversationWithDeck(desk);
    const report = desk.addDocument({ id: "doc-report", filePath: "/p/Q3 report.docx", documentType: "docx" });

    await service.send(message("Change one sentence in the intro", { mentions: [{ kind: "file", id: report.id, label: "Q3 report.docx" }] }));

    expect(desk.calls.modify).toHaveLength(1);
    expect(desk.calls.modify[0].sourceFile).toBe(report.filePath);
    expect(desk.calls.modify[0].documentType).toBe("docx");
    expect(desk.calls.generate).toHaveLength(1);
  });

  it("takes the quoted passage's file as the target too", async () => {
    const desk = scripted();
    const { service } = await conversationWithDeck(desk);
    const report = desk.addDocument({ id: "doc-report", filePath: "/p/Q3 report.docx", documentType: "docx" });

    await service.send(message("Tighten this", { reference: { fileId: report.id, label: "Q3 report.docx · Intro", text: "We are pleased..." } }));

    expect(desk.calls.modify.map((call) => call.sourceFile)).toEqual([report.filePath]);
  });

  it("falls back to the last file this conversation made only when nothing is named, and says so", async () => {
    const desk = scripted();
    const { service, panel, deck } = await conversationWithDeck(desk);

    await service.send(message("Make it shorter"));

    expect(desk.calls.modify.map((call) => call.sourceFile)).toEqual([deck.filePath]);
    const texts = panel.last()?.messages.map((entry) => entry.text) ?? [];
    expect(texts.some((text) => text.includes("Editing Launch deck.pptx") && text.includes("last file this conversation made"))).toBe(true);
  });

  it("does not fall back to the last file when the words ask for another kind of file", async () => {
    const desk = scripted();
    const { service } = await conversationWithDeck(desk);

    await service.send(message("再帮我写一份预算表格"));

    expect(desk.calls.modify).toHaveLength(0);
    expect(desk.calls.generate.map((call) => call.documentType)).toEqual(["pptx", "xlsx"]);
  });

  it("still edits the last file when the words name its own kind", async () => {
    const desk = scripted();
    const { service, deck } = await conversationWithDeck(desk);

    await service.send(message("把这份 PPT 压缩到 5 页"));

    expect(desk.calls.modify.map((call) => call.sourceFile)).toEqual([deck.filePath]);
  });

  it("does not fall back to the last file when the message names a folder or a non-editable file", async () => {
    const desk = scripted();
    const { service } = await conversationWithDeck(desk);
    const picture = desk.addDocument({ id: "doc-img", filePath: "/p/hero.png", documentType: "img" });

    await service.send(message("Write a memo about this", { mentions: [{ kind: "file", id: picture.id, label: "hero.png" }] }));

    expect(desk.calls.modify).toHaveLength(0);
    expect(desk.calls.generate).toHaveLength(2);
  });

  it("modifies multiple targets sequentially without generating an unrelated file", async () => {
    const desk = scripted();
    const { service, panel } = await conversationWithDeck(desk);
    const a = desk.addDocument({ id: "doc-a", filePath: "/p/A.docx", documentType: "docx" });
    const b = desk.addDocument({ id: "doc-b", filePath: "/p/B.docx", documentType: "docx" });

    await service.send(message("Update these, do not create a PPT", { mentions: [{ kind: "file", id: a.id, label: "A.docx" }, { kind: "file", id: b.id, label: "B.docx" }] }));
    expect(desk.calls.modify).toHaveLength(1);
    expect(desk.calls.modify[0].sourceFile).toBe("/p/A.docx");
    desk.push({ event_id: "fail-a", task_id: "task-2", type: "task.failed", ts: new Date().toISOString(), payload: { message: "corrupt DOCX" } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(desk.calls.modify).toHaveLength(2);
    expect(desk.calls.modify[1].sourceFile).toBe("/p/B.docx");
    desk.push(completed("task-3", "/p/B.modified.docx", "docx"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(panel.last()?.batch?.map((item) => item.status)).toEqual(["failed", "completed"]);
    await service.retryBatch!("task-3");
    expect(desk.calls.modify).toHaveLength(3);
    expect(desk.calls.modify[2].sourceFile).toBe("/p/A.docx");
    expect(desk.calls.generate).toHaveLength(1);
  });

  it("keeps the open file as the target over a mention", async () => {
    const desk = scripted();
    const service = createAgentService(desk.api);
    const open = desk.addDocument({ id: "doc-open", filePath: "/p/Open.docx", documentType: "docx" });
    const other = desk.addDocument({ id: "doc-other", filePath: "/p/Other.docx", documentType: "docx" });

    await service.send(message("Use the tone of the other one", { activeFileId: open.id, mentions: [{ kind: "file", id: other.id, label: "Other.docx" }] }));

    expect(desk.calls.modify.map((call) => call.sourceFile)).toEqual([open.filePath]);
  });

  it("does not retry a batch file the user removed from the queue", async () => {
    const desk = scripted();
    const { service, panel } = await conversationWithDeck(desk);
    const a = desk.addDocument({ id: "doc-a", filePath: "/p/A.docx", documentType: "docx" });
    const b = desk.addDocument({ id: "doc-b", filePath: "/p/B.docx", documentType: "docx" });
    await service.send(message("Update these", { mentions: [{ kind: "file", id: a.id, label: "A.docx" }, { kind: "file", id: b.id, label: "B.docx" }] }));
    await service.removeQueued!("task-2", panel.last()!.queued![0].id);
    desk.push({ event_id: "fail-a", task_id: "task-2", type: "task.failed", ts: new Date().toISOString(), payload: { message: "failed" } });
    await service.retryBatch!("task-2");
    desk.push(completed("task-3", "/p/A.modified.docx", "docx"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(desk.calls.modify.map((call) => call.sourceFile)).toEqual(["/p/A.docx", "/p/A.docx"]);
  });

  it("continues a batch when the first file fails before allocating a runtime task", async () => {
    const desk = scripted();
    const { service, panel } = await conversationWithDeck(desk);
    const a = desk.addDocument({ id: "doc-a", filePath: "/p/A.docx", documentType: "docx" });
    const b = desk.addDocument({ id: "doc-b", filePath: "/p/B.docx", documentType: "docx" });
    vi.spyOn(desk.api, "modify").mockRejectedValueOnce(new Error("Cannot read A.docx"));
    await service.send(message("Update these", { mentions: [{ kind: "file", id: a.id, label: "A.docx" }, { kind: "file", id: b.id, label: "B.docx" }] }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(desk.calls.modify.map((call) => call.sourceFile)).toEqual(["/p/B.docx"]);
    desk.push(completed("task-2", "/p/B.modified.docx", "docx"));
    expect(panel.last()?.batch?.map((item) => item.status)).toEqual(["failed", "completed"]);
    expect(panel.last()?.batch?.[0].error).toBe("Cannot read A.docx");
  });

  it("collects each referenced file once", () => {
    expect(
      referencedFileIds({
        mentions: [{ kind: "file", id: "a", label: "A" }, { kind: "folder", id: "f", label: "F" }, { kind: "file", id: "a", label: "A again" }],
        reference: { fileId: "b", label: "B", text: "" },
      }),
    ).toEqual(["a", "b"]);
  });
});

describe("F02 — review before the change lands", () => {
  it("holds an edit as a suggestion when the words ask for a review, even on full access", async () => {
    const desk = scripted();
    const { service, panel } = await conversationWithDeck(desk);
    const report = desk.addDocument({ id: "doc-report", filePath: "/p/Q3 report.docx", documentType: "docx" });

    await service.send(message("只改一句话，先审阅再应用", { mentions: [{ kind: "file", id: report.id, label: "Q3 report.docx" }] }));
    const editTask = "task-2";
    desk.push(running(editTask));
    desk.push(completed(editTask, "/p/Q3 report.modified.docx", "docx"));

    const task = panel.last();
    expect(task?.id).toBe(editTask);
    expect(task?.suggestion).toMatchObject({ id: editTask, targetFileId: report.id, applied: false });
    // Nothing was reported as dropped: review is honoured here.
    expect(panel.notices()).toEqual([]);
  });

  it("holds an edit as a suggestion when the composer's permission is review", async () => {
    const desk = scripted();
    const service = createAgentService(desk.api);
    const panel = listen(service);
    const report = desk.addDocument({ id: "doc-report", filePath: "/p/Q3 report.docx", documentType: "docx" });

    await service.send(message("Fix the typo", { activeFileId: report.id, permission: "review" }));
    desk.push(running("task-1"));
    desk.push(completed("task-1", "/p/Q3 report.modified.docx", "docx"));

    expect(panel.last()?.suggestion?.targetFileId).toBe(report.id);
    expect(panel.notices()).toEqual([]);
  });

  it("writes directly on full access when nothing asks for a review", async () => {
    const desk = scripted();
    const apply = vi.spyOn(desk.api, "applyArtifactSuggestion");
    const service = createAgentService(desk.api);
    const panel = listen(service);
    const report = desk.addDocument({ id: "doc-report", filePath: "/p/Q3 report.docx", documentType: "docx" });

    await service.send(message("Fix the typo", { activeFileId: report.id }));
    desk.push(running("task-1"));
    desk.push(completed("task-1", "/p/Q3 report.modified.docx", "docx"));

    await vi.waitFor(() => expect(panel.last()?.suggestion).toMatchObject({ applied: true, undoable: true }));
    expect(apply).toHaveBeenCalledWith({ suggestionId: "task-1", sourceFile: report.filePath, artifactFile: "/p/Q3 report.modified.docx", expectedSourceSHA256: "a".repeat(64) });
  });

  it("recognises review requests in both languages and little else", () => {
    for (const text of ["先审阅再改", "改完先给我看一下", "review it first", "let me review before you apply", "don't apply yet"]) {
      expect(reviewRequestedBy(text), text).toBe(true);
    }
    for (const text of ["Write a review of the product", "审阅意见已经收到，按它改", "apply the changes"]) {
      expect(reviewRequestedBy(text), text).toBe(false);
    }
  });
});

describe("F03 — formats and file names", () => {
  it("refuses a format it cannot make instead of making the default", async () => {
    const desk = scripted();
    const service = createAgentService(desk.api);

    await expect(service.send(message("把这些要点存成一个 txt 文件", { newConversation: true }))).rejects.toThrow(/TXT/);
    expect(desk.calls.generate).toHaveLength(0);
  });

  it("lists what it can make in the refusal", async () => {
    const desk = scripted();
    const service = createAgentService(desk.api);

    await expect(service.send(message("export this as a PDF", { newConversation: true }))).rejects.toThrow(/PPTX, DOCX, XLSX, PNG/);
  });

  it("still makes slides from a PDF when slides are what was asked for", async () => {
    const desk = scripted();
    const service = createAgentService(desk.api);

    await service.send(message("turn this PDF into slides", { newConversation: true }));
    expect(desk.calls.generate.map((call) => call.documentType)).toEqual(["pptx"]);
  });

  it("carries a requested file name as the topic and in the prompt", async () => {
    const desk = scripted();
    const service = createAgentService(desk.api);

    await service.send(message("写一份项目方案，文件名叫 Q4-plan.docx", { newConversation: true }));

    expect(desk.calls.generate).toHaveLength(1);
    expect(desk.calls.generate[0].topic).toBe("Q4-plan");
    expect(desk.calls.generate[0].prompt).toContain("Requested output file name: Q4-plan.docx");
    // And as the field officecli names the artifact by, as a stem: the
    // extension is its to add from the document type.
    expect(desk.calls.generate[0].outputFileName).toBe("Q4-plan");
  });

  it("sends the requested name as outputFileName when it is given without an extension", async () => {
    const desk = scripted();
    const service = createAgentService(desk.api);

    await service.send(message("生成一个叫 ODQA-check 的 Word", { newConversation: true }));

    expect(desk.calls.generate).toHaveLength(1);
    expect(desk.calls.generate[0].documentType).toBe("docx");
    expect(desk.calls.generate[0].outputFileName).toBe("ODQA-check");
  });

  // No name asked for means no field on the wire: the runtime keeps naming by
  // slug, exactly as before the field existed.
  it("leaves outputFileName off when no name was asked for", async () => {
    const desk = scripted();
    const service = createAgentService(desk.api);

    await service.send(message("写一份项目方案", { newConversation: true }));

    expect(desk.calls.generate).toHaveLength(1);
    expect("outputFileName" in desk.calls.generate[0]).toBe(false);
  });
});

describe("F05 — each run is its own", () => {
  it("titles a follow-up run by itself, not by the first run's file", async () => {
    const desk = scripted();
    const { service, panel } = await conversationWithDeck(desk);

    await service.send(message("Now write a budget spreadsheet", { documentType: "xlsx" }));
    desk.push(running("task-2"));

    const card = panel.last();
    expect(card?.id).toBe("task-2");
    expect(card?.title).not.toBe("Launch deck.pptx");
    expect(card?.title).toContain("Now write a budget spreadsheet");

    // The conversation row keeps the first run's name.
    const rows = await service.list();
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Launch deck.pptx");
    expect(rows[0].runTaskIds).toEqual(["task-1", "task-2"]);
  });

  it("queues a message typed while the conversation's run is under way, and sends it when the run ends", async () => {
    const desk = scripted();
    const service = createAgentService(desk.api);
    const panel = listen(service);

    await service.send(message("Make a launch deck", { newConversation: true }));
    desk.push(running("task-1"));
    await service.send(message("And a budget spreadsheet", { documentType: "xlsx" }));

    // Not sent, shown waiting.
    expect(desk.calls.generate).toHaveLength(1);
    const waiting = panel.last();
    expect(waiting?.id).toBe("task-1");
    expect(waiting?.queued).toEqual([{ id: expect.stringMatching(/^queued:/), text: "And a budget spreadsheet" }]);
    expect(waiting?.messages.at(-1)).toMatchObject({ role: "user", text: "And a budget spreadsheet" });

    desk.push(completed("task-1", "/p/Launch deck.pptx", "pptx"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(desk.calls.generate).toHaveLength(2);
    expect(desk.calls.generate[1].documentType).toBe("xlsx");
    expect(desk.calls.generate[1].conversationId).toBe("task-1");
    // Not an edit of the deck: that was the bug.
    expect(desk.calls.modify).toHaveLength(0);
    expect(panel.last()?.queued).toBeUndefined();
  });

  it("retains the queue after stop and dispatches only on explicit continue", async () => {
    const desk = scripted();
    const service = createAgentService(desk.api);
    const panel = listen(service);

    await service.send(message("Make a launch deck", { newConversation: true }));
    desk.push(running("task-1"));
    await service.send(message("And a budget spreadsheet"));
    await service.finish("task-1");

    expect(desk.calls.generate).toHaveLength(1);
    expect(panel.last()?.queued?.[0].text).toBe("And a budget spreadsheet");
    await service.sendQueued!("task-1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(desk.calls.generate).toHaveLength(2);
    expect(desk.calls.generate[1].documentType).toBe("xlsx");
    expect(panel.last()?.queued).toBeUndefined();
  });

  it("reports a failure once, however many events follow it", async () => {
    const desk = scripted();
    const service = createAgentService(desk.api);
    const panel = listen(service);

    await service.send(message("Make a launch deck", { newConversation: true }));
    desk.push(running("task-1"));
    desk.push({ event_id: "f", task_id: "task-1", type: "task.failed", ts: new Date().toISOString(), payload: { message: "unknown sentinel target" } });
    desk.push({ event_id: "p1", task_id: "task-1", type: "task.progress", ts: new Date().toISOString(), payload: { message: "late line" } });
    desk.push({ event_id: "p2", task_id: "task-1", type: "task.output", ts: new Date().toISOString(), payload: { message: "flushed" } });

    expect(panel.errors()).toEqual(["unknown sentinel target"]);
  });

  it("stops the run the card names and shows it stopped at once", async () => {
    const desk = scripted();
    const service = createAgentService(desk.api);
    const panel = listen(service);

    await service.send(message("Make a launch deck", { newConversation: true }));
    desk.push(running("task-1"));
    // A second run elsewhere is what the service would otherwise consider live.
    await service.send(message("Something in another project", { folderId: "project:2", newConversation: true }));
    desk.push(running("task-2"));

    await service.finish("task-1");

    expect(desk.calls.cancel).toEqual(["task-1"]);
    const stopped = panel.tasks().filter((task) => task.id === "task-1").at(-1);
    expect(stopped?.status).toBe("done");
    expect(stopped?.outcome).toBe("stopped");
    // The other run was not touched.
    const other = panel.tasks().filter((task) => task.id === "task-2").at(-1);
    expect(other?.status).not.toBe("done");
  });

  it("stops what is live when no id is given, as the composer's Stop does", async () => {
    const desk = scripted();
    const service = createAgentService(desk.api);
    const panel = listen(service);

    await service.send(message("Make a launch deck", { newConversation: true }));
    desk.push(running("task-1"));
    await service.finish();

    expect(desk.calls.cancel).toEqual(["task-1"]);
    expect(panel.last()?.outcome).toBe("stopped");
  });
});

describe("1.0.13 routing regression", () => {
  it.each(["新建一个 DOCX 文档，命名为 OD13-agent-exact.docx", "Create a new document called OD13-agent-exact.docx"])("creates a fresh file with an old document open: %s", async (text) => {
    const desk = scripted();
    const service = createAgentService(desk.api);
    desk.addDocument({ id: "old", filePath: "/p/old.docx", documentType: "docx" });
    await service.send(message(text, { activeFileId: "old" }));
    expect(desk.calls.modify).toHaveLength(0);
    expect(desk.calls.generate[0]).toMatchObject({ documentType: "docx", outputFileName: "OD13-agent-exact" });
  });
  it("refuses TXT even when a PPT remains open", async () => {
    const desk = scripted();
    const service = createAgentService(desk.api);
    desk.addDocument({ id: "old", filePath: "/p/old.pptx", documentType: "pptx" });
    await expect(service.send(message("生成三行 TXT 文件 QA.txt，不支持就说明", { activeFileId: "old" }))).rejects.toThrow(/TXT/);
    expect(desk.calls.modify).toHaveLength(0);
    expect(desk.calls.generate).toHaveLength(0);
  });
  it("retries the original instruction rather than a queued message", async () => {
    const desk = scripted();
    const service = createAgentService(desk.api);
    const panel = listen(service);
    await service.send(message("Create a new document", { documentType: "docx", newConversation: true }));
    desk.push(running("task-1"));
    await service.send(message("And a budget spreadsheet"));
    await service.finish("task-1");
    await service.retry!("task-1");
    expect(desk.calls.generate[1].documentType).toBe("docx");
    expect(panel.last()?.attempt).toBe(2);
    expect(panel.last()?.queued?.[0].text).toBe("And a budget spreadsheet");
  });
});

it("restores queued messages after a restart and waits for Continue", async () => {
 const first = scripted();
 const service = createAgentService(first.api);
 await service.send(message("Make a deck", { newConversation: true }));
 first.push(running("task-1"));
 await service.send(message("Create a new workbook"));
 await service.finish("task-1");
 const second = scripted(50);
 const restored = createAgentService(second.api);
 const panel = listen(restored);
 second.push(running("task-1"));
 await restored.finish("task-1");
 expect(panel.last()?.queued?.[0].text).toBe("Create a new workbook");
 expect(second.calls.generate).toHaveLength(0);
 await restored.sendQueued!("task-1");
 await new Promise((resolve) => setTimeout(resolve, 0));
 expect(second.calls.generate[0].documentType).toBe("xlsx");
});


describe("1.0.15 attachment and independent task isolation", () => {
  it("edits a path attachment without adding the previous deck's content", async () => {
    const desk = scripted();
    const {service} = await conversationWithDeck(desk);
    const source = desk.addDocument({id: "source", filePath: "/p/OD15-review.docx", documentType: "docx"});
    await service.send(message('Edit the attached DOCX. Replace "Beta" with "Gamma". Keep other paragraphs.', {
      attachments: [{id: "attached", name: source.fileName, path: source.filePath, size: 100}],
    }));
    expect(desk.calls.modify[0]).toMatchObject({sourceFile: source.filePath, documentType: "docx"});
    expect(desk.calls.modify[0].prompt).not.toContain("Make a launch deck");
  });
  it("keeps queued two-slide generation independent from the prior twelve-slide prompt", async () => {
    const desk = scripted(); const service = createAgentService(desk.api);
    await service.send(message('Create a NEW presentation named "First.pptx". Exactly 12 slides.'));
    desk.push(running("task-1"));
    await service.send(message('Create a separate NEW presentation named "Second.pptx". Exactly two slides.'));
    desk.push(completed("task-1", "/p/First.pptx", "pptx"));
    await vi.waitFor(() => expect(desk.calls.generate).toHaveLength(2));
    expect(desk.calls.generate[1].prompt).not.toContain("12 slides");
    expect(desk.calls.generate[1].outputFileName).toBe("Second");
    expect(desk.calls.modify).toHaveLength(0);
  });
  it("preserves logical request identity and start time across retry", async () => {
    const desk = scripted(); const service = createAgentService(desk.api); const panel = listen(service);
    await service.send(message('Create a NEW document named "Report.docx".'));
    desk.push(running("task-1"));
    await service.finish("task-1");
    const before = panel.last()!;
    await service.retry!("task-1");
    expect(panel.last()).toMatchObject({logicalTaskId: "task-1", attempt: 2, startedAt: before.startedAt});
  });
});

describe("acceptance failure isolation", () => {
  it("keeps a valid attachment result and retries only an attachment that could not be imported", async () => {
    const desk = scripted(); const service = createAgentService(desk.api); const panel = listen(service);
    desk.addDocument({ id: "good", filePath: "/p/good.docx", documentType: "docx" });
    await service.send(message('Process each attached DOCX independently. Replace "Beta fifteen." with "Gamma fifteen.". Do not create a presentation.', {
      attachments: [{id:"good",name:"good.docx",path:"/p/good.docx",size:100},{id:"bad",name:"bad.docx",path:"/p/bad.docx",size:100}],
    }));
    expect(desk.calls.modify[0].prompt).not.toContain("/p/bad.docx");
    desk.push(completed("task-1", "/p/good.modified.docx", "docx"));
    await vi.waitFor(() => expect(panel.last()?.batch?.map(item => item.status)).toEqual(["completed", "failed"]));
    const id = panel.last()!.id;
    desk.addDocument({ id: "bad", filePath: "/p/bad.docx", documentType: "docx" });
    await service.retryBatch!(id);
    expect(desk.calls.modify.map(call => call.sourceFile)).toEqual(["/p/good.docx", "/p/bad.docx"]);
    expect(desk.calls.generate).toHaveLength(0);
  });
  it("preserves raw diagnostics only in Details and identifies a connection failure", async () => {
    const desk = scripted(); const service = createAgentService(desk.api); const panel = listen(service);
    await service.send(message('Create a NEW document.'));
    const raw = 'RuntimeError: request failed: EOF\n    at worker.mjs:50';
    desk.push({event_id:"offline",task_id:"task-1",type:"task.failed",ts:new Date().toISOString(),payload:{message:raw}});
    expect(panel.last()).toMatchObject({outcome:"interrupted",failureKind:"network",errorDetail:raw});
    expect(panel.last()!.error).not.toContain('worker.mjs');
    expect(panel.last()!.messages.some(message => message.text.includes('worker.mjs'))).toBe(false);
    await service.retry!("task-1");
    expect(panel.last()).toMatchObject({logicalTaskId:"task-1",attempt:2});
  });
});

describe("1.0.18 acceptance regressions", () => {
  it.each([
    "先问我演示文稿的主题，等我回答再创建。",
    "Create a PowerPoint presentation. Ask me for the topic and wait for my answer.",
    "Ask me about the Word document content and wait.",
  ])("does not mistake a question about one format for a format choice: %s", prompt => {
    expect(requestsFormatChoice(prompt)).toBe(false);
  });
  const choiceRequest = "I need a NEW office file, but have not chosen Word, Excel, or PowerPoint. Ask me which of those three formats to use and WAIT for my answer before creating or editing any file. Do not choose a format yourself.";
  it.each([
    ["[OD20-FORMAT-10] Help me create a small fictional office checklist. FIRST ask me whether I want a Word document or a PowerPoint presentation and WAIT for my answer. Do not create or modify any file before I answer the question. Ask the question in English.", ["docx", "pptx"], "pptx"],
    ["Create a report. Ask me whether to use Word or Excel and wait for my answer.", ["docx", "xlsx"], "xlsx"],
    ["先问我使用 Excel 还是 PPT，等我回答再创建。", ["xlsx", "pptx"], "xlsx"],
  ])("holds a two-format choice before any file operation: %s", async (prompt, ids, answer) => {
    const desk = scripted(); const service = createAgentService(desk.api); const panel = listen(service);
    await service.send(message(prompt as string, { newConversation: true }));
    expect(panel.last()?.question?.options.map(option => option.id)).toEqual(ids);
    expect(desk.calls.generate).toHaveLength(0);
    expect(desk.calls.modify).toHaveLength(0);
    const gate = panel.last()!;
    const restarted = createAgentService(desk.api);
    await restarted.openConversation(FOLDER, gate.conversationId!);
    await restarted.answer({ text: "not yet" });
    expect(desk.calls.generate).toHaveLength(0);
    await restarted.answer({ optionId: answer as string });
    expect(desk.calls.generate).toHaveLength(1);
    expect(desk.calls.generate[0].documentType).toBe(answer);
  });
  it("asks for a format without creating a file, then continues with the selected format", async () => {
    const desk = scripted(); const service = createAgentService(desk.api); const panel = listen(service);
    await service.send(message(choiceRequest, { newConversation: true }));
    const gate = panel.last()!;
    expect(gate.status).toBe("awaiting-review");
    expect(gate.question?.options.map(o => o.id)).toEqual(["docx", "xlsx", "pptx"]);
    expect(desk.calls.generate).toHaveLength(0);
    expect(desk.calls.modify).toHaveLength(0);
    await service.answer({ text: "not sure" });
    expect(desk.calls.generate).toHaveLength(0);
    await service.answer({ optionId: "docx" });
    expect(desk.calls.generate).toHaveLength(1);
    expect(desk.calls.generate[0].documentType).toBe("docx");
    expect(desk.calls.generate[0].conversationId).toBe(gate.conversationId);
    desk.push(running("task-1"));
    expect(panel.last()?.logicalTaskId).toBe(gate.id);
  });

  it("restores an unanswered format choice after restart", async () => {
    const desk = scripted(); const first = createAgentService(desk.api); const panel = listen(first);
    await first.send(message(choiceRequest, { newConversation: true }));
    const gate = panel.last()!;
    const restarted = createAgentService(desk.api);
    await restarted.openConversation(FOLDER, gate.conversationId!);
    const restored = await restarted.current(FOLDER);
    expect(restored?.question).not.toBeNull();
    await restarted.answer({ optionId: "pptx" });
    expect(desk.calls.generate).toHaveLength(1);
    expect(desk.calls.generate[0].documentType).toBe("pptx");
  });

  it("rejects a proposal and refuses a later stale Apply", async () => {
    const desk = scripted(); desk.addDocument({ id: "source", filePath: "/p/review.docx", documentType: "docx" });
    const apply = vi.spyOn(desk.api, "applyArtifactSuggestion");
    const service = createAgentService(desk.api); const panel = listen(service);
    await service.send(message("Replace Beta with Gamma; let me review first", { activeFileId: "source" }));
    desk.push(completed("task-1", "/p/review.modified.docx", "docx"));
    expect(panel.last()?.suggestion?.applied).toBe(false);
    await service.rejectSuggestion!("task-1");
    expect(panel.last()?.suggestion).toBeNull();
    expect(panel.last()?.outcome).toBe("stopped");
    await expect(service.applySuggestion("task-1")).rejects.toThrow();
    expect(apply).not.toHaveBeenCalled();
  });
});

it("keeps full-access batch proposals reviewable across a failure, apply, undo and retry", async () => {
  const desk = scripted();
  const service = createAgentService(desk.api); const panel = listen(service);
  desk.addDocument({ id: "good", filePath: "/external/good.docx", documentType: "docx" });
  desk.addDocument({ id: "bad", filePath: "/external/bad.docx", documentType: "docx" });
  const apply = vi.spyOn(desk.api, "applyArtifactSuggestion");
  await service.send(message("Replace Beta with Delta independently in both files", { conversationId: "batch-review", mentions: [{ kind: "file", id: "good", label: "good.docx" }, { kind: "file", id: "bad", label: "bad.docx" }] }));
  desk.push(completed("task-1", "/external/good.modified.docx", "docx"));
  await vi.waitFor(() => expect(desk.calls.modify).toHaveLength(2));
  desk.push({ event_id: "bad-failed", task_id: "task-2", type: "task.failed", ts: new Date().toISOString(), payload: { message: "invalid DOCX" } });
  desk.push({ event_id: "bad-title", task_id: "task-2", type: "task.title", payload: { topic: desk.calls.modify[1].prompt } });
  expect(panel.last()?.title).toBe("Replace Beta with Delta independently in both files");
  expect((await service.list())[0].title).not.toContain("This is one item of a batch");
  expect(panel.last()?.batch?.[0].suggestion).toMatchObject({ id: "task-1", targetFileId: "good", applied: false });
  expect(apply).not.toHaveBeenCalled();
  await service.applySuggestion("task-1");
  expect(apply).toHaveBeenCalledWith({ suggestionId: "task-1", sourceFile: "/external/good.docx", artifactFile: "/external/good.modified.docx", expectedSourceSHA256: "a".repeat(64) });
  expect(panel.last()?.batch?.[0].suggestion).toMatchObject({ applied: true, undoable: true });
  await service.undoSuggestion("task-1");
  expect(panel.last()?.batch?.[0].suggestion).toMatchObject({ applied: false, undoable: false });
  await service.retryBatch!("task-2");
  expect(desk.calls.modify.map(call => call.sourceFile)).toEqual(["/external/good.docx", "/external/bad.docx", "/external/bad.docx"]);
  expect(panel.last()?.title).toBe("Replace Beta with Delta independently in both files");
});

it.each([
  'content generation failed: Post "https://platform.officecli.io/api/llm/v1/json": EOF',
  'extract docx content: failed to open OOXML zip: zip: not a valid zip file',
  'content generation failed: PPTX expansion is incomplete; retained completed pages: 23/24 ready (page_failed); evidence: /Users/test/workspace/.mop-assets/officecli-expansion-123',
])("keeps short technical diagnostics out of messages, phases and notices: %s", async (raw) => {
  const desk = scripted(); const service = createAgentService(desk.api); const panel = listen(service);
  const events: AgentEvent[] = []; service.subscribe(event => events.push(event));
  await service.send(message("Create a NEW Word document."));
  desk.push({ event_id: "failed", task_id: "task-1", type: "task.failed", ts: new Date().toISOString(), payload: { message: raw } });
  const task = panel.last()!;
  expect(task.errorDetail).toBe(raw);
  expect(task.error).not.toBe(raw);
  expect(task.phase).not.toBe(raw);
  expect(task.messages.some(message => message.text === raw)).toBe(false);
  expect(events.filter(event => event.kind === "error").some(event => event.message === raw)).toBe(false);
});


describe("1.0.21 report regressions", () => {
  it("freezes attachment targets even with an unrelated active editor", async () => {
    const desk = scripted(); const service = createAgentService(desk.api); const panel = listen(service);
    desk.addDocument({ id: "review", filePath: "/p/OD21-review.docx", documentType: "docx" });
    desk.addDocument({ id: "good", filePath: "/p/OD21-batch.docx", documentType: "docx" });
    await service.send(message('Process ONLY the two attached QA DOCX files independently. Replace Beta with Delta. Do not create unrelated files.', {
      activeFileId: "review",
      attachments: [{id:"good",name:"OD21-batch.docx",path:"/p/OD21-batch.docx",size:100},{id:"bad",name:"OD21-corrupt.docx",path:"/p/OD21-corrupt.docx",size:100}],
    }));
    expect(desk.calls.modify.map(call => call.sourceFile)).toEqual(["/p/OD21-batch.docx"]);
    desk.push(completed("task-1", "/p/OD21-batch.modified.docx", "docx"));
    await vi.waitFor(() => expect(panel.last()?.batch?.map(item => item.status)).toEqual(["completed", "failed"]));
    expect(panel.last()?.outcome).not.toBe("completed");
    expect(desk.calls.generate).toHaveLength(0);
  });
  it("retains the failed run and its retry identity after a queued result finishes", async () => {
    const desk = scripted(); const service = createAgentService(desk.api); const panel = listen(service);
    await service.send(message('Create a NEW 24-slide PPTX OD21-long.pptx', {newConversation:true}));
    desk.push(running("task-1"));
    await service.send(message('Create a NEW Word DOCX OD21-queued.docx'));
    desk.push({event_id:"fail-long",task_id:"task-1",type:"task.failed",ts:new Date().toISOString(),payload:{message:"PPTX expansion is incomplete"}});
    await vi.waitFor(() => expect(desk.calls.generate).toHaveLength(2));
    desk.push(completed("task-2", "/p/OD21-queued.docx", "docx"));
    expect(panel.last()?.history?.[0]).toMatchObject({id:"task-1",outcome:"failed"});
    const activity = await service.list({individualRuns:true});
    expect(activity.map(row=>row.id)).toContain("task-1");
    expect(activity.find(row=>row.id==="task-1")?.outcome).toBe("failed");
    await service.retry!("task-1");
    expect(desk.calls.generate.at(-1)?.prompt).toContain("OD21-long.pptx");
    desk.push({event_id:"fail-retry",task_id:"task-3",type:"task.failed",ts:new Date().toISOString(),payload:{message:"PPTX expansion is incomplete"}});
    await service.send(message("Create a NEW Word file after retry"));
    desk.push(completed("task-4","/p/after.docx","docx"));
    expect(panel.last()?.history?.map(run=>run.id)).toContain("task-3");
    expect(panel.last()?.history?.map(run=>run.id)).not.toContain("task-1");
  });
});


describe("N23 — every file-edit entry point has a delivery contract", () => {
  for (const route of ["attachment", "mention", "active", "reference"] as const) {
    for (const review of [false, true]) {
      it(`${route}: ${review ? "review leaves source untouched until Apply" : "full access waits for source save"}`, async () => {
        const desk = scripted();
        const file = desk.addDocument({ id: "source", filePath: "/external/OD23-single.docx", documentType: "docx" });
        let finish!: () => void;
        const apply = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
        desk.api.applyArtifactSuggestion = apply;
        const undo = vi.spyOn(desk.api, "undoArtifactSuggestion");
        const service = createAgentService(desk.api); const panel = listen(service);
        const targets: Partial<SendInput> = route === "attachment" ? { attachments: [{ id: "a", name: file.fileName, path: file.filePath, size: 10 }] }
          : route === "mention" ? { mentions: [{ kind: "file", id: file.id, label: file.fileName }] }
          : route === "reference" ? { reference: { fileId: file.id, label: file.fileName, text: "The status is draft." } }
          : { activeFileId: file.id };
        await service.send(message('Edit the existing DOCX in place: replace “The status is draft.” with “The status is final.”. ' + (review ? "先展示 Review 差异，等待我确认，不要自动应用。" : "Apply the change now."), targets));
        expect(desk.calls.generate).toHaveLength(0);
        desk.push(completed("task-1", "/external/OD23-single.modified.docx", "docx"));
        let applying: Promise<void> | undefined;
        if (review) {
          expect(apply).not.toHaveBeenCalled();
          expect(panel.last()?.suggestion).toMatchObject({ applied: false, targetFileId: file.id });
          applying = service.applySuggestion("task-1");
        } else {
          expect(panel.last()?.status).not.toBe("done");
          expect(panel.last()?.outcome).toBeUndefined();
        }
        expect(apply).toHaveBeenCalledExactlyOnceWith({ suggestionId: "task-1", sourceFile: file.filePath, artifactFile: "/external/OD23-single.modified.docx", expectedSourceSHA256: "a".repeat(64) });
        finish(); await applying;
        await vi.waitFor(() => expect(panel.last()?.suggestion).toMatchObject({ applied: true, undoable: true }));
        expect(panel.last()?.outcome).toBe("completed");
        expect(panel.last()?.artifact?.path).toBe("/external/OD23-single.modified.docx");
        await service.undoSuggestion("task-1");
        expect(undo).toHaveBeenCalledOnce();
        expect(panel.last()?.suggestion).toMatchObject({ applied: false, undoable: false });
      });
    }
  }

  it("does not turn quoted document content into a new-file instruction", async () => {
    const desk = scripted(); desk.addDocument({ id: "source", filePath: "/p/OD23-simple.docx", documentType: "docx" });
    const service = createAgentService(desk.api); const panel = listen(service);
    await service.send(message('请修改当前打开的 OD23-simple.docx：把唯一正文行“OD23 Agent can create a document.”改成“OD23 Agent can revise a document.”。先展示 Review 差异，等待我确认，不要自动应用。', { activeFileId: "source" }));
    expect(desk.calls.generate).toHaveLength(0);
    expect(desk.calls.modify).toHaveLength(1);
    desk.push(completed("task-1", "/p/OD23-simple.modified.docx", "docx"));
    expect(panel.last()?.suggestion?.applied).toBe(false);
  });

  it("reports a failed source write and keeps the artifact available for retry", async () => {
    const desk = scripted(); desk.addDocument({ id: "source", filePath: "/p/a.docx", documentType: "docx" });
    const apply = vi.fn(async () => {}).mockRejectedValueOnce(new Error("disk is read-only"));
    desk.api.applyArtifactSuggestion = apply;
    const service = createAgentService(desk.api); const panel = listen(service);
    await service.send(message("Fix the typo", { activeFileId: "source" }));
    desk.push(completed("task-1", "/p/a.modified.docx", "docx"));
    await vi.waitFor(() => expect(panel.last()?.outcome).toBe("failed"));
    expect(panel.last()?.suggestion).toMatchObject({ applied: false, undoable: false });
    expect(panel.last()?.artifact?.path).toBe("/p/a.modified.docx");
    expect(panel.last()?.errorDetail).toBe("disk is read-only");
    await service.applySuggestion("task-1");
    expect(apply).toHaveBeenCalledTimes(2);
    expect(panel.last()?.outcome).toBe("completed");
  });

  it("registers the source even when completion arrives before modify resolves", async () => {
    const desk = scripted(); desk.addDocument({ id: "source", filePath: "/p/a.docx", documentType: "docx" });
    const original = desk.api.modify;
    vi.spyOn(desk.api, "modify").mockImplementation(async input => {
      const result = await original(input);
      desk.push(completed(result.taskId, "/p/a.modified.docx", "docx"));
      return result;
    });
    const apply = vi.spyOn(desk.api, "applyArtifactSuggestion");
    const service = createAgentService(desk.api); const panel = listen(service);
    await service.send(message("Fix the typo", { activeFileId: "source" }));
    await vi.waitFor(() => expect(panel.last()?.suggestion?.applied).toBe(true));
    expect(apply).toHaveBeenCalledOnce();
    expect(panel.tasks().filter(task => task.outcome === "completed").every(task => task.suggestion?.applied)).toBe(true);
  });
});

it("does not start a queued edit until the preceding source write finishes", async () => {
  const desk = scripted(); desk.addDocument({ id: "source", filePath: "/p/a.docx", documentType: "docx" });
  let finish!: () => void;
  desk.api.applyArtifactSuggestion = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const service = createAgentService(desk.api); const panel = listen(service);
  await service.send(message("Fix first typo", { activeFileId: "source", conversationId: "save-queue" }));
  desk.push(running("task-1"));
  await service.send(message("Fix second typo", { activeFileId: "source", conversationId: "save-queue" }));
  desk.push(completed("task-1", "/p/a.modified.docx", "docx"));
  expect(desk.calls.modify).toHaveLength(1);
  expect(panel.last()?.outcome).toBeUndefined();
  finish();
  await vi.waitFor(() => expect(desk.calls.modify).toHaveLength(2));
});

it("does not call a modification complete if the worker returned no artifact", async () => {
  const desk = scripted(); desk.addDocument({ id: "source", filePath: "/p/a.docx", documentType: "docx" });
  const service = createAgentService(desk.api); const panel = listen(service);
  await service.send(message("Fix the typo", { activeFileId: "source" }));
  desk.push({ ...completed("task-1", "", "docx"), payload: {} });
  expect(panel.last()?.outcome).toBe("failed");
  expect(panel.last()?.suggestion).toBeNull();
});


it("recovers an unapplied proposal after restart without silently replaying a write", async () => {
  const desk = scripted();
  localStorage.setItem("officedex.agent.reviews.v1", JSON.stringify([["task-1", {
    sourceFileId: "source", sourceFile: "/p/a.docx", autoApply: true, applying: true, applied: false, undoable: false,
  }]]));
  const apply = vi.spyOn(desk.api, "applyArtifactSuggestion");
  const service = createAgentService(desk.api); const panel = listen(service);
  desk.push(completed("task-1", "/p/a.modified.docx", "docx"));
  expect(panel.last()?.suggestion).toMatchObject({ targetFileId: "source", applied: false });
  expect(apply).not.toHaveBeenCalled();
  await service.applySuggestion("task-1");
  expect(apply).toHaveBeenCalledOnce();
});


describe("historical scope boundaries", () => {
  it.each(["Save a separate modified copy", "另存副本，保留原件"])("never auto-applies %s", async prompt => {
    const desk = scripted(); desk.addDocument({id:"source",filePath:"/p/a.docx",documentType:"docx"});
    const apply = vi.spyOn(desk.api,"applyArtifactSuggestion");
    const service = createAgentService(desk.api); const panel = listen(service);
    await service.send(message(`Fix the typo. ${prompt}`, {activeFileId:"source"}));
    desk.push(completed("task-1","/p/copy.docx","docx"));
    await vi.waitFor(() => expect(panel.last()?.outcome).toBe("completed"));
    expect(apply).not.toHaveBeenCalled();
    expect(panel.last()?.artifact?.path).toBe("/p/copy.docx");
  });
  it.each([false, true])("read-only attachment answers without modification; malicious edits=%s", async malicious => {
    const desk = scripted(); const file=desk.addDocument({id:"source",filePath:"/p/a.docx",documentType:"docx"});
    desk.api.issuePreviewToken = vi.fn(async () => ({token:"read",fileName:"a.docx",documentType:"docx"})) as DesktopAPI["issuePreviewToken"];
    desk.api.readArtifactFile = vi.fn(async () => ({data:zipSync({"word/document.xml":strToU8('<w:document xmlns:w="urn:word"><w:p><w:r><w:t>Alpha.</w:t></w:r></w:p></w:document>')})})) as DesktopAPI["readArtifactFile"];
    desk.api.revokePreviewToken = vi.fn(async () => {});
    desk.api.startAgentRun = vi.fn(async () => ({id:"reader",status:"running",workflow:"office.docx.edit.v1",created_at:"",updated_at:""})) as DesktopAPI["startAgentRun"];
    desk.api.getAgentRun = vi.fn(async () => ({id:"reader",status:"completed",workflow:"office.docx.edit.v1",created_at:"",updated_at:"",result:{summary:"LOCAL-A-19",edits:malicious?[{query:"Alpha.",replacement:"Beta."}]:[]}})) as DesktopAPI["getAgentRun"];
    desk.api.cancelAgentRun = vi.fn(async () => {});
    const apply=vi.spyOn(desk.api,"applyArtifactSuggestion");
    const service=createAgentService(desk.api); const panel=listen(service);
    await service.send(message('Reply exactly "LOCAL-A-19". Do not create or edit any file.', {attachments:[{id:"a",name:file.fileName,path:file.filePath,size:1}]}));
    expect(desk.calls.modify).toHaveLength(0);expect(desk.calls.generate).toHaveLength(0);expect(apply).not.toHaveBeenCalled();
    expect(desk.api.startAgentRun).toHaveBeenCalledWith(expect.objectContaining({input:{parameters:expect.objectContaining({text:"Alpha.",read_only:true})}}));
    expect(desk.api.revokePreviewToken).toHaveBeenCalledWith("read");
    expect(panel.last()?.outcome).toBe(malicious?"failed":"completed");
    if (!malicious) expect(panel.last()?.messages.some(item=>item.text==="LOCAL-A-19")).toBe(true);
  });
});
