import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { transformWithEsbuild } from "vite";
import { chromium } from "@playwright/test";

// No development server or native user document is needed. Real frame focus
// and keyboard dispatch exercise the browser boundary that jsdom can miss.
test("save shortcuts cross editor frame mount, navigation and nested-frame boundaries", async () => {
  const source = "src/shell/chrome/shortcutDocuments.ts";
  const compiled = await transformWithEsbuild(await readFile(source, "utf8"), source, { format: "iife", globalName: "shortcuts" });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<button id="shell">Shell</button><iframe id="editor" srcdoc="<div contenteditable=true>Title</div><textarea>Notes</textarea>"></iframe>');
    await page.addScriptTag({ content: compiled.code });
    await page.evaluate(() => {
      window.saves = 0;
      const save = event => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
          event.preventDefault(); event.stopPropagation(); window.saves += 1;
        }
      };
      // Reproduce the previous implementation before exercising the fix.
      window.addEventListener("keydown", save, true);
      window.removeOld = () => window.removeEventListener("keydown", save, true);
      window.saveHandler = save;
    });
    const editor = page.frameLocator("#editor");
    await editor.locator("div").click();
    await page.keyboard.press("Meta+s");
    assert.equal(await page.evaluate(() => window.saves), 0, "the parent-only listener misses iframe focus");
    await page.evaluate(() => { window.removeOld(); window.disposeShortcuts = shortcuts.listenToShortcutDocuments(window, window.saveHandler); });
    await editor.locator("div").click(); await page.keyboard.press("Meta+s");
    await editor.locator("textarea").click(); await page.keyboard.press("Control+s");
    await page.locator("#shell").click(); await page.keyboard.press("Meta+s");
    assert.equal(await page.evaluate(() => window.saves), 3);
    await page.evaluate(() => { document.querySelector("#editor").srcdoc = '<iframe id="nested" srcdoc="<textarea>Reloaded notes</textarea>"></iframe>'; });
    await editor.frameLocator("#nested").locator("textarea").click();
    await page.keyboard.press("Meta+s");
    assert.equal(await page.evaluate(() => window.saves), 4);
    await page.evaluate(() => window.disposeShortcuts());
    await page.keyboard.press("Meta+s");
    assert.equal(await page.evaluate(() => window.saves), 4, "teardown removes all bindings");
  } finally {
    await browser.close();
  }
});
