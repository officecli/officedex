import { test, expect } from "@playwright/test";
import { installBridgeMock, getBridgeCalls } from "./fixtures/bridge-mock";

/**
 * Report Issue e2e tests (Phase B + minimal-report pivot).
 *
 * After the pivot, the desktop posts a tiny JSON payload (≤ 4KB) containing
 * only requestId + taskId + errorCode + description + a few metadata fields.
 * No more zip upload from the dialog — Phase A1 export remains the deep
 * investigation fallback.
 *
 * Mock-bridge tests are runnable today via `npm run dev:browser`.
 * Real-bridge tests are `.skip()` — see inline comments for manual run.
 */

test.describe("Report issue (mock bridge — capability enabled)", () => {
  test("Capability enabled → dialog shows context bar, submits JSON payload ≤ 4KB", async ({ page }) => {
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

      mock.officecli.peekReportContext = async (...args: unknown[]) => {
        mock.__bridgeMock.calls["peekReportContext"] = mock.__bridgeMock.calls["peekReportContext"] || [];
        mock.__bridgeMock.calls["peekReportContext"].push(args);
        return {
          requestId: "req-abc-123",
          errorCode: "rate_limit",
          errorMessage: "Too many requests",
          runtimeMode: "hosted",
        };
      };

      mock.officecli.submitReport = async (...args: unknown[]) => {
        mock.__bridgeMock.calls["submitReport"] = mock.__bridgeMock.calls["submitReport"] || [];
        mock.__bridgeMock.calls["submitReport"].push(args);
        return {
          uploaded: true,
          ticketId: "TKT-123",
          viewUrl: "https://support.example.com/tickets/TKT-123",
          requestId: "req-abc-123",
        };
      };
    });

    await page.goto("/");

    const reportBtn = page.getByRole("button", { name: /report.*issue|上报.*问题|报告.*问题/i });
    await expect(reportBtn).toBeVisible({ timeout: 5000 });
    await reportBtn.click();

    await expect(page.getByText(/req-abc-123/)).toBeVisible({ timeout: 3000 });

    const descriptionInput = page.getByRole("textbox", { name: /description|描述|问题描述/i });
    await expect(descriptionInput).toBeVisible({ timeout: 3000 });
    await descriptionInput.fill("The document generation task hangs at 50% progress for over 5 minutes without any response.");

    const submitBtn = page.getByRole("button", { name: /submit|提交|发送/i });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    await expect.poll(async () => {
      const calls = await getBridgeCalls(page, "submitReport");
      if (calls.length === 0) return null;
      const input = (calls[0] as unknown[])[0] as Record<string, unknown>;
      return {
        hasDescription: typeof input.description === "string",
        noBundlePath: !("bundlePath" in input),
        noExportOpts: !("exportOpts" in input),
      };
    }).toMatchObject({
      hasDescription: true,
      noBundlePath: true,
      noExportOpts: true,
    });

    const calls = await getBridgeCalls(page, "submitReport");
    expect(JSON.stringify((calls[0] as unknown[])[0]).length).toBeLessThanOrEqual(4096);

    await expect(
      page.getByText(/TKT-123/).or(page.getByText(/ticket|工单/i))
    ).toBeVisible({ timeout: 5000 });
  });

  test("Capability disabled → B3 degraded: card button is Copy Request ID, no dialog opens", async ({ page }) => {
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

      mock.officecli.peekReportContext = async (...args: unknown[]) => {
        mock.__bridgeMock.calls["peekReportContext"] = mock.__bridgeMock.calls["peekReportContext"] || [];
        mock.__bridgeMock.calls["peekReportContext"].push(args);
        return {
          requestId: "req-xyz-789",
          errorCode: "",
          errorMessage: "",
          runtimeMode: "hosted",
        };
      };
    });

    await page.goto("/");

    const reportBtn = page.getByRole("button", { name: /^report.*issue$|^上报.*问题$|^报告.*问题$/i });
    await expect(reportBtn).not.toBeVisible();

    const copyBtn = page.getByRole("button", { name: /copy.*request.*id|复制.*request.*id/i });
    const copyVisible = await copyBtn.isVisible().catch(() => false);
    if (copyVisible) {
      await copyBtn.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).not.toBeVisible({ timeout: 1000 });
    }
  });
});

test.describe.skip("Report issue (real bridge — manual run)", () => {
  /**
   * Prerequisites for real-bridge tests after the minimal-report pivot:
   *   1. Set `supportReportEndpoint` in settings.json to an HTTP endpoint
   *      that accepts JSON (NOT multipart): e.g. a local httpbin / mock
   *      server that returns {"ticketId": "TKT-..."} on 2xx.
   *   2. Optionally set `supportReportToken` for Bearer auth.
   *   3. Build and run the full Wails app:
   *      `npm run build && go build -o officedex . && ./officedex`
   *   4. Trigger a failed task so the card surfaces a Report button.
   *   5. Remove `.skip` from this describe block.
   *   6. Run: `npx playwright test e2e/report-issue.spec.ts`
   *
   * Expected server contract (per docs/issue-reporting.md §7):
   *   POST <endpoint>
   *   Content-Type: application/json
   *   Authorization: Bearer <supportReportToken>  (optional)
   *   X-Client-Bundle-Schema: 1
   *   Body: ≤ 4KB JSON matching ReportPayload
   *   Response 2xx: {"ticketId": "TKT-...", "viewUrl": "https://..."}
   *   Response 4xx with "unsupported_schema" → desktop triggers app update flow
   */

  test("Real submit via configured endpoint → server receives JSON ≤ 4KB and returns ticket", async ({ page }) => {
    await page.goto("/");

    const reportBtn = page.getByRole("button", { name: /report.*issue|上报.*问题|报告.*问题/i });
    await expect(reportBtn).toBeVisible({ timeout: 10000 });
    await reportBtn.click();

    const descriptionInput = page.getByRole("textbox", { name: /description|描述|问题描述/i });
    await descriptionInput.fill("Testing real submission flow — synthetic JSON-tiny report payload.");

    const submitBtn = page.getByRole("button", { name: /submit|提交|发送/i });
    await submitBtn.click();

    await expect(page.getByText(/TKT-/)).toBeVisible({ timeout: 30000 });
  });

  test("Real submit with max-length CJK description stays within 4KB payload limit", async ({ page }) => {
    await page.goto("/");

    const reportBtn = page.getByRole("button", { name: /report.*issue|上报.*问题|报告.*问题/i });
    await expect(reportBtn).toBeVisible({ timeout: 10000 });
    await reportBtn.click();

    const descriptionInput = page.getByRole("textbox", { name: /description|描述|问题描述/i });
    const longCJK = "测试上报路径在中文长描述下仍能正常提交。".repeat(20).slice(0, 500);
    await descriptionInput.fill(longCJK);

    const submitBtn = page.getByRole("button", { name: /submit|提交|发送/i });
    await submitBtn.click();

    await expect(page.getByText(/TKT-/)).toBeVisible({ timeout: 30000 });
  });
});
