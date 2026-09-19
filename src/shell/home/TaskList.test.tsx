import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SEED_FOLDER_ID } from "../port/fake/seed";
import { renderShell } from "../test/renderShell";

afterEach(cleanup);

/**
 * The band this file guards exists because Home used to lie by omission.
 *
 * It drew `AgentPort.current(scopeFolderId)` — one card, one folder — so a run
 * started in another folder vanished from the one screen whose job is to say
 * what the user was doing, the instant they changed the folder chip. The
 * assertions below are the mechanical form of "that cannot happen again":
 * every folder's runs are listed, a live event edits the row it belongs to
 * rather than adding a second one, and an empty list draws nothing at all.
 */

const OTHER_FOLDER_ID = "folder-research";

const sendInput = {
  mentions: [],
  attachments: [],
  activeFileId: null,
  modelId: "gpt-6-astra",
  permission: "review" as const,
};

/** The "Continue working" section, or null when it is not on Home at all. */
function band(container: HTMLElement) {
  return container.querySelector<HTMLElement>('[aria-label="Continue working"]');
}

function rows(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>(".shell-task-row")];
}

const untilText = (element: HTMLElement, needle: string) =>
  waitFor(
    () => {
      if (!element.textContent?.includes(needle)) throw new Error(`waiting for “${needle}”`);
    },
    { timeout: 4000 },
  );

describe("Continue working", () => {
  it("renders nothing until there has been a run", async () => {
    const shell = await renderShell();
    expect(band(shell.view.container)).toBeNull();
  });

  // The whole point of `list` over `current`: Home is not scoped to the chip.
  it("lists runs from every folder, not just the one in scope", async () => {
    const shell = await renderShell({ fastAgent: true });

    await act(async () => {
      await shell.port.agent.send({
        ...sendInput,
        folderId: SEED_FOLDER_ID,
        text: "Draft the launch checklist.",
      });
    });
    await act(async () => {
      await shell.port.agent.send({
        ...sendInput,
        folderId: OTHER_FOLDER_ID,
        text: "Summarise the interviews.",
      });
    });

    const section = band(shell.view.container);
    if (!section) throw new Error("the Continue working band is missing");
    await untilText(section, "Summarise the interviews.");

    expect(rows(shell.view.container)).toHaveLength(2);
    expect(section.textContent).toContain("Draft the launch checklist.");
    // The folder each run belongs to is what tells two rows apart.
    expect(section.textContent).toContain("MO product launch");
    expect(section.textContent).toContain("Customer research");
    // The scope chip is still the launch folder; the research run is listed
    // anyway, which is the regression this band was rebuilt for.
    expect(shell.state().selectedFolderId).not.toBe(OTHER_FOLDER_ID);
  });

  it("updates the row a live event belongs to instead of adding another", async () => {
    // Real delays, not `fastAgent`: the run has to be observably mid-flight for
    // the "still working" assertion to mean anything.
    const shell = await renderShell();

    await act(async () => {
      await shell.port.agent.send({
        ...sendInput,
        folderId: SEED_FOLDER_ID,
        text: "Draft the launch checklist.",
      });
    });

    const section = band(shell.view.container);
    if (!section) throw new Error("the Continue working band is missing");
    await untilText(section, "Agent working");

    // The phase is the part of the subtitle that keeps moving.
    expect(section.textContent).toContain("Reading your instructions");

    await untilText(section, "Agent waiting for review");
    expect(section.textContent).toContain("Suggested changes are ready");
    expect(rows(shell.view.container)).toHaveLength(1);
  });

  it("opens a file in the run's own folder, wherever the user was", async () => {
    const shell = await renderShell({ fastAgent: true });

    await act(async () => {
      await shell.port.agent.send({
        ...sendInput,
        folderId: OTHER_FOLDER_ID,
        text: "Summarise the interviews.",
      });
    });

    const section = band(shell.view.container);
    if (!section) throw new Error("the Continue working band is missing");
    await untilText(section, "Summarise the interviews.");

    await act(async () => {
      fireEvent.click(within(section).getByText("Summarise the interviews."));
    });

    await waitFor(() => {
      expect(shell.state().selectedFolderId).toBe(OTHER_FOLDER_ID);
    });
    const opened = shell.state().activeFileId;
    const files = await shell.port.files.list();
    expect(files.find((file) => file.id === opened)?.folderId).toBe(OTHER_FOLDER_ID);
  });
});
