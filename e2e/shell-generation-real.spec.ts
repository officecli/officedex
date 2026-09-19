import { expect, test, type Locator, type Page } from "@playwright/test";

import { attachHostReport, recordScenario } from "./support/real-e2e";

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

/** Whatever the run is waiting on, or null if it is not waiting. */
function questionCard(page: Page): Locator {
  return page.locator(".shell-task-question");
}

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

    const card = questionCard(page);
    if (await card.isVisible().catch(() => false)) {
      const options = card.locator(".shell-task-question-options button");
      const count = await options.count();
      if (count > 0) {
        // The recommended option when the run marked one, otherwise the first.
        const recommended = options.locator("css=.is-primary");
        const pick = (await recommended.count()) > 0 ? recommended.first() : options.first();
        await pick.click();
        answered += 1;
        await expect(card).toBeHidden({ timeout: 60_000 });
        continue;
      }
      // Freeform-only: the composer is the way through, and `agent.send` routes
      // a typed answer to the pending question rather than starting a new run.
      await page.getByRole("textbox", { name: /Message Agent|New task instructions/ }).fill("Yes, go ahead.");
      await page.getByRole("button", { name: "Send message" }).click();
      answered += 1;
      await expect(card).toBeHidden({ timeout: 60_000 });
      continue;
    }

    const failed = page.getByText(/The run stopped/i).first();
    if (await failed.isVisible().catch(() => false)) {
      /*
       * The reason is in the conversation, not the toast.
       *
       * `useAgentTask` raises a toast for an error event, but the runtime's own
       * sentence is what the agent service appends to the task's messages — and
       * the toast is gone by the time anyone reads the report. Without this the
       * failure read "the run stopped", which sends the reader back to the video
       * to find out what actually happened.
       */
      const detail = await page
        .locator(".shell-task-reply p")
        .last()
        .innerText()
        .catch(() => "");
      throw new Error(
        `The shell reported the run as failed: ${detail.trim().replace(/\s+/g, " ") || "no reason shown"}`,
      );
    }
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
    page.on("pageerror", (error) => {
      if (/Failed to fetch/i.test(error.message)) return;
      throw error;
    });

    const startedAt = Date.now();
    await page.goto("/");
    await expect(page.locator('#shell[data-loaded="true"]')).toBeVisible({ timeout: 60_000 });

    // The seed rows belong to src/shell/port/fake. Seeing them here would mean
    // the page fell back to its in-memory fake and proved nothing.
    await expect(page.getByText("MO product launch", { exact: true })).toHaveCount(0);

    const prompt = page.getByRole("textbox", { name: "New task instructions" });
    await prompt.fill(
      "Create a compact OfficeDex shell demo workbook with a small project budget table and a totals row.",
    );
    await page.getByRole("button", { name: "Send message" }).click();

    // Asking for something leaves Home immediately — the canvas the run fills
    // is behind it, and staying would leave the user watching a file list.
    await expect(page.locator("#shell")).toHaveAttribute("data-home", "false", { timeout: 30_000 });

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
      page.locator(".shell-canvas [data-canvas-host] .shell-skeleton-paper, .shell-canvas .shell-skeleton-paper"),
    ).toHaveCount(0);

    // And the shell agrees it is saved, rather than reporting unsaved changes
    // on a file nobody has touched.
    await expect(page.locator(".shell-statusbar")).toContainText("All changes saved");

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
