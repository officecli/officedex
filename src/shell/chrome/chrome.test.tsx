import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SEED_OPEN_FILE_IDS } from "../port/fake/seed";
import { renderShell } from "../test/renderShell";

// `globals: false` in vite.config means Testing Library never registers its own
// afterEach, so every suite in this repo unmounts explicitly.
afterEach(cleanup);

const tabNames = (container: HTMLElement) =>
  [...container.querySelectorAll(".shell-tab-name")].map((node) => node.textContent);

async function openSeedTabs() {
  const shell = await renderShell();
  for (const fileId of SEED_OPEN_FILE_IDS) {
    await shell.dispatch({ type: "open-file", fileId });
  }
  return shell;
}

describe("file tabs", () => {
  it("survive a mode change and a Home round trip", async () => {
    const shell = await openSeedTabs();
    const expected = ["MO launch plan", "MO sales forecast", "MO launch deck"];
    expect(tabNames(shell.view.container)).toEqual(expected);

    await shell.dispatch({ type: "set-mode", mode: "editor" });
    expect(tabNames(shell.view.container)).toEqual(expected);

    await shell.dispatch({ type: "go-home" });
    expect(tabNames(shell.view.container)).toEqual(expected);

    await shell.dispatch({ type: "set-mode", mode: "agent" });
    expect(tabNames(shell.view.container)).toEqual(expected);
  });

  it("marks only the active tab selected, and drops selection on Home", async () => {
    const shell = await openSeedTabs();
    // Scoped to the file tablist: the ribbon is a second, unrelated tablist.
    const strip = () => within(shell.view.getByRole("tablist", { name: "Open files" }));
    const selected = () => strip().getAllByRole("tab").filter((tab) => tab.getAttribute("aria-selected") === "true");

    expect(selected()).toHaveLength(1);
    await shell.dispatch({ type: "go-home" });
    expect(selected()).toHaveLength(0);
  });

  it("shows the unsaved marker for a dirty file and clears it on save", async () => {
    const shell = await openSeedTabs();
    // file-forecast is seeded dirty.
    expect(shell.view.container.querySelectorAll(".shell-tab-dirty")).toHaveLength(1);

    await shell.dispatch({ type: "activate-file", fileId: "file-forecast" });
    await act(async () => {
      fireEvent.click(shell.view.getByTitle("Save on this computer"));
    });

    expect(shell.view.container.querySelectorAll(".shell-tab-dirty")).toHaveLength(0);
  });

  it("closes a tab from its close button", async () => {
    const shell = await openSeedTabs();
    await act(async () => {
      fireEvent.click(shell.view.getByLabelText("Close MO sales forecast.xlsx"));
    });
    expect(tabNames(shell.view.container)).toEqual(["MO launch plan", "MO launch deck"]);
  });
});

describe("sidebar", () => {
  it("keeps its frame in both modes and swaps only the middle", async () => {
    const shell = await openSeedTabs();
    const sidebar = () => shell.view.container.querySelector<HTMLElement>("#shell-sidebar")!;

    // Frame: brand, Home and the profile footer are in both modes.
    for (const mode of ["agent", "editor"] as const) {
      await shell.dispatch({ type: "set-mode", mode });
      const region = within(sidebar());
      expect(region.getByRole("button", { name: /Switch mode/ })).toBeInTheDocument();
      expect(region.getByTitle("Home")).toBeInTheDocument();
      expect(region.getByTitle("Flora · Personal workspace")).toBeInTheDocument();
    }

    // Middle: Agent offers New task; Editor offers the file library views.
    await shell.dispatch({ type: "set-mode", mode: "agent" });
    expect(within(sidebar()).getByTitle("New task")).toBeInTheDocument();
    expect(within(sidebar()).queryByTitle("Pinned")).toBeNull();

    await shell.dispatch({ type: "set-mode", mode: "editor" });
    expect(within(sidebar()).queryByTitle("New task")).toBeNull();
    expect(within(sidebar()).getByTitle("Pinned")).toBeInTheDocument();
    expect(within(sidebar()).getByTitle("Recent")).toBeInTheDocument();
  });

  it("hides labels but keeps accessible names when collapsed", async () => {
    const shell = await openSeedTabs();
    const home = () => shell.view.container.querySelector<HTMLElement>("#shell-sidebar .shell-sidebar-item")!;

    expect(home().textContent).toContain("Home");
    await shell.dispatch({ type: "toggle-nav" });
    expect(home().textContent).toBe("");
    expect(home()).toHaveAttribute("aria-label", "Home");
  });
});

describe("mode menu", () => {
  it("opens on ArrowDown, marks the current mode, and switches on select", async () => {
    const shell = await openSeedTabs();
    const trigger = shell.view.getByRole("button", { name: /Switch mode/ });

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await act(async () => {
      fireEvent.keyDown(trigger, { key: "ArrowDown" });
    });
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    const options = shell.view.getAllByRole("menuitemradio");
    expect(options.map((option) => option.getAttribute("aria-checked"))).toEqual(["true", "false"]);

    await act(async () => {
      fireEvent.click(options[1]);
    });
    expect(shell.state().mode).toBe("editor");
    // Closing returns focus to the trigger rather than dropping it on <body>.
    expect(document.activeElement).toBe(trigger);
  });

  it("moves focus with the arrow keys and closes on Escape", async () => {
    const shell = await openSeedTabs();
    const trigger = shell.view.getByRole("button", { name: /Switch mode/ });

    await act(async () => {
      fireEvent.click(trigger);
    });
    const [agent, editor] = shell.view.getAllByRole("menuitemradio");
    expect(document.activeElement).toBe(agent);

    await act(async () => {
      fireEvent.keyDown(shell.view.getByRole("menu"), { key: "ArrowDown" });
    });
    expect(document.activeElement).toBe(editor);

    // Wrapping keeps a two-item menu usable from either end.
    await act(async () => {
      fireEvent.keyDown(shell.view.getByRole("menu"), { key: "ArrowDown" });
    });
    expect(document.activeElement).toBe(agent);

    await act(async () => {
      fireEvent.keyDown(shell.view.getByRole("menu"), { key: "Escape" });
    });
    expect(shell.view.queryByRole("menu")).toBeNull();
    expect(shell.state().mode).toBe("agent");
    expect(document.activeElement).toBe(trigger);
  });
});

describe("status bar", () => {
  it("reports per-format facts and the save state", async () => {
    const shell = await openSeedTabs();
    // Scoped to the bar: the task panel's artifact card reports save state too.
    const bar = () =>
      within(shell.view.container.querySelector<HTMLElement>(".shell-statusbar")!);

    await shell.dispatch({ type: "activate-file", fileId: "file-plan" });
    expect(bar().getByText("739 words")).toBeInTheDocument();
    expect(bar().getByText("All changes saved")).toBeInTheDocument();

    await shell.dispatch({ type: "activate-file", fileId: "file-forecast" });
    expect(bar().getByText("Sheet 1 of 1")).toBeInTheDocument();
    expect(bar().getByText("Unsaved changes")).toBeInTheDocument();

    await shell.dispatch({ type: "activate-file", fileId: "file-deck" });
    expect(bar().getByText("Slide 3 of 6")).toBeInTheDocument();
  });
});
