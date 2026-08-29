import { expect, test } from "@playwright/test";
import {
  attachHostReport,
  fixturePath,
  hostControl,
  preparePage,
  queueFileDialog,
  recordScenario,
} from "./support/real-e2e";

test.describe("OfficeDex real client shell, account, settings, diagnostics, and update flows", () => {
  test.afterEach(async ({}, testInfo) => {
    await attachHostReport(testInfo);
  });

  test("drives shell navigation, workspace actions, settings, diagnostics, login events, and update states through the real bridge", async ({ page }) => {
    await preparePage(page);

    const collapseSidebar = page.getByRole("button", { name: /Collapse sidebar/i });
    const expandSidebar = page.getByRole("button", { name: /Expand sidebar/i });
    if (await collapseSidebar.isVisible().catch(() => false)) {
      await collapseSidebar.click();
      await expect(page.locator(".app-shell.sidebar-collapsed")).toBeVisible();
    } else {
      await expect(expandSidebar).toBeVisible();
    }
    await page.getByRole("button", { name: /Expand sidebar/i }).click();
    await expect(page.locator(".app-shell.sidebar-collapsed")).toHaveCount(0);

    await page.getByRole("button", { name: /Tasks/i }).click();
    await expect(page.getByRole("heading", { name: /Recent Tasks/i })).toBeVisible();
    await page.getByRole("button", { name: /Settings/i }).click();
    await expect(page.getByRole("heading", { name: /App Settings/i }).first()).toBeVisible();

    await page.getByRole("navigation", { name: /Settings sections/i }).getByRole("button", { name: /Generation/i }).click();
    await page.getByRole("combobox").first().click();
    await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content").filter({ hasText: /^Word \(\.docx\)$/ }).click();
    await expect(page.getByText(/Settings saved and applied/i)).toBeVisible({ timeout: 15_000 });

    await page.getByRole("navigation", { name: /Settings sections/i }).getByRole("button", { name: /Notification/i }).click();
    const notificationsSwitch = page.getByRole("switch", { name: /Desktop notifications/i });
    if (!(await notificationsSwitch.isChecked())) {
      await notificationsSwitch.click();
    }
    await page.getByRole("button", { name: /Test desktop notification/i }).click();

    await page.getByRole("navigation", { name: /Settings sections/i }).getByRole("button", { name: /Appearance/i }).click();
    await page.getByRole("combobox").click();
    await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content").filter({ hasText: /^English$/ }).click();

    await page.getByRole("navigation", { name: /Settings sections/i }).getByRole("button", { name: /Connection/i }).click();
    await page.getByRole("button", { name: /Test/i }).click();
    const providerTestDialog = page.getByRole("dialog", { name: /Run official provider test/i });
    await expect(providerTestDialog).toBeVisible();
    await providerTestDialog.getByRole("button", { name: /Run test/i }).click();
    const providerRow = page.locator(".setting-row").filter({ hasText: /LLM Provider/i });
    await expect(providerRow.locator(".ant-tag").filter({ hasText: /Official generation probe (passed|failed)|OK|HTTP|Unavailable|Network error/i }).first()).toBeVisible({ timeout: 90_000 });

    await page.getByRole("navigation", { name: /Settings sections/i }).getByRole("button", { name: /Diagnostics/i }).click();
    await page.getByRole("button", { name: /Export diagnostic logs/i }).click();
    await expect(page.getByRole("button", { name: /Exported/i })).toBeVisible({ timeout: 60_000 });

    await page.getByRole("navigation", { name: /Settings sections/i }).getByRole("button", { name: /About/i }).click();
    await page.getByRole("button", { name: /Check for updates/i }).click();
    await expect(page.getByText(/New version|Up to date|Last error/i)).toBeVisible({ timeout: 60_000 });

    await page.getByRole("button", { name: /Profile/i }).click();
    await expect(page.getByRole("heading", { name: /Sign in|Signed in|Could not/i })).toBeVisible({ timeout: 60_000 });
    await hostControl("/control/auth-event", {
      method: "POST",
      body: JSON.stringify({ type: "failure", message: "Local OAuth callback failure fixture" }),
    });

    const returnButton = page.getByRole("button", { name: /Back to OfficeDex|返回 OfficeDex/i }).first();
    if (await returnButton.isVisible().catch(() => false)) await returnButton.click();

    const workspace = await fixturePath("workspace");
    await queueFileDialog(workspace);
    await page.getByRole("button", { name: /Add content space|Add new project|Add project/i }).first().click();

    await recordScenario({
      uiScenario: "shell-settings-account-diagnostics-update-workspace",
    });
  });
});
