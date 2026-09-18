import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SEED_ACTIVE_FILE_ID } from "../port/fake/seed";
import { renderShell } from "../test/renderShell";

afterEach(cleanup);

async function agentHome() {
  const shell = await renderShell({ fastAgent: true });
  await shell.dispatch({ type: "go-home" });
  return shell;
}

async function taskColumn() {
  const shell = await renderShell({ fastAgent: true });
  await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });
  return shell;
}

/**
 * The guard for the second half of decision 2.
 *
 * The prototype put a folder dropdown in the Agent Home header whose only job
 * was to pick what a task would touch — while the composer separately supported
 * `@folder` mentions that did the same thing. These assertions pin the merged
 * result: scope is a chip on the message, there is no second folder control,
 * and every placement of the composer offers the same one.
 */
describe("task scope is a composer chip", () => {
  it("defaults to the folder the sidebar has selected", async () => {
    const shell = await agentHome();
    await shell.dispatch({ type: "select-folder", folderId: "folder-research" });

    expect(shell.view.getByTitle("Scope: Customer research")).toBeInTheDocument();
  });

  it("falls back to the active file's folder when nothing is selected", async () => {
    const shell = await taskColumn();
    // `open-file` is the raw reducer action, so no folder gets selected: this is
    // exactly the case the fallback exists for.
    expect(shell.state().selectedFolderId).toBeNull();
    expect(shell.view.getByTitle("Scope: MO product launch")).toBeInTheDocument();
  });

  it("offers no folder control outside the composer", async () => {
    const shell = await agentHome();

    // The prototype's header dropdown is gone; the only folder picker is the
    // scope chip, and the sidebar selection that feeds it.
    const home = shell.view.container.querySelector<HTMLElement>(".shell-home")!;
    const banner = within(home).queryByRole("button", { name: /Switch folder/i });
    expect(banner).toBeNull();

    const scopeTriggers = shell.view.container.querySelectorAll(".shell-cx-scope");
    expect(scopeTriggers).toHaveLength(1);
  });

  it("changes scope from the chip and sends the new folder", async () => {
    const shell = await agentHome();

    await act(async () => {
      fireEvent.click(shell.view.getByTitle(/^Scope: /));
    });
    await act(async () => {
      fireEvent.click(shell.view.getByRole("menuitemradio", { name: /Customer research/ }));
    });

    expect(shell.state().selectedFolderId).toBe("folder-research");

    await act(async () => {
      fireEvent.change(shell.view.getByLabelText("New task instructions"), {
        target: { value: "Summarise the interviews." },
      });
    });
    await act(async () => {
      fireEvent.click(shell.view.getByTitle("Send message"));
    });

    await waitFor(async () => {
      const task = await shell.port.agent.current("folder-research");
      if (!task) throw new Error("task not started in the chosen folder");
      expect(task.folderId).toBe("folder-research");
    });
  });

  it("is the same control in every placement", async () => {
    const shell = await taskColumn();

    // Docked column.
    expect(shell.view.getAllByTitle(/^Scope: /)).toHaveLength(1);

    // Floating panel.
    await shell.dispatch({ type: "set-placement", placement: "floating" });
    expect(shell.view.getAllByTitle(/^Scope: /)).toHaveLength(1);

    // Home hero.
    await shell.dispatch({ type: "go-home" });
    expect(shell.view.getAllByTitle(/^Scope: /)).toHaveLength(1);
  });
});

describe("mentions", () => {
  it("opens on @ and inserts a folder as a chip", async () => {
    const shell = await agentHome();
    const input = shell.view.getByLabelText("New task instructions") as HTMLTextAreaElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: "Use @" } });
    });

    const listbox = shell.view.getByRole("listbox", { name: "Files and folders" });
    expect(listbox).toBeInTheDocument();

    // Targeted by role: "Customer research" is also the location label on every
    // file that lives in it, so a bare text query is ambiguous.
    await act(async () => {
      fireEvent.click(within(listbox).getByRole("option", { name: /^Customer research/ }));
    });

    expect(input.value).toContain("@Customer research");
    expect(shell.view.container.querySelector(".shell-cx-chip.is-folder")?.textContent).toContain(
      "Customer research",
    );
  });

  it("filters as you type and mentions a file", async () => {
    const shell = await agentHome();
    const input = shell.view.getByLabelText("New task instructions") as HTMLTextAreaElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: "Check @forecast" } });
    });

    const listbox = shell.view.getByRole("listbox", { name: "Files and folders" });
    expect(within(listbox).getByText("MO sales forecast.xlsx")).toBeInTheDocument();
    // Unrelated files are filtered out.
    expect(within(listbox).queryByText("Interview notes.docx")).toBeNull();

    await act(async () => {
      fireEvent.click(within(listbox).getByText("MO sales forecast.xlsx"));
    });
    expect(shell.view.container.querySelector(".shell-cx-chip.is-file")).not.toBeNull();
  });

  it("removing a chip also removes its token from the text", async () => {
    const shell = await agentHome();
    const input = shell.view.getByLabelText("New task instructions") as HTMLTextAreaElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: "Use @" } });
    });
    await act(async () => {
      fireEvent.click(
        within(shell.view.getByRole("listbox", { name: "Files and folders" })).getByRole("option", {
          name: /^Customer research/,
        }),
      );
    });
    expect(input.value).toContain("@Customer research");

    await act(async () => {
      fireEvent.click(shell.view.getByLabelText("Remove Customer research"));
    });

    expect(input.value).not.toContain("@Customer research");
    expect(shell.view.container.querySelector(".shell-cx-chip.is-folder")).toBeNull();
  });

  it("sends the mentions alongside the text", async () => {
    const shell = await agentHome();
    const input = shell.view.getByLabelText("New task instructions");

    await act(async () => {
      fireEvent.change(input, { target: { value: "Compare @" } });
    });
    await act(async () => {
      fireEvent.click(
        within(shell.view.getByRole("listbox", { name: "Files and folders" })).getByText(
          "MO sales forecast.xlsx",
        ),
      );
    });
    await act(async () => {
      fireEvent.click(shell.view.getByTitle("Send message"));
    });

    await waitFor(async () => {
      const task = await shell.port.agent.current(shell.state().selectedFolderId ?? "folder-launch");
      if (!task?.messages.length) throw new Error("no message recorded");
      expect(task.messages[0].text).toContain("@MO sales forecast.xlsx");
    });
  });
});

describe("send button", () => {
  it("is disabled until there is text", async () => {
    const shell = await agentHome();
    const send = shell.view.getByTitle("Send message");
    expect(send).toBeDisabled();

    await act(async () => {
      fireEvent.change(shell.view.getByLabelText("New task instructions"), {
        target: { value: "Go" },
      });
    });
    expect(shell.view.getByTitle("Send message")).toBeEnabled();
  });

  it("switches to Stop while a task runs with an empty draft", async () => {
    const shell = await taskColumn();
    await act(async () => {
      await shell.port.agent.send({
        text: "Long task",
        folderId: "folder-launch",
        mentions: [],
        attachments: [],
        modelId: "gpt-6-astra",
        permission: "review",
        activeFileId: SEED_ACTIVE_FILE_ID,
      });
      await shell.port.agent.pause();
    });

    // Paused counts as running: the control has to offer a way out.
    await shell.dispatch({ type: "set-placement", placement: "docked" });
    expect(shell.view.queryByTitle("Send message")).toBeDisabled();
  });
});
