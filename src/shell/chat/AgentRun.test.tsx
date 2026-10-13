/**
 * One run, as the conversation shows it — AGENT-STATE-STANDARD §02, §03.
 *
 * The card is driven entirely from the task record, so these mount the shell
 * against the approved prototype's sample workspace with one run staged in each
 * of the eleven states its review pages show (`prototypeRun`). What is asserted
 * is what the user can act on: the state in words, and exactly which buttons
 * are valid right now.
 *
 * The negative half matters as much. An action offered in the wrong state is a
 * promise the runtime will refuse — Retry on a run that is still going, Review
 * with nothing to review — and an actions row with nothing in it still takes its
 * gap, which is why "complete" and "input" have to draw none at all.
 */
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resetLayers } from "../kit/layers";
import {
  PROTOTYPE_CHAT_IDS,
  PROTOTYPE_FOLDER_IDS,
  prototypeFiles,
  prototypeFolders,
  prototypeRun,
  prototypeTasks,
} from "../port/fake/prototypeSeed";
import { holdOnline } from "../state/useOnline";
import { renderShell } from "../test/renderShell";
import type { AgentTask } from "../../shared/uiPort";

afterEach(() => {
  holdOnline(null);
  resetLayers();
  cleanup();
});

/** The prototype's workspace with one run staged, and its conversation open. */
async function stage(key: string, patch: (task: AgentTask) => AgentTask = (task) => task) {
  const now = Date.now();
  const staged = patch(prototypeRun(key, now)!);
  const tasks = prototypeTasks()
    .reverse()
    .map((task) => (task.conversationId === staged.conversationId ? staged : task));
  const shell = await renderShell({ folders: prototypeFolders(), files: prototypeFiles(now), tasks });
  await shell.dispatch({
    type: "open-chat",
    chat: { folderId: PROTOTYPE_FOLDER_IDS.launch, conversationId: PROTOTYPE_CHAT_IDS.plan },
  });

  const card = () => shell.view.container.querySelector<HTMLElement>(".dx-agent-run");
  await waitFor(() => {
    if (!card()) throw new Error(`the ${key} run card was never drawn`);
  });
  return {
    ...shell,
    card: () => card()!,
    status: () => card()!.querySelector(".dx-agent-run-status")?.textContent ?? "",
    /** The `data-act` of every button in the actions row, in the order drawn. */
    actions: () =>
      [...card()!.querySelectorAll<HTMLElement>(".dx-agent-run-actions [data-act]")].map(
        (button) => button.dataset.act ?? "",
      ),
    actionsRow: () => card()!.querySelector(".dx-agent-run-actions"),
    action: (act: string) => card()!.querySelector<HTMLButtonElement>(`.dx-agent-run-actions [data-act=${act}]`),
  };
}

describe("the state in words", () => {
  const titles: Array<[string, string, string]> = [
    ["planning", "Planning", "preparing"],
    ["reading", "Reading files", "running"],
    ["working", "Preparing changes", "running"],
    ["checking", "Checking results", "running"],
    ["input", "Needs input", "waiting"],
    ["review", "Ready for review", "review"],
    ["complete", "Complete", "completed"],
    ["stopped", "Stopped", "stopped"],
    ["failed", "Couldn’t finish", "failed"],
    ["partial", "Partly complete", "partial"],
    ["offline", "Connection lost", "interrupted"],
  ];

  for (const [key, title, dataStatus] of titles) {
    it(`says "${title}" for a ${key} run`, async () => {
      const run = await stage(key);
      expect(run.status()).toContain(title);
      expect(run.card().dataset.status).toBe(dataStatus);
      // The card names itself by state and title, for anyone not looking at it.
      expect(run.card().getAttribute("aria-label")).toBe(`${title}: Launch plan & copy`);
    });
  }
});

describe("Stop", () => {
  for (const key of ["planning", "reading", "working", "checking"]) {
    it(`is the only action while a run is ${key}`, async () => {
      const run = await stage(key);
      expect(run.actions()).toEqual(["task-stop"]);
      expect(run.action("task-stop")?.textContent).toBe("Stop");
    });
  }

  it("asks the port to finish the run it shows, by id", async () => {
    const run = await stage("working");
    const finish = vi.spyOn(run.port.agent, "finish");
    fireEvent.click(run.action("task-stop")!);
    expect(finish).toHaveBeenCalledTimes(1);
    // Not whatever the port considers live: the card knows which run it is.
    expect(finish).toHaveBeenCalledWith(run.card().querySelector<HTMLElement>("[data-act=task-stop]")?.dataset.id);
  });

  it("shows the messages waiting behind the run as queued", async () => {
    const run = await stage("working", (task) => ({
      ...task,
      queued: [{ id: "queued:1", text: "And a budget spreadsheet" }],
    }));
    const rows = [...run.card().querySelectorAll(".dx-agent-queued li")].map((row) => row.textContent ?? "");
    expect(rows).toEqual(["Queued · And a budget spreadsheetRemove"]);
    // Stop is still the only action: the queue is not a run yet.
    expect(run.actions()).toEqual(["task-stop"]);
  });

  // A run that has ended cannot be stopped again.
  for (const key of ["complete", "stopped", "failed", "partial", "offline", "review", "input"]) {
    it(`is not offered on a ${key} run`, async () => {
      const run = await stage(key);
      expect(run.actions()).not.toContain("task-stop");
    });
  }
});

describe("the retry family", () => {
  const labels: Array<[string, string]> = [
    ["stopped", "Resume"],
    ["failed", "Retry"],
    ["partial", "Retry remaining"],
    ["offline", "Retry"],
  ];

  for (const [key, label] of labels) {
    it(`offers "${label}" on a ${key} run`, async () => {
      const run = await stage(key);
      expect(run.actions()).toContain("task-retry");
      expect(run.action("task-retry")?.textContent).toBe(label);
      // The way forward is the primary action on a run that did not finish.
      expect(run.action("task-retry")?.className).toContain("dx-primary");
    });
  }

  for (const key of ["planning", "working", "checking", "input", "review", "complete"]) {
    it(`is not offered on a ${key} run`, async () => {
      const run = await stage(key);
      expect(run.actions()).not.toContain("task-retry");
    });
  }
});

describe("Review", () => {
  it("loads concrete content differences and sends Reject to the agent", async () => {
    const run = await stage("review");
    const reject = vi.fn(async () => {});
    run.port.agent.rejectSuggestion = reject;
    run.port.agent.suggestionChanges = vi.fn(async () => [{ part: "word/document.xml", before: "Beta eighteen.", after: "Gamma eighteen." }]);
    fireEvent.click(run.action("review-task")!);
    const dialog = document.querySelector("dialog#dx-modal")!;
    await waitFor(() => expect(dialog.textContent).toContain("Beta eighteen."));
    expect(dialog.textContent).toContain("Gamma eighteen.");
    fireEvent.click(dialog.querySelector("[data-act=reject-change]")!);
    await waitFor(() => expect(reject).toHaveBeenCalledOnce());
    expect(document.querySelector("dialog#dx-modal[open]")).toBeNull();
  });

  it("is the primary action while changes are waiting", async () => {
    const run = await stage("review");
    expect(run.actions()).toEqual(["review-task"]);
    expect(run.action("review-task")?.className).toContain("dx-primary");
  });

  // A partial run still has changes to look at, but retrying is the way forward.
  it("is a secondary action beside a retry", async () => {
    const run = await stage("partial");
    expect(run.actions()).toEqual(["task-retry", "review-task"]);
    expect(run.action("review-task")?.className).not.toContain("dx-primary");
  });

  it("opens the review dialog with the file it would change", async () => {
    const run = await stage("review");
    fireEvent.click(run.action("review-task")!);

    const dialog = document.querySelector("dialog#dx-modal")!;
    expect(dialog.querySelector("#dx-modal-title")?.textContent).toBe("Review proposed changes");
    expect(dialog.textContent).toContain("Project readme.md");
    expect(dialog.querySelector("[data-act=apply-change]")).not.toBeNull();
  });

  for (const key of ["planning", "reading", "working", "checking", "input", "complete", "stopped", "failed", "offline"]) {
    it(`is not offered on a ${key} run, which has nothing pending`, async () => {
      const run = await stage(key);
      expect(run.actions()).not.toContain("review-task");
    });
  }
});

describe("Undo", () => {
  const applied = (task: AgentTask): AgentTask => ({
    ...task,
    suggestion: { id: "s", targetFileId: "readme", summary: "Clarify the next step.", applied: true, undoable: true },
  });

  it("is offered once the changes are in the file, in place of Review", async () => {
    const run = await stage("complete", applied);
    expect(run.actions()).toEqual(["undo-task"]);
    expect(run.action("undo-task")?.textContent).toBe("Undo");
  });

  // Nothing to put back: the button stays where the design drew it and says so
  // by being unavailable, rather than disappearing.
  it("is unavailable when the change cannot be reversed", async () => {
    const run = await stage("complete", (task) => ({
      ...applied(task),
      suggestion: { ...applied(task).suggestion!, undoable: false },
    }));
    expect(run.action("undo-task")?.disabled).toBe(true);
  });

  it("is not offered while the changes are still only proposed", async () => {
    const run = await stage("review");
    expect(run.actions()).not.toContain("undo-task");
  });
});

describe("Models", () => {
  // Only a failure Settings → Models can actually fix offers the trip there.
  it("is offered for a model failure", async () => {
    const run = await stage("failed", (task) => ({ ...task, failureKind: "model" }));
    expect(run.actions()).toEqual(["task-retry", "settings"]);
    expect(run.action("settings")?.textContent).toBe("Models");
  });

  it("takes the user to the models section", async () => {
    const run = await stage("failed", (task) => ({ ...task, failureKind: "model" }));
    fireEvent.click(run.action("settings")!);
    expect(run.state().page).toBe("settings");
    expect(run.state().settingsSection).toBe("models");
  });

  it("is not offered for a timeout, which no setting fixes", async () => {
    const run = await stage("failed");
    expect(run.actions()).toEqual(["task-retry"]);
  });

  it("is not offered for a lost connection", async () => {
    const run = await stage("offline");
    expect(run.actions()).not.toContain("settings");
  });
});

describe("Reconnect", () => {
  it("is offered when the run lost its connection and there is still none", async () => {
    holdOnline(false);
    const run = await stage("offline");
    expect(run.actions()).toEqual(["task-retry", "reconnect"]);
  });

  // With a connection back, retrying is the whole story; there is nothing to reconnect.
  it("is not offered once the workspace is online again", async () => {
    const run = await stage("offline");
    expect(run.actions()).toEqual(["task-retry"]);
  });

  it("is not offered for a failure that was not about the connection", async () => {
    holdOnline(false);
    const run = await stage("failed");
    expect(run.actions()).not.toContain("reconnect");
  });
});

describe("the actions row itself", () => {
  // An empty row still takes its gap, so it is not drawn at all.
  for (const key of ["complete", "input"]) {
    it(`is absent on a ${key} run, which has no valid action`, async () => {
      const run = await stage(key);
      expect(run.actionsRow()).toBeNull();
    });
  }

  it("is present wherever there is something to press", async () => {
    for (const key of ["planning", "review", "stopped", "failed", "partial", "offline"]) {
      const run = await stage(key);
      expect(run.actionsRow(), key).not.toBeNull();
      cleanup();
    }
  });

  // Details is not an action on the run; it is always there, outside the row.
  it("never holds Details", async () => {
    const run = await stage("review");
    expect(run.actions()).not.toContain("task-details");
    expect(run.card().querySelector("[data-act=task-details]")).not.toBeNull();
  });
});

describe("a run that needs input", () => {
  it("asks its one question, with the answers it suggests", async () => {
    const run = await stage("input");
    const form = run.card().querySelector<HTMLFormElement>("[data-form=task-input]")!;

    expect(form.textContent).toContain("Who is this document for?");
    expect([...form.querySelectorAll("[data-act=agent-answer]")].map((option) => option.textContent)).toEqual([
      "Project team",
      "Leadership",
      "Customers",
    ]);
    expect(form.querySelector("input[name=answer]")).not.toBeNull();
    expect(form.querySelector("button[type=submit]")?.textContent).toBe("Continue");
  });

  // A suggested answer fills the field and can still be edited; it is a
  // shortcut, not a radio button.
  it("fills the field from a suggested answer", async () => {
    const run = await stage("input");
    const form = run.card().querySelector<HTMLFormElement>("[data-form=task-input]")!;
    const leadership = form.querySelectorAll<HTMLButtonElement>("[data-act=agent-answer]")[1];

    fireEvent.click(leadership);
    expect(leadership.getAttribute("aria-pressed")).toBe("true");
    expect(form.querySelector<HTMLInputElement>("input[name=answer]")?.value).toBe("Leadership");
  });

  it("refuses an empty answer and says what is missing", async () => {
    const run = await stage("input");
    const form = run.card().querySelector<HTMLFormElement>("[data-form=task-input]")!;

    fireEvent.submit(form);
    expect(form.querySelector("[role=alert]")?.textContent).toBe("Add the information needed to continue.");
    expect(form.querySelector<HTMLInputElement>("input[name=answer]")?.getAttribute("aria-invalid")).toBe("true");
  });

  // Stopping is offered inside the question, where the choice is being made,
  // rather than in an actions row of its own.
  it("offers Stop beside Continue", async () => {
    const run = await stage("input");
    const form = run.card().querySelector<HTMLFormElement>("[data-form=task-input]")!;
    expect(form.querySelector("[data-act=task-stop]")?.textContent).toBe("Stop");
  });
});

describe("what the run produced", () => {
  it("offers the finished file to open", async () => {
    const run = await stage("complete");
    const result = run.card().querySelector<HTMLElement>(".dx-agent-results [data-act=open-file]")!;
    expect(result.textContent).toContain("MO launch plan.docx");
    expect(result.textContent).toContain("Ready to open");
  });

  it("offers the file whose changes are waiting", async () => {
    const run = await stage("review");
    const results = run.card().querySelector(".dx-agent-results")!;
    expect(results.textContent).toContain("Project readme.md");
    expect(results.textContent).toContain("Changes ready for review");
  });
});

it("opens a batch proposal in Review with a real diff and apply/reject actions", async () => {
  const staged = prototypeRun("review", Date.now())!;
  const proposal = staged.suggestion!;
  const run = await stage("partial", task => ({ ...task, suggestion: null, batch: [
    { fileId: proposal.targetFileId, name: "QA.docx", taskId: proposal.id, status: "completed", suggestion: proposal },
    { fileId: "bad", name: "Broken.docx", status: "failed", error: "Could not read file", suggestion: null },
  ] }));
  const changes = vi.fn().mockResolvedValue([{ part: "word/document.xml", before: "Beta nineteen.", after: "Beta revised." }]);
  Object.assign(run.port.agent, { suggestionChanges: changes });
  const results = run.card().querySelector('[aria-label="Batch results"]') ?? run.card().querySelector(".dx-agent-results");
  const review = [...results!.querySelectorAll("button")].find(button => button.textContent === "Review");
  expect(review).toBeDefined();
  fireEvent.click(review!);
  await waitFor(() => expect(changes).toHaveBeenCalledWith(proposal.id));
  await waitFor(() => expect(document.body.textContent).toContain("Beta revised."));
  expect(document.querySelector('[data-act="apply-change"]')).not.toBeNull();
  expect(document.querySelector('[data-act="reject-change"]')).not.toBeNull();
});

it("shows raw per-file failures only after opening Details", async () => {
  const raw = "failed to open OOXML zip at /Users/test/workspace/broken.docx";
  const run = await stage("partial", task => ({ ...task, error: "A file could not be read. Choose a valid copy and retry.", errorDetail: undefined, batch: [
    { fileId: "bad", name: "Broken.docx", status: "failed", error: "This file could not be read.", errorDetail: raw, suggestion: null },
    { fileId: "good", name: "Ready.docx", status: "completed", suggestion: null },
  ] }));
  expect(run.card().textContent).toContain("This file could not be read.");
  expect(document.body.textContent).not.toContain(raw);
  const details = [...run.card().querySelectorAll("button")].find(button => button.textContent === "Details")!;
  fireEvent.click(details);
  await waitFor(() => expect(document.querySelector(".dx-dialog")?.textContent ?? document.body.textContent).toContain(raw));
  expect(run.card().textContent).not.toContain(raw);
});

it("offers one retry for the unfinished part of a batch (UX28-14)", async () => {
  const run = await stage("partial", task => ({ ...task, batch: [
    { fileId: "bad", name: "Broken.docx", status: "failed", error: "This file could not be read.", suggestion: null },
    { fileId: "good", name: "Ready.docx", status: "completed", suggestion: null },
  ] }));
  const retries = [...run.card().querySelectorAll("button")].filter(button => button.textContent === "Retry remaining");
  expect(retries).toHaveLength(1);
});

it("asks for another file when the input itself could not be read (UX28-05)", async () => {
  const run = await stage("failed", task => ({ ...task, failureKind: "input" }));
  expect(run.card().querySelector('[data-act="task-replace-file"]')?.textContent).toBe("Choose another file");
  expect(run.card().querySelector('[data-act="task-retry"]')).toBeNull();
});

it("keeps the previous failure actionable after the next result completes", async () => {
  const shell = await stage("complete", task => ({...task,history:[{...prototypeRun("failed",Date.now())!,id:"old-failed",title:"OD21-long.pptx",recovery:{readyPages:13,totalPages:24}}]}));
  const old = shell.view.container.querySelector('[data-task="old-failed"]') ?? [...shell.view.container.querySelectorAll(".dx-agent-run")].find(card=>card.textContent?.includes("OD21-long.pptx"));
  expect(old?.textContent).toContain("Retry remaining");
  expect(shell.view.container.querySelectorAll(".dx-agent-run")).toHaveLength(2);
  const resume = vi.spyOn(shell.port.agent, "resumeFailed").mockResolvedValue();
  fireEvent.click(old!.querySelector<HTMLButtonElement>('[data-act="task-retry"]')!);
  await waitFor(() => expect(resume).toHaveBeenCalledWith("old-failed"));
});
it("does not claim files are ready when the editor applied no changes", async () => {
  const run = await stage("complete",task=>({...task,noChanges:true,suggestion:null,artifact:null}));
  expect(run.status()).toContain("No changes were made");
  expect(run.card().textContent).not.toContain("Your files are ready");
});

it("shows and opens a worker artifact even when it is absent from the library page", async () => {
  const run = await stage("complete", task => ({ ...task, id: "unlisted-result", artifact: { path: "/external/OD23-single.modified.docx", name: "OD23-single.modified.docx" } }));
  expect(run.card().textContent).toContain("Your file is ready to open");
  expect(run.card().textContent).not.toContain("without a new file");
  const open = vi.spyOn(run.port.files, "openDropped").mockResolvedValue(prototypeFiles(Date.now())[0]);
  fireEvent.click(run.card().querySelector<HTMLButtonElement>('[data-act="open-file"]')!);
  await waitFor(() => expect(open).toHaveBeenCalledWith("/external/OD23-single.modified.docx"));
});

it("keeps the source review visible even before the imported file appears in the library", async () => {
  const run = await stage("review", task => ({ ...task, targetFileName: "OD23-single.docx", suggestion: { ...task.suggestion!, targetFileId: "not-in-library" } }));
  expect(run.status()).toBe("Ready for review");
  expect(run.card().querySelector(".dx-agent-results")?.textContent).toContain("OD23-single.docx");
  expect(run.action("review-task")).toBeTruthy();
});

it("N24-02 displays Before/After with a dedicated Apply and no Continue", async () => {
  const run = await stage("input", task => ({ ...task, question: {
    id: "review-24", kind: "document_edit_review", text: "Proposed replacement", options: [], allowFreeform: false,
    changes: [{ before: "The status is final.", after: "The status is approved." }],
  }}));
  const card = run.card();
  expect(card.querySelector('[data-review="document-edit"]')?.textContent).toContain("The status is final.");
  expect(card.querySelector('[data-review="document-edit"]')?.textContent).toContain("The status is approved.");
  expect(card.querySelector('form[data-form="task-input"]')).toBeNull();
  const answer = vi.spyOn(run.port.agent, "answer");
  fireEvent.click(card.querySelector('[data-act="apply-reviewed-edit"]')!);
  expect(answer).toHaveBeenCalledWith(expect.objectContaining({optionId:"review-apply"}));
});

// N27-01: the library can still contain a legacy staging record. The edit is
// one result regardless of whether that older record has been reconciled.
for (const applied of [false, true]) it(`N27-01 shows one ${applied ? "saved" : "review"} result for an in-place edit`, async () => {
  const run = await stage("complete", task => ({ ...task,
    artifact: { path: "/p/.officedex-proposal-123/OD27-attachment.modified.docx", name: "OD27-attachment.modified.docx" },
    targetFileName: "OD27-attachment.docx",
    suggestion: { id: task.id, targetFileId: "readme", summary: "Edit original", applied, undoable: applied },
  }));
  expect(run.card().querySelectorAll(".dx-agent-results .dx-agent-result")).toHaveLength(1);
  expect(run.card().querySelector(".dx-agent-results")?.textContent).not.toContain("Ready to open");
  expect(run.card().querySelector(".dx-agent-results")?.textContent).toContain(applied ? "Changes applied" : "Changes ready for review");
  const result = run.card().querySelector<HTMLButtonElement>(".dx-agent-result")!;
  expect(result.dataset.act).toBe(applied ? "open-file" : "review-task");
  if (applied) {
    const open = vi.spyOn(run.port.files, "open");
    fireEvent.click(result);
    await waitFor(() => expect(open).toHaveBeenCalledWith("readme"));
    expect(run.actions()).toContain("undo-task");
  }
});

describe("UX30 — 1.0.30 interaction review", () => {
  it("UX30-02: a rejected proposal says so, in the card and in Details, and offers no Resume", async () => {
    const run = await stage("stopped", (task) => ({ ...task, outcome: "rejected", suggestion: null, error: undefined }));
    expect(run.status()).toContain("Changes rejected");
    expect(run.card().textContent).toContain("You rejected the changes. The original file is unchanged.");
    expect(run.card().textContent).not.toContain("Stopped");
    // Asking again is a new, named action; "Resume" would reuse the decision just made.
    expect(run.action("task-retry")?.textContent).toBe("Propose changes again");
    fireEvent.click([...run.card().querySelectorAll("button")].find((button) => button.textContent === "Details")!);
    await waitFor(() => expect(document.querySelector("#dx-modal")?.textContent).toContain("Changes rejected"));
  });

  it("UX30-03: Choose another file is bound to the failed task and retries it in one action", async () => {
    const run = await stage("failed", (task) => ({ ...task, failureKind: "input", inputFile: { name: "Broken.docx", fileId: "missing" } }));
    const retryWithFile = vi.fn().mockResolvedValue(undefined);
    run.port.agent.retryWithFile = retryWithFile;
    fireEvent.click(run.card().querySelector<HTMLButtonElement>('[data-act="task-replace-file"]')!);
    const modal = () => document.querySelector<HTMLElement>("#dx-modal")!;
    await waitFor(() => expect(modal().textContent).toContain("Retry with another file"));
    // The old file is named; nothing is chosen yet, so nothing can be retried.
    expect(modal().querySelector("[data-replace-change]")?.textContent).toContain("Broken.docx");
    const retry = () => modal().querySelector<HTMLButtonElement>('[data-act="replace-retry"]')!;
    expect(retry().disabled).toBe(true);
    const first = modal().querySelector<HTMLInputElement>('input[name="replacement-file"]')!;
    fireEvent.click(first);
    expect(retry().disabled).toBe(false);
    fireEvent.click(retry());
    await waitFor(() => expect(retryWithFile).toHaveBeenCalledWith(run.card().dataset.task, { fileId: first.value }));
  });

  it("UX30-03: cancelling leaves the failed task alone, and the unreadable file cannot be chosen again", async () => {
    const now = Date.now();
    const same = prototypeFiles(now).find((file) => file.type !== "image")!;
    const run = await stage("failed", (task) => ({ ...task, failureKind: "input", inputFile: { name: same.name, fileId: same.id } }));
    const retryWithFile = vi.fn().mockResolvedValue(undefined);
    run.port.agent.retryWithFile = retryWithFile;
    fireEvent.click(run.card().querySelector<HTMLButtonElement>('[data-act="task-replace-file"]')!);
    const modal = () => document.querySelector<HTMLElement>("#dx-modal")!;
    await waitFor(() => expect(modal().querySelector(`input[value="${same.id}"]`)).not.toBeNull());
    fireEvent.click(modal().querySelector<HTMLInputElement>(`input[value="${same.id}"]`)!);
    expect(modal().querySelector("[data-replace-same]")?.textContent).toContain(same.name);
    expect(modal().querySelector<HTMLButtonElement>('[data-act="replace-retry"]')!.disabled).toBe(true);
    fireEvent.click(modal().querySelector<HTMLButtonElement>('[data-act="modal-close"]')!);
    expect(retryWithFile).not.toHaveBeenCalled();
    expect(run.status()).toContain("Couldn’t finish");
  });

  it("UX30-05: a confirmation lists what is being confirmed", async () => {
    const run = await stage("input", (task) => ({
      ...task,
      question: {
        id: "q", kind: "pptx_brief", text: "This is what I understood from your request.", allowFreeform: true,
        options: [{ id: "Start", label: "Confirm and draft the outline" }],
        details: [{ label: "Audience", value: "Design team" }, { label: "Length", value: "3 slides" }],
      },
    }));
    const details = run.card().querySelector("[data-question-details]")!;
    expect([...details.querySelectorAll("dt")].map((node) => node.textContent)).toEqual(["Audience", "Length"]);
    expect([...details.querySelectorAll("dd")].map((node) => node.textContent)).toEqual(["Design team", "3 slides"]);
  });

  it("UX30-06: a deck with nothing to pick up from is generated again, not 'retried remaining'", async () => {
    const pages = [{ slide: 1, title: "One", state: "canceled" as const }];
    const run = await stage("failed", (task) => ({ ...task, documentType: "pptx", outline: pages, recovery: undefined }));
    expect(run.action("task-retry")?.textContent).toBe("Generate again");
    const resumable = await stage("failed", (task) => ({ ...task, documentType: "pptx", outline: pages, recovery: { readyPages: 1, totalPages: 3 } }));
    expect(resumable.action("task-retry")?.textContent).toBe("Retry remaining");
  });

  it("UX30-08: Details gives the summary first and the full technical text, wrapped and copyable", async () => {
    const raw = "PPTX content validation failed: requested exactly 3 slides, exported 1";
    const run = await stage("failed", (task) => ({ ...task, error: "The deck came out with fewer slides than requested.", errorDetail: raw }));
    fireEvent.click([...run.card().querySelectorAll("button")].find((button) => button.textContent === "Details")!);
    const section = await waitFor(() => {
      const found = document.querySelector<HTMLElement>("#dx-modal [data-run-error]");
      if (!found) throw new Error("no error section");
      return found;
    });
    expect(section.querySelector("p")?.textContent).toBe("The deck came out with fewer slides than requested.");
    expect(section.querySelector("details summary")?.textContent).toBe("Technical details");
    // The whole message is in the document, not a clipped line of it.
    expect(section.querySelector("pre")?.textContent).toBe(raw);
    expect(section.querySelector('[data-act="copy-error"]')?.textContent).toBe("Copy details");
  });
});
