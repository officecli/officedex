import { expect, test, type Page, type TestInfo } from "@playwright/test";

import {
  answerPendingQuestion,
  assertRunDidNotFail,
  attachHostReport,
  expectLeftHome,
  homeComposer,
  openShell,
  recordScenario,
} from "./support/real-e2e";

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
 * The gate is the pipeline's one confirmation stop, and it is wired only for an
 * interactive best-mode run (`agent_bridge_office_runtime.go`:
 * `request.Interactive && job.Mode == "best"`), which the bridge produces only
 * for `generationMode: "plan"` (`officeGenerateModeArgs`). The shell sends that
 * field only behind the `?planMode=1` opt-in (`services/planMode.ts`), so an
 * ordinary run — which is what this spec is — is `fast` and non-interactive and
 * never reaches the gate. `shell-outline-gate-real.spec.ts` is the spec that
 * takes the opt-in and asserts the gate.
 *
 * An earlier revision of this spec asserted the gate and failed on a run that
 * was otherwise perfect, which is how the above was found.
 */

const RUN_DEADLINE_MS = 20 * 60_000;

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

    if (await answerPendingQuestion(page)) {
      answered += 1;
      continue;
    }
    await assertRunDidNotFail(page);
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
    const startedAt = Date.now();
    await openShell(page);

    const prompt = homeComposer(page);
    await expect(prompt).toBeVisible({ timeout: 30_000 });
    await prompt.fill(
      "Prepare a three-slide product launch brief covering positioning, timeline and next steps.",
    );
    await prompt.press("Enter");

    await expectLeftHome(page);

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
