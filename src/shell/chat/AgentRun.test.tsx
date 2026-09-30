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

  it("asks the port to finish the run", async () => {
    const run = await stage("working");
    const finish = vi.spyOn(run.port.agent, "finish");
    fireEvent.click(run.action("task-stop")!);
    expect(finish).toHaveBeenCalledTimes(1);
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
