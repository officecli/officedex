import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { toast } from "../../../renderer/ui";
import type { SendInput } from "../../../shared/uiPort";
import { resetComposerDrafts } from "../../composer/Composer";
import { resetLayers } from "../../kit/layers";
import { renderShell } from "../../test/renderShell";

/**
 * The image creator, and the image composer beside a picture's conversation.
 *
 * r10 keeps this interface as it was (§18: "AI image 保留既有图像创作界面") and
 * moves it: it is a page of its own — New → AI image, or Home's Quick start —
 * rather than a mode Home's composer could be toggled into. So what these
 * assert is unchanged, the brief and every control that decides what the run
 * receives, plus the two ways in and the compact form the same control takes in
 * the task column afterwards.
 */

afterEach(() => {
  cleanup();
  toast.destroy();
  resetComposerDrafts();
  resetLayers();
});

/** The image creator page, the way the UI opens it. */
async function imageCreator() {
  const shell = await renderShell({ fastAgent: true });
  await act(async () => {
    fireEvent.click(shell.view.getByRole("button", { name: "New AI image" }));
  });
  await waitFor(() => expect(shell.state().page).toBe("image"));
  const sent: SendInput[] = [];
  const send = shell.port.agent.send.bind(shell.port.agent);
  shell.port.agent.send = async (input) => {
    sent.push(input);
    return send(input);
  };
  return { ...shell, sent };
}

describe("the way into the image creator", () => {
  it("is Home's Quick start", async () => {
    const shell = await renderShell({ fastAgent: true });

    await act(async () => {
      fireEvent.click(shell.view.getByRole("button", { name: "New AI image" }));
    });

    expect(shell.state().page).toBe("image");
    expect(shell.view.getByRole("heading", { level: 1 }).textContent).toBe("What would you like to create?");
    // The brief, not a conversation: nothing has been sent and no chat opened.
    expect(shell.state().chat).toBeNull();
  });

  it("is New → AI image", async () => {
    const shell = await renderShell({ fastAgent: true });

    await act(async () => {
      fireEvent.click(shell.view.getByRole("button", { name: "New" }));
    });
    await act(async () => {
      fireEvent.click(
        document.querySelector<HTMLButtonElement>('#dx-new-popover [data-act=create-local][data-id=png]')!,
      );
    });

    await waitFor(() => expect(shell.state().page).toBe("image"));
    expect(shell.view.getByRole("heading", { level: 1 }).textContent).toBe("What would you like to create?");
  });
});

describe("the image creator's composer", () => {
  it("is the image interface, not the agent one, and cannot be switched out of it", async () => {
    const shell = await imageCreator();

    const composer = document.querySelector<HTMLElement>(".shell-cx.is-image");
    expect(composer).not.toBeNull();
    // The r10 agent composer is not also on the page: this is the form the
    // design keeps, not a fourth chat input.
    expect(document.querySelector(".dx-composer")).toBeNull();
    // The page *is* image mode, so there is no way out of it to offer.
    expect(composer!.querySelector(".shell-ig-mode-close")).toBeNull();
    expect(composer!.querySelector(".shell-ig-head-exit")).toBeNull();

    const strip = shell.view.getByRole("group", { name: "Image options" });
    for (const name of ["Choose image model", "Image settings", "Add text to image", "Mention files or folders", "Camera settings", "Image style"]) {
      expect(within(strip).getByRole("button", { name })).toBeTruthy();
    }
    expect(shell.view.getByRole("button", { name: "Add reference image" })).toBeTruthy();
    expect(shell.view.getByRole("group", { name: "Image prompt ideas" })).toBeTruthy();
  });

  it("fills a purpose without sending it", async () => {
    const shell = await imageCreator();
    await act(async () => {
      fireEvent.click(shell.view.getByRole("button", { name: /Product photo/ }));
    });
    expect((shell.view.getByLabelText("New task instructions") as HTMLTextAreaElement).value).toMatch(/product photo/i);
    expect(shell.sent).toHaveLength(0);
  });
});

describe("the image settings", () => {
  it("send what the panel shows", async () => {
    const shell = await imageCreator();
    await act(async () => {
      fireEvent.click(shell.view.getByRole("button", { name: "Image settings" }));
    });
    const panel = shell.view.getByRole("dialog", { name: "Image settings" });
    await act(async () => {
      fireEvent.click(within(panel).getByRole("radio", { name: "16:9" }));
      fireEvent.click(within(panel).getByRole("radio", { name: "4K" }));
      fireEvent.click(within(panel).getByRole("radio", { name: "2 images" }));
    });
    expect((within(panel).getByLabelText("Image width") as HTMLInputElement).value).toBe("3840");
    expect(shell.view.getByRole("button", { name: "Image settings" }).textContent).toBe("16:9·4K·2");

    await act(async () => {
      fireEvent.change(shell.view.getByLabelText("New task instructions"), { target: { value: "A lamp" } });
    });
    await act(async () => {
      fireEvent.click(shell.view.getByTitle("Send message"));
    });
    expect(shell.sent[0]).toMatchObject({
      documentType: "img",
      activeFileId: null,
      imageGeneration: { ratio: "16:9", resolution: "4K", count: 2, camera: null, references: [], prompt: "A lamp" },
    });
  });

  it("refuses a typed size the model would reject", async () => {
    const shell = await imageCreator();
    await act(async () => {
      fireEvent.click(shell.view.getByRole("button", { name: "Image settings" }));
    });
    const panel = shell.view.getByRole("dialog", { name: "Image settings" });
    await act(async () => {
      fireEvent.change(within(panel).getByLabelText("Image width"), { target: { value: "1000" } });
    });
    expect(within(panel).getByRole("alert").textContent).toMatch(/multiple of 16/);
    // Nothing reached the draft: the chip still shows the ratio, not a size.
    expect(shell.view.getByRole("button", { name: "Image settings" }).textContent).toBe("Auto·2K·1");
  });

  it("only lets Auto be picked as the model, and says why", async () => {
    const shell = await imageCreator();
    await act(async () => {
      fireEvent.click(shell.view.getByRole("button", { name: "Choose image model" }));
    });
    await act(async () => {
      fireEvent.click(within(shell.view.getByRole("dialog", { name: "Image model" })).getByRole("radio", { name: /GPT Image 2/ }));
    });
    await waitFor(() => expect(document.body.textContent).toMatch(/not available yet/));
    expect(shell.view.getByRole("button", { name: "Choose image model" }).textContent).toContain("Auto");
  });

  it("shows a chosen style and camera as chips that remove them", async () => {
    const shell = await imageCreator();
    await act(async () => {
      fireEvent.click(shell.view.getByRole("button", { name: "Image style" }));
    });
    await act(async () => {
      fireEvent.click(within(shell.view.getByRole("dialog", { name: "Image style" })).getByRole("radio", { name: /Cinematic/ }));
    });
    await act(async () => {
      fireEvent.click(shell.view.getByRole("button", { name: "Camera settings" }));
    });
    await act(async () => {
      fireEvent.click(shell.view.getByRole("switch", { name: "Use camera settings" }));
    });

    expect(shell.view.getByRole("button", { name: "Remove image style" })).toBeTruthy();
    await act(async () => {
      fireEvent.change(shell.view.getByLabelText("New task instructions"), { target: { value: "A lamp" } });
    });
    await act(async () => {
      fireEvent.click(shell.view.getByTitle("Send message"));
    });
    expect(shell.sent[0].imageGeneration).toMatchObject({
      style: "cinematic",
      camera: { body: "Arri Alexa 35", lens: "Zeiss Ultra Prime", focal: "35mm", aperture: "f/2.8" },
    });
  });

  it("quotes the selection as text for the picture", async () => {
    const shell = await imageCreator();
    const input = shell.view.getByLabelText("New task instructions") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "A poster saying Hello" } });
    });
    input.setSelectionRange(16, 21);
    await act(async () => {
      fireEvent.click(shell.view.getByRole("button", { name: "Add text to image" }));
    });
    expect(input.value).toBe('A poster saying "Hello"');
  });
});

describe("the image composer in the task column", () => {
  it("fits one line: add-reference first, no mode label, model in the header", async () => {
    const shell = await imageCreator();
    await act(async () => {
      fireEvent.change(shell.view.getByLabelText("New task instructions"), { target: { value: "A lamp" } });
    });
    await act(async () => {
      fireEvent.click(shell.view.getByTitle("Send message"));
    });

    // Sending opens the request's own conversation beside the run's stage.
    const composer = await waitFor(() => {
      const found = document.querySelector<HTMLElement>("#dx-conversation .shell-cx--task.is-image");
      expect(found).toBeTruthy();
      return found!;
    });
    const strip = within(composer).getByRole("group", { name: "Image options" });
    expect(strip.classList.contains("is-compact")).toBe(true);
    expect(strip.firstElementChild?.getAttribute("aria-label")).toBe("Add reference image");
    expect(within(strip).queryByRole("button", { name: "Choose image model" })).toBeNull();
    expect(strip.querySelector(".shell-ig-mode")).toBeNull();

    const head = composer.querySelector<HTMLElement>(".shell-ig-head")!;
    expect(within(head).getByRole("button", { name: "Choose image model" }).textContent).toContain("Auto");
    // No tile column beside the prompt, and no empty reference row above it.
    expect(composer.querySelector(".shell-ig-prompt-row")).toBeNull();
    expect(composer.querySelector(".shell-ig-reference-strip")).toBeNull();
  });
});
