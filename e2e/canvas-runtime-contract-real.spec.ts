import { expect, test } from "@playwright/test";

import {
  answerPlanUntilCompleted,
  assertNoResponseContractError,
  attachHostReport,
  preparePage,
  recordScenario,
  submitGeneration,
} from "./support/real-e2e";

const OFFICECLI_MAGIC_VIBE_PROMPT = "officedex::magic-deck::v1::7f3k9q2x";

test("the bundled runtime enters PPTX Canvas Node mode", async ({ page }) => {
  test.setTimeout(240_000);
  await preparePage(page);

  await submitGeneration(page, {
    documentType: "pptx",
    mode: "plan",
    prompt: OFFICECLI_MAGIC_VIBE_PROMPT,
  });

  const artifact = await answerPlanUntilCompleted(page, "pptx");
  const canvas = page.locator(".living-tree-cockpit, [data-testid='progressive-editor'], [data-testid='pptx-production-canvas']").first();
  await expect(canvas).toBeVisible({ timeout: 60_000 });
  await assertNoResponseContractError(page);
  expect(artifact.fileSize).toBeGreaterThan(0);
  expect(artifact.artifactPath.toLowerCase()).toContain(".pptx");
  await assertNoResponseContractError(page);

  await recordScenario({
    uiScenario: "canvas-runtime-contract",
    documentType: "pptx",
    mode: "plan",
    taskId: artifact.taskId,
    artifactPath: artifact.artifactPath,
    fileSize: artifact.fileSize,
  });
});

test.afterEach(async ({}, testInfo) => {
  await attachHostReport(testInfo);
});
