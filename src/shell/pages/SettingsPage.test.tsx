/**
 * Settings — OD-UI-1.2 §12, WORKSPACE-STANDARD §04.
 *
 * A page in the content region rather than a cover over the window, with eight
 * sections in a fixed order. A preference takes effect when it is changed;
 * there is no Save, so "it wrote through" is the whole contract for a control
 * that has a backend.
 *
 * The other half is the rule the shell states about controls with nothing behind
 * them: they keep their place and say so when pressed. A switch that reported
 * itself on after such a press would be claiming a preference nobody stored, so
 * these check the answer *and* that the switch stayed where it was.
 */
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { toast } from "../../renderer/ui";
import { resetLayers } from "../kit/layers";
import { renderShell } from "../test/renderShell";
import { AVATAR_IDS, SETTINGS_SECTIONS, type SettingsSectionId } from "../state/shellReducer";

afterEach(() => {
  toast.destroy();
  resetLayers();
  cleanup();
});

/** The shell on Settings, with one section showing. */
async function settings(section?: SettingsSectionId) {
  const harness = await renderShell();
  await harness.dispatch({ type: "go", page: "settings", ...(section ? { section } : {}) });
  const find = <T extends HTMLElement>(selector: string) => harness.view.container.querySelector<T>(selector);
  const all = (selector: string) => [...harness.view.container.querySelectorAll<HTMLElement>(selector)];
  // The sections read their own settings before they draw their rows.
  await waitFor(() => {
    if (!find(".dx-settings-content h2")) throw new Error("the section body is still loading");
  });
  return { ...harness, find, all };
}

const announced = () => document.body.textContent ?? "";

const untilAnnounced = (needle: string) =>
  waitFor(() => {
    if (!announced().includes(needle)) throw new Error(`waiting for “${needle}”`);
  });

describe("the sections", () => {
  it("are the eight the design files, in order", async () => {
    const view = await settings();
    const nav = view.all(".dx-settings-nav button");

    expect(nav.map((button) => button.dataset.id)).toEqual([...SETTINGS_SECTIONS]);
    expect(nav.map((button) => button.textContent)).toEqual([
      "General",
      "Files & storage",
      "Models",
      "Connections & permissions",
      "Notifications",
      "Account & usage",
      "Commercial license",
      "About & support",
    ]);
  });

  it("opens on General, and says which one is showing", async () => {
    const view = await settings();
    expect(view.find(".dx-settings-content h2")?.textContent).toBe("General");
    expect(view.find(".dx-settings-nav [data-id=general]")?.getAttribute("aria-current")).toBe("page");
  });

  it("shows the section that was chosen", async () => {
    const view = await settings();
    fireEvent.click(view.find(".dx-settings-nav [data-id=notifications]")!);

    expect(view.find(".dx-settings-content h2")?.textContent).toBe("Notifications");
    expect(view.find(".dx-settings-nav [data-id=notifications]")?.getAttribute("aria-current")).toBe("page");
    expect(view.find(".dx-settings-nav [data-id=general]")?.getAttribute("aria-current")).toBeNull();
    expect(view.state().settingsSection).toBe("notifications");
  });

  // The sidebar's account row is a shortcut to the section that is about the
  // account, not a second sign-in flow.
  it("is reachable at Account & usage from the sidebar's account row", async () => {
    const harness = await renderShell();
    fireEvent.click(harness.view.container.querySelector<HTMLElement>("#dx-sidebar [data-act=account]")!);

    expect(harness.state().page).toBe("settings");
    expect(harness.state().settingsSection).toBe("account");
    await waitFor(() => {
      const heading = harness.view.container.querySelector(".dx-settings-content h2");
      if (heading?.textContent !== "Account & usage") throw new Error(`saw ${heading?.textContent}`);
    });
  });
});

describe("a preference that has a backend", () => {
  it("writes Enter to send through the port", async () => {
    const view = await settings("general");
    const toggle = view.find<HTMLButtonElement>("[data-act=preference-toggle][data-id=enterSends]")!;
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(toggle);

    await waitFor(async () => {
      if ((await view.port.settings.get()).enterToSend !== false) throw new Error("the port still says true");
    });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("writes Reduce motion through the port, and the shell follows it", async () => {
    const view = await settings("general");
    const toggle = view.find<HTMLButtonElement>("[data-act=preference-toggle][data-id=reduced]")!;
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(toggle);

    await waitFor(async () => {
      if ((await view.port.settings.get()).reduceMotion !== true) throw new Error("the port still says false");
    });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    // Reduced motion is a property of the whole workspace, not of this row.
    expect(view.find("#shell")?.className).toContain("dx-reduced");
  });

  // Appearance is this window's own state, so it changes the shell rather than
  // going to the port.
  it("changes the shell's theme from the appearance select", async () => {
    const view = await settings("general");
    expect(view.find("#shell")?.dataset.theme).toBe("light");

    fireEvent.change(view.find("[data-pref=theme]")!, { target: { value: "dark" } });

    expect(view.state().theme).toBe("dark");
    expect(view.find("#shell")?.dataset.theme).toBe("dark");

    fireEvent.change(view.find("[data-pref=theme]")!, { target: { value: "light" } });
    expect(view.find("#shell")?.dataset.theme).toBe("light");
  });
});

describe("a control with nothing behind it", () => {
  /*
   * Every row the approved design draws that this version cannot do. Each keeps
   * its place and answers when pressed; hiding them would mean editing the
   * layout twice and losing the record of what was designed.
   */
  const switches: Array<[SettingsSectionId, string, string]> = [
    ["general", "quickEntry", "Quick entry from the menu bar is not available in this version."],
    ["notifications", "sound", "Notification sounds are not available in this version."],
    ["notifications", "quietActive", "Quiet while active is not available in this version."],
  ];

  for (const [section, id, message] of switches) {
    it(`answers when ${id} is pressed, and stays off`, async () => {
      const view = await settings(section);
      const toggle = view.find<HTMLButtonElement>(`[data-act=preference-toggle][data-id=${id}]`)!;
      expect(toggle.getAttribute("aria-checked")).toBe("false");

      fireEvent.click(toggle);

      await untilAnnounced(message);
      expect(document.querySelector("#dx-notice")?.textContent).toBe(message);
      // Nothing was stored, so nothing may claim to be on.
      expect(toggle.getAttribute("aria-checked")).toBe("false");
    });
  }

  const buttons: Array<[SettingsSectionId, string, string]> = [
    ["files", "storage-folder", "Choosing another workspace location is not available in this version."],
    ["files", "defaults", "Setting OfficeDex as the default app for a file type is not available in this version."],
    ["files", "recovery", "The recovery center is not available in this version."],
    ["files", "trash", "Trash is not available in this version. Removing a file asks first."],
    ["license", "license-form", "Requesting a commercial license from the app is not available in this version."],
  ];

  for (const [section, act, message] of buttons) {
    it(`answers when ${act} is pressed`, async () => {
      const view = await settings(section);
      fireEvent.click(view.find(`[data-act=${act}]`)!);

      await untilAnnounced(message);
      expect(document.querySelector("#dx-notice")?.textContent).toBe(message);
      // A notice, not a dialog: nothing was started that has to be closed.
      expect(document.querySelector("dialog#dx-modal")).toBeNull();
    });
  }

  // The workspace has one notice, so leaning on a switch leaves one rather than three.
  it("does not stack one notice per press", async () => {
    const view = await settings("notifications");
    const toggle = view.find<HTMLButtonElement>("[data-act=preference-toggle][data-id=sound]")!;

    fireEvent.click(toggle);
    fireEvent.click(toggle);
    fireEvent.click(toggle);

    await untilAnnounced("Notification sounds are not available in this version.");
    expect(document.body.querySelectorAll("#dx-notice.dx-visible")).toHaveLength(1);
    expect(document.body.querySelectorAll(".od-toast-slot")).toHaveLength(0);
  });
});

describe("the avatar picker", () => {
  const openPicker = async () => {
    const view = await settings("account");
    fireEvent.click(view.find("[data-act=avatar-picker]")!);
    const dialog = document.querySelector<HTMLElement>("dialog#dx-modal")!;
    return { view, dialog, group: dialog.querySelector<HTMLElement>("[role=radiogroup]")! };
  };

  it("offers the six static avatars as one radio group", async () => {
    const { dialog, group } = await openPicker();

    expect(dialog.querySelector("#dx-modal-title")?.textContent).toBe("Choose your avatar");
    expect(group.getAttribute("aria-label")).toBe("Dex avatars");
    const choices = [...group.querySelectorAll<HTMLElement>("[data-act=avatar-select]")];
    expect(choices.map((choice) => choice.dataset.id)).toEqual([...AVATAR_IDS]);
    expect(choices.every((choice) => choice.getAttribute("role") === "radio")).toBe(true);
    // The one in use is the one checked, and the only tab stop.
    expect(choices[0].getAttribute("aria-checked")).toBe("true");
    expect(choices.filter((choice) => choice.tabIndex === 0)).toHaveLength(1);
  });

  it("moves the selection with the arrow keys, and with Home and End", async () => {
    const { group } = await openPicker();
    const checked = () =>
      group.querySelector<HTMLElement>("[aria-checked=true]")?.dataset.id ?? "";

    expect(checked()).toBe("ready");
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(checked()).toBe("hover");
    fireEvent.keyDown(group, { key: "ArrowDown" });
    expect(checked()).toBe("done");
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(checked()).toBe("hover");
    fireEvent.keyDown(group, { key: "End" });
    expect(checked()).toBe("celebrate");
    fireEvent.keyDown(group, { key: "Home" });
    expect(checked()).toBe("ready");
    // And it wraps, rather than stopping at the end of the grid.
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(checked()).toBe("celebrate");
  });

  // Choosing only changes the temporary selection; Save is what commits it.
  it("keeps the change until Save", async () => {
    const { view, dialog, group } = await openPicker();
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(view.state().avatar).toBe("ready");

    fireEvent.click(dialog.querySelector<HTMLElement>("[data-act=avatar-save]")!);

    expect(view.state().avatar).toBe("hover");
    expect(document.querySelector("dialog#dx-modal")).toBeNull();
    expect(document.querySelector("#dx-notice")?.textContent).toBe("Avatar updated");
  });

  it("discards the change on Cancel", async () => {
    const { view, dialog, group } = await openPicker();
    fireEvent.click(group.querySelector<HTMLElement>("[data-act=avatar-select][data-id=think]")!);
    fireEvent.click(dialog.querySelector<HTMLElement>(".dx-form-actions [data-act=modal-close]")!);

    expect(document.querySelector("dialog#dx-modal")).toBeNull();
    expect(view.state().avatar).toBe("ready");
  });

  it("opens again on the avatar that is in use", async () => {
    const { view, dialog, group } = await openPicker();
    fireEvent.click(group.querySelector<HTMLElement>("[data-act=avatar-select][data-id=write]")!);
    fireEvent.click(dialog.querySelector<HTMLElement>("[data-act=avatar-save]")!);
    expect(view.state().avatar).toBe("write");

    fireEvent.click(view.find("[data-act=avatar-picker]")!);
    const reopened = document.querySelector<HTMLElement>("dialog#dx-modal [role=radiogroup]")!;
    expect(reopened.querySelector<HTMLElement>("[aria-checked=true]")?.dataset.id).toBe("write");
  });
});
