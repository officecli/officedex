/**
 * W1-A regression gate: every menu the S2 audit found clipped is now fully on
 * screen, in the combination it was measured in.
 *
 * This is a gate, not a probe. Each check ends in `expectNoClip`, which fails
 * unless the panel is inside the viewport *and* no ancestor's overflow cuts it.
 *
 * There is deliberately no `test.skip` anywhere in this file, conditional or
 * otherwise. `e2e/ui-audit-s4.spec.ts` is 30 cases of `test.skip(!BRIDGE)`,
 * which reports "30 skipped" and exit code 0 when its environment is absent —
 * indistinguishable from a pass in a CI summary line. Everything here runs
 * against the fixture server, which needs nothing but the dev server, so a
 * missing environment is a failure rather than a silent pass.
 *
 *   npx vite --port 3121 --strictPort
 *   PLAYWRIGHT_BASE_URL=http://localhost:3121 npx playwright test e2e/fix-w1a.spec.ts
 */

import { expect, test, type Page } from "@playwright/test";

import { capture, expectNoClip, open, type Combination } from "./ui-audit-helpers";

const SESSION = { session: "fixes/W1-A" };
const MENU = ".shell-menu";

/** The measurement the fix is judged on, printed so the report can quote it. */
async function record(page: Page, name: string) {
  const measured = await expectNoClip(page, MENU);
  // eslint-disable-next-line no-console
  console.log(`W1A-FIXED ${name} ${JSON.stringify(measured)}`);
  return measured;
}

async function closeMenu(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.locator(MENU)).toHaveCount(0);
}

test.describe("W1-A overlay engine", () => {
  /* ------------------------------------------------------------- S2-003 */

  test("S2-003 ModeMenu is fully visible on the collapsed rail and expanded", async ({ page }) => {
    // C1 is the default start-up shell, where the two rows of this menu used to
    // be cut down to 44px — icons only, no "Agent" or "Editor" text at all.
    for (const combination of ["C1", "C2", "C3", "C9"] as Combination[]) {
      await open(page, combination, SESSION);
      await page.locator(".shell-brand").click();
      await page.locator(MENU).waitFor();
      await record(page, `mode-menu-${combination}`);
      // The text that was invisible before, asserted as text rather than as a box.
      await expect(page.getByRole("menuitemradio", { name: /Agent/ })).toBeVisible();
      await expect(page.getByRole("menuitemradio", { name: /Editor/ })).toBeVisible();
      await capture(page, combination, "W1A-mode-menu", SESSION);
      await closeMenu(page);
    }
  });

  /* ------------------------------------------------------------- S2-002 */

  test("S2-002 sidebar settings menu is fully visible in C1-C4", async ({ page }) => {
    for (const combination of ["C1", "C2", "C3", "C4"] as Combination[]) {
      await open(page, combination, SESSION);
      await page.locator(".shell-sidebar-footer button[aria-haspopup='menu']").click();
      await page.locator(MENU).waitFor();
      await record(page, `settings-menu-${combination}`);
      await capture(page, combination, "W1A-settings-menu", SESSION);
      await closeMenu(page);
    }
  });

  /* ------------------------------------------------------- S2-001 / S1-002 */

  test("S2-001 folder context menu is fully visible wherever the tree exists", async ({ page }) => {
    for (const combination of ["C1", "C2", "C5", "C6", "C7", "C8"] as Combination[]) {
      await open(page, combination, SESSION);
      const row = page.locator(".shell-tree-folder-row").first();
      await expect(row).toBeVisible();
      await row.click({ button: "right" });
      await page.locator(MENU).waitFor();
      await record(page, `folder-context-menu-${combination}`);
      // On the rail the panel used to be a 35px white sliver; the first item's
      // label being readable is the thing the number stands for.
      await expect(page.locator(".shell-menu-item").first()).toBeVisible();
      await capture(page, combination, "W1A-folder-context-menu", SESSION);
      await closeMenu(page);
    }
  });

  test("S2-001 file row menu, the instance the audit inferred rather than measured", async ({
    page,
  }) => {
    // Its trigger is `display: none` until the row is hovered, so the menu is
    // opened the way a user does: right-click on the row (FileTree.tsx:281).
    // That is also the case the placement code has to survive a zero-sized
    // trigger for.
    await open(page, "C2", SESSION);
    const row = page.locator(".shell-tree-file-row").first();
    await expect(row).toBeVisible();
    await row.click({ button: "right" });
    await page.locator(MENU).waitFor();
    await record(page, "file-row-menu-C2");
    await expect(page.locator(".shell-menu-item").first()).toBeVisible();
    await capture(page, "C2", "W1A-file-row-menu", SESSION);
    await closeMenu(page);

    // Not repeated on C1: the rail renders the file rows at 0x0 (measured), so
    // there is nothing for a user to right-click there. The folder rows on the
    // rail *are* reachable and are covered by the case above.
  });

  /* ------------------------------------------------------------- S2-004 */

  test("S2-004 FileTabs More menu stays inside the window", async ({ page }) => {
    for (const combination of ["C7", "C9"] as Combination[]) {
      await open(page, combination, SESSION);
      await page.locator("button[aria-label='More actions']").click();
      await page.locator(MENU).waitFor();
      const measured = await record(page, `tab-more-menu-${combination}`);
      // It opened from a trigger 44px from the right edge and ran 146px past it.
      expect(measured?.rect.right).toBeLessThanOrEqual(1280);
      await capture(page, combination, "W1A-tab-more-menu", SESSION);
      await closeMenu(page);
    }
  });

  /* --------------------------------------------------- S2-005 / S2-006 / S4-006 */

  test("S2-005 composer scope, permission and model menus in every placement", async ({ page }) => {
    // C5/C6 are the docked column (clipped by `.shell-agent`), C7-C10 the
    // floating panel (clipped by `.shell-presence-panel`), C1/C2 the Home hero
    // where only the height mattered (S2-006).
    for (const combination of ["C1", "C2", "C5", "C6", "C7", "C8", "C9", "C10"] as Combination[]) {
      await open(page, combination, SESSION);
      for (const [name, selector] of [
        ["scope", ".shell-cx-scope"],
        ["permission", ".shell-cx-permission"],
        ["model", ".shell-cx-model"],
      ] as const) {
        const trigger = page.locator(selector).first();
        // Opened from the keyboard: the toolbar's chips overlap each other
        // (S2-005's cross-reference to S3), so a mouse click on the scope chip
        // is intercepted. That is a different track's bug and must not turn
        // into a skip here.
        await expect(trigger).toBeVisible();
        await trigger.focus();
        await page.keyboard.press("ArrowDown");
        await page.locator(MENU).waitFor();
        await record(page, `composer-${name}-${combination}`);
        await capture(page, combination, `W1A-composer-${name}`, SESSION);
        await closeMenu(page);
      }
    }
  });

  test("S2-006 a menu never grows past the room it has", async ({ page }) => {
    await open(page, "C1", SESSION);
    const trigger = page.locator(".shell-cx-scope").first();
    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    await page.locator(MENU).waitFor();
    const measured = await record(page, "scope-height-C1");
    // The old `max-height: 340px` constant put this exactly 1px past the bottom
    // of a 720px window.
    expect(measured?.rect.bottom).toBeLessThanOrEqual(720);
    const maxHeight = await page.locator(MENU).evaluate((node) => getComputedStyle(node).maxHeight);
    expect(maxHeight).not.toBe("340px");
  });

  /* ------------------------------------------------------------- S2-007 */

  test("S2-007 a menu follows its anchor while the sidebar scrolls, then closes", async ({
    page,
  }) => {
    await open(page, "C2", SESSION);
    const body = page.locator(".shell-sidebar-body");
    // The first folder row: it sits 34px below the scroller's top edge, so a
    // 20px scroll moves it without pushing it out — which is the case where
    // following is the right answer.
    const row = page.locator(".shell-tree-folder-row").first();
    await row.click({ button: "right" });
    await page.locator(MENU).waitFor();
    const before = await record(page, "scroll-follow-before");

    await body.evaluate((node) => {
      node.scrollTop = 20;
    });
    await page.waitForTimeout(150);
    const after = await record(page, "scroll-follow-after");
    // Follows by exactly the scroll distance, and does not drift sideways: the
    // anchor is the wrapper, whose box does not change when the pointer leaves
    // the row and the hover-only trigger goes away.
    expect(before!.rect.top - after!.rect.top).toBeCloseTo(20, 0);
    expect(after!.rect.left).toBeCloseTo(before!.rect.left, 0);
    await capture(page, "C2", "W1A-menu-after-scroll", SESSION);

    // Scrolled right past it: the anchor leaves the scroller, so the panel
    // closes rather than hang over whatever is in that spot now.
    await body.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await page.waitForTimeout(200);
    await expect(page.locator(MENU)).toHaveCount(0);
  });

  /* ------------------------------ the portal's two structural requirements */

  test("the panel is portalled inside #shell, not onto document.body", async ({ page }) => {
    // Both `--shell-*` and the `--od-*` bridge are declared on `#shell`
    // (tokens.css:15,105). A panel on `document.body` renders in the browser's
    // default serif with every token unresolved — this is R3's failure mode,
    // and the fix for R1 must not create a second instance of it.
    await open(page, "C1", SESSION);
    await page.locator(".shell-brand").click();
    await page.locator(MENU).waitFor();

    const placement = await page.locator(MENU).evaluate((node) => ({
      insideShell: !!node.closest("#shell"),
      parentIsShell: node.parentElement?.id === "shell",
      position: getComputedStyle(node).position,
      fontFamily: getComputedStyle(node).fontFamily,
      paper: getComputedStyle(node).backgroundColor,
      shellFont: getComputedStyle(document.querySelector(".shell")!).fontFamily,
    }));
    // eslint-disable-next-line no-console
    console.log(`W1A-FIXED portal ${JSON.stringify(placement)}`);

    expect(placement.insideShell).toBe(true);
    expect(placement.parentIsShell).toBe(true);
    expect(placement.position).toBe("fixed");
    expect(placement.fontFamily).toBe(placement.shellFont);
    expect(placement.fontFamily).toContain("PingFang SC");
  });

  test("none of the four inner overflow containers is above an open panel", async ({ page }) => {
    // The five `overflow: hidden` ancestors S2 named were `.shell-sidebar`,
    // `.shell-sidebar-body`, `.shell-agent`, `.shell-presence-panel` and
    // `.shell`. Four of them must be gone from the chain. `.shell` stays — it
    // is the portal host, it is `inset: 0`, and a box the size of the viewport
    // cuts nothing off something the placement code already kept inside the
    // viewport. That is asserted rather than assumed.
    await open(page, "C7", SESSION);
    await page.locator(".shell-cx-model").first().focus();
    await page.keyboard.press("ArrowDown");
    await page.locator(MENU).waitFor();

    const chain = await page.locator(MENU).evaluate((node) => {
      const clippers: string[] = [];
      for (let p = node.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.overflow !== "visible" || s.overflowX !== "visible" || s.overflowY !== "visible") {
          clippers.push(`${p.tagName.toLowerCase()}.${String(p.className)}`.trim());
        }
      }
      const shell = document.querySelector("#shell")!.getBoundingClientRect();
      return {
        clippers,
        shellCoversViewport:
          shell.left <= 0 &&
          shell.top <= 0 &&
          shell.right >= window.innerWidth &&
          shell.bottom >= window.innerHeight,
      };
    });
    // eslint-disable-next-line no-console
    console.log(`W1A-FIXED clipping-ancestors ${JSON.stringify(chain)}`);

    for (const gone of [
      "shell-sidebar",
      "shell-sidebar-body",
      "shell-agent",
      "shell-presence-panel",
      "shell-cx",
    ]) {
      expect(chain.clippers.join(" ")).not.toContain(gone);
    }
    expect(chain.shellCoversViewport).toBe(true);
  });

  test("the keyboard contract S2-015 recorded as correct still holds", async ({ page }) => {
    // Portalling moves the panel out of its trigger's DOM subtree, which is
    // exactly the kind of change that quietly breaks Escape-returns-focus.
    await open(page, "C2", SESSION);
    const trigger = page.locator(".shell-sidebar-footer button[aria-haspopup='menu']");
    await trigger.click();
    await page.locator(MENU).waitFor();

    const focusInMenu = await page.evaluate(() => document.activeElement?.className ?? "");
    expect(focusInMenu).toContain("shell-menu-item");

    await page.keyboard.press("Escape");
    await expect(page.locator(MENU)).toHaveCount(0);
    const afterEscape = await page.evaluate(
      () => document.activeElement?.getAttribute("aria-label") ?? "",
    );
    expect(afterEscape).toBe("Settings");

    // And a click on an item still reaches its handler through the portal.
    await page.locator(".shell-brand").click();
    await page.locator(MENU).waitFor();
    await page.getByRole("menuitemradio", { name: /Editor/ }).click();
    await expect(page.locator("#shell")).toHaveAttribute("data-mode", "editor");
  });
});
