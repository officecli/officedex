import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { resetComposerDrafts } from "../composer/Composer";
import { SEED_FOLDER_ID } from "../port/fake/seed";
import { renderShell } from "../test/renderShell";

afterEach(() => {
  cleanup();
  resetComposerDrafts();
});

const imageMessage = (text: string, extra: Record<string, unknown> = {}) => ({
  text,
  folderId: SEED_FOLDER_ID,
  mentions: [],
  attachments: [],
  activeFileId: null,
  modelId: "",
  permission: "full" as const,
  documentType: "img" as const,
  imageGeneration: { modelId: "auto", ratio: "1:1" as const, resolution: "1K" as const, count: 2, style: "auto" as const, prompt: text, ...extra },
});

/**
 * A finished run opens its picture, which leaves Home — so Home is visited
 * after both pictures have landed, the way a user comes back to it.
 */
async function sendAndReturnHome(shell: Awaited<ReturnType<typeof renderShell>>) {
  await act(async () => {
    await shell.port.agent.send(imageMessage("Desk lamp"));
  });
  await waitFor(async () => {
    const images = (await shell.port.files.list()).filter((file) => file.type === "image");
    expect(images).toHaveLength(2);
  });
  await waitFor(() => expect(shell.state().home).toBe(false));
  await shell.dispatch({ type: "go-home" });
}

const imageRows = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>(".shell-task-row--image")];

describe("Continue working, for a picture", () => {
  it("is one row named after the picture, counting its versions", async () => {
    const shell = await renderShell({ fastAgent: true });
    await sendAndReturnHome(shell);

    await waitFor(() => {
      const [row] = imageRows(shell.view.container);
      expect(row?.textContent).toContain("Image · 2 versions");
    });
    const rows = imageRows(shell.view.container);
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("Desk lamp");
    expect(rows[0].textContent).toContain("Ready");
  });

  it("opens the latest version", async () => {
    const shell = await renderShell({ fastAgent: true });
    await sendAndReturnHome(shell);
    await waitFor(() => expect(imageRows(shell.view.container)[0]?.textContent).toContain("2 versions"));

    await act(async () => {
      fireEvent.click(imageRows(shell.view.container)[0]);
    });
    const files = await shell.port.files.list();
    const latest = files.filter((file) => file.type === "image").at(-1)!;
    await waitFor(() => expect(shell.state().activeFileId).toBe(latest.id));
    expect(shell.state().home).toBe(false);
  });
});
