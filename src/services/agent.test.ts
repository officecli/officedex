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
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BridgeEvent, DesktopAPI, DocumentRecord, GenerateInput, ModifyInput } from "../shared/types";
import type { AgentEvent, AgentTask, SendInput } from "../shared/uiPort";
import { createAgentService, referencedFileIds, reviewRequestedBy } from "./agent";

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
      return { taskId: `task-${serial}`, sessionId: "session", status: "running" };
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
    const service = createAgentService(desk.api);
    const panel = listen(service);
    const report = desk.addDocument({ id: "doc-report", filePath: "/p/Q3 report.docx", documentType: "docx" });

    await service.send(message("Fix the typo", { activeFileId: report.id }));
    desk.push(running("task-1"));
    desk.push(completed("task-1", "/p/Q3 report.modified.docx", "docx"));

    expect(panel.last()?.suggestion).toBeNull();
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
