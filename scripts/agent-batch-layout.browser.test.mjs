import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

test('batch failures remain readable in a 320px Chat pane', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 650 } });
    const css = await Promise.all(['src/shell/tokens.css', 'src/shell/app.css', 'src/shell/styles/workspace-v12.css'].map(path => readFile(path, 'utf8')));
    await page.setContent(`<style>${css.join('\n')}</style><div id="shell" class="shell"><div id="dx-workspace" style="display:block;width:320px;padding:12px"><article class="dx-task-card dx-agent-run"><div class="dx-agent-results"><div class="dx-agent-result dx-agent-batch-result"><span><strong>OD21-corrupt-very-long-filename.docx</strong><small>Failed</small><small>This file could not be read. Check that it is a valid Word document and try again.</small></span><button class="dx-btn">Retry remaining</button></div></div></article></div></div>`);
    const metrics = await page.locator('.dx-agent-batch-result > span').evaluate(el => ({ textWidth: el.getBoundingClientRect().width, textHeight: el.getBoundingClientRect().height, rowWidth: el.parentElement.getBoundingClientRect().width, overflow: el.scrollWidth > el.clientWidth }));
    assert.ok(metrics.textWidth >= 200, JSON.stringify(metrics));
    assert.ok(metrics.textHeight < 200, JSON.stringify(metrics));
    assert.ok(metrics.rowWidth <= 296, JSON.stringify(metrics));
    assert.equal(metrics.overflow, false);
    if (process.env.OFFICEDEX_BATCH_LAYOUT_SCREENSHOT) await page.screenshot({ path: process.env.OFFICEDEX_BATCH_LAYOUT_SCREENSHOT });
  } finally { await browser.close(); }
});
