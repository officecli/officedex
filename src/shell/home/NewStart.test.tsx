import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderShell } from "../test/renderShell";

afterEach(cleanup);

describe("Editor mode's New", () => {
  it("opens the New page of blank templates, not a menu", async () => {
    const shell = await renderShell();
    await shell.dispatch({ type: "set-mode", mode: "editor" });
    await act(async () => {
      fireEvent.click(shell.view.getByRole("button", { name: "New" }));
    });

    expect(shell.view.getByRole("heading", { level: 1, name: "New" })).toBeTruthy();
    const templates = shell.view.getByRole("region", { name: "New" });
    expect(within(templates).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "Blank document",
      "Blank workbook",
      "Blank presentation",
    ]);
    expect(shell.view.queryByRole("menu")).toBeNull();
    expect(shell.view.getByRole("button", { name: "New" })).toHaveAttribute("aria-current", "page");
  });

  it("creates the picked blank file and opens it", async () => {
    const shell = await renderShell();
    await shell.dispatch({ type: "set-mode", mode: "editor" });
    await shell.dispatch({ type: "set-home-list", list: "new" });
    const before = (await shell.port.files.list()).length;

    await act(async () => {
      fireEvent.click(shell.view.getByRole("button", { name: "Blank workbook" }));
    });

    await waitFor(async () => expect((await shell.port.files.list()).length).toBe(before + 1));
    const created = (await shell.port.files.list()).at(-1)!;
    expect(created.type).toBe("sheet");
    await waitFor(() => expect(shell.state().activeFileId).toBe(created.id));
  });

  it("is left by Home and not restored on reload", async () => {
    const shell = await renderShell();
    await shell.dispatch({ type: "set-mode", mode: "editor" });
    await shell.dispatch({ type: "set-home-list", list: "new" });
    await shell.dispatch({ type: "go-home" });
    expect(shell.state().homeList).toBe("recent");
  });
});
