/**
 * S7 probe 2 — the parts of the settings surfaces that need a second page load
 * or a comparison across the portal boundary.
 *
 * Split from ui-audit-s7.spec.ts only so the first file stays readable; same
 * fixture, same read-only rules.
 */

import { expect, test } from "@playwright/test";

import { capture, open } from "./ui-audit-helpers";

const SESSION = { session: "S7" };

test.describe("S7 settings — token bridge and dialog behaviour", () => {
  test("compares the same design tokens inside and outside #shell", async ({ page }) => {
    await open(page, "C2", SESSION);

    await page.locator(".shell-cx-model").click();
    await expect(page.locator('.shell-menu[role="menu"]')).toBeVisible();
    await page
      .locator('.shell-menu[role="menu"] .shell-menu-item', { hasText: /Add model|Replace custom model/ })
      .click();
    await expect(page.locator(".od-dialog")).toBeVisible();

    const tokens = await page.evaluate(() => {
      const names = [
        "--od-ink",
        "--od-ink-medium",
        "--od-surface",
        "--od-border-subtle",
        "--od-accent",
        "--od-radius-control",
        "--od-radius-dialog",
        "--od-control-md",
        "--od-font-ui",
      ];
      const read = (node: Element | null) => {
        if (!node) return null;
        const style = getComputedStyle(node);
        return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name).trim()]));
      };
      return {
        insideShell: read(document.querySelector("#shell")),
        // The Modal portals to document.body, so it never sees the #shell
        // bridge block in tokens.css — this is the measurement that proves it.
        insideDialog: read(document.querySelector(".od-dialog")),
        dialogParentId: document.querySelector(".od-dialog-mask")?.parentElement?.id ?? "(body)",
        dialogIsInsideShell: !!document.querySelector("#shell .od-dialog"),
        // What the shell says a control should look like, for the diff.
        shellRadii: (() => {
          const shell = document.querySelector("#shell");
          if (!shell) return null;
          const style = getComputedStyle(shell);
          return {
            "--shell-radius-item": style.getPropertyValue("--shell-radius-item").trim(),
            "--shell-radius-card": style.getPropertyValue("--shell-radius-card").trim(),
            "--shell-radius-control": style.getPropertyValue("--shell-radius-control").trim(),
            "--shell-font": style.getPropertyValue("--shell-font").trim(),
            "--shell-row-h": style.getPropertyValue("--shell-row-h").trim(),
          };
        })(),
      };
    });

    // Keyboard contract: the shell's own Menu returns focus to its trigger on
    // Escape (Menu.tsx close(true)). Does the legacy Modal?
    const escape = await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      return null;
    });
    await page.keyboard.press("Escape");
    const afterEscape = await page.evaluate(() => ({
      dialogStillOpen: !!document.querySelector(".od-dialog"),
      activeElement: document.activeElement?.tagName + "." + (document.activeElement?.className || ""),
    }));

    // Focus containment: tab out of the last field and see where focus lands.
    const focusOrder: string[] = [];
    if (afterEscape.dialogStillOpen) {
      await page.locator("#shell-model-name").focus();
      for (let step = 0; step < 9; step += 1) {
        await page.keyboard.press("Tab");
        focusOrder.push(
          await page.evaluate(() => {
            const node = document.activeElement as HTMLElement | null;
            if (!node) return "(none)";
            const inDialog = !!node.closest(".od-dialog");
            return `${node.id || node.className || node.tagName}${inDialog ? "" : "  <-- OUTSIDE DIALOG"}`;
          }),
        );
      }
      await capture(page, "C2", "S7-dialog-focus", SESSION);
    }

    console.log("S7-TOKEN-BRIDGE " + JSON.stringify({ tokens, escape, afterEscape, focusOrder }, null, 2));
  });

  test("reports what the shell offers versus what the dialog uses", async ({ page }) => {
    await open(page, "C2", SESSION);

    // The shell's own menus are the in-house control language; the dialog's
    // native <select> is the thing being compared against them.
    await page.locator(".shell-cx-model").click();
    await expect(page.locator('.shell-menu[role="menu"]')).toBeVisible();
    const shellMenu = await page.evaluate(() => {
      const node = document.querySelector('.shell-menu[role="menu"]');
      if (!node) return null;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return {
        width: Math.round(rect.width),
        borderRadius: style.borderRadius,
        borderColor: style.borderColor,
        background: style.backgroundColor,
        boxShadow: style.boxShadow,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
      };
    });
    const shellMenuItem = await page.evaluate(() => {
      const node = document.querySelector(".shell-menu-item");
      if (!node) return null;
      const style = getComputedStyle(node);
      return {
        minHeight: style.minHeight,
        height: Math.round(node.getBoundingClientRect().height),
        borderRadius: style.borderRadius,
        fontSize: style.fontSize,
      };
    });
    await page
      .locator('.shell-menu[role="menu"] .shell-menu-item', { hasText: /Add model|Replace custom model/ })
      .click();
    await expect(page.locator(".od-dialog")).toBeVisible();
    const nativeSelect = await page.evaluate(() => {
      const node = document.querySelector("#shell-model-provider");
      if (!node) return null;
      const style = getComputedStyle(node);
      return {
        tagName: node.tagName,
        appearance: style.appearance,
        borderRadius: style.borderRadius,
        height: style.height,
        fontSize: style.fontSize,
        // A native select renders its list with the OS, so nothing about the
        // shell's menu styling can reach it.
        optionCount: (node as HTMLSelectElement).options.length,
      };
    });

    console.log("S7-CONTROL-LANGUAGE " + JSON.stringify({ shellMenu, shellMenuItem, nativeSelect }, null, 2));
  });
});
