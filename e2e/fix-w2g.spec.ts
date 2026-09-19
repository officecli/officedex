/**
 * W2-G regression gate: one preference, one answer, everywhere, immediately.
 *
 * The three defects this closes are all the same fault seen from three angles
 * (audit S7-002 / S7-003 / S7-004):
 *
 *   - two menus on the same screen disagreed about `enterToSend`;
 *   - Reduced motion did not reach the carousel until Home happened to remount;
 *   - the workspace's attention border was never handed the preference at all.
 *
 * So every check here does the same two things: change the setting in one
 * place, and assert the *other* place without reloading or remounting anything.
 * "Without remounting" is asserted rather than assumed — each probe stamps the
 * DOM node it measured and checks the stamp survived, because a remount would
 * make a broken build look fixed (that is exactly how S7 told the two apart).
 *
 * There is deliberately no `test.skip` anywhere in this file, conditional or
 * otherwise. `e2e/ui-audit-s4.spec.ts` is 30 cases of `test.skip(!BRIDGE)`,
 * which reports "30 skipped" and exit code 0 when its environment is absent —
 * indistinguishable from a pass in a CI summary line. Everything here runs
 * against the fixture server, which needs nothing but the dev server.
 *
 *   npx vite --port 3133 --strictPort
 *   PLAYWRIGHT_BASE_URL=http://localhost:3133 npx playwright test e2e/fix-w2g.spec.ts
 */

import { expect, test, type Page } from "@playwright/test";

import { capture, open } from "./ui-audit-helpers";

const SESSION = { session: "fixes/W2-G" };

const SIDEBAR_TRIGGER = '.shell-sidebar-footer button[aria-label="Settings"]';
const SIDEBAR_MENU = '[role="menu"][aria-label="Workspace settings"]';
const COMPOSER_TRIGGER = ".shell-cx-permission";
const COMPOSER_MENU = '[role="menu"][aria-label="Permissions"]';

/** The sidebar's Enter row, as a screen reader and a user each see it. */
async function readSidebarEnter(page: Page) {
  await page.locator(SIDEBAR_TRIGGER).click();
  const row = page.locator(SIDEBAR_MENU).locator(".shell-menu-item").filter({ hasText: /Enter/ });
  await expect(row).toHaveCount(1);
  const state = {
    label: ((await row.locator(".shell-menu-label").innerText()) ?? "").split("\n")[0].trim(),
    checked: await row.getAttribute("aria-checked"),
  };
  await page.keyboard.press("Escape");
  await expect(page.locator(SIDEBAR_MENU)).toHaveCount(0);
  return state;
}

/** The composer's Enter row, which writes its state into the label instead. */
async function readComposerEnter(page: Page) {
  await page.locator(COMPOSER_TRIGGER).click();
  const row = page.locator(COMPOSER_MENU).locator(".shell-menu-item").filter({ hasText: /Enter sends/ });
  await expect(row).toHaveCount(1);
  const label = ((await row.locator(".shell-menu-label").innerText()) ?? "").split("\n")[0].trim();
  await page.keyboard.press("Escape");
  await expect(page.locator(COMPOSER_MENU)).toHaveCount(0);
  return label;
}

async function clickSidebarEnter(page: Page) {
  await page.locator(SIDEBAR_TRIGGER).click();
  await page.locator(SIDEBAR_MENU).locator(".shell-menu-item").filter({ hasText: /Enter/ }).click();
  await expect(page.locator(SIDEBAR_MENU)).toHaveCount(0);
}

async function clickComposerEnter(page: Page) {
  await page.locator(COMPOSER_TRIGGER).click();
  await page
    .locator(COMPOSER_MENU)
    .locator(".shell-menu-item")
    .filter({ hasText: /Enter sends/ })
    .click();
  await expect(page.locator(COMPOSER_MENU)).toHaveCount(0);
}

/** Flips Reduced motion from the sidebar footer, its only entry point. */
async function toggleReducedMotion(page: Page) {
  await page.locator(SIDEBAR_TRIGGER).click();
  await page.locator(SIDEBAR_MENU).locator(".shell-menu-item").filter({ hasText: /motion/i }).click();
  await expect(page.locator(SIDEBAR_MENU)).toHaveCount(0);
}

/**
 * Stamps a node so a later check can tell "still the same element" from
 * "React threw it away and built a new one".
 */
async function stamp(page: Page, selector: string, mark: string) {
  const applied = await page.evaluate(
    ([target, value]) => {
      const node = document.querySelector(target) as HTMLElement | null;
      if (!node) return false;
      node.dataset.w2gMark = value;
      return true;
    },
    [selector, mark] as const,
  );
  expect(applied, `${selector} is not in the DOM to stamp`).toBe(true);
}

async function expectSameNode(page: Page, selector: string, mark: string) {
  const found = await page.getAttribute(selector, "data-w2g-mark");
  expect(found, `${selector} was remounted — this check proves nothing now`).toBe(mark);
}

test.describe("W2-G one settings store", () => {
  /* ------------------------------------------------------------- S7-002 */

  test("S7-002 the two Enter sends menus agree, in both directions", async ({ page }) => {
    await open(page, "C2", SESSION);

    // Both entry points are on screen at once — that is what made the old
    // disagreement visible in a single screenshot.
    await expect(page.locator(COMPOSER_TRIGGER)).toHaveCount(1);

    const before = await readSidebarEnter(page);
    expect(before).toEqual({ label: "Enter sends", checked: "true" });
    expect(await readComposerEnter(page)).toBe("Enter sends · on");

    // composer → sidebar. This is the exact sequence S7 recorded: after it, the
    // sidebar still said `aria-checked="true"` for a setting that was false.
    await clickComposerEnter(page);
    const afterComposer = await readSidebarEnter(page);
    // eslint-disable-next-line no-console
    console.log(`W2G-ENTER-SYNC composer->sidebar ${JSON.stringify(afterComposer)}`);
    expect(afterComposer).toEqual({ label: "Enter adds a line", checked: "false" });
    expect(await readComposerEnter(page)).toBe("Enter sends · off");

    await capture(page, "C2", "W2G-enter-sync", SESSION);

    // sidebar → composer, so neither menu is merely the one that happens to
    // re-render for its own reasons.
    await clickSidebarEnter(page);
    const afterSidebar = await readComposerEnter(page);
    // eslint-disable-next-line no-console
    console.log(`W2G-ENTER-SYNC sidebar->composer ${JSON.stringify(afterSidebar)}`);
    expect(afterSidebar).toBe("Enter sends · on");
    expect(await readSidebarEnter(page)).toEqual({ label: "Enter sends", checked: "true" });
  });

  /* ------------------------------------------------------------- S7-003 */

  test("S7-003 Reduced motion reaches the carousel in the same mount", async ({ page }) => {
    await open(page, "C2", SESSION);
    await expect(page.locator(".shell-highlights-track")).toBeVisible();

    /**
     * Presses Next and reports whether the track jumped or animated.
     *
     * Two frames after the press an animated scroll has barely moved (S7
     * measured 1px) while an instant one is already at its destination (337px).
     * Comparing the two samples is what makes this a judgement about behaviour
     * rather than about a CSS property that may or may not be honoured.
     */
    const probe = async () =>
      page.evaluate(async () => {
        const track = document.querySelector(".shell-highlights-track") as HTMLElement | null;
        const next = document.querySelector(
          '[aria-label="Next highlight videos"]',
        ) as HTMLButtonElement | null;
        if (!track || !next) return null;
        track.scrollLeft = 0;
        // The arrow disables itself from a scroll event, so resetting the track
        // and clicking in the same tick can hit a button React still thinks is
        // at the end.
        await new Promise((resolve) => setTimeout(resolve, 150));
        next.click();
        const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
        await frame();
        await frame();
        const twoFrames = track.scrollLeft;
        await new Promise((resolve) => setTimeout(resolve, 900));
        const settled = track.scrollLeft;
        return { twoFrames, settled, instant: settled > 0 && twoFrames === settled };
      });

    const baseline = await probe();
    // eslint-disable-next-line no-console
    console.log(`W2G-MOTION baseline ${JSON.stringify(baseline)}`);
    expect(baseline, "the carousel did not scroll at all, so this measures nothing").not.toBeNull();
    expect(baseline?.settled).toBeGreaterThan(0);
    expect(baseline?.instant, "motion is on, so the track should animate").toBe(false);

    await stamp(page, ".shell-highlights-track", "carousel");
    await toggleReducedMotion(page);
    // Nothing was remounted between the switch and the measurement: that is the
    // whole difference between the bug and the fix.
    await expectSameNode(page, ".shell-highlights-track", "carousel");

    const sameMount = await probe();
    // eslint-disable-next-line no-console
    console.log(`W2G-MOTION sameMount ${JSON.stringify(sameMount)}`);
    expect(sameMount?.settled).toBeGreaterThan(0);
    expect(sameMount?.instant, "Reduced motion is on but the track still animated").toBe(true);
    expect(sameMount?.twoFrames).toBe(sameMount?.settled);

    await capture(page, "C2", "W2G-motion-same-mount", SESSION);
  });

  /* ------------------------------------------------------------- S7-004 */

  test("S7-004 the workspace attention border obeys Reduced motion", async ({ page }) => {
    // C5 is a workspace with the seeded working task in scope, which is what
    // lights this border: `attentionActive` in App.tsx needs a run in progress,
    // a file open and Home closed.
    await open(page, "C5", SESSION);

    const host = ".shell-workspace .shell-attention";
    await expect(page.locator(host)).toHaveCount(1);
    await expect(page.locator(`${host} svg`)).toHaveCount(1);

    /** Samples the travelling light's geometry over ~400ms. */
    const probe = async () =>
      page.evaluate(async (target: string) => {
        const svg = document.querySelector(`${target} svg`) as SVGElement | null;
        if (!svg) return null;
        const sample = () => (svg.outerHTML.match(/-?\d+\.\d{2}/g) ?? []).slice(0, 12).join(",");
        const first = sample();
        await new Promise((resolve) => setTimeout(resolve, 400));
        return { moved: first !== sample() };
      }, host);

    const before = await probe();
    // eslint-disable-next-line no-console
    console.log(`W2G-ATTENTION before ${JSON.stringify(before)}`);
    expect(before?.moved, "the border was not animating, so turning it off proves nothing").toBe(true);

    await stamp(page, host, "attention");
    await toggleReducedMotion(page);
    await expectSameNode(page, host, "attention");

    const after = await probe();
    // eslint-disable-next-line no-console
    console.log(`W2G-ATTENTION after ${JSON.stringify(after)}`);
    // The prop App.tsx used to omit. Before the fix this stayed true forever,
    // through the switch, a remount and a restart.
    expect(after?.moved, "Reduced motion is on but the light is still travelling").toBe(false);

    await capture(page, "C5", "W2G-attention-reduced", SESSION);
  });

  /* ---------------------------------------------- the shared store itself */

  test("a preference set in the workspace is already set on Home", async ({ page }) => {
    // The fifth and least visible consumer: the setting has to be one value for
    // the whole application, not one per screen that happens to be mounted.
    await open(page, "C6", SESSION);
    await clickSidebarEnter(page);
    expect(await readComposerEnter(page)).toBe("Enter sends · off");

    await page.locator('.shell-sidebar-item[title="Home"]').click();
    await expect(page.locator("#shell")).toHaveAttribute("data-home", "true");

    // Home mounts a different composer in a different subtree. It must open on
    // the value the user just chose, not on the default it would have read for
    // itself.
    expect(await readComposerEnter(page)).toBe("Enter sends · off");
    expect(await readSidebarEnter(page)).toEqual({ label: "Enter adds a line", checked: "false" });
  });
});
