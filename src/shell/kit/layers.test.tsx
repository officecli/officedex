/**
 * The workspace's temporary layers — OD-UI-1.2 §05, §08, §17.
 *
 * Three slots, one of each: a menu, a dialog and a notice. Opening a second
 * replaces the first rather than stacking on it, which is the rule §08 states
 * for dialogs and the prototype applies to all three. The trigger says whether
 * its popup is open, and stops saying it the moment it closes.
 */
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  Layers,
  closeMenu,
  closeModal,
  menuIsOpen,
  modalIsOpen,
  notice,
  openMenu,
  openModal,
  resetLayers,
  retitleModal,
  type MenuItem,
} from "./layers";

afterEach(() => {
  resetLayers();
  cleanup();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

/** The host, plus a couple of triggers that are real buttons in the document. */
function mount(): { trigger: HTMLButtonElement; other: HTMLButtonElement } {
  render(<Layers />);
  const trigger = document.createElement("button");
  trigger.textContent = "more";
  const other = document.createElement("button");
  other.textContent = "options";
  document.body.append(trigger, other);
  return { trigger, other };
}

const panel = () => document.querySelector<HTMLElement>("#dx-layers .dx-menu");
const items = () => [...document.querySelectorAll<HTMLButtonElement>("#dx-layers .dx-menu button")];
const dialog = () => document.querySelector<HTMLDialogElement>("dialog#dx-modal");
const noticeText = () => document.querySelector("#dx-notice")?.textContent ?? "";

const open = (trigger: HTMLElement, entries: MenuItem[], options?: Parameters<typeof openMenu>[2]) =>
  act(() => openMenu(trigger, entries, options));

describe("openMenu", () => {
  it("draws the items it was given and marks its trigger open", () => {
    const { trigger } = mount();
    open(trigger, [{ label: "Rename", onSelect: () => {} }, "-", { label: "Delete", onSelect: () => {} }]);

    expect(items().map((item) => item.textContent)).toEqual(["Rename", "Delete"]);
    expect(document.querySelectorAll("#dx-layers .dx-menu hr")).toHaveLength(1);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.dataset.popupOpen).toBe("true");
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
  });

  it("keeps one menu on screen, and hands the open state to the new trigger", () => {
    const { trigger, other } = mount();
    open(trigger, [{ label: "Rename", onSelect: () => {} }]);
    open(other, [{ label: "Archive", onSelect: () => {} }]);

    expect(document.querySelectorAll("#dx-layers .dx-menu")).toHaveLength(1);
    expect(items().map((item) => item.textContent)).toEqual(["Archive"]);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.dataset.popupOpen).toBe("false");
    expect(other.getAttribute("aria-expanded")).toBe("true");
  });

  it("gives the first enabled row focus when it takes focus at all", () => {
    const { trigger } = mount();
    open(trigger, [
      { label: "Preview", onSelect: () => {}, disabled: true },
      { label: "Rename", onSelect: () => {} },
    ]);
    expect(document.activeElement?.textContent).toBe("Rename");
  });

  // The @-mention list is anchored over a composer and typing continues there,
  // so that one does not take focus.
  it("leaves focus alone for a list that is not taking it", () => {
    const { trigger } = mount();
    trigger.focus();
    open(trigger, [{ label: "Project brief.docx", onSelect: () => {} }], { takeFocus: false, role: "listbox" });

    expect(document.activeElement).toBe(trigger);
    expect(panel()?.getAttribute("role")).toBe("listbox");
    expect(items()[0].getAttribute("role")).toBe("option");
  });

  it("runs the row that was chosen and closes on the way", () => {
    const { trigger } = mount();
    const chosen: string[] = [];
    open(trigger, [{ label: "Rename", onSelect: () => chosen.push("Rename") }]);

    act(() => {
      items()[0].click();
    });
    expect(chosen).toEqual(["Rename"]);
    expect(panel()).toBeNull();
    expect(menuIsOpen()).toBe(false);
  });

  it("shows the empty text when a list has nothing in it", () => {
    const { trigger } = mount();
    open(trigger, [], { emptyText: "No files match" });
    expect(panel()?.textContent).toBe("No files match");
  });

  /*
   * A row that carries `checked` is a choice, not a command: it reports as a
   * radio item so a screen reader says "selected" rather than leaving the state
   * to the check glyph.
   */
  it("makes a choice a radio item and a command a plain one", () => {
    const { trigger } = mount();
    open(trigger, [
      { label: "Light", onSelect: () => {}, checked: true },
      { label: "Dark", onSelect: () => {}, checked: false },
      { label: "Rename", onSelect: () => {} },
    ]);

    const [light, dark, rename] = items();
    expect(light.getAttribute("role")).toBe("menuitemradio");
    expect(light.getAttribute("aria-checked")).toBe("true");
    expect(dark.getAttribute("role")).toBe("menuitemradio");
    expect(dark.getAttribute("aria-checked")).toBe("false");
    expect(rename.getAttribute("role")).toBe("menuitem");
    expect(rename.hasAttribute("aria-checked")).toBe(false);
  });
});

describe("a menu from the keyboard", () => {
  const openThree = () => {
    const { trigger } = mount();
    open(trigger, [
      { label: "One", onSelect: () => {} },
      { label: "Two", onSelect: () => {} },
      { label: "Three", onSelect: () => {} },
    ]);
    return trigger;
  };

  const press = (key: string) => fireEvent.keyDown(document.activeElement!, { key });

  it("moves down and up, wrapping at both ends", () => {
    openThree();
    expect(document.activeElement?.textContent).toBe("One");
    press("ArrowDown");
    expect(document.activeElement?.textContent).toBe("Two");
    press("ArrowUp");
    expect(document.activeElement?.textContent).toBe("One");
    press("ArrowUp");
    expect(document.activeElement?.textContent).toBe("Three");
    press("ArrowDown");
    expect(document.activeElement?.textContent).toBe("One");
  });

  it("jumps to the ends with Home and End", () => {
    openThree();
    press("End");
    expect(document.activeElement?.textContent).toBe("Three");
    press("Home");
    expect(document.activeElement?.textContent).toBe("One");
  });

  it("closes on Escape and gives the trigger its focus back", () => {
    const trigger = openThree();
    act(() => {
      press("Escape");
    });
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  // Tab is a request to leave, so the menu goes; where focus lands is the
  // browser's business, not the menu's.
  it("closes on Tab", () => {
    openThree();
    act(() => {
      press("Tab");
    });
    expect(panel()).toBeNull();
  });
});

describe("closeMenu", () => {
  it("clears the trigger's open state", () => {
    const { trigger } = mount();
    open(trigger, [{ label: "Rename", onSelect: () => {} }]);
    act(() => closeMenu());

    expect(panel()).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("is harmless with no menu open", () => {
    mount();
    expect(() => act(() => closeMenu(true))).not.toThrow();
  });

  it("closes on a press outside itself", () => {
    const { trigger, other } = mount();
    open(trigger, [{ label: "Rename", onSelect: () => {} }]);

    act(() => {
      fireEvent.pointerDown(other);
    });
    expect(panel()).toBeNull();
  });

  it("stays open for a press on itself or on its trigger", () => {
    const { trigger } = mount();
    open(trigger, [{ label: "Rename", onSelect: () => {} }]);

    act(() => {
      fireEvent.pointerDown(items()[0]);
    });
    expect(panel()).not.toBeNull();

    act(() => {
      fireEvent.pointerDown(trigger);
    });
    expect(panel()).not.toBeNull();
  });
});

describe("openModal", () => {
  it("shows one dialog with its title and body", () => {
    mount();
    act(() => openModal({ title: "New project", render: () => <p>name it</p> }));

    expect(dialog()).not.toBeNull();
    expect(dialog()?.open).toBe(true);
    expect(document.querySelector("#dx-modal-title")?.textContent).toBe("New project");
    expect(dialog()?.textContent).toContain("name it");
    expect(modalIsOpen()).toBe(true);
  });

  it("closes any open menu on the way up", () => {
    const { trigger } = mount();
    open(trigger, [{ label: "Rename", onSelect: () => {} }]);
    act(() => openModal({ title: "Rename", render: () => null }));

    expect(panel()).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("never stacks: a second dialog replaces the first", () => {
    mount();
    act(() => openModal({ title: "New project", render: () => null }));
    act(() => openModal({ title: "Choose your avatar", render: () => null }));

    expect(document.querySelectorAll("dialog#dx-modal")).toHaveLength(1);
    expect(document.querySelector("#dx-modal-title")?.textContent).toBe("Choose your avatar");
  });

  it("returns focus to whatever opened it", () => {
    const { trigger } = mount();
    trigger.focus();
    act(() => openModal({ title: "New project", render: () => null }));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");

    act(() => closeModal());
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  /*
   * Replacing the body is one dialog going through its stages — checking, then
   * found, then downloading — so focus still comes back to the button that
   * started it, not to whatever happened to be focused inside the first stage.
   */
  it("keeps the first opener when the dialog is replaced", () => {
    const { trigger, other } = mount();
    trigger.focus();
    act(() => openModal({ title: "Check for updates", render: () => null }));
    other.focus();
    act(() => openModal({ title: "Update available", render: () => null }));

    act(() => closeModal());
    expect(document.activeElement).toBe(trigger);
  });

  it("runs onClose once, when it closes", () => {
    mount();
    let closed = 0;
    act(() => openModal({ title: "Redeem a code", render: () => null, onClose: () => (closed += 1) }));
    act(() => closeModal());
    act(() => closeModal());
    expect(closed).toBe(1);
  });

  it("is harmless to close when nothing is open", () => {
    mount();
    expect(() => act(() => closeModal())).not.toThrow();
  });
});

describe("a dialog with a submit in flight", () => {
  const openBusy = () => {
    mount();
    act(() => openModal({ title: "Connecting…", busy: true, render: () => null }));
  };

  it("refuses the cancel gesture", () => {
    openBusy();
    act(() => {
      fireEvent(dialog()!, new Event("cancel", { cancelable: true }));
    });
    expect(dialog()).not.toBeNull();
    expect(dialog()?.dataset.busy).toBe("true");
  });

  it("disables its own close button", () => {
    openBusy();
    const close = dialog()!.querySelector<HTMLButtonElement>("[data-act=modal-close]")!;
    expect(close.disabled).toBe(true);
  });

  it("accepts the cancel gesture once it is no longer busy", () => {
    mount();
    act(() => openModal({ title: "New project", render: () => null }));
    act(() => {
      fireEvent(dialog()!, new Event("cancel", { cancelable: true }));
    });
    expect(dialog()).toBeNull();
  });
});

describe("retitleModal", () => {
  it("renames the open dialog without reopening it", () => {
    mount();
    act(() => openModal({ title: "Checking for updates", render: () => <p>body</p> }));
    act(() => retitleModal("Update available"));

    expect(document.querySelector("#dx-modal-title")?.textContent).toBe("Update available");
    expect(document.querySelectorAll("dialog#dx-modal")).toHaveLength(1);
    expect(dialog()?.textContent).toContain("body");
  });

  it("can put the dialog in and out of its busy state", () => {
    mount();
    act(() => openModal({ title: "Update available", render: () => null }));
    act(() => retitleModal("Downloading", true));
    expect(dialog()?.dataset.busy).toBe("true");

    act(() => retitleModal("Ready to install", false));
    expect(dialog()?.dataset.busy).toBe("false");
  });

  it("has nothing to rename when no dialog is open", () => {
    mount();
    act(() => retitleModal("Downloading", true));
    expect(dialog()).toBeNull();
  });
});

describe("notice", () => {
  it("says its line, politely, then takes it back", () => {
    vi.useFakeTimers();
    mount();
    const host = document.querySelector("#dx-notice")!;
    expect(host.getAttribute("role")).toBe("status");
    expect(host.getAttribute("aria-live")).toBe("polite");

    act(() => notice("Avatar updated"));
    expect(noticeText()).toBe("Avatar updated");
    expect(host.className).toContain("dx-visible");

    act(() => vi.advanceTimersByTime(3199));
    expect(noticeText()).toBe("Avatar updated");

    act(() => vi.advanceTimersByTime(1));
    expect(noticeText()).toBe("");
    expect(host.className).not.toContain("dx-visible");
  });

  it("replaces the line it was showing, and restarts its clock", () => {
    vi.useFakeTimers();
    mount();

    act(() => notice("Saved"));
    act(() => vi.advanceTimersByTime(3000));
    act(() => notice("Connected"));

    act(() => vi.advanceTimersByTime(3000));
    // The first line's clock must not take the second line away early.
    expect(noticeText()).toBe("Connected");

    act(() => vi.advanceTimersByTime(200));
    expect(noticeText()).toBe("");
  });
});

describe("resetLayers", () => {
  it("clears all three slots", () => {
    vi.useFakeTimers();
    const { trigger } = mount();
    open(trigger, [{ label: "Rename", onSelect: () => {} }]);
    act(() => openModal({ title: "New project", render: () => null }));
    act(() => notice("Saved"));

    act(() => resetLayers());

    expect(panel()).toBeNull();
    expect(dialog()).toBeNull();
    expect(noticeText()).toBe("");
    expect(menuIsOpen()).toBe(false);
    expect(modalIsOpen()).toBe(false);

    // And the notice's timer is gone with it, so nothing fires into a fresh test.
    act(() => vi.advanceTimersByTime(4000));
    expect(noticeText()).toBe("");
  });
});
