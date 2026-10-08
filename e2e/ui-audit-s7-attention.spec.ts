/**
 * S7 probe 4 — which attention borders obey the Reduced motion switch.
 *
 * Two `AttentionBorder`s are mounted at once (Hero's and the workspace's) and
 * only one of them is handed the preference. This counts the hosts and watches
 * the one that is wired, so the report can say the mechanism works and the
 * second call site simply does not use it.
 */

import { expect, test } from "@playwright/test";

import { capture, open } from "./ui-audit-helpers";

const SESSION = { session: "S7" };

/** Samples the travelling light's transform over ~400ms. */
const LIGHT_PROBE = async () => {
  const hosts = Array.from(document.querySelectorAll(".shell-attention"));
  const svg = hosts
    .map((host) => host.querySelector("svg"))
    .find((node) => node && (node as SVGElement).style.display !== "none");
  if (!svg) return { hostCount: hosts.length, svgFound: false };
  const sample = () => (svg as SVGElement).innerHTML.length + "|" + ((svg as SVGElement).outerHTML.match(/-?\d+\.\d{2}/g) ?? []).slice(0, 12).join(",");
  const first = sample();
  await new Promise((resolve) => setTimeout(resolve, 400));
  const second = sample();
  return { hostCount: hosts.length, svgFound: true, moved: first !== second };
};

test("counts the attention borders and checks which one the switch reaches", async ({ page }) => {
  await open(page, "C2", SESSION);

  // Light Hero's border by focusing the composer.
  await page.locator(".shell-cx-input").click();
  await expect(page.locator(".shell-attention svg")).toHaveCount(2);
  const movingBefore = await page.evaluate(LIGHT_PROBE);

  /*
   * The switch is on the settings page, which is a full-window cover, so it is
   * closed again before the mode switches below touch `.shell-brand`.
   */
  await page.locator('.shell-sidebar-footer button[aria-label="Settings"]').click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByRole("switch", { name: "Reduced motion" }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".shell-settings")).toHaveCount(0);

  // Remount Home so Hero re-reads the setting (see ui-audit-s7-motion.spec.ts).
  await page.locator(".shell-brand").click();
  await page.locator('.shell-menu[role="menu"] .shell-menu-item', { hasText: /Editor/i }).click();
  await expect(page.locator("#shell")).toHaveAttribute("data-mode", "editor");
  await page.locator(".shell-brand").click();
  await page.locator('.shell-menu[role="menu"] .shell-menu-item', { hasText: /Agent/i }).click();
  await expect(page.locator("#shell")).toHaveAttribute("data-mode", "agent");
  await page.locator(".shell-cx-input").click();

  const movingAfter = await page.evaluate(LIGHT_PROBE);
  await capture(page, "C2", "S7-attention-reduced", SESSION);

  console.log("S7-ATTENTION " + JSON.stringify({ movingBefore, movingAfter }, null, 2));
});
