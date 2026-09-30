import { expect, test } from "@playwright/test";

import {
  attachHostReport,
  fixturePath,
  homeComposer,
  openFromDisk,
  openShell,
  queueFileDialog,
} from "./support/real-e2e";

/**
 * The shell against the real Go backend.
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
 *   - Open from this Mac — the picker, the import, and the document
 *     projection row without which an opened file is remembered as recent and
 *     listed nowhere.
 *   - The workbook canvas — that a real editor mounts in the shell's slot
 *     rather than the skeleton that stood in for one.
 *
 * The skeleton is the thing to assert against: it is what the host draws when
 * no adapter is registered, so "the skeleton is gone" is precisely "an adapter
 * mounted something".
 *
 * OD-UI-1.2 (r10) moved the way in, not the thing being tested: there is no
 * Agent/Editor mode to switch and no Home hero action for the picker, so the
 * file is opened from Local, which is where r10 puts Open (§07).
 */

const SKELETON = ".shell-canvas[data-canvas-host] .shell-skeleton-paper, .shell-canvas .shell-skeleton-paper";

test.describe("new shell · real bridge", () => {
  test.afterEach(async ({}, testInfo) => {
    await attachHostReport(testInfo);
  });

  test("opens a workbook from disk and mounts the real editor in the canvas", async ({ page }) => {
    await openShell(page);

    await queueFileDialog(await fixturePath("sales-report.xlsx"));
    await openFromDisk(page);

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

  test("boots the real shell with none of the preview workspace in it", async ({ page }) => {
    /*
     * The production shell must never expose the browser-preview seed rows.
     * Those names belong only to `src/shell/port/fake` and would make a release
     * look functional while bypassing the desktop bridge entirely. `openShell`
     * refuses the folder; the files are named here because a fake that seeded
     * only documents would still pass that check.
     */
    await openShell(page);
    await expect(page.getByText("MO launch plan.docx", { exact: true })).toHaveCount(0);
    await expect(page.getByText("MO sales forecast.xlsx", { exact: true })).toHaveCount(0);

    // Home, with the three ways in r10 gives it, and nothing open behind them.
    await expect(page.locator("#shell")).toHaveAttribute("data-page", "home");
    await expect(homeComposer(page)).toBeVisible();
    await expect(page.locator(".dx-quick-start [data-act=create-local]").first()).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(0);

    // And Local is reachable and empty of anyone else's documents.
    await page.locator("#dx-sidebar [data-act=local]").click();
    await expect(page.locator("#shell")).toHaveAttribute("data-page", "local");
    await expect(page.getByText("MO launch plan.docx", { exact: true })).toHaveCount(0);
  });
});
