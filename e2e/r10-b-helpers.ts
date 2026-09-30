/**
 * What the r10 fix specs need from the fixture, in place of `ui-audit-helpers`.
 *
 * The audit helper waits for `data-home` before it hands the page back. That
 * attribute was the Agent/Editor split, and r10 has no such split — `#shell`
 * carries `data-page` now — so every call through the old helper times out
 * before the first assertion runs. The helper is shared with the survey specs,
 * so the replacement lives here rather than as an edit to it.
 *
 * There is no `capture` here on purpose. The screenshots it wrote were audit
 * evidence filed under `docs/ui-audit-2026-09-19/`; they were never assertions,
 * and a regression gate should not be writing into the repository to pass.
 */

import { expect, type Page } from "@playwright/test";

import { SHELL_COMBINATIONS } from "../src/shell/dev/fixture";

export const COMBINATIONS = [
  "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10",
] as const;

export type Combination = (typeof COMBINATIONS)[number];

/**
 * Puts the shell into `combination` and waits until it has actually loaded.
 *
 * Two waits, both load-bearing. `data-loaded` because the port resolves folders
 * and files asynchronously even in memory, and anything measured before that
 * lands is a measurement of an empty workspace. Then `data-page`, because the
 * named combination has to have survived the trip — the expected page is read
 * out of `SHELL_COMBINATIONS` itself rather than restated here, so the check
 * cannot drift away from the table the fixture is applying.
 */
export async function open(
  page: Page,
  combination: Combination,
  params: Record<string, string> = {},
): Promise<void> {
  const search = new URLSearchParams({ shellFixture: "1", shell: combination, ...params });
  await page.goto(`/?${search.toString()}`);
  await expect(page.locator("#shell")).toHaveAttribute("data-loaded", "true");
  const expected = params.page ?? SHELL_COMBINATIONS[combination].page;
  await expect(page.locator("#shell")).toHaveAttribute("data-page", expected);
}

/**
 * The focus ring around `selector`, wherever r10 chose to draw it.
 *
 * Several r10 rows put the ring on the row and clear it on the control inside
 * (`.dx-chat-tree:has(> button:focus-visible)`, `.dx-file-tab:has(.dx-tab-title
 * :focus-visible)`), which the design asks for in so many words: the frame goes
 * round the whole tab, not round the title button. So the verdict is "something
 * from the focused control up to its row draws an outline", and the answer says
 * which node it was — a check that only looked at the control itself would call
 * a correctly framed row a missing ring.
 *
 * The Tab press comes first because Chromium only matches `:focus-visible` on a
 * programmatically focused button when the last interaction was a key press.
 * The verdict is read off `outline-style`, never `outline-width`: with
 * `outline-style: none` the computed width still reports 3px, which is how a
 * control that draws nothing passes a width-based check.
 */
export async function focusRing(page: Page, selector: string) {
  await page.keyboard.press("Tab");
  return page.evaluate((target: string) => {
    const element = document.querySelector<HTMLElement>(target);
    if (!element) return null;
    element.focus();
    let ringOn: string | null = null;
    let outlineStyle = "none";
    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.outlineStyle !== "none") {
        ringOn = node.className || node.tagName.toLowerCase();
        outlineStyle = style.outlineStyle;
        break;
      }
      if (node.id === "dx-workspace") break;
    }
    return {
      focused: document.activeElement === element,
      focusVisible: element.matches(":focus-visible"),
      ringOn,
      outlineStyle,
    };
  }, selector);
}

/**
 * A DataTransfer plus the drag verbs, installed on the page.
 *
 * Synthetic rather than a real pointer drag: Playwright cannot drive the OS drag
 * loop, and the handlers under test read `dataTransfer` and `event.target`, both
 * of which a dispatched `DragEvent` reproduces faithfully.
 */
export const DRAG_HARNESS = `
  window.__r10drag = {
    dt: null,
    start(selector) {
      const source = document.querySelector(selector);
      if (!source) return { ok: false, why: "no source " + selector };
      this.dt = new DataTransfer();
      const event = new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: this.dt });
      source.dispatchEvent(event);
      return { ok: true, payload: this.dt.getData("text/plain") };
    },
    over(selector) {
      const target = document.querySelector(selector);
      if (!target) return { ok: false, why: "no target " + selector };
      const event = new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: this.dt });
      target.dispatchEvent(event);
      return { ok: true, defaultPrevented: event.defaultPrevented };
    },
    drop(selector) {
      const target = document.querySelector(selector);
      if (!target) return { ok: false, why: "no target " + selector };
      const event = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: this.dt });
      target.dispatchEvent(event);
      return { ok: true, defaultPrevented: event.defaultPrevented };
    },
  };
`;

declare global {
  interface Window {
    __r10drag: {
      start(selector: string): { ok: boolean; why?: string; payload?: string };
      over(selector: string): { ok: boolean; why?: string; defaultPrevented?: boolean };
      drop(selector: string): { ok: boolean; why?: string; defaultPrevented?: boolean };
    };
  }
}
