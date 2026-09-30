import { expect, test, type Page } from "@playwright/test";

import {
  answerPendingQuestion,
  assertRunDidNotFail,
  attachHostReport,
  expectLeftHome,
  homeComposer,
  recordScenario,
  openShell,
} from "./support/real-e2e";

/**
 * The launch-demo chain, in the interface the demo will actually be given in.
 *
 * Every other generation spec drives the previous interface at `/legacy.html`,
 * because that is where they were written. They still prove the runtime
 * generates real documents — they do not prove that the shell can ask for one,
 * survive being asked a question back, and put the result on screen. The shell
 * is what `/` serves and what the packaged app opens, so until this existed the
 * demo path had no end-to-end coverage at all.
 *
 * One real generation, start to finish: type a task, answer whatever the run
 * asks, and end up with the produced file open in a real editor.
 */

const RUN_DEADLINE_MS = 20 * 60_000;

/**
 * Drives the run to completion, answering questions as they come.
 *
 * The polling shape is deliberate: a plain `toBeVisible` on the finished state
 * would time out behind the first question with nothing saying why, which is
 * exactly how the deadlock this spec exists to catch used to present.
 */
async function runToCompletion(page: Page): Promise<void> {
  const deadline = Date.now() + RUN_DEADLINE_MS;
  let answered = 0;
  while (Date.now() < deadline) {
    if (await page.getByRole("tab").first().isVisible().catch(() => false)) return;
    if (await answerPendingQuestion(page)) {
      answered += 1;
      continue;
    }
    await assertRunDidNotFail(page);
    await page.waitForTimeout(1_000);
  }
  throw new Error(
    `The shell run never produced a file (answered ${answered} question(s) before giving up).`,
  );
}

test.describe.configure({ mode: "serial" });

test.describe("new shell · real generation", () => {
  test.afterEach(async ({}, testInfo) => {
    await attachHostReport(testInfo);
  });

  test("generates a workbook from the shell composer and opens it in the canvas", async ({ page }) => {
    const startedAt = Date.now();
    await openShell(page);

    const prompt = homeComposer(page);
    await expect(prompt).toBeVisible({ timeout: 30_000 });
    await prompt.fill(
      "Create a compact OfficeDex shell demo workbook with a small project budget table and a totals row.",
    );
    await prompt.press("Enter");

    // Asking for something leaves Home immediately — the canvas the run fills
    // is behind it, and staying would leave the user watching a file list.
    await expectLeftHome(page);

    await runToCompletion(page);

    // The produced file is open, named, and rendered by a real editor rather
    // than the skeleton the host draws when no adapter mounted.
    const tab = page.getByRole("tab").first();
    await expect(tab).toBeVisible();
    const fileName = (await tab.textContent())?.trim() ?? "";
    expect(fileName.length, "the opened tab has no file name").toBeGreaterThan(0);

    await expect(page.locator(".spreadsheet-canvas--error")).toHaveCount(0);
    await expect(page.locator(".spreadsheet-canvas__editor canvas")).toBeVisible({ timeout: 120_000 });
    await expect(
      page.locator(".shell-canvas[data-canvas-host] .shell-skeleton-paper, .shell-canvas .shell-skeleton-paper"),
    ).toHaveCount(0);

    /*
     * And the shell agrees it is saved, rather than reporting unsaved changes
     * on a file nobody has touched.
     *
     * The save state is the tab row's control: r10 draws no status bar at all
     * (`tokens.css`: "the shell draws no status bar; save state sits in the tab
     * row"). Its accessible name is "Save <file>", so the state is read off the
     * label inside it rather than off the button's name.
     */
    await expect(page.locator("[data-act=save] span")).toHaveText("Saved", { timeout: 30_000 });

    await recordScenario({
      uiScenario: "shell-generate-xlsx",
      documentType: "xlsx",
      mode: "plan",
      taskId: "shell-composer",
      artifactPath: fileName,
      fileSize: 0,
      durationMs: Date.now() - startedAt,
    });
  });
});
