import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { toast } from "../../renderer/ui";
import { renderShell } from "../test/renderShell";
import { resetComposerDrafts } from "./Composer";

afterEach(() => {
  cleanup();
  toast.destroy();
  resetComposerDrafts();
});

async function homeWithSpy() {
  const shell = await renderShell({ fastAgent: true });
  await shell.dispatch({ type: "go-home" });
  const sent: string[] = [];
  const send = shell.port.agent.send.bind(shell.port.agent);
  shell.port.agent.send = async (input) => {
    sent.push(input.text);
    await send(input);
  };
  const input = shell.view.getByLabelText("New task instructions") as HTMLTextAreaElement;
  return { shell, sent, input };
}

/**
 * Enter while a Chinese/Japanese IME shows candidates confirms the candidate
 * (e.g. commits the raw "a"). It must never send the message.
 */
describe("composer with an IME", () => {
  it("does not send on the Enter that confirms a candidate", async () => {
    const { sent, input } = await homeWithSpy();

    await act(async () => {
      fireEvent.compositionStart(input);
      fireEvent.change(input, { target: { value: "使用输入法时a" } });
      fireEvent.keyDown(input, { key: "Enter", isComposing: true, keyCode: 229 });
    });

    expect(sent).toEqual([]);
    expect(input.value).toBe("使用输入法时a");
  });

  it("ignores the keyCode 229 Enter WebKit fires after compositionend", async () => {
    const { sent, input } = await homeWithSpy();

    await act(async () => {
      fireEvent.compositionStart(input);
      fireEvent.change(input, { target: { value: "hello a" } });
      fireEvent.compositionEnd(input);
      fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    });

    expect(sent).toEqual([]);
  });

  it("still sends on a plain Enter once composition is over", async () => {
    const { sent, input } = await homeWithSpy();

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
    const { shell, input } = await homeWithSpy();

    await act(async () => {
      fireEvent.change(input, { target: { value: "Compare @" } });
    });
    expect(shell.view.getByRole("listbox", { name: "Files and folders" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter", isComposing: true, keyCode: 229 });
    });

    expect(input.value).toBe("Compare @");
    expect(
      within(shell.view.getByRole("listbox", { name: "Files and folders" })).getAllByRole("option").length,
    ).toBeGreaterThan(0);
  });
});
