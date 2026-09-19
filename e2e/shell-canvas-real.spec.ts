import { expect, test, type Page } from "@playwright/test";

import { attachHostReport, fixturePath, queueFileDialog } from "./support/real-e2e";

/**
 * The new shell against the real Go backend.
 *
 * Every other spec here drives the previous interface, now at `/legacy.html`.
 * This one drives the shell, which is the entry point,
 * and it is the first end-to-end coverage the new IA has had: until the port
 * and canvas gates started asking `hasDesktopBackend()` instead of looking for
 * `window.go`, this page fell back to its in-memory fake under Playwright and
 * a test like this would have proved nothing at all.
 *
 * What it covers, in one pass because they are one user action:
 *
 *   - "Open from this computer" — the picker, the import, and the document
 *     projection row without which an opened file is remembered as recent and
 *     listed nowhere.
 *   - The workbook canvas — that a real editor mounts in the shell's slot
 *     rather than the skeleton that stood in for one.
 *
 * The skeleton is the thing to assert against: it is what the host draws when
 * no adapter is registered, so "the skeleton is gone" is precisely "an adapter
 * mounted something".
 */

const SKELETON = ".shell-canvas [data-canvas-host] .shell-skeleton-paper, .shell-canvas .shell-skeleton-paper";

/**
 * Switches mode the way the shell actually offers it: the brand button at the
 * top of the sidebar opens a menu. Asserting on a segmented Agent/Editor pair
 * in the window bar looks tidier and passes nowhere — the shell opens on its
 * compact rail, and that control is display:none there.
 *
 * The menu item's accessible name is the label *and* its description, so it is
 * matched by prefix rather than exactly.
 */
async function switchMode(page: Page, mode: "Agent" | "Editor") {
  await page.getByRole("button", { name: /Switch mode/ }).click();
  await page.getByRole("menuitemradio", { name: new RegExp(`^${mode}\\b`) }).click();
  await expect(page.locator("#shell")).toHaveAttribute("data-mode", mode.toLowerCase());
}

test.describe("new shell · real bridge", () => {
  test.afterEach(async ({}, testInfo) => {
    await attachHostReport(testInfo);
  });

  test("opens a workbook from disk and mounts the real editor in the canvas", async ({ page }) => {
    page.on("pageerror", (error) => {
      // The bridge's SSE stream can abort as the page navigates; everything
      // else is a genuine failure and should surface here rather than be
      // swallowed into a timeout further down.
      if (/Failed to fetch/i.test(error.message)) return;
      throw error;
    });

    await page.goto("/");
    await expect(page.locator('#shell[data-loaded="true"]')).toBeVisible({ timeout: 60_000 });

    // The fake port seeds a sample workspace; the real one starts from whatever
    // the backend has. Asserting on the seed's own names is how a test that is
    // silently running on the fake still passes, so check the port instead:
    // the fake never answers this.
    const onFake = await page.evaluate(() =>
      document.body.textContent?.includes("MO product launch") ?? false,
    );
    expect(onFake, "the shell fell back to its in-memory fake — check hasDesktopBackend()").toBe(false);

    // Editor mode's Home is where "Open from this computer" lives.
    await switchMode(page, "Editor");
    await page.getByRole("button", { name: "Home", exact: true }).first().click();

    await queueFileDialog(await fixturePath("sales-report.xlsx"));
    await page.getByRole("button", { name: /Open from this computer/i }).click();

    // Imported files land in the default folder and open straight away.
    await expect(page.getByRole("tab", { name: /sales-report/i })).toBeVisible({ timeout: 30_000 });

    /*
     * The workbook editor is a real grid.
     *
     * `.spreadsheet-canvas` alone does not say that: the same section is what
     * the component renders while it is still loading *and* what it renders
     * with "Spreadsheet editor failed to load" inside it. A missing RPC case in
     * the bridge host produced exactly that error panel and this assertion went
     * green over it. So the three states are separated here — no error section,
     * no loading overlay, and the Sheet SDK's own canvas inside the editor slot,
     * which only exists once the SDK has drawn.
     */
    await expect(page.locator(".spreadsheet-canvas--error")).toHaveCount(0);
    await expect(page.locator(".spreadsheet-canvas__editor canvas")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(".spreadsheet-canvas__loading")).toHaveCount(0);
    await expect(page.locator(SKELETON)).toHaveCount(0);
  });

  test("keeps Agent and Editor modes on the real shell without prototype documents", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('#shell[data-loaded="true"]')).toBeVisible({ timeout: 60_000 });

    // The production shell must never expose the browser-preview seed rows.
    // Those names belong only to src/shell/port/fake and would make a release
    // look functional while bypassing the desktop bridge entirely.
    await expect(page.getByText("MO product launch", { exact: true })).toHaveCount(0);
    await expect(page.getByText("MO launch plan.docx", { exact: true })).toHaveCount(0);

    await switchMode(page, "Agent");
    await expect(page.locator(".shell-home--agent")).toBeVisible();

    await switchMode(page, "Editor");
    await expect(page.getByRole("button", { name: "Home", exact: true }).first()).toBeVisible();
  });
});
