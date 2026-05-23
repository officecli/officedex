import { test, expect } from "@playwright/test";
import { emitBridgeEvent, installBridgeMock } from "./fixtures/bridge-mock";

test.describe("OfficeDex smoke", () => {
  test("renders application shell with sidebar navigation", async ({ page }) => {
    await installBridgeMock(page);
    await page.goto("/");

    // Sidebar nav items are buttons with their text label visible (5 main entries).
    await expect(page.getByRole("button", { name: "Dialogue" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Tasks" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Artifacts" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Templates" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
  });

  test("clicking sidebar nav items switches the rendered screen", async ({ page }) => {
    await installBridgeMock(page);
    await page.goto("/");

    await page.getByRole("button", { name: "Tasks" }).click();
    await expect(page.getByRole("heading", { name: "Recent Tasks" })).toBeVisible();

    await page.getByRole("button", { name: "Artifacts" }).first().click();
    await expect(page.getByText(/no files generated yet|content library|artifacts/i).first()).toBeVisible();

    await page.getByRole("button", { name: "Templates" }).click();
    await expect(page.getByRole("heading", { name: /template center/i })).toBeVisible();

    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: /app settings/i })).toBeVisible();

    await page.getByRole("button", { name: "Dialogue" }).click();
    await expect(page.getByPlaceholder(/enter what you want to generate/i)).toBeVisible();
  });

  test("bridge unconfigured event surfaces the setup-required failure screen", async ({ page }) => {
    await installBridgeMock(page);
    await page.goto("/");
    await expect(page.getByPlaceholder(/enter what you want to generate/i)).toBeVisible();

    await emitBridgeEvent(page, {
      event_id: "bridge-unconf",
      type: "bridge.unconfigured",
      payload: { message: "OfficeCLI binary is not configured" },
    });

    await expect(page.getByRole("heading", { name: /setup required/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /open settings/i }).first()).toBeVisible();
  });
});
