import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { toast } from "../../../renderer/ui";
import type { SendInput } from "../../../shared/uiPort";
import { resetComposerDrafts } from "../../composer/Composer";
import { renderShell } from "../../test/renderShell";

afterEach(() => {
  cleanup();
  toast.destroy();
  resetComposerDrafts();
});

async function agentHome() {
  const shell = await renderShell({ fastAgent: true });
  await shell.dispatch({ type: "go-home" });
  const sent: SendInput[] = [];
  const send = shell.port.agent.send.bind(shell.port.agent);
  shell.port.agent.send = async (input) => {
    sent.push(input);
    return send(input);
  };
  return { ...shell, sent };
}

async function enterImageMode(shell: Awaited<ReturnType<typeof agentHome>>) {
  await act(async () => {
    fireEvent.click(shell.view.getByRole("button", { name: "Create an image" }));
  });
}

describe("Home's image mode", () => {
  it("is a toggle that retitles Home and keeps what was typed", async () => {
    const shell = await agentHome();
    const input = shell.view.getByLabelText("New task instructions");
    await act(async () => {
      fireEvent.change(input, { target: { value: "A lamp" } });
    });

    await enterImageMode(shell);
    expect(shell.view.getByRole("heading", { level: 1 }).textContent).toBe("What would you like to create?");
    expect(shell.view.getByRole("button", { name: "Create an image" }).getAttribute("aria-pressed")).toBe("true");
    expect(shell.view.getByRole("group", { name: "Image prompt ideas" })).toBeTruthy();
    expect((input as HTMLTextAreaElement).value).toBe("A lamp");

    await enterImageMode(shell);
    expect(shell.view.getByRole("heading", { level: 1 }).textContent).toBe("What would you like to get done?");
    expect(shell.view.queryByRole("group", { name: "Image prompt ideas" })).toBeNull();
  });

  it("swaps the text controls for the image strip", async () => {
    const shell = await agentHome();
    await enterImageMode(shell);
    const strip = shell.view.getByRole("group", { name: "Image options" });
    for (const name of ["Choose image model", "Image settings", "Add text to image", "Mention files or folders", "Camera settings", "Image style"]) {
      expect(within(strip).getByRole("button", { name })).toBeTruthy();
    }
    expect(shell.view.queryByRole("button", { name: "Dictate" })).toBeNull();
    expect(shell.view.queryByRole("button", { name: "Add files or folders" })).toBeNull();
    expect(shell.view.getByRole("button", { name: "Add reference image" })).toBeTruthy();
  });

  it("fills a purpose without sending it", async () => {
    const shell = await agentHome();
    await enterImageMode(shell);
    await act(async () => {
      fireEvent.click(shell.view.getByRole("button", { name: /Product photo/ }));
    });
    expect((shell.view.getByLabelText("New task instructions") as HTMLTextAreaElement).value).toMatch(/product photo/i);
    expect(shell.sent).toHaveLength(0);
  });
});

describe("the image settings", () => {
  it("send what the panel shows", async () => {
    const shell = await agentHome();
    await enterImageMode(shell);
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
    const shell = await agentHome();
    await enterImageMode(shell);
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
    const shell = await agentHome();
    await enterImageMode(shell);
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
    const shell = await agentHome();
    await enterImageMode(shell);
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
    const shell = await agentHome();
    await enterImageMode(shell);
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

describe("New task in agent mode", () => {
  it("asks what kind, then primes Home for it", async () => {
    const shell = await renderShell({ fastAgent: true });
    await act(async () => {
      fireEvent.click(shell.view.getByRole("button", { name: "New task" }));
    });
    const menu = shell.view.getByRole("menu", { name: "New task type" });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.getAttribute("aria-label"))).toEqual([
      "Document",
      "Spreadsheet",
      "Presentation",
      "Image",
    ]);

    await act(async () => {
      fireEvent.click(within(menu).getByRole("menuitem", { name: "Image" }));
    });
    await waitFor(() =>
      expect(shell.view.getByRole("heading", { level: 1 }).textContent).toBe("What would you like to create?"),
    );
    expect((shell.view.getByLabelText("New task instructions") as HTMLTextAreaElement).value).not.toBe("");
  });

  it("moves by row with the arrow keys", async () => {
    const shell = await renderShell({ fastAgent: true });
    await act(async () => {
      fireEvent.click(shell.view.getByRole("button", { name: "New task" }));
    });
    const menu = shell.view.getByRole("menu", { name: "New task type" });
    await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("Document"));
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Presentation");
    fireEvent.keyDown(menu, { key: "ArrowRight" });
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Image");
  });
});
