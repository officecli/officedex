import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { toast } from "../../renderer/ui";
import type { AgentTask } from "../../shared/uiPort";
import { SEED_FOLDER_ID } from "../port/fake/seed";
import { renderShell } from "../test/renderShell";

afterEach(() => {
  cleanup();
  toast.destroy();
});

const TASK_ID = "task-failed-deck";

/** "8/10 ready (provider_rejected)": a deck that stopped with most pages written. */
function failedDeck(recovery: AgentTask["recovery"]): AgentTask {
  return {
    id: TASK_ID,
    title: "季度复盘",
    folderId: SEED_FOLDER_ID,
    documentType: "pptx",
    status: "done",
    phase: "content generation failed",
    steps: [],
    messages: [
      { id: "m1", role: "user", text: "做一份 10 页的季度复盘", createdAt: 1 },
      { id: "m2", role: "agent", text: "content generation failed: PPTX expansion is incomplete", createdAt: 2 },
    ],
    suggestion: null,
    question: null,
    ...(recovery ? { recovery } : {}),
  };
}

async function openTask(task: AgentTask) {
  const shell = await renderShell({ fastAgent: true, tasks: [task] });
  await shell.dispatch({ type: "select-folder", folderId: SEED_FOLDER_ID });
  await shell.dispatch({ type: "enter-workspace" });
  return shell;
}

const retryButton = () =>
  [...document.querySelectorAll<HTMLButtonElement>(".shell-task-button")].find((button) =>
    /Retry/.test(button.textContent ?? ""),
  );

describe("a failed deck with finished pages", () => {
  it("says how much is kept and offers to write only the rest", async () => {
    await openTask(failedDeck({ readyPages: 8, totalPages: 10 }));

    await waitFor(() => expect(document.querySelector(".shell-task-recovery")).not.toBeNull());
    expect(document.querySelector(".shell-task-recovery")?.textContent).toContain("8 of 10");
    expect(retryButton()?.textContent).toContain("Retry the remaining 2");
  });

  it("does not invent a count the runtime did not report", async () => {
    await openTask(failedDeck({}));

    await waitFor(() => expect(retryButton()).toBeDefined());
    expect(retryButton()?.textContent).toBe("Retry unfinished slides");
  });

  it("resumes the run when asked", async () => {
    const shell = await openTask(failedDeck({ readyPages: 8, totalPages: 10 }));
    await waitFor(() => expect(retryButton()).toBeDefined());

    await act(async () => {
      fireEvent.click(retryButton()!);
    });

    await waitFor(() => expect(retryButton()).toBeUndefined());
    const task = await shell.port.agent.current(SEED_FOLDER_ID);
    expect(task?.status).not.toBe("done");
    expect(task?.recovery).toBeUndefined();
  });

  it("offers nothing for a failure that cannot be resumed", async () => {
    await openTask(failedDeck(undefined));

    await waitFor(() => expect(document.querySelector(".shell-task-reply")).not.toBeNull());
    expect(retryButton()).toBeUndefined();
    expect(document.querySelector(".shell-task-recovery")).toBeNull();
  });
});
