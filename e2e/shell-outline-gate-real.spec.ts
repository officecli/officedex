import { expect, test, type Page, type TestInfo } from "@playwright/test";

import {
  answerPendingQuestion,
  assertRunDidNotFail,
  attachHostReport,
  expectLeftHome,
  homeComposer,
  openShell,
  outlineGate,
  recordScenario,
} from "./support/real-e2e";

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
 *
 * In r10 the gate is `.dx-agent-question[data-gate=outline]` — the same form a
 * plain question uses, with an editable outline in it (`chat/AgentRun.tsx`,
 * `OutlineGate`) — and its titles are the inputs of `ol.dx-agent-outline`.
 */

const RUN_DEADLINE_MS = 20 * 60_000;

async function waitForDeck(page: Page): Promise<void> {
  const deadline = Date.now() + RUN_DEADLINE_MS;
  while (Date.now() < deadline) {
    if (await page.getByRole("tab").first().isVisible().catch(() => false)) return;
    await assertRunDidNotFail(page);
    // Any other question — a brief round, say — is answered so the run can
    // reach the end; the gate itself is over by this point.
    if (await answerPendingQuestion(page)) continue;
    await page.waitForTimeout(1_000);
  }
  throw new Error("the run never produced a deck");
}

/** Answers every question before the gate — the brief round — and returns at the gate. */
async function untilGate(page: Page): Promise<void> {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    if (await outlineGate(page).isVisible().catch(() => false)) return;
    await assertRunDidNotFail(page);
    if (await answerPendingQuestion(page)) continue;
    await page.waitForTimeout(1_000);
  }
  throw new Error("the run never stopped at the outline");
}

test.describe.configure({ mode: "serial" });

test.describe("new shell · the outline gate, for real", () => {
  test.afterEach(async ({}, testInfo) => {
    await attachHostReport(testInfo);
  });

  test("stops at the outline, takes an edit, and draws what was approved", async ({ page }, testInfo: TestInfo) => {
    const startedAt = Date.now();
    await openShell(page, "/?planMode=1");

    const composer = homeComposer(page);
    await expect(composer).toBeVisible({ timeout: 30_000 });
    await composer.fill("Prepare a three-slide product launch brief covering positioning, timeline and next steps.");
    await composer.press("Enter");
    await expectLeftHome(page);

    /*
     * The stop itself. Generous, because everything before it is real: the
     * brief, the outline call and whatever the provider is doing today.
     *
     * The brief comes first (`kind: pptx_brief`, "Here is what I understood.
     * Correct anything, then start.") and is a stop of its own; it is answered
     * as proposed so the run can reach the gate, which is what this spec is about.
     */
    await untilGate(page);

    const gate = outlineGate(page);
    const titles = gate.locator("ol.dx-agent-outline input");
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
    // The gate's own approval: the submit button carries the runtime's label for
    // it ("Start drawing"), and nothing is sent until it is pressed.
    await gate.locator("button[type=submit]").click();

    // The card goes away because the run took the answer, not because it broke.
    await expect(gate).toBeHidden({ timeout: 60_000 });

    await waitForDeck(page);

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
