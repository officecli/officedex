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

  it("pins the active tab from its bookmark control", async () => {
    const shell = await openSeedTabs();
    const bookmark = shell.view.getByRole("button", { name: "Bookmark MO launch deck.pptx" });
    expect(bookmark).toHaveAttribute("aria-pressed", "false");
    await act(async () => {
      fireEvent.click(bookmark);
    });
    expect(shell.view.getByRole("button", { name: "Remove bookmark from MO launch deck.pptx" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("renames the active file through the file menu", async () => {
    const shell = await openSeedTabs();
    await act(async () => {
      fireEvent.click(shell.view.getByRole("button", { name: "More actions" }));
    });
    await act(async () => {
      fireEvent.click(shell.view.getByRole("menuitem", { name: "Rename file…" }));
    });
    const input = shell.view.getByLabelText("File name");
    await act(async () => {
      fireEvent.change(input, { target: { value: "Launch deck final" } });
      fireEvent.click(shell.view.getByRole("button", { name: "Save" }));
    });
    // Scoped to the tablist: the status bar carries the same name in a `title`
    // now (it is how a clipped 66-character name stays recoverable), so a
    // document-wide `getByTitle` has two hits and neither is the one meant here.
    expect(
      within(shell.view.getByRole("tablist", { name: "Open files" })).getByTitle(
        "Launch deck final.pptx",
      ),
    ).toBeInTheDocument();
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
      fireEvent.click(shell.view.getByLabelText("Close MO launch plan.docx"));
    });
    expect(tabNames(shell.view.container)).toEqual(["MO sales forecast", "MO launch deck"]);
  });

  // jsdom is not macOS, so the chord under test is the Ctrl+W branch. The
  // platform split itself is covered in closeTabShortcut.test.ts.
  const pressCloseChord = (shell: Awaited<ReturnType<typeof openSeedTabs>>) =>
    act(async () => {
      fireEvent.keyDown(shell.view.container, { key: "w", code: "KeyW", ctrlKey: true });
    });

  it("closes the tab on the canvas from the keyboard", async () => {
    const shell = await openSeedTabs();
    // The deck is active after opening the seed tabs.
    await pressCloseChord(shell);
    expect(tabNames(shell.view.container)).toEqual(["MO launch plan", "MO sales forecast"]);
  });

  it("routes the keyboard close through the unsaved question, not around it", async () => {
    const shell = await openSeedTabs();
    await shell.dispatch({ type: "activate-file", fileId: "file-forecast" });

    await pressCloseChord(shell);
    expect(shell.view.getByRole("dialog")).toHaveTextContent("Save before closing?");
    expect(tabNames(shell.view.container)).toHaveLength(3);
  });

  it("has nothing to close on Home, and leaves the open files alone", async () => {
    const shell = await openSeedTabs();
    await shell.dispatch({ type: "go-home" });
    await pressCloseChord(shell);
    expect(tabNames(shell.view.container)).toHaveLength(3);
  });

  it("asks before closing a dirty tab and saves before removing it", async () => {
    const shell = await openSeedTabs();
    await shell.dispatch({ type: "activate-file", fileId: "file-forecast" });

    await act(async () => {
      fireEvent.click(shell.view.getByLabelText("Close MO sales forecast.xlsx"));
    });
    expect(shell.view.getByRole("dialog")).toHaveTextContent("Save before closing?");
    expect(shell.view.getByRole("dialog")).toHaveTextContent("MO sales forecast.xlsx");

    await act(async () => {
      fireEvent.click(shell.view.getByRole("button", { name: "Save and close" }));
    });
    expect(tabNames(shell.view.container)).toEqual(["MO launch plan", "MO launch deck"]);
    expect(shell.view.queryByRole("dialog")).toBeNull();
  });

  it("activates an inactive dirty tab before allowing it to close", async () => {
    const shell = await openSeedTabs();
    // The deck is active after opening the seed tabs; the forecast is dirty.
    await act(async () => {
      fireEvent.click(shell.view.getByLabelText("Close MO sales forecast.xlsx"));
    });
    expect(shell.state().activeFileId).toBe("file-forecast");
    expect(shell.view.getByLabelText("Close MO sales forecast.xlsx")).toBeInTheDocument();
    expect(shell.view.queryByRole("dialog")).toBeNull();
  });
});

describe("sidebar", () => {
  it("keeps its frame in both modes and swaps only the middle", async () => {
    const shell = await openSeedTabs();
    const sidebar = () => shell.view.container.querySelector<HTMLElement>("#shell-sidebar")!;

    // Frame: brand, Home and the settings footer are in both modes. The footer
    // used to carry an account chip reading "Flora · Personal workspace" — one
    // name, shown to everyone, beside a workspace that does not exist.
    for (const mode of ["agent", "editor"] as const) {
      await shell.dispatch({ type: "set-mode", mode });
      const region = within(sidebar());
      expect(region.getByRole("button", { name: /Switch mode/ })).toBeInTheDocument();
      expect(region.getByTitle("Home")).toBeInTheDocument();
      expect(region.getByTitle("Settings")).toBeInTheDocument();
      expect(region.queryByText("Flora")).toBeNull();
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

    // The reference shell opens on its compact icon rail.
    expect(home().textContent).toBe("");
    expect(home()).toHaveAttribute("aria-label", "Home");
    await shell.dispatch({ type: "toggle-nav" });
    expect(home().textContent).toContain("Home");
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
  // It used to report per-format facts — "739 words", "Slide 3 of 6", "B6" —
  // and this suite asserted them. They were fixed strings, identical for every
  // file of a type, and a status bar is read as a report on *your* document. So
  // what is asserted now is the two things the shell genuinely knows.
  it("names the open file and its save state", async () => {
    const shell = await openSeedTabs();
    // Scoped to the bar: the task panel's artifact card reports save state too.
    const bar = () =>
      within(shell.view.container.querySelector<HTMLElement>(".shell-statusbar")!);

    await shell.dispatch({ type: "activate-file", fileId: "file-plan" });
    expect(bar().getByText("MO launch plan.docx")).toBeInTheDocument();
    expect(bar().getByText("All changes saved")).toBeInTheDocument();

    await shell.dispatch({ type: "activate-file", fileId: "file-forecast" });
    expect(bar().getByText("MO sales forecast.xlsx")).toBeInTheDocument();
    expect(bar().getByText("Unsaved changes")).toBeInTheDocument();
  });

  // Nothing invented in place of an answer it does not have.
  it("claims no page count, word count or zoom level", async () => {
    const shell = await openSeedTabs();
    await shell.dispatch({ type: "activate-file", fileId: "file-plan" });
    const bar = shell.view.container.querySelector<HTMLElement>(".shell-statusbar")!;

    expect(bar.textContent).not.toMatch(/\bwords?\b/i);
    expect(bar.textContent).not.toMatch(/Page \d|Slide \d|Sheet \d/);
    expect(bar.textContent).not.toMatch(/\d+%/);
  });
});
