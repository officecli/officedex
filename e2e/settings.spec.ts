import { test, expect } from "@playwright/test";
import { getBridgeCalls, installBridgeMock } from "./fixtures/bridge-mock";

test.describe("Settings screen", () => {
  test("loads current defaults and persists changes", async ({ page }) => {
    await installBridgeMock(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: /generation defaults/i })).toBeVisible();

    // antd Radio.Group with optionType="button" hides the underlying input;
    // click the visible label text inside the Generation Mode row.
    await page.locator("label.ant-radio-button-wrapper").filter({ hasText: "Smart" }).first().click();
    await expect.poll(async () => {
      const calls = await getBridgeCalls(page, "updateSettings");
      return calls.some((args) => (args[0] as { defaults?: { mode?: string } })?.defaults?.mode === "best");
    }).toBe(true);
  });

  test("switching default document type via Select sends the patch", async ({ page }) => {
    await installBridgeMock(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: /generation defaults/i })).toBeVisible();

    // Open the document type select (first compact selector under Settings)
    await page.getByText("PowerPoint (.pptx)").click();
    await page.getByText("Word (.docx)", { exact: true }).click();

    await expect.poll(async () => {
      const calls = await getBridgeCalls(page, "updateSettings");
      return calls.some((args) => (args[0] as { defaults?: { documentType?: string } })?.defaults?.documentType === "docx");
    }).toBe(true);
  });

  test("switching to Custom runtime reveals the LLM provider form", async ({ page }) => {
    await installBridgeMock(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: /generation defaults/i })).toBeVisible();

    await page.getByRole("radio", { name: /custom/i }).click();

    await expect(page.getByPlaceholder(/api key/i)).toBeVisible();
    await page.getByPlaceholder(/api key/i).fill("sk-e2e-key");
    await expect.poll(async () => {
      const calls = await getBridgeCalls(page, "updateSettings");
      return calls.some((args) => {
        const patch = args[0] as { llmProvider?: { apiKey?: string } };
        return patch?.llmProvider?.apiKey === "sk-e2e-key";
      });
    }).toBe(true);
  });

  test("Reset everything modal triggers a full settings reset patch", async ({ page }) => {
    await installBridgeMock(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: /generation defaults/i })).toBeVisible();

    await page.getByRole("button", { name: /reset everything/i }).first().click();
    // Click the dangerous-styled OK button inside the confirm modal.
    await page.locator(".ant-modal-confirm-btns button.ant-btn-dangerous").click();

    await expect.poll(async () => {
      const calls = await getBridgeCalls(page, "updateSettings");
      return calls.some((args) => {
        const patch = args[0] as { onboardingCompletedAt?: unknown; llmProvider?: unknown };
        return patch?.onboardingCompletedAt === null && patch?.llmProvider === null;
      });
    }).toBe(true);
  });
});
