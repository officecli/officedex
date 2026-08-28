import { expect, test } from "@playwright/test";
import { attachHostReport, hostControl, preparePage } from "./support/real-e2e";

/**
 * Provider-free browser acceptance for the PPTX production surface.
 *
 * This suite is deliberately opt-in: the start test intercepts Generate and
 * never invokes the hosted provider, while the terminal test uses a persisted
 * failure fixture. Set OFFICEDEX_E2E_PPTX_STAGE=1 to run it against the
 * managed real bridge.
 */
test.describe("OfficeDex PPTX production stage", () => {
  test.skip(
    process.env.OFFICEDEX_E2E_PPTX_STAGE !== "1",
    "Set OFFICEDEX_E2E_PPTX_STAGE=1 to run the provider-free PPTX Stage browser checks.",
  );

  test.afterEach(async ({}, testInfo) => {
    await attachHostReport(testInfo);
  });

  test("shows immediate Starting feedback without starting a paid generation", async ({ page }) => {
    await preparePage(page);
    await page.route("**/rpc/Generate", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ taskId: "pptx-stage-start-fixture", sessionId: "pptx-stage-start-fixture", status: "running" }),
      });
    });

    const prompt = page.getByPlaceholder(/Enter what you want to generate/i);
    await prompt.fill("Create a provider-free PPTX stage smoke test");
    await page.getByRole("button", { name: /Generate/i }).last().click();
    await expect(page.getByRole("status")).toContainText(/Starting production|Starting/i, { timeout: 2_000 });
    await expect(page.getByRole("button", { name: /Generate/i }).last()).toBeDisabled();
  });

  test("renders a failed PPTX task in the production stage", async ({ page }) => {
    await hostControl("/control/seed/failed-task", {
      method: "POST",
      body: JSON.stringify({ taskId: "pptx-stage-failed-fixture", documentType: "pptx" }),
    });
    await preparePage(page);
    const stage = page.getByTestId("pptx-production-stage");
    await expect(stage).toBeVisible({ timeout: 60_000 });
    await expect(stage).toHaveClass(/pptx-production-stage--failed/);
    await expect(stage.getByTestId("pptx-production-status")).toContainText(/Generation failed/i);
    await expect(stage.getByRole("alert")).toContainText(/Real E2E diagnostic failure fixture/i);
    await expect(stage.getByRole("button", { name: /Retry/i })).toBeVisible();
  });
});

