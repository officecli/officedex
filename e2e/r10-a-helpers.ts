/**
 * Helpers for the r10 overlay gates (`gates.spec.ts`, `fix-w1a.spec.ts`,
 * `fix-w1c.spec.ts`).
 *
 * These are the OD-UI-1.2 replacements for the four functions in
 * `e2e/ui-audit-helpers.ts`. That file is a survey instrument for the 2026-09-19
 * UI and its `open()` waits on `#shell[data-home]`, an attribute r10 does not
 * write — so every spec that went through it failed in its own setup rather than
 * on anything it was about. The brief says not to edit the shared survey
 * helpers, so what these specs need lives here instead.
 *
 * Two things are new rather than ported. `expectOnTop` answers the question the
 * old gate wrote down as a known blind spot ("it compares boxes… a panel fully
 * inside the viewport and fully covered by something painted above it passes"),
 * and `rootPaintKey` is what makes that answerable for the two overlays that
 * are deliberately `pointer-events: none`.
 */

import { expect, type Page } from "@playwright/test";

/**
 * The ten reviewed shells. r10 redefined every one of them; the table is in
 * `src/shell/dev/fixture.ts` and restated in
 * `src/shell/test/combinationSelectors.test.ts`:
 *
 *   C1  Home                       C6  document, conversation right, sidebar hidden
 *   C2  Home, sidebar hidden       C7  document, conversation floating, sidebar hidden
 *   C3  Local                      C8  conversation alone (content region closed)
 *   C4  conversation + Assets      C9  Local document, sidebar hidden
 *   C5  conversation + document    C10 Settings
 */
export const COMBINATIONS = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10"] as const;

export type Combination = (typeof COMBINATIONS)[number];

/** Which page each combination puts in the content region, from SHELL_COMBINATIONS. */
export const COMBINATION_PAGE: Record<Combination, string> = {
  C1: "home",
  C2: "home",
  C3: "local",
  C4: "assets",
  C5: "editor",
  C6: "editor",
  C7: "editor",
  C8: "assets",
  C9: "editor",
  C10: "settings",
};

function url(combination: Combination, params: Record<string, string> = {}): string {
  return `/?${new URLSearchParams({ shellFixture: "1", shell: combination, ...params }).toString()}`;
}

/**
 * Puts the shell into `combination` and waits until it has actually loaded.
 *
 * Two waits, for the same reason the survey helper had two. `data-loaded` is the
 * port having resolved folders, files and conversations — measured before it, an
 * empty workspace is indistinguishable from a real empty-state bug. `data-page`
 * is the named combination having survived the trip: the fixture's override is
 * merged over whatever `localStorage` kept from the last spec, and a menu filed
 * under C7 that was really measured on Home is worse than no measurement.
 */
export async function open(
  page: Page,
  combination: Combination,
  params: Record<string, string> = {},
): Promise<void> {
  await page.goto(url(combination, params));
  await expect(page.locator("#shell")).toHaveAttribute("data-loaded", "true");
  await expect(page.locator("#shell")).toHaveAttribute("data-page", COMBINATION_PAGE[combination]);
  await dismissUsageNotice(page);
  await settle(page);
}

/**
 * Acknowledges the first-run usage notice, so a measurement is of the shell.
 *
 * `UsageNotice` shows once per browser profile and every Playwright context is a
 * fresh one, so it is up in every run: a 320 × 188 card fixed to the bottom-right
 * corner at `--shell-z-menu` (300), which is above every rung the r10 overlays
 * use. Left up it covers the composer's tools on the shells whose conversation
 * is on the right, and a spec that measured through it would be reporting the
 * notice rather than the surface it named.
 *
 * Dismissed here rather than worked around per test, and asserted separately:
 * `gates.spec.ts` has a case that raises a menu underneath it on purpose,
 * because "an overlay drawn under another region" is the class of defect these
 * files exist for and hiding the one live instance of it in a setup helper would
 * be the weakening the brief forbids.
 */
export async function dismissUsageNotice(page: Page): Promise<void> {
  const notice = page.locator(".shell-usage-notice");
  if ((await notice.count()) === 0) return;
  await notice.locator("button").last().click();
  await expect(notice).toHaveCount(0);
}

/**
 * Waits for the floating conversation and the Dex bubble to stop moving.
 *
 * Both are placed from their own measured box (`ConversationPane.floatingStyle`,
 * `Dex.place`) and both animate into place, so a rect read too early is a
 * position the object is on its way out of. The r10 shape of the hazard the
 * survey helper documented at +0/+100/+300ms for the old presence panel.
 *
 * Polls for two identical readings rather than sleeping a fixed duration: the
 * transition's length is a design token (`--dx-ease`), and a test that hard-codes
 * it goes quietly wrong the day somebody tunes it.
 */
export async function settle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const moving = document.querySelectorAll("#dx-conversation, .dx-dex, .dx-dex-panel");
      const now = [...moving].map((node) => JSON.stringify(node.getBoundingClientRect())).join("|");
      const box = window as unknown as { __r10aSettle?: string };
      const previous = box.__r10aSettle;
      box.__r10aSettle = now;
      return previous === now;
    },
    undefined,
    { polling: 100 },
  );
}

export interface Measurement {
  rect: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  viewport: { width: number; height: number };
  offViewport: boolean;
  clippedBy: string | null;
}

/**
 * Fails when `selector` is cut off by the viewport or by an ancestor's overflow.
 *
 * Returns the measurements either way, because a finding needs the number, not
 * just the verdict — "the menu is clipped" is an opinion; "left = -58" is a fact
 * somebody can check after the fix.
 *
 * `<dialog>` is walked the same way as anything else even though `showModal()`
 * puts it in the top layer, where no ancestor's overflow can reach it. The walk
 * costs nothing and the dialog does not always go to the top layer — the
 * fallback in `ModalLayer` sets the `open` attribute instead when `showModal` is
 * missing, and a dialog left in the page flow is clippable like any other box.
 */
export async function expectNoClip(page: Page, selector: string): Promise<Measurement> {
  const measurement = await page.evaluate((target: string) => {
    const element = document.querySelector(target);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    // Walk the ancestors for the first one that actually clips, so the failure
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
        clippedBy = `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ""}.${String(node.className)}`.trim();
        break;
      }
    }
    return {
      rect: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      offViewport:
        rect.left < -0.5 ||
        rect.top < -0.5 ||
        rect.right > window.innerWidth + 0.5 ||
        rect.bottom > window.innerHeight + 0.5,
      clippedBy,
    };
  }, selector);

  expect(measurement, `${selector} is not in the DOM`).not.toBeNull();
  expect(measurement, `${selector} is clipped: ${JSON.stringify(measurement)}`).toMatchObject({
    offViewport: false,
    clippedBy: null,
  });
  return measurement!;
}

export interface TopReading {
  /** What `document.elementFromPoint` returned at the overlay's centre. */
  hit: string | null;
  /** True when that element is the overlay or something inside it. */
  ownsCentre: boolean;
  /** The overlay's sort key in `#shell`'s stacking context. */
  overlayKey: number;
  /** The hit element's sort key in the same context. */
  hitKey: number;
  /** Whether the overlay takes pointer events at all. */
  interactive: boolean;
}

/**
 * Fails when something else is painted over the middle of `selector`.
 *
 * This is the instrument the old `gates.spec.ts` said it was missing. Its second
 * known blind spot was exactly S2-010 — `.shell-presence` at z 200 over
 * `.shell-menu` at 60 — and the note said the right tool was "`elementFromPoint`
 * on the panel's own centre", held back because the z-index ladder was still
 * being rebuilt. The ladder landed (`src/shell/tokens.css`, gated statically by
 * `src/shell/test/layers.test.ts`), and that gate's own first blind spot says
 * the run-time complement "belongs at run time … in `e2e/`". Here it is.
 *
 * Two overlays in r10 are deliberately `pointer-events: none`: the name tip
 * (`.dx-control-tooltip`, "never holds anything that has to be clicked") and the
 * notice (`#dx-notice`, a self-dismissing confirmation). A hit test cannot see
 * either — they are transparent to it by design — so for those the question is
 * answered by paint order instead: the sort key each element has in `#shell`'s
 * stacking context, which is the z-index of the outermost ancestor between
 * `#shell` and the element that has one. `#shell` and `#dx-workspace` open no
 * stacking context of their own (asserted in `layers.test.ts`), so those keys
 * really do sort against each other.
 */
export async function expectOnTop(page: Page, selector: string): Promise<TopReading> {
  const reading = await page.evaluate((target: string) => {
    const element = document.querySelector(target);
    if (!element) return null;

    /** The element's sort key at `#shell`'s root: the outermost z-index above it. */
    const rootPaintKey = (node: Element | null): number => {
      const chain: Element[] = [];
      for (let walk = node; walk && walk.id !== "shell"; walk = walk.parentElement) chain.unshift(walk);
      for (const link of chain) {
        const z = getComputedStyle(link).zIndex;
        if (z !== "auto") return Number(z);
      }
      return 0;
    };

    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      hit: hit ? `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ""}.${String(hit.className)}`.trim() : null,
      ownsCentre: hit !== null && (hit === element || element.contains(hit) || hit.contains(element)),
      overlayKey: rootPaintKey(element),
      hitKey: rootPaintKey(hit),
      interactive: getComputedStyle(element).pointerEvents !== "none",
    };
  }, selector);

  expect(reading, `${selector} is not in the DOM`).not.toBeNull();
  if (reading!.interactive) {
    expect(
      reading!.ownsCentre,
      `${selector} is covered at its centre by ${reading!.hit}: ${JSON.stringify(reading)}`,
    ).toBe(true);
  } else {
    expect(
      reading!.overlayKey,
      `${selector} paints below ${reading!.hit}: ${JSON.stringify(reading)}`,
    ).toBeGreaterThan(reading!.hitKey);
  }
  return reading!;
}
