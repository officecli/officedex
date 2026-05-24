import { test, expect } from "@playwright/test";
import { installBridgeMock, getBridgeCalls } from "./fixtures/bridge-mock";

/**
 * Report Issue e2e tests (Phase B).
 *
 * Mock-bridge tests are runnable today via `npm run dev:browser`.
 * Real-bridge tests are `.skip()` — see inline comments for manual run instructions.
 */

test.describe("Report issue (mock bridge — capability enabled)", () => {
  test("Capability enabled → Report button visible, opens dialog, fills form, submits, shows ticket toast", async ({ page }) => {
    await installBridgeMock(page, {
      capabilities: { "report.submit": true },
    });

    await page.addInitScript(() => {
      const mock = (window as unknown as {
        __bridgeMock: { calls: Record<string, unknown[][]> };
        officecli: Record<string, (...args: unknown[]) => unknown>;
      });

      mock.officecli.getReportCapability = async (...args: unknown[]) => {
        mock.__bridgeMock.calls["getReportCapability"] = mock.__bridgeMock.calls["getReportCapability"] || [];
        mock.__bridgeMock.calls["getReportCapability"].push(args);
        return { enabled: true };
      };

      mock.officecli.submitReport = async (...args: unknown[]) => {
        mock.__bridgeMock.calls["submitReport"] = mock.__bridgeMock.calls["submitReport"] || [];
        mock.__bridgeMock.calls["submitReport"].push(args);
        return { uploaded: true, ticketId: "TKT-123", viewUrl: "https://support.example.com/tickets/TKT-123" };
      };
    });

    await page.goto("/");

    // Report button should be visible when capability is enabled
    const reportBtn = page.getByRole("button", { name: /report.*issue|上报.*问题|报告.*问题/i });
    await expect(reportBtn).toBeVisible({ timeout: 5000 });
    await reportBtn.click();

    // Dialog should open — fill the form
    const descriptionInput = page.getByRole("textbox", { name: /description|描述|问题描述/i });
    await expect(descriptionInput).toBeVisible({ timeout: 3000 });
    await descriptionInput.fill("The document generation task hangs at 50% progress for over 5 minutes without any response.");

    // Submit the report
    const submitBtn = page.getByRole("button", { name: /submit|提交|发送/i });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // Verify submitReport was called
    await expect.poll(async () => {
      const calls = await getBridgeCalls(page, "submitReport");
      return calls.length;
    }).toBeGreaterThan(0);

    // Verify ticket toast appears
    await expect(
      page.getByText(/TKT-123/).or(page.getByText(/ticket|工单/i))
    ).toBeVisible({ timeout: 5000 });
  });

  test("Capability disabled → only Export button visible, no Report button", async ({ page }) => {
    await installBridgeMock(page);

    await page.addInitScript(() => {
      const mock = (window as unknown as {
        __bridgeMock: { calls: Record<string, unknown[][]> };
        officecli: Record<string, (...args: unknown[]) => unknown>;
      });

      mock.officecli.getReportCapability = async (...args: unknown[]) => {
        mock.__bridgeMock.calls["getReportCapability"] = mock.__bridgeMock.calls["getReportCapability"] || [];
        mock.__bridgeMock.calls["getReportCapability"].push(args);
        return { enabled: false, reason: "no_endpoint" };
      };
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();

    // Export button should still be visible
    const exportBtn = page.getByRole("button", { name: /export.*diagnostic|导出.*诊断/i });
    await expect(exportBtn).toBeVisible();

    // Report button should NOT be visible
    const reportBtn = page.getByRole("button", { name: /report.*issue|上报.*问题|报告.*问题/i });
    await expect(reportBtn).not.toBeVisible();
  });
});

test.describe.skip("Report issue (real bridge — manual run)", () => {
  /**
   * Prerequisites for real-bridge tests:
   *   1. Set `supportReportEndpoint` in settings.json to a test server
   *      (e.g., a local httpbin or the staging report endpoint)
   *   2. Build and run the full Wails app:
   *      `npm run build && go build -o officedex . && ./officedex`
   *   3. Remove `.skip` from this describe block
   *   4. Run: `npx playwright test e2e/report-issue.spec.ts`
   *
   * Test server expected behavior:
   *   - Accept multipart POST with bundle.zip + description + bundleId + bundleSchemaVersion
   *   - Return JSON: {"ticketId": "TKT-...", "viewUrl": "https://..."}
   */

  test("Real submit via configured endpoint → server returns ticket", async ({ page }) => {
    await page.goto("/");

    const reportBtn = page.getByRole("button", { name: /report.*issue|上报.*问题|报告.*问题/i });
    await expect(reportBtn).toBeVisible({ timeout: 10000 });
    await reportBtn.click();

    const descriptionInput = page.getByRole("textbox", { name: /description|描述|问题描述/i });
    await descriptionInput.fill("Testing real submission flow — this is a synthetic test report.");

    const submitBtn = page.getByRole("button", { name: /submit|提交|发送/i });
    await submitBtn.click();

    // With a real test server, expect a ticket ID in the response toast
    await expect(page.getByText(/TKT-/)).toBeVisible({ timeout: 30000 });
  });

  /**
   * Prerequisites for CLI path test:
   *   1. Install officecli with `report submit` subcommand support
   *      (check: `officecli report submit --help` should exit 0)
   *   2. Ensure officecli is authenticated (run `officecli auth login` if needed)
   *   3. Build and run the full Wails app
   *   4. Remove `.skip` from this describe block
   */

  test("CLI path: officecli report submit returns ticket", async ({ page }) => {
    await page.goto("/");

    const reportBtn = page.getByRole("button", { name: /report.*issue|上报.*问题|报告.*问题/i });
    await expect(reportBtn).toBeVisible({ timeout: 10000 });
    await reportBtn.click();

    const descriptionInput = page.getByRole("textbox", { name: /description|描述|问题描述/i });
    await descriptionInput.fill("CLI path test — verifying officecli report submit integration.");

    const submitBtn = page.getByRole("button", { name: /submit|提交|发送/i });
    await submitBtn.click();

    // CLI path should also produce a ticket ID
    await expect(page.getByText(/TKT-/)).toBeVisible({ timeout: 30000 });
  });
});
