import { expect, test } from "@playwright/test";
import {
  answerPlanUntilCompleted,
  assertNoResponseContractError,
  attachHostReport,
  dismissOnboarding,
  expectPptistText,
  fixturePath,
  hostRPC,
  preparePage,
  recordScenario,
  submitGeneration,
  waitForCompletedArtifact,
  type DocumentType,
} from "./support/real-e2e";

const GENERATION_MATRIX: Array<{
  documentType: DocumentType;
  prompt: string;
  sourceFixture?: string;
}> = [
  {
    documentType: "pptx",
    prompt: "Create a concise three-slide OfficeDex real E2E deck about a product launch plan. Keep text short.",
  },
  {
    documentType: "docx",
    prompt: "Write a one-page OfficeDex real E2E memo about rollout risks and mitigation steps.",
  },
  {
    documentType: "xlsx",
    prompt: "Create a compact OfficeDex real E2E workbook with a project budget table and totals.",
  },
  {
    documentType: "report",
    prompt: "Create an OfficeDex real E2E report from this workbook. Summarize the trend and include a recommendation.",
    sourceFixture: "sales-report.xlsx",
  },
  {
    documentType: "img",
    prompt: "画一只猫咪",
  },
  {
    documentType: "gif",
    prompt: "Generate a 4x4 sprite sheet for a short subtle OfficeDex real E2E loading animation. Output exactly 1024x1024 pixels, with sixteen equal 256x256 frames, simple shapes, no text.",
  },
];

test.describe.configure({ mode: "serial" });

test.describe("OfficeDex real client generation and artifact flows", () => {
  test.afterEach(async ({}, testInfo) => {
    await attachHostReport(testInfo);
  });

  for (const item of GENERATION_MATRIX) {
    test(`generates a real ${item.documentType} artifact from the UI`, async ({ page }) => {
      test.skip(
        item.documentType === "pptx" && process.env.OFFICEDEX_E2E_RUN_HOSTED_PPTX !== "1",
        "Hosted PPTX rendering can spend several minutes in provider-side layout QA; run with OFFICEDEX_E2E_RUN_HOSTED_PPTX=1 when validating the full hosted PPTX render path.",
      );
      test.skip(
        item.documentType === "gif" && process.env.OFFICEDEX_E2E_RUN_HOSTED_GIF !== "1",
        "Hosted GIF generation depends on the image provider returning an exact 4x4-divisible sprite sheet; run with OFFICEDEX_E2E_RUN_HOSTED_GIF=1 when validating that provider path.",
      );
      await preparePage(page);
      const startedAt = Date.now();
      const sourceFile = item.sourceFixture ? await fixturePath(item.sourceFixture) : undefined;
      if (item.documentType === "pptx" && process.env.OFFICEDEX_E2E_PPTX_NO_IMAGES === "1") {
        await hostRPC("UpdateSettings", { defaults: { enableImages: false } });
        // UpdateSettings mutates the bridge store, while the renderer keeps a
        // local settings snapshot. Reload so the actual user submission picks
        // up the persisted no-images flag instead of sending the stale default.
        await page.reload();
        await dismissOnboarding(page);
      }

      await submitGeneration(page, {
        documentType: item.documentType,
        prompt: item.prompt,
        sourceFile,
      });

      const artifact = await waitForCompletedArtifact(page, item.documentType);
      const durationMs = Date.now() - startedAt;
      if (item.documentType === "pptx") {
        const editor = page.locator(".living-tree-cockpit[data-vibe-stage='completed'] .living-tree-pptx-edit-panel.is-review-mode").first();
        if (await editor.isVisible().catch(() => false)) {
          const verifiedTitle = "OfficeDex v0.6.0 Verified";
          const editInput = page.getByPlaceholder(/Ask to modify this PPT/i);
          await editInput.fill(`将第一页的标题改为“${verifiedTitle}”`);
          await page.getByRole("button", { name: /Send edit request/i }).click();
          await expect(page.getByText(/Saved locally\./i).last()).toBeVisible({ timeout: 180_000 });
          await expectPptistText(page, verifiedTitle);

          await page.reload();
          await dismissOnboarding(page);
          await expectPptistText(page, verifiedTitle);
        } else {
          // Some hosted Web environments intentionally ship without an
          // embedded editor. Generation is still valid when the real artifact
          // preview is rendered and exposes the expected slide count/actions.
          await expect(page.getByText(/AI editor unavailable/i)).toBeVisible();
          await expect(page.locator("iframe.pptx-embed-frame").first()).toBeVisible();
          await expect(page.getByRole("button", { name: /Open in app|Show in folder/i }).first()).toBeVisible();
        }
      } else {
        await expect(page.getByText(artifact.artifactPath.split(/[\\/]/).pop() ?? artifact.artifactPath).first()).toBeVisible();
      }

      await recordScenario({
        uiScenario: `generate-${item.documentType}`,
        documentType: item.documentType,
        mode: item.documentType === "img" || item.documentType === "gif" ? undefined : "plan",
        taskId: artifact.taskId,
        artifactPath: artifact.artifactPath,
        fileSize: artifact.fileSize,
        durationMs,
      });
    });
  }

  test("blocks on docx plan option response contract and completes the real artifact", async ({ page }) => {
    await preparePage(page);
    const startedAt = Date.now();

    await submitGeneration(page, {
      documentType: "docx",
      mode: "plan",
      prompt: "Use plan mode to write a one-page onboarding checklist for a new OfficeDex customer success workflow.",
    });

    await expect(page.getByText(/Review the plan|Confirmation Required|Recommended/i).first()).toBeVisible({ timeout: 20 * 60_000 });
    const artifact = await answerPlanUntilCompleted(page, "docx");
    await recordScenario({
      uiScenario: "generate-docx-plan-option-response",
      documentType: "docx",
      mode: "plan",
      taskId: artifact.taskId,
      artifactPath: artifact.artifactPath,
      fileSize: artifact.fileSize,
      durationMs: Date.now() - startedAt,
    });
  });

  test("starts a pptx Vibe plan and cancels it from the UI", async ({ page }) => {
    await preparePage(page);

    await submitGeneration(page, {
      documentType: "pptx",
      mode: "plan",
      prompt: "Use plan mode to create a short OfficeDex launch presentation with agenda, risks, and owner next steps.",
    });

    await expect(page.getByLabel(/Living Tree Cockpit/i).first()).toBeVisible({ timeout: 60_000 });
    await assertNoResponseContractError(page);

    await page.getByRole("button", { name: /Cancel/i }).click();
    await expect(page.getByText(/cancelled|Task cancelled/i).first()).toBeVisible({ timeout: 60_000 });

    await recordScenario({
      uiScenario: "generate-pptx-vibe-plan-cancel",
      documentType: "pptx",
      mode: "plan",
    });
  });
});
