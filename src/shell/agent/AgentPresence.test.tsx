import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SEED_ACTIVE_FILE_ID, SEED_FOLDER_ID } from "../port/fake/seed";
import { renderShell, type RenderShellOptions } from "../test/renderShell";

afterEach(cleanup);

/** Every rendering of the presence, docked or floating, expanded or not. */
function presenceCount(container: HTMLElement) {
  const docked = container.querySelectorAll('.shell-agent:not([aria-hidden="true"]) .shell-task');
  const floatingPanel = container.querySelectorAll(".shell-presence-panel");
  const floatingFace = container.querySelectorAll(".shell-presence-face");
  return docked.length + floatingPanel.length + floatingFace.length;
}

async function openFile(options: RenderShellOptions = {}) {
  const shell = await renderShell(options);
  await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });
  return shell;
}

const untilText = (container: HTMLElement, needle: string) =>
  waitFor(
    () => {
      if (!container.textContent?.includes(needle)) throw new Error(`waiting for “${needle}”`);
    },
    { timeout: 4000 },
  );

const sendInput = {
  folderId: SEED_FOLDER_ID,
  mentions: [],
  attachments: [],
  modelId: "gpt-6-astra",
  permission: "review" as const,
};

/**
 * The guard for decision 1.
 *
 * The prototype carried three draggable agent objects — two of them the same
 * artwork with different rules, and two that could be on screen at once. These
 * assertions make "there is exactly one presence" mechanically checkable.
 */
describe("agent presence is a single object", () => {
  it("renders exactly one presence in every placement", async () => {
    const shell = await openFile();

    expect(shell.state().presence.placement).toBe("docked");
    expect(presenceCount(shell.view.container)).toBe(1);

    await shell.dispatch({ type: "set-placement", placement: "floating" });
    expect(presenceCount(shell.view.container)).toBe(1);

    await shell.dispatch({ type: "set-presence-expanded", expanded: false });
    expect(presenceCount(shell.view.container)).toBe(1);

    // Editor mode cannot dock, so it is always the floating object.
    await shell.dispatch({ type: "set-mode", mode: "editor" });
    expect(presenceCount(shell.view.container)).toBe(1);
  });

  it("never draws a collapsed face beside the docked column", async () => {
    const shell = await openFile();
    expect(shell.view.container.querySelector(".shell-presence-face")).toBeNull();
    expect(shell.view.container.querySelector(".shell-agent .shell-task")).not.toBeNull();
  });

  it("shows no presence on Home, in either mode", async () => {
    const shell = await openFile();
    await shell.dispatch({ type: "go-home" });
    expect(presenceCount(shell.view.container)).toBe(0);

    await shell.dispatch({ type: "set-mode", mode: "editor" });
    expect(presenceCount(shell.view.container)).toBe(0);
  });

  it("refuses to dock in Editor mode but remembers the Agent-mode choice", async () => {
    const shell = await openFile();
    await shell.dispatch({ type: "set-mode", mode: "editor" });

    // No dock/float control is offered where docking is impossible.
    expect(shell.view.queryByTitle("Dock the Agent panel")).toBeNull();
    expect(shell.view.container.querySelector(".shell-presence-panel")).not.toBeNull();

    await shell.dispatch({ type: "set-mode", mode: "agent" });
    expect(shell.view.container.querySelector(".shell-agent .shell-task")).not.toBeNull();
  });

  it("expands from the collapsed face on click", async () => {
    const shell = await openFile();
    await shell.dispatch({ type: "set-placement", placement: "floating" });
    await shell.dispatch({ type: "set-presence-expanded", expanded: false });

    const face = shell.view.container.querySelector<HTMLElement>(".shell-presence-face");
    if (!face) throw new Error("collapsed face missing");

    await act(async () => {
      fireEvent.click(face);
    });

    // The prototype's status pet deliberately did nothing on click; decision 1
    // drops that rule, because a round animate face reads as a button.
    expect(shell.state().presence.expanded).toBe(true);
    expect(shell.view.container.querySelector(".shell-presence-panel")).not.toBeNull();
  });

  it("keeps one conversation across a placement change", async () => {
    const shell = await openFile({ fastAgent: true });
    await act(async () => {
      await shell.port.agent.send({
        ...sendInput,
        text: "Draft the launch checklist.",
        activeFileId: SEED_ACTIVE_FILE_ID,
      });
    });
    await untilText(shell.view.container, "Draft the launch checklist.");

    expect(shell.view.container.querySelector(".shell-agent .shell-task")?.textContent).toContain(
      "Draft the launch checklist.",
    );

    await shell.dispatch({ type: "set-placement", placement: "floating" });
    expect(shell.view.container.querySelector(".shell-presence-panel")?.textContent).toContain(
      "Draft the launch checklist.",
    );
  });
});

describe("task panel", () => {
  it("runs a task to a reviewable suggestion and applies it", async () => {
    const shell = await openFile({ fastAgent: true });
    const panel = () => within(shell.view.container.querySelector<HTMLElement>(".shell-task")!);

    await act(async () => {
      fireEvent.change(panel().getByLabelText("Message Agent"), {
        target: { value: "Add a launch checklist." },
      });
    });
    await act(async () => {
      fireEvent.click(panel().getByTitle("Send message"));
    });

    await untilText(shell.view.container, "Suggested changes are ready");

    await act(async () => {
      fireEvent.click(panel().getByText("Review and apply"));
    });
    await untilText(shell.view.container, "Changes applied");

    // Applying is what marks the file dirty, so the tab dot must follow.
    expect(shell.view.container.querySelectorAll(".shell-tab-dirty").length).toBeGreaterThan(0);
    expect(panel().getByText("Undo")).toBeInTheDocument();
  });

  it("undoes an applied suggestion and clears the dirty marker", async () => {
    const shell = await openFile({ fastAgent: true });
    const panel = () => within(shell.view.container.querySelector<HTMLElement>(".shell-task")!);

    await act(async () => {
      await shell.port.agent.send({ ...sendInput, text: "Tidy it.", activeFileId: SEED_ACTIVE_FILE_ID });
    });
    await untilText(shell.view.container, "Suggested changes are ready");

    await act(async () => {
      fireEvent.click(panel().getByText("Review and apply"));
    });
    await untilText(shell.view.container, "Changes applied");

    await act(async () => {
      fireEvent.click(panel().getByText("Undo"));
    });
    await untilText(shell.view.container, "Suggested changes are ready");

    const plan = (await shell.port.files.list()).find((file) => file.id === SEED_ACTIVE_FILE_ID);
    expect(plan?.dirty).toBe(false);
  });

  it("pauses and resumes without losing the task", async () => {
    const shell = await openFile({ fastAgent: true });

    await act(async () => {
      await shell.port.agent.send({ ...sendInput, text: "Summarise the folder.", activeFileId: null });
      await shell.port.agent.pause();
    });
    await untilText(shell.view.container, "Agent paused");
    expect(shell.view.container.textContent).not.toContain("Suggested changes are ready");

    await act(async () => {
      fireEvent.click(shell.view.getByText("Resume"));
    });
    await untilText(shell.view.container, "Suggested changes are ready");
  });
});
