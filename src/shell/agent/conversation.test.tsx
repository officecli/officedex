import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SEED_ACTIVE_FILE_ID, SEED_FOLDER_ID } from "../port/fake/seed";
import { renderShell } from "../test/renderShell";
import { mergeMessages } from "./useAgentTask";

afterEach(cleanup);

const sendInput = {
  folderId: SEED_FOLDER_ID,
  mentions: [],
  attachments: [],
  modelId: "gpt-6-astra",
  permission: "review" as const,
  activeFileId: null,
};

const untilText = (container: HTMLElement, needle: string) =>
  waitFor(
    () => {
      if (!container.textContent?.includes(needle)) throw new Error(`waiting for “${needle}”`);
    },
    { timeout: 4000 },
  );

/*
 * The panel is one conversation, and the way out of it is a button.
 *
 * Follow-ups typed under the conversation continue it; "New conversation"
 * empties the panel so the next message starts over. Without the button the
 * only way to start fresh was Home.
 */
describe("task panel conversation", () => {
  it("keeps earlier messages on screen when a follow-up is sent", async () => {
    const shell = await renderShell({ fastAgent: true });
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });

    await act(async () => {
      await shell.port.agent.send({ ...sendInput, text: "Draft the launch memo." });
    });
    await untilText(shell.view.container, "Suggested changes are ready");
    await act(async () => {
      await shell.port.agent.send({ ...sendInput, text: "Make it shorter." });
    });
    await untilText(shell.view.container, "Make it shorter.");
    expect(shell.view.container.textContent).toContain("Draft the launch memo.");
  });

  it("empties the panel on New conversation", async () => {
    const shell = await renderShell({ fastAgent: true });
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });

    await act(async () => {
      await shell.port.agent.send({ ...sendInput, text: "Draft the launch memo." });
    });
    await untilText(shell.view.container, "Suggested changes are ready");

    await act(async () => {
      fireEvent.click(shell.view.getAllByRole("button", { name: "New conversation" })[0]);
    });
    await waitFor(() => {
      expect(shell.view.container.textContent).not.toContain("Draft the launch memo.");
    });
    expect(shell.view.queryAllByRole("button", { name: "New conversation" })).toHaveLength(0);
  });

  it("starts a new conversation from a message that asks for one", async () => {
    const shell = await renderShell({ fastAgent: true });
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });

    await act(async () => {
      await shell.port.agent.send({ ...sendInput, text: "Draft the launch memo." });
    });
    await untilText(shell.view.container, "Suggested changes are ready");
    await act(async () => {
      await shell.port.agent.send({ ...sendInput, text: "Plan the Q4 budget.", newConversation: true });
    });
    await untilText(shell.view.container, "Plan the Q4 budget.");
    expect(shell.view.container.textContent).not.toContain("Draft the launch memo.");
  });
});

// Home starts new work; it never folds into what the folder's panel shows.
describe("Home composer", () => {
  it("always starts a new conversation", async () => {
    const shell = await renderShell({ fastAgent: true });
    await shell.dispatch({ type: "go-home" });
    const flags: Array<boolean | undefined> = [];
    const send = shell.port.agent.send.bind(shell.port.agent);
    shell.port.agent.send = async (input) => {
      flags.push(input.newConversation);
      await send(input);
    };

    await act(async () => {
      fireEvent.change(shell.view.getByLabelText("New task instructions"), {
        target: { value: "Plan the offsite." },
      });
    });
    await act(async () => {
      fireEvent.click(shell.view.getByTitle("Send message"));
    });

    expect(flags).toEqual([true]);
  });

  it("does not send a new conversation from the task panel", async () => {
    const shell = await renderShell({ fastAgent: true });
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });
    const flags: Array<boolean | undefined> = [];
    const send = shell.port.agent.send.bind(shell.port.agent);
    shell.port.agent.send = async (input) => {
      flags.push(input.newConversation);
      await send(input);
    };

    const input = shell.view.getAllByRole("textbox").find((box) => box.closest(".shell-task-composer"));
    expect(input).toBeTruthy();
    await act(async () => {
      fireEvent.change(input!, { target: { value: "Make it shorter." } });
    });
    await act(async () => {
      fireEvent.click(shell.view.getAllByTitle("Send message").find((button) => button.closest(".shell-task-composer"))!);
    });

    expect(flags).toEqual([undefined]);
  });
});

describe("mergeMessages", () => {
  const message = (id: string, text: string) => ({ id, role: "user" as const, text, createdAt: 0 });

  it("adds the in-place edit after the conversation", () => {
    expect(mergeMessages([message("a", "one")], [message("b", "two")]).map((entry) => entry.text)).toEqual(["one", "two"]);
  });

  // Once recorded, the port carries the edit too; it must not show twice.
  it("does not repeat an edit the conversation already carries", () => {
    expect(mergeMessages([message("a", "one"), message("b", "two")], [message("b", "two")])).toHaveLength(2);
  });
});
