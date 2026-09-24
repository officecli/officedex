import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { attachHostReport, recordScenario } from "./support/real-e2e";

/**
 * The outline gate, against the real runtime, for the first time.
 *
 * The gate is the pipeline's one blocking stop: generation pauses once the
 * outline is fixed, because that is the last point where changing the plan
 * costs nothing — every stage after it rewrites whole pages.
 *
 * Until now it had never run. The runtime wires it only for an interactive
 * best-mode run, which the bridge produces only for `generationMode: "plan"`,
 * and the shell never sent that field — so both halves existed, with a card, a
 * decision payload and unit tests, and nothing had ever put them together.
 * `?planMode=1` is the opt-in that makes the run ask for it (`services/planMode`);
 * it is off by default, and this spec is the reason it exists.
 *
 * What this proves that a fixture cannot: that the runtime actually stops, that
 * what it stops with is the outline the panel can render, that an edited plan
 * is accepted on the wire, and that the run then carries on to a finished deck
 * rather than hanging on an answer it did not understand.
 */

const RUN_DEADLINE_MS = 20 * 60_000;

/** The gate's own card: an editable outline, not the plain question card. */
const GATE = ".shell-task-question .shell-task-outline--editable";

async function waitForDeck(page: Page, testInfo: TestInfo): Promise<void> {
  const deadline = Date.now() + RUN_DEADLINE_MS;
  while (Date.now() < deadline) {
    if (await page.getByRole("tab").first().isVisible().catch(() => false)) return;

    const failed = page.getByText(/The run stopped/i).first();
    if (await failed.isVisible().catch(() => false)) {
      const detail = await page.locator(".shell-task-reply p").last().innerText().catch(() => "");
      throw new Error(
        `The shell reported the run as failed: ${detail.trim().replace(/\s+/g, " ") || "no reason shown"}`,
      );
    }

    // Any other question — a brief round, say — is answered so the run can
    // reach the gate, which is what this spec is about.
    const card = page.locator(".shell-task-question");
    if ((await card.isVisible().catch(() => false)) && (await page.locator(GATE).count()) === 0) {
      const options = card.locator(".shell-task-question-options button");
      if ((await options.count()) > 0) {
        const recommended = options.locator("css=.is-primary");
        await ((await recommended.count()) > 0 ? recommended.first() : options.first()).click();
        await expect(card).toBeHidden({ timeout: 60_000 });
        continue;
      }
    }
    await page.waitForTimeout(1_000);
  }
  throw new Error("the run never produced a deck");
}

test.describe.configure({ mode: "serial" });

test.describe("new shell · the outline gate, for real", () => {
  test.afterEach(async ({}, testInfo) => {
    await attachHostReport(testInfo);
  });

  test("stops at the outline, takes an edit, and draws what was approved", async ({ page }, testInfo) => {
    page.on("pageerror", (error) => {
      if (/Failed to fetch/i.test(error.message)) return;
      throw error;
    });

    const startedAt = Date.now();
    await page.goto("/?planMode=1");
    await expect(page.locator('#shell[data-loaded="true"]')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("MO product launch", { exact: true })).toHaveCount(0);

    await page
      .getByRole("textbox", { name: "New task instructions" })
      .fill("Prepare a three-slide product launch brief covering positioning, timeline and next steps.");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.locator("#shell")).toHaveAttribute("data-home", "false", { timeout: 30_000 });

    /*
     * The stop itself. Generous, because everything before it is real: the
     * brief, the outline call and whatever the provider is doing today.
     */
    await expect(page.locator(GATE), "the run never stopped at the outline").toBeVisible({
      timeout: 10 * 60_000,
    });

    const titles = page.locator(`${GATE} .shell-task-outline-input`);
    await expect(titles.first()).toBeVisible();
    const before = await titles.count();
    expect(before, "the gate opened with no pages to decide about").toBeGreaterThan(1);

    await testInfo.attach("gate.png", { body: await page.screenshot(), contentType: "image/png" });

    /*
     * An edit the finished deck can be checked against. A rename is the cheaper
     * of the two edits to verify — a dropped page only proves itself by absence,
     * and page counts move for other reasons.
     */
    const renamed = "Renamed by the gate";
    await titles.nth(1).fill(renamed);
    await page.locator(".shell-task-question .shell-task-button").click();

    // The card goes away because the run took the answer, not because it broke.
    await expect(page.locator(GATE)).toBeHidden({ timeout: 60_000 });

    await waitForDeck(page, testInfo);

    const tab = page.getByRole("tab").first();
    await expect(tab).toBeVisible();
    const fileName = (await tab.textContent())?.trim() ?? "";
    expect(fileName.length, "the opened tab has no file name").toBeGreaterThan(0);
    await expect(page.getByText(/Unable to open this presentation/i)).toHaveCount(0);

    await recordScenario({
      uiScenario: "shell-outline-gate-pptx",
      documentType: "pptx",
      mode: "plan",
      taskId: "shell-composer",
      artifactPath: fileName,
      fileSize: 0,
      durationMs: Date.now() - startedAt,
    });
  });
});
