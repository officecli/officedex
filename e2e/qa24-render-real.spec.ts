import { test, expect } from '@playwright/test';
import path from 'node:path';
import { openShell, queueFileDialog, openFromDisk } from './support/real-e2e';
// Exercise the exact adapter staged into both native component bundles.
// @ts-expect-error build script is intentionally shared with browser evidence
import { installEmbeddedFrameClock } from '../scripts/embedded-frame-clock.mjs';
for (const suspended of [false, true]) for (const [name, file, selector, surface, text] of [
  ['PPT', 'known-good.pptx', 'iframe.pptx-embed-frame', '.ppt-slide-surface', 'Shortcut save body.'],
  ['Word', 'OD24-local.docx', 'iframe.writer-embed-frame', '.writer-document-preview__render-surface', 'Local text before save.'],
]) test(`N24-01 ${name} main canvas paints with ${suspended ? 'suspended' : 'normal'} native frames`, async ({page}, info) => {
  if (suspended) await page.addInitScript({content: `if(window !== window.top) {
    window.requestAnimationFrame = () => 999; window.cancelAnimationFrame = () => {};
    (${installEmbeddedFrameClock.toString()})(window);
  }`});
  const failedFonts: string[] = [];
  let binaryFonts = 0;
  page.on('response', response => {
    if (response.url().includes('/writer-next-default-fonts/')) {
      if (response.status() >= 400) failedFonts.push(`${response.status()} ${response.url()}`);
      if (response.url().endsWith('.bin') && response.ok()) binaryFonts++;
    }
  });
  await openShell(page);
  await queueFileDialog(path.resolve('e2e/fixtures/qa24', file));
  await openFromDisk(page);
  await expect(page.locator(selector)).toBeVisible();
  const frame = page.frameLocator(selector);
  // Thumbnail text alone was the false positive in N24-01. Require text in a
  // rendered main surface with document-sized dimensions and capture its pixels.
  const assertPainted = () => expect.poll(async () => frame.locator(surface).evaluateAll((nodes, expected) => nodes.some(node => {
    const rect = node.getBoundingClientRect();
    return rect.width > 300 && rect.height > 250 && node.textContent?.includes(expected);
  }), text).catch(() => false), { timeout: 30_000 }).toBe(true);
  await assertPainted();
  await page.setViewportSize({width: 1100, height: 760});
  await assertPainted();
  const other = name === 'Word' ? 'known-good.pptx' : 'OD24-local.docx';
  await queueFileDialog(path.resolve('e2e/fixtures/qa24', other));
  await openFromDisk(page);
  await expect(page.getByRole('tab', {name: path.parse(other).name, exact: true})).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', {name: path.parse(file).name, exact: true}).click();
  await assertPainted();
  await page.getByRole('button', {name: `Close ${file}`, exact: true}).click();
  await queueFileDialog(path.resolve('e2e/fixtures/qa24', file));
  await openFromDisk(page);
  await assertPainted();
  expect(failedFonts).toEqual([]);
  if (name === 'Word') expect(binaryFonts).toBeGreaterThan(0);
  await page.screenshot({path:info.outputPath('main-canvas.png')});
});
