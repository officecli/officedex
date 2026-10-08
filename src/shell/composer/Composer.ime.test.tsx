import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { toast } from "../../renderer/ui";
import { resetLayers } from "../kit/layers";
import { SEED_FOLDER_ID } from "../port/fake/seed";
import { renderShell } from "../test/renderShell";
import { resetComposerDrafts } from "./Composer";

afterEach(() => {
  cleanup();
  toast.destroy();
  resetLayers();
  resetComposerDrafts();
});

/** Records every message the port receives, whichever composer sent it. */
function watchSends(shell: Awaited<ReturnType<typeof renderShell>>) {
  const sent: string[] = [];
  const send = shell.port.agent.send.bind(shell.port.agent);
  shell.port.agent.send = async (input) => {
    sent.push(input.text);
    await send(input);
  };
  return sent;
}

/** The conversation column's composer, where a project's messages are typed. */
async function chatWithSpy() {
  const shell = await renderShell({ fastAgent: true });
  await shell.dispatch({ type: "open-chat", chat: { folderId: SEED_FOLDER_ID, conversationId: null } });
  const sent = watchSends(shell);
  const input = shell.view.getByLabelText("Message OfficeDex") as HTMLTextAreaElement;
  return { shell, sent, input };
}

/** Home's one main input — a fresh render is already there. */
async function homeWithSpy() {
  const shell = await renderShell({ fastAgent: true });
  const sent = watchSends(shell);
  const input = shell.view.getByLabelText("Describe your task") as HTMLTextAreaElement;
  return { shell, sent, input };
}

/**
 * Enter while a Chinese/Japanese IME shows candidates confirms the candidate
 * (e.g. commits the raw "a"). It must never send the message.
 */
describe("composer with an IME", () => {
  it("does not send on the Enter that confirms a candidate", async () => {
    const { sent, input } = await chatWithSpy();

    await act(async () => {
      fireEvent.compositionStart(input);
      fireEvent.change(input, { target: { value: "使用输入法时a" } });
      fireEvent.keyDown(input, { key: "Enter", isComposing: true, keyCode: 229 });
    });

    expect(sent).toEqual([]);
    expect(input.value).toBe("使用输入法时a");
  });

  it("ignores the keyCode 229 Enter WebKit fires after compositionend", async () => {
    const { sent, input } = await chatWithSpy();

    await act(async () => {
      fireEvent.compositionStart(input);
      fireEvent.change(input, { target: { value: "hello a" } });
      fireEvent.compositionEnd(input);
      fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    });

    expect(sent).toEqual([]);
  });

  it("still sends on a plain Enter once composition is over", async () => {
    const { sent, input } = await chatWithSpy();

    await act(async () => {
      fireEvent.compositionStart(input);
      fireEvent.change(input, { target: { value: "hello" } });
      fireEvent.compositionEnd(input);
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter", keyCode: 13 });
    });

    expect(sent).toEqual(["hello"]);
  });

  it("does not pick a mention while the IME owns Enter", async () => {
    const { shell, input } = await chatWithSpy();
    const list = () => shell.view.getByRole("listbox", { name: "Files to add to this message" });

    await act(async () => {
      fireEvent.change(input, { target: { value: "Compare @" } });
    });
    expect(list()).toBeInTheDocument();

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter", isComposing: true, keyCode: 229 });
    });

    expect(input.value).toBe("Compare @");
    expect(within(list()).getAllByRole("option").length).toBeGreaterThan(0);
  });

  /*
   * Home is where a Chinese sentence is most often typed from scratch, and it is
   * the placement whose send opens a new conversation — so a candidate confirmed
   * there would not only send, it would start a run.
   */
  it("holds the same on Home", async () => {
    const { shell, sent, input } = await homeWithSpy();

    await act(async () => {
      fireEvent.compositionStart(input);
      fireEvent.change(input, { target: { value: "帮我写一份发布计划a" } });
      fireEvent.keyDown(input, { key: "Enter", isComposing: true, keyCode: 229 });
    });

    expect(sent).toEqual([]);
    expect(input.value).toBe("帮我写一份发布计划a");
    expect(shell.state().chat).toBeNull();
  });
});
