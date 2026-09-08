import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import net from "node:net";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";

// Provider-free integration test: the real SDK and OfficeDex initialization,
// with a small MODoc converted from the deterministic sales-report XLSX fixture.
test("Sheet SDK menus render and formatting/undo works without runtime errors", { timeout: 90_000 }, async () => {
  const repoRoot = fileURLToPath(new URL("../", import.meta.url));
  const content = await readFile(new URL("./fixtures/sheet-toolbar.modoc", import.meta.url), "utf8");
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const server = await createServer({ root: repoRoot, server: { host: "127.0.0.1", port, strictPort: true, open: false, hmr: false, watch: { ignored: ["**/test-results/**"] } } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.stack));
    await page.route("**/__sheet_toolbar_test", (route) => route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><body style="margin:0"><div id="editor" style="width:100vw;height:100vh"></div></body></html>',
    }));
    await page.goto(`http://127.0.0.1:${port}/__sheet_toolbar_test`);
    await page.evaluate(async (modoc) => {
      const { createOfflineSheetEditor } = await import("/src/renderer/spreadsheet/sheetSdk.ts");
      window.editor = await createOfflineSheetEditor(document.querySelector("#editor"), modoc);
    }, content);
    const toolbar = page.locator(".s-new-toolbar");
    await expect(toolbar).toBeVisible();
    for (const name of ["开始", "插入", "页面", "公式", "数据", "审阅", "视图", "帮助"]) {
      await expect(toolbar.getByRole("tab", { name, exact: true })).toBeVisible();
    }
    await toolbar.getByRole("tab", { name: "插入", exact: true }).click();
    await expect(toolbar.getByRole("tab", { name: "插入", exact: true })).toHaveAttribute("aria-selected", "true");
    await toolbar.getByRole("tab", { name: "开始", exact: true }).click();
    await page.mouse.click(126, 207);
    // Inspect the rendered cell style: this SDK version omits bold from getCellData().
    const isBold = () => page.evaluate(() => /\bbold\b/.test(window.editor.__editor.spread.coreBook.sheets[0].getStyle(1, 1)?.font ?? ""));
    const before = await isBold();
    await toolbar.getByRole('button', { name: '加粗', exact: true }).click();
    await expect.poll(isBold).toBe(!before);
    await toolbar.getByRole('button', { name: '撤销', exact: true }).click();
    await expect.poll(isBold).toBe(before);
    // Match the narrower canvas beside the AI assistant, then check resize/reflow.
    await page.setViewportSize({ width: 960, height: 760 });
    await expect(toolbar.getByRole("tab", { name: "开始", exact: true })).toBeVisible();
    assert.deepEqual(errors, []);
    const output = new URL("../test-results/sheet-toolbar/", import.meta.url);
    await mkdir(output, { recursive: true });
    await page.screenshot({ path: fileURLToPath(new URL("restored.png", output)) });
    await page.evaluate(() => window.editor.destroy());
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});
