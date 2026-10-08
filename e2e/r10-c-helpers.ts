/**
 * Fixture helpers for the r10 shell, for the three `fix-w*` specs this agent owns.
 *
 * `ui-audit-helpers.ts` is a survey instrument written against the pre-r10 DOM:
 * its `open()` waits for `#shell[data-home]` and its `settle()` polls
 * `.shell-presence-panel`. Neither exists in OD-UI-1.2 — there is no Agent/Editor
 * mode for `data-home` to report and no floating presence to wait for — so the
 * shared helper fails before a single assertion runs. It is shared with the audit
 * specs, which still describe the old UI, so it is copied here rather than edited.
 *
 * What replaced each wait:
 *
 *   - `data-home` → `data-page`, which is the r10 state (`shellReducer.ts`), and
 *     is checked against the combination's own page so a screenshot or a
 *     measurement cannot be filed under a shell it does not show.
 *   - the presence panel → the conversation column and the content region, which
 *     are what r10 animates (`--dx-chat` width, the splitter drag). Anything
 *     measured mid-transition reads a position on its way somewhere else.
 */

import { expect, type Page } from "@playwright/test";

import { SHELL_COMBINATIONS } from "../src/shell/dev/fixture";

/** The ten r10 combinations. Their meanings are in `dev/fixture.ts`. */
export const COMBINATIONS = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10"] as const;

export type Combination = (typeof COMBINATIONS)[number];

export interface FixtureOptions {
  /** Extra query parameters, for axes the combination does not cover. */
  params?: Record<string, string>;
}

export function fixtureUrl(combination: Combination, params: Record<string, string> = {}): string {
  const search = new URLSearchParams({ shellFixture: "1", shell: combination, ...params });
  return `/?${search.toString()}`;
}

/**
 * Puts the shell into `combination` and waits until it has actually loaded.
 *
 * The wait is on `data-loaded`, not on a timeout: the port resolves projects and
 * files asynchronously even when it is in-memory, and a measurement taken before
 * that lands reads an empty workspace, which looks exactly like a real
 * empty-state bug.
 */
export async function open(
  page: Page,
  combination: Combination,
  options: FixtureOptions = {},
): Promise<void> {
  await page.goto(fixtureUrl(combination, options.params));
  await expect(page.locator("#shell")).toHaveAttribute("data-loaded", "true");
  // The named combination has to have survived the trip. `?page=` overrides the
  // combination on purpose, so a caller that passes one gets its page checked.
  const expected = options.params?.page ?? SHELL_COMBINATIONS[combination].page;
  await expect(page.locator("#shell")).toHaveAttribute("data-page", expected);
  await settle(page);
}

/**
 * Waits for the three columns to stop moving.
 *
 * `data-loaded` says the workspace arrived; it says nothing about layout. The
 * conversation column's width and the content region's inset both transition, so
 * a rect read during one is a rect on its way somewhere else — the pre-r10 fix
 * specs took "before" baselines mid-transition and then blamed the movement on
 * whatever they did next.
 *
 * Polls for two identical readings rather than sleeping a fixed duration: the
 * transition's length is a design token, and a test that hard-codes it goes
 * quietly wrong the day somebody tunes it.
 */
export async function settle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const parts = ["#dx-sidebar", "#dx-conversation", "#dx-content"]
        .map((selector) => document.querySelector(selector))
        .filter((node): node is Element => node !== null);
      if (parts.length === 0) return true;
      const now = JSON.stringify(parts.map((node) => node.getBoundingClientRect()));
      const window_ = window as unknown as { __r10cSettle?: string };
      const previous = window_.__r10cSettle;
      window_.__r10cSettle = now;
      return previous === now;
    },
    undefined,
    { polling: 100 },
  );
}

/** A rounded rect, or null when the selector matches nothing. */
export async function box(page: Page, selector: string) {
  return page.evaluate((target: string) => {
    const element = document.querySelector(target);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const round = (value: number) => Math.round(value * 100) / 100;
    return {
      left: round(rect.left),
      right: round(rect.right),
      top: round(rect.top),
      bottom: round(rect.bottom),
      width: round(rect.width),
      height: round(rect.height),
    };
  }, selector);
}
