/**
 * Shared helpers for the UI audit sessions (docs/ui-audit-2026-09-19/PLAN.md).
 *
 * Every session writes its own spec; they all go through these two functions so
 * the screenshots land in one predictable place, named after the shell
 * combination they show, and so "is it clipped" is answered the same way by
 * eight people.
 *
 * These drive the fixture server (`?shellFixture=1`), not the real bridge —
 * see PLAN 2.3 for what each environment can and cannot show. Nothing here
 * touches a real workspace.
 */

import { expect, type Page } from "@playwright/test";

/** The ten combinations from PLAN section 2. Keep in step with dev/fixture.ts. */
export const COMBINATIONS = [
  "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10",
] as const;

export type Combination = (typeof COMBINATIONS)[number];

export interface AuditOptions {
  /** Session directory under docs/ui-audit-2026-09-19/, e.g. "S2". */
  session: string;
  /** Extra query parameters, for axes the combination does not cover. */
  params?: Record<string, string>;
}

function url(combination: Combination, params: Record<string, string> = {}): string {
  const search = new URLSearchParams({ shellFixture: "1", shell: combination, ...params });
  return `/?${search.toString()}`;
}

/**
 * Puts the shell into `combination` and waits until it has actually loaded.
 *
 * The wait is on `data-loaded`, not on a timeout: the port resolves folders and
 * files asynchronously even when it is in-memory, and a screenshot taken before
 * that lands is a picture of an empty workspace that looks exactly like a real
 * empty-state bug. Several early audit screenshots were exactly this.
 */
export async function open(
  page: Page,
  combination: Combination,
  options: AuditOptions,
): Promise<void> {
  await page.goto(url(combination, options.params));
  await expect(page.locator("#shell")).toHaveAttribute("data-loaded", "true");
  await settle(page);
  // The named combination has to have survived the trip, or the screenshot is
  // filed under a state it does not show.
  await expect(page.locator("#shell")).toHaveAttribute(
    "data-home",
    /^(true|false)$/,
  );
}

/**
 * Waits for the floating presence to stop moving.
 *
 * `data-loaded` says the workspace arrived; it says nothing about layout. The
 * panel is placed with a transition (`--ease`, ~300ms), and anything measured
 * during it reads a position that is on its way somewhere else — probed at
 * +0ms the panel top is 302.56, at +100ms 354.63, and only from +300ms is it
 * 355.
 *
 * The audit itself got away with this because it mostly took screenshots, and a
 * frame of a moving panel still looks like a panel. The fix specs did not: two
 * of them took a "before" baseline mid-transition and then blamed the movement
 * on whatever they did next (see SUMMARY §3.2, MERGE-002). Same hazard, one
 * level deeper than the `data-loaded` note above.
 *
 * Polls for two identical readings rather than sleeping a fixed duration: the
 * transition's length is a design token, and a test that hard-codes 300ms goes
 * quietly wrong the day someone tunes it.
 */
export async function settle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const panel = document.querySelector(".shell-presence-panel, .shell-presence-face");
      if (!panel) return true;
      const now = JSON.stringify(panel.getBoundingClientRect());
      const previous = (window as unknown as { __settleLast?: string }).__settleLast;
      (window as unknown as { __settleLast?: string }).__settleLast = now;
      return previous === now;
    },
    undefined,
    { polling: 100 },
  );
}

/**
 * Screenshots the page into the session's directory, named for the combination.
 *
 * The combination goes in the filename because the whole audit turns on being
 * able to say which of the ten shells a defect appears in; a folder of
 * `menu-clipped-3.png` cannot answer that, and by the merge step nobody
 * remembers.
 */
export async function capture(
  page: Page,
  combination: Combination,
  name: string,
  options: AuditOptions,
): Promise<string> {
  const path = `docs/ui-audit-2026-09-19/${options.session}/screenshots/${combination}-${name}.png`;
  await page.screenshot({ path, fullPage: false });
  return path;
}

/**
 * Fails when `selector` is cut off by the viewport or by an ancestor's overflow.
 *
 * Returns the measurements either way, because a finding needs the number, not
 * just the verdict — "the menu is clipped" is an opinion; "left = -58" is a
 * fact somebody can check after the fix.
 */
export async function expectNoClip(page: Page, selector: string) {
  const measurement = await page.evaluate((target: string) => {
    const element = document.querySelector(target);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    // Walk the ancestors for the first one that actually clips, so the report
    // names the container at fault rather than just the victim.
    let clippedBy: string | null = null;
    for (let node = element.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.overflow === "visible" && style.overflowX === "visible" && style.overflowY === "visible") continue;
      const bounds = node.getBoundingClientRect();
      if (
        rect.left < bounds.left - 0.5 ||
        rect.top < bounds.top - 0.5 ||
        rect.right > bounds.right + 0.5 ||
        rect.bottom > bounds.bottom + 0.5
      ) {
        clippedBy = node.className || node.tagName.toLowerCase();
        break;
      }
    }
    return {
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      offViewport:
        rect.left < 0 || rect.top < 0 || rect.right > window.innerWidth || rect.bottom > window.innerHeight,
      clippedBy,
    };
  }, selector);

  expect(measurement, `${selector} is not in the DOM`).not.toBeNull();
  expect(measurement, `${selector} is clipped: ${JSON.stringify(measurement)}`).toMatchObject({
    offViewport: false,
    clippedBy: null,
  });
  return measurement;
}
