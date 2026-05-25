import { test, expect } from "@playwright/test";
import { installBridgeMock, getBridgeCalls } from "./fixtures/bridge-mock";

/**
 * Export Diagnostics e2e tests.
 *
 * These tests are SKIPPED by default because the full flow requires the Wails
 * backend bridge to actually produce a zip file on disk. In the browser-mode
 * dev server (`npm run dev:browser`), `exportLogs` is mocked and returns a
 * synthetic result — useful for verifying UI behaviour, but not for asserting
 * real file creation.
 *
 * To run manually against a full Wails build:
 *   1. `npm run build && go build -o officedex . && ./officedex`
 *   2. Remove `.skip` from the `test.describe` block below.
 *   3. `npx playwright test e2e/export-diagnostics.spec.ts`
 *
 * The mock-based variants (not skipped) verify that the UI correctly calls
 * the bridge and displays the expected feedback.
 */

test.describe("Export diagnostics (mock bridge)", () => {
  test("Settings → Diagnostics → export button calls exportLogs", async ({ page }) => {
    await installBridgeMock(page);

    // Add exportLogs to the mock
    await page.addInitScript(() => {
      const mock = (window as unknown as {
        __bridgeMock: { calls: Record<string, unknown[][]> };
        officecli: Record<string, (...args: unknown[]) => unknown>;
      });
      mock.officecli.exportLogs = async (...args: unknown[]) => {
        mock.__bridgeMock.calls["exportLogs"] = mock.__bridgeMock.calls["exportLogs"] || [];
        mock.__bridgeMock.calls["exportLogs"].push(args);
        return {
          path: "/tmp/mock-officedex-logs-20260524120000-abcd1234.zip",
          manifest: {
            schemaVersion: 1,
            bundleId: "abcd1234-mock",
            items: [
              { path: "meta.json", sizeBytes: 256, sectionId: "meta" },
              { path: "settings.scrubbed.json", sizeBytes: 512, sectionId: "settings" },
              { path: "logs/bridge-20260524.log", sizeBytes: 4096, sectionId: "logs" },
            ],
            truncated: false,
          },
        };
      };
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();

    // Find and click the export diagnostics button
    const exportBtn = page.getByRole("button", { name: /export.*diagnostic|导出.*诊断/i });
    await expect(exportBtn).toBeVisible();
    await exportBtn.click();

    // Verify exportLogs was called
    await expect.poll(async () => {
      const calls = await getBridgeCalls(page, "exportLogs");
      return calls.length;
    }).toBeGreaterThan(0);
  });

  test("export shows success feedback with file path", async ({ page }) => {
    await installBridgeMock(page);

    const mockPath = "/tmp/mock-officedex-logs-20260524120000-abcd1234.zip";
    await page.addInitScript((p: string) => {
      const mock = (window as unknown as {
        __bridgeMock: { calls: Record<string, unknown[][]> };
        officecli: Record<string, (...args: unknown[]) => unknown>;
      });
      mock.officecli.exportLogs = async (...args: unknown[]) => {
        mock.__bridgeMock.calls["exportLogs"] = mock.__bridgeMock.calls["exportLogs"] || [];
        mock.__bridgeMock.calls["exportLogs"].push(args);
        return {
          path: p,
          manifest: {
            schemaVersion: 1,
            bundleId: "abcd1234-mock",
            items: [
              { path: "meta.json", sizeBytes: 256, sectionId: "meta" },
            ],
            truncated: false,
          },
        };
      };
    }, mockPath);

    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();

    const exportBtn = page.getByRole("button", { name: /export.*diagnostic|导出.*诊断/i });
    await exportBtn.click();

    // Verify toast/notification appears with file path
    await expect(page.getByText(mockPath).or(page.getByText(/success|成功|已导出/))).toBeVisible({ timeout: 5000 });
  });
});

test.describe.skip("Export diagnostics (full Wails bridge)", () => {
  /**
   * These tests require a running Wails application with real backend.
   * They verify the complete flow including actual zip file creation.
   *
   * Prerequisites:
   *   - Build the app: `npm run build && go build -o officedex .`
   *   - Run the app: `./officedex`
   *   - Or use `wails dev` for development mode
   *
   * Manual verification steps:
   *   1. Open Settings → Diagnostics section
   *   2. Click "Export diagnostic logs" / "导出诊断日志"
   *   3. Verify a success toast appears showing the zip path
   *   4. Verify the zip exists at ~/Downloads/officedex-logs-*.zip
   *   5. Unzip and verify: meta.json, settings.scrubbed.json, logs/, events/
   *   6. Run privacy grep: grep -REn 'Bearer |sk-|apiKey=|Authorization:|eyJ' <unzipped>/
   *      Expected exit code: 1 (no matches)
   */

  test("full export produces a zip with manifest", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();

    const exportBtn = page.getByRole("button", { name: /export.*diagnostic|导出.*诊断/i });
    await expect(exportBtn).toBeVisible();
    await exportBtn.click();

    // With real bridge, the toast should show the actual zip path
    await expect(page.getByText(/officedex-logs-.*\.zip/)).toBeVisible({ timeout: 15000 });
  });

  test("manifest preview populates after export", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();

    const exportBtn = page.getByRole("button", { name: /export.*diagnostic|导出.*诊断/i });
    await exportBtn.click();

    // Manifest preview should show section items
    await expect(page.getByText("meta.json")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("settings.scrubbed.json")).toBeVisible();
  });
});
