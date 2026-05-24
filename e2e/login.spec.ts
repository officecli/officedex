import { test, expect } from "@playwright/test";
import { emitAuthEvent, getBridgeCalls, installBridgeMock } from "./fixtures/bridge-mock";

test.describe("Login screen", () => {
  test("renders anonymous state with Sign in via browser CTA", async ({ page }) => {
    await installBridgeMock(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Profile" }).click();
    await expect(page.getByRole("button", { name: /sign in via browser/i })).toBeVisible();
  });

  test("clicking Sign in calls login() and displays the awaiting URL", async ({ page }) => {
    await installBridgeMock(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Profile" }).click();

    await page.getByRole("button", { name: /sign in via browser/i }).click();
    await expect.poll(async () => (await getBridgeCalls(page, "login")).length).toBe(1);
    await expect(page.getByText("https://example.com/login")).toBeVisible();
    await expect(page.getByText(/waiting for browser sign-in/i)).toBeVisible();
  });

  test("auth success event refreshes whoami and shows signed-in state", async ({ page }) => {
    await installBridgeMock(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Profile" }).click();
    await expect(page.getByRole("button", { name: /sign in via browser/i })).toBeVisible();

    // Update whoami via direct evaluate so the next whoami call returns signed-in.
    await page.evaluate(() => {
      const mock = (window as unknown as { __bridgeMock?: { calls: Record<string, unknown[][]> } }).__bridgeMock;
      const api = (window as unknown as { officecli: Record<string, unknown> }).officecli;
      api.whoami = async () => {
        mock!.calls.whoami = mock!.calls.whoami || [];
        mock!.calls.whoami.push([]);
        return { mode: "logged_in", userId: "user-e2e", session: "sess-e2e" };
      };
    });

    await emitAuthEvent(page, { type: "success" });
    await expect(page.getByText("user-e2e").first()).toBeVisible();
    await expect(page.getByText("sess-e2e").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible();
  });

  test("auth failure event renders failure state with Try again", async ({ page }) => {
    await installBridgeMock(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Profile" }).click();
    await expect(page.getByRole("button", { name: /sign in via browser/i })).toBeVisible();

    await emitAuthEvent(page, { type: "failure", message: "Provider rejected token" });
    await expect(page.getByText("Provider rejected token")).toBeVisible();
    await expect(page.getByRole("button", { name: /try again/i })).toBeVisible();
  });
});
