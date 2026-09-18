import { expect, test } from "@playwright/test";
import {
  answerPlanUntilCompleted,
  attachHostReport,
  preparePage,
  recordScenario,
  submitGeneration,
} from "./support/real-e2e";

const PROMPT =
  "请做一份介绍 TikTok 运营的 PPT。用自由构图，不要套同一套列表模板。内容覆盖定位、短视频生产、钩子、发布节奏、推荐流和复盘。必须包含可编辑的原生图表，用来展示趋势、栏目对比和内容结构。大约 20 页。";

test.describe.configure({ mode: "serial" });

test.describe("OfficeDex UI TikTok PPTX generation", () => {
  test.afterEach(async ({}, testInfo) => {
    await attachHostReport(testInfo);
  });

  test("generates a TikTok operations PPTX from the home prompt", async ({ page }) => {
    test.setTimeout(60 * 60 * 1000);
    await preparePage(page);
    const startedAt = Date.now();

    await submitGeneration(page, {
      documentType: "pptx",
      prompt: PROMPT,
    });

    const artifact = await answerPlanUntilCompleted(page, "pptx");
    const durationMs = Date.now() - startedAt;

    expect(artifact.artifactPath.toLowerCase()).toContain(".pptx");
    expect(artifact.fileSize).toBeGreaterThan(0);

    await recordScenario({
      uiScenario: "generate-pptx-tiktok-ops-ui",
      documentType: "pptx",
      mode: "plan",
      taskId: artifact.taskId,
      artifactPath: artifact.artifactPath,
      fileSize: artifact.fileSize,
      durationMs,
    });
  });
});
