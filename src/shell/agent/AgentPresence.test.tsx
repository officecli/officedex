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

/**
 * Leaving the docked column animates it shut and the docked conversation stays
 * mounted for the length of that animation (see AgentPresence and S6-003), so
 * the floating object arrives a beat later. Tests that care about the settled
 * state wait for it; the test that cares about the handover watches it happen.
 */
const untilFloating = (container: HTMLElement, selector: string) =>
  waitFor(
    () => {
      const found = container.querySelector<HTMLElement>(selector);
      if (!found) throw new Error(`waiting for ${selector}`);
      return found;
    },
    { timeout: 4000 },
  );

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
    // Editor opens on the collapsed mark, not the conversation.
    await untilFloating(shell.view.container, ".shell-presence-face");
    expect(shell.state().presence.expanded).toBe(false);
    expect(shell.view.container.querySelector(".shell-presence-panel")).toBeNull();

    await shell.dispatch({ type: "set-mode", mode: "agent" });
    expect(shell.view.container.querySelector(".shell-agent .shell-task")).not.toBeNull();
  });

  it("expands from the collapsed face on click", async () => {
    const shell = await openFile();
    await shell.dispatch({ type: "set-placement", placement: "floating" });
    await shell.dispatch({ type: "set-presence-expanded", expanded: false });

    const face = await untilFloating(shell.view.container, ".shell-presence-face");

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
    const panel = await untilFloating(shell.view.container, ".shell-presence-panel");
    expect(panel.textContent).toContain("Draft the launch checklist.");
  });

  /*
   * S6-003: leaving the dock used to unmount the docked conversation on the
   * frame the placement changed, while the column it lived in kept its 320px
   * for another 200ms and the floating panel appeared at full opacity in the
   * same frame. Two agent panels, one of them an empty box.
   *
   * The invariant is not "the panel is never remounted" — it is that a user
   * never sees two of them, and never sees none of them.
   */
  it("hands the conversation over without ever showing two panels, or none", async () => {
    const shell = await openFile();
    expect(presenceCount(shell.view.container)).toBe(1);

    await shell.dispatch({ type: "set-placement", placement: "floating" });
    // The frame straight after the change: still exactly one.
    expect(presenceCount(shell.view.container)).toBe(1);
    expect(
      shell.view.container.querySelectorAll(".shell-task").length,
      "two conversations on screen at once",
    ).toBe(1);

    await untilFloating(shell.view.container, ".shell-presence-panel");
    expect(presenceCount(shell.view.container)).toBe(1);
    expect(shell.view.container.querySelectorAll(".shell-task").length).toBe(1);

    // And back: the docked column takes over in the same commit.
    await shell.dispatch({ type: "set-placement", placement: "docked" });
    expect(presenceCount(shell.view.container)).toBe(1);
    expect(shell.view.container.querySelector(".shell-presence-panel")).toBeNull();
  });

  /*
   * Home is not a placement change: it replaces the whole body row, so there
   * is no column collapse to wait for. A docked panel lingering into Home puts
   * a second composer on the page beside the hero's.
   */
  it("drops the docked conversation immediately on the way to Home", async () => {
    const shell = await openFile();
    await shell.dispatch({ type: "go-home" });
    expect(shell.view.container.querySelectorAll(".shell-task").length).toBe(0);
    expect(presenceCount(shell.view.container)).toBe(0);
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

  it("follows the open file's folder when switching tabs", async () => {
    const shell = await renderShell({
      fastAgent: true,
      tasks: [
        {
          id: "task-launch",
          title: "Launch deck work",
          folderId: SEED_FOLDER_ID,
          status: "working",
          phase: "Writing the launch deck",
          steps: [],
          messages: [{ id: "m-launch", role: "user", text: "Write the launch deck", createdAt: 1 }],
          suggestion: null,
          question: null,
        },
        {
          id: "task-research",
          title: "Interview notes work",
          folderId: "folder-research",
          status: "working",
          phase: "Reading the interviews",
          steps: [],
          messages: [{ id: "m-research", role: "user", text: "Summarise the interviews", createdAt: 1 }],
          suggestion: null,
          question: null,
        },
      ],
    });
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });
    await shell.dispatch({ type: "open-file", fileId: "file-interviews" });
    await untilText(shell.view.container, "Interview notes work");

    await act(async () => {
      fireEvent.click(shell.view.getByTitle("MO launch plan.docx"));
    });
    await untilText(shell.view.container, "Launch deck work");
    expect(shell.state().selectedFolderId).toBe(SEED_FOLDER_ID);
  });

  it("pauses and resumes without losing the task", async () => {
    const shell = await openFile({ fastAgent: true });
    // The editor opens on the collapsed mark; the controls live in the panel.
    await shell.dispatch({ type: "set-presence-expanded", expanded: true });

    await act(async () => {
      // Pausing only exists for decks, so this run has to be one.
      await shell.port.agent.send({ ...sendInput, text: "Summarise the folder.", activeFileId: null, documentType: "pptx" });
      await shell.port.agent.pause();
    });
    await untilText(shell.view.container, "Agent paused");
    expect(shell.view.container.textContent).not.toContain("Suggested changes are ready");

    await act(async () => {
      fireEvent.click(shell.view.getByText("Resume"));
    });
    await untilText(shell.view.container, "Suggested changes are ready");
  });

  /*
   * A blocked run has to have a way through.
   *
   * The question used to render as an agent reply and nothing else. The only
   * text box on screen was the composer, and typing into it started a second
   * run while the first stayed blocked — so the panel showed a conversation
   * that had quietly stopped being about the thing still waiting.
   */
  it("offers the run's question as choices, and answering lets it continue", async () => {
    const shell = await openFile({ fastAgent: true, asksQuestion: true });

    await act(async () => {
      await shell.port.agent.send({ ...sendInput, text: "Draft the launch memo.", activeFileId: null });
    });
    await untilText(shell.view.container, "Who is this for?");
    expect(shell.view.container.textContent).not.toContain("Suggested changes are ready");

    await act(async () => {
      fireEvent.click(shell.view.getByText("Executives"));
    });
    await untilText(shell.view.container, "Suggested changes are ready");
    expect(shell.view.container.querySelector(".shell-task-question")).toBeNull();
  });

  // The composer answers the question instead of starting a second run.
  it("routes a typed reply to the waiting question", async () => {
    const shell = await openFile({ fastAgent: true, asksQuestion: true });

    await act(async () => {
      await shell.port.agent.send({ ...sendInput, text: "Draft the launch memo.", activeFileId: null });
    });
    await untilText(shell.view.container, "Who is this for?");

    await act(async () => {
      await shell.port.agent.send({ ...sendInput, text: "The board.", activeFileId: null });
    });
    await untilText(shell.view.container, "Suggested changes are ready");
    expect(shell.view.container.querySelector(".shell-task-question")).toBeNull();
  });
});
