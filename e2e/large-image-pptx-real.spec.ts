import { test, expect } from '@playwright/test';
import path from 'node:path';
import { openShell, queueFileDialog, openFromDisk } from './support/real-e2e';

// A deck whose picture is larger than the document codec's 8 MiB string limit
// used to fail to open at all ("resource limit exceeded for string bytes"),
// because the host bridge inlined every asset as a data: URI. Such a deck is
// tens of megabytes, so it is not checked in: point
// OFFICEDEX_E2E_LARGE_IMAGE_PPTX at one (any PPTX with a picture over 6 MB).
const deck = process.env.OFFICEDEX_E2E_LARGE_IMAGE_PPTX?.trim();

test('a PPTX with a picture too large to inline still opens and paints', async ({ page }, info) => {
  test.skip(!deck, 'set OFFICEDEX_E2E_LARGE_IMAGE_PPTX to a deck with a picture over 6 MB');
  await openShell(page);
  await queueFileDialog(path.resolve(deck!));
  await openFromDisk(page);
  const selector = 'iframe.pptx-embed-frame';
  await expect(page.locator(selector)).toBeVisible();
  const frame = page.frameLocator(selector);
  await expect(page.getByText('resource limit exceeded')).toHaveCount(0);
  await expect(frame.getByText('resource limit exceeded')).toHaveCount(0);
  await expect.poll(async () => frame.locator('.ppt-slide-surface').evaluateAll(nodes => nodes.some(node => {
    const rect = node.getBoundingClientRect();
    return rect.width > 300 && rect.height > 250;
  })).catch(() => false), { timeout: 60_000 }).toBe(true);
  // The large picture must actually be delivered, not just tolerated.
  await expect.poll(async () => frame.locator('image, img').evaluateAll(nodes => nodes.some(node => {
    const href = node.getAttribute('href') || node.getAttribute('xlink:href') || node.getAttribute('src') || '';
    return href.startsWith('blob:');
  })).catch(() => false), { timeout: 30_000 }).toBe(true);
  await page.screenshot({ path: info.outputPath('large-image-deck.png') });
});
