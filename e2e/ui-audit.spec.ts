/**
 * S0's smoke test: proves the audit harness itself works before eight sessions
 * build three hours of findings on top of it.
 *
 * It asserts the fixture reaches all ten shell combinations and that the data
 * each session was promised is actually there. It deliberately asserts nothing
 * about how anything *looks* — that is the sessions' job, and a harness test
 * that also grades the UI would fail for two unrelated reasons.
 *
 * Needs the fixture server: `preview_start ui-audit`, or
 * `npx vite --port 3100 --strictPort` in this directory.
 */

import { expect, test } from "@playwright/test";

import { COMBINATIONS, open } from "./ui-audit-helpers";

const SESSION = { session: "S0" };

test.describe("UI audit harness", () => {
  test("reaches all ten shell combinations with the data each one needs", async ({ page }) => {
    const seen: Record<string, string> = {};

    for (const combination of COMBINATIONS) {
      await open(page, combination, SESSION);
      const shell = page.locator("#shell");
      const state = {
        mode: await shell.getAttribute("data-mode"),
        home: await shell.getAttribute("data-home"),
        nav: await shell.getAttribute("data-nav-collapsed"),
        presence: await shell.getAttribute("data-presence"),
      };
      seen[combination] = JSON.stringify(state);

      // Editor mode can never dock — shellReducer.canDock(). If this ever
      // passes with "docked" the combination table in PLAN section 2 is wrong,
      // and six sessions are walking a matrix that does not match the product.
      if (state.mode === "editor") expect(state.presence, combination).toBe("floating");
    }

    // Ten combinations, ten distinct shells. A duplicate means two rows of the
    // matrix are the same screen and one of them is wasted session time.
    expect(new Set(Object.values(seen)).size).toBe(COMBINATIONS.length);
  });

  test("serves the awkward fixture the sessions were promised", async ({ page }) => {
    await open(page, "C2", SESSION);

    const tree = page.locator(".shell-sidebar-body");
    // The three shapes the prototype seed does not have, each one the reason
    // some session can see something at all.
    await expect(tree, "a folder large enough to page").toContainText("Show 40 more");
    await expect(tree, "an empty folder").toContainText("No files yet");
    await expect(tree, "a name long enough to overflow").toContainText("二〇二六年第三季度");

    // Enough tabs to overflow the strip at any supported width.
    expect(await page.locator('[role="tab"], .shell-tab').count()).toBeGreaterThanOrEqual(5);
  });

  test("renders the mandatory-update page on demand", async ({ page }) => {
    await page.goto("/?forceUpdate=downloading");
    await expect(page.locator(".force-update-title, h1")).toBeVisible();
    // No shell behind it: this page replaces the application, it does not
    // appear beside it (UpdateGate).
    await expect(page.locator("#shell")).toHaveCount(0);
  });

  test("gives a production build nothing, whatever the URL says", async ({ page }) => {
    // The dev server is a development build, so the fixture is on here by
    // design; the production branch is asserted in src/shell/dev/fixture.test.ts.
    // What this checks is the other half: that without the parameter, the
    // browser still gets the empty preview workspace and not the fixture.
    await page.goto("/");
    await expect(page.locator("#shell")).toHaveAttribute("data-loaded", "true");
    await expect(page.locator(".shell-sidebar-body")).not.toContainText("Show 40 more");
  });
});
