/**
 * S7 probe 3 — is Reduced motion dead, or only stale?
 *
 * The first probe showed the carousel still animating after the switch was
 * turned on. That has two possible causes with very different fixes: the wire
 * is not connected at all, or every `useComposerSettings()` holds its own copy
 * of the value and only the sidebar's copy was updated. This tells them apart
 * by remounting Agent Home (mode → editor → agent) without reloading the page,
 * so the fake port keeps the patched value but Highlights re-reads it.
 */

import { expect, test } from "@playwright/test";

import { capture, open } from "./ui-audit-helpers";

const SESSION = { session: "S7" };

/** Presses the carousel's Next and reports whether it jumped or animated. */
const CAROUSEL_PROBE = async () => {
  const track = document.querySelector(".shell-highlights-track") as HTMLElement | null;
  const next = document.querySelector('[aria-label="Next highlight videos"]') as HTMLButtonElement | null;
  if (!track || !next) return null;
  track.scrollLeft = 0;
  // The arrow disables itself from a scroll event, so resetting the track and
  // clicking in the same tick can hit a button React still thinks is at the end.
  await new Promise((resolve) => setTimeout(resolve, 120));
  next.click();
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  await frame();
  await frame();
  const twoFrames = track.scrollLeft;
  await new Promise((resolve) => setTimeout(resolve, 900));
  const settled = track.scrollLeft;
  return { twoFrames, settled, instant: settled > 0 && twoFrames === settled };
};

test("tells a dead Reduced motion wire apart from a stale one", async ({ page }) => {
  await open(page, "C2", SESSION);

  const baseline = await page.evaluate(CAROUSEL_PROBE);

  /*
   * Turn it on from the settings page, which is the only place it lives. The
   * page is a full-window cover, so it is closed again before the mode switches
   * below — those click `.shell-brand`, which the cover would intercept. The
   * carousel probe itself is script-driven and reads the same either way.
   */
  await page.locator('.shell-sidebar-footer button[aria-label="Settings"]').click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByRole("switch", { name: "Reduced motion" }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".shell-settings")).toHaveCount(0);

  const sameMount = await page.evaluate(CAROUSEL_PROBE);

  // Remount Agent Home without reloading: the fake port keeps the patched
  // settings, but every hook inside Home re-runs its initial read.
  await page.locator(".shell-brand").click();
  await page.locator('.shell-menu[role="menu"] .shell-menu-item', { hasText: /Editor/i }).click();
  await expect(page.locator("#shell")).toHaveAttribute("data-mode", "editor");
  await page.locator(".shell-brand").click();
  await page.locator('.shell-menu[role="menu"] .shell-menu-item', { hasText: /Agent/i }).click();
  await expect(page.locator("#shell")).toHaveAttribute("data-mode", "agent");
  await expect(page.locator(".shell-highlights-track")).toBeVisible();

  const afterRemount = await page.evaluate(CAROUSEL_PROBE);

  // And what the control itself now holds, so the report can name the stale side.
  await page.locator('.shell-sidebar-footer button[aria-label="Settings"]').click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  const motionRow = {
    label: "Reduced motion",
    checked: await page.getByRole("switch", { name: "Reduced motion" }).getAttribute("aria-checked"),
  };
  await capture(page, "C2", "S7-motion-after-remount", SESSION);
  await page.keyboard.press("Escape");

  console.log(
    "S7-MOTION-STALENESS " + JSON.stringify({ baseline, sameMount, afterRemount, motionRow }, null, 2),
  );
});
