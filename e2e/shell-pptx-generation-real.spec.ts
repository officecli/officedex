import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

import { attachHostReport, recordScenario } from "./support/real-e2e";

/**
 * A deck, generated through the shell, against the real runtime.
 *
 * The sibling spec generates a workbook. Presentations are the longer and more
 * fragile path — a live draft appears mid-run, is replaced on every redraw, and
 * is handed over to the finished file's editor at the end — and none of it had
 * end-to-end coverage in the interface the packaged app actually opens.
 *
 * ## Why the outline gate is not asserted here
 *
 * The gate is the pipeline's one confirmation stop, and it cannot be reached
 * from this interface today. It is wired only for an interactive best-mode run
 * (`agent_bridge_office_runtime.go`: `request.Interactive && job.Mode ==
 * "best"`), which the bridge produces only for `generationMode: "plan"`
 * (`officeGenerateModeArgs`). Nothing in `src/shell` sets that field, so every
 * shell run is `fast` and non-interactive; the legacy renderer does not set it
 * either — `generationModeForDocumentType` returns `"fast"` for every office
 * type. The gate is a default-off feature behind an opt-in no interface offers,
 * not a regression.
 *
 * An earlier revision of this spec asserted the gate and failed on a run that
 * was otherwise perfect, which is how the above was found. Asserting it again
 * would mean asserting something unreachable; covering it needs the opt-in to
 * exist first, and that is a product decision rather than a test change.
 */

const RUN_DEADLINE_MS = 20 * 60_000;

function questionCard(page: Page): Locator {
  return page.locator(".shell-task-question");
}

/**
 * Drives the run to completion, answering questions as they come, and captures
 * the deck mid-draw on the way past.
 *
 * The capture is the point of passing it `testInfo`. Everything this spec looks
 * at exists only while the run is going — the live draft on the canvas, the
 * banner over the editor's ribbon, the per-page marks in the panel — and the
 * project retains video, traces and screenshots `only-on-failure`. So a *green*
 * run left no picture of the one interface nobody can otherwise see: not the
 * static fixtures (`createShellCanvas()` returns null in a browser, so the
 * canvas falls back to a skeleton), not a later inspection (the run is over and
 * the draft is deleted), and not the audit's ten shell combinations, which
 * describe a workspace at rest.
 *
 * Attached rather than asserted. What "being drawn" should look like is a
 * judgement, and a pixel assertion here would fail on every legitimate change
 * to the deck's own content.
 */
async function runToCompletion(page: Page, testInfo: TestInfo): Promise<number> {
  const deadline = Date.now() + RUN_DEADLINE_MS;
  let answered = 0;
  let captured = false;

  while (Date.now() < deadline) {
    if (await page.getByRole("tab").first().isVisible().catch(() => false)) return answered;

    // First moment the live deck is on screen, with the banner over it.
    if (!captured && (await page.locator(".shell-live-deck").isVisible().catch(() => false))) {
      captured = true;
      await testInfo
        .attach("deck-being-drawn.png", { body: await page.screenshot(), contentType: "image/png" })
        .catch(() => undefined);
    }

    const card = questionCard(page);
    if (await card.isVisible().catch(() => false)) {
      const options = card.locator(".shell-task-question-options button");
      if ((await options.count()) > 0) {
        const recommended = options.locator("css=.is-primary");
        const pick = (await recommended.count()) > 0 ? recommended.first() : options.first();
        await pick.click();
        answered += 1;
        await expect(card).toBeHidden({ timeout: 60_000 });
        continue;
      }
      await page.getByRole("textbox", { name: /Message Agent|New task instructions/ }).fill("Yes, go ahead.");
      await page.getByRole("button", { name: "Send message" }).click();
      answered += 1;
      await expect(card).toBeHidden({ timeout: 60_000 });
      continue;
    }

    const failed = page.getByText(/The run stopped/i).first();
    if (await failed.isVisible().catch(() => false)) {
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

  throw new Error(`The shell run never produced a deck (answered ${answered} question(s) before giving up).`);
}

test.describe.configure({ mode: "serial" });

test.describe("new shell · real deck generation", () => {
  test.afterEach(async ({}, testInfo) => {
    await attachHostReport(testInfo);
  });

  test("generates a deck from the shell composer and opens it in the canvas", async ({ page }, testInfo) => {
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
      "Prepare a three-slide product launch brief covering positioning, timeline and next steps.",
    );
    await page.getByRole("button", { name: "Send message" }).click();

    await expect(page.locator("#shell")).toHaveAttribute("data-home", "false", { timeout: 30_000 });

    await runToCompletion(page, testInfo);

    const tab = page.getByRole("tab").first();
    await expect(tab).toBeVisible();
    const fileName = (await tab.textContent())?.trim() ?? "";
    expect(fileName.length, "the opened tab has no file name").toBeGreaterThan(0);

    /*
     * The finished deck, in a real editor.
     *
     * The skeleton is what the canvas draws while a deck is still being written
     * — legitimate mid-run, wrong once a file is open. The read-only lock is
     * the live draft's, and it has to lift by itself: the canvas routes to the
     * finished file's editor when the run leaves its live statuses, so a lock
     * still on screen means the handover did not happen and the user is left
     * looking at scratch they cannot edit.
     */
    await expect(page.locator(".pptx-embed-frame")).toBeVisible({ timeout: 120_000 });
    await expect(page.locator(".shell-canvas .shell-skeleton-paper")).toHaveCount(0);
    await expect(page.locator(".shell-live-deck-lock")).toHaveCount(0);

    /*
     * And the editor could actually read it.
     *
     * An earlier revision stopped at the assertion above, and a run passed it
     * while the canvas said "Unable to open this presentation — MOP Diagram
     * layout did not produce native shapes": the frame mounts either way, so
     * the deck failing to open looked exactly like the deck opening. A
     * generation spec that cannot tell those apart is not checking the thing it
     * exists to check.
     */
    await expect(page.getByText(/Unable to open this presentation/i)).toHaveCount(0);
    await expect(page.getByText(/did not produce native shapes/i)).toHaveCount(0);

    await recordScenario({
      uiScenario: "shell-generate-pptx",
      documentType: "pptx",
      mode: "fast",
      taskId: "shell-composer",
      artifactPath: fileName,
      fileSize: 0,
      durationMs: Date.now() - startedAt,
    });
  });
});
