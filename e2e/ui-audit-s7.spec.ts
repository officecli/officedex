/**
 * S7 — settings & preference consistency (docs/ui-audit-2026-09-19/PLAN.md §2.1).
 *
 * When this spec was written the shell had **no settings page**: preferences
 * were scattered over three menus, two of which offered the same switch under
 * two different names, and the legacy renderer's 2130-line page was reachable
 * only by typing `legacy.html` — which a packaged WKWebView has no address bar
 * for. Every number in `S7/findings.md` came from here.
 *
 * The gear now opens a settings page, so this measures the surface that
 * replaced the footer dropdown: the page's sections, whether it fits on screen
 * in the shells the old panel was clipped in, whether one preference reads the
 * same in both of the two places it can still be changed, and whether changing
 * it reaches the thing that animates. The two composer menus and the
 * custom-model dialog are untouched, and are measured the same way as before.
 *
 * Read-only against the fixture server on 3100. Nothing here writes to a real
 * workspace; the fake port keeps its settings in memory for the page's life.
 */

import { expect, test, type Page } from "@playwright/test";

import { capture, open, type Combination } from "./ui-audit-helpers";

const SESSION = { session: "S7" };

/** Rect + the first ancestor that actually clips it, without failing the test. */
async function measure(page: import("@playwright/test").Page, selector: string) {
  return page.evaluate((target: string) => {
    const element = document.querySelector(target);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    let clippedBy: string | null = null;
    for (let node = element.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.overflow === "visible" && style.overflowX === "visible" && style.overflowY === "visible")
        continue;
      const bounds = node.getBoundingClientRect();
      if (
        rect.left < bounds.left - 0.5 ||
        rect.top < bounds.top - 0.5 ||
        rect.right > bounds.right + 0.5 ||
        rect.bottom > bounds.bottom + 0.5
      ) {
        clippedBy = node.className || node.tagName.toLowerCase();
        break;
      }
    }
    return {
      rect: {
        left: Math.round(rect.left * 10) / 10,
        top: Math.round(rect.top * 10) / 10,
        right: Math.round(rect.right * 10) / 10,
        bottom: Math.round(rect.bottom * 10) / 10,
        width: Math.round(rect.width * 10) / 10,
        height: Math.round(rect.height * 10) / 10,
      },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      offViewport:
        rect.left < 0 || rect.top < 0 || rect.right > window.innerWidth || rect.bottom > window.innerHeight,
      clippedBy,
    };
  }, selector);
}

/** The sidebar footer's gear, and the page it opens. */
async function openSettingsPage(page: Page) {
  await page.locator('.shell-sidebar-footer button[aria-label="Settings"]').click();
  await expect(page.locator(".shell-settings")).toBeVisible();
}

/** The page's section nav, with the current section marked. */
async function settingsSections(page: Page) {
  return page.$$eval(".shell-settings-nav-item", (nodes) =>
    nodes.map((node) => ({
      label: node.querySelector(".shell-settings-nav-label")?.textContent?.trim() ?? "",
      current: node.getAttribute("aria-current"),
    })),
  );
}

/** Opens one section of the page by its nav label. */
async function openSection(page: Page, label: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await expect(page.locator(".shell-settings-group-title")).toHaveText(label);
}

/** Every row of an open menu, with its label, sub-label and tick state. */
async function menuRows(page: Page) {
  return page.$$eval('.shell-menu[role="menu"] .shell-menu-item', (nodes) =>
    nodes.map((node) => ({
      label: node.querySelector(".shell-menu-label")?.childNodes[0]?.textContent?.trim() ?? "",
      description: node.querySelector(".shell-menu-label small")?.textContent?.trim() ?? "",
      role: node.getAttribute("role"),
      checked: node.getAttribute("aria-checked"),
    })),
  );
}

test.describe("S7 settings & preferences", () => {
  /* ------------------------------------------- 1. the settings surface itself */

  test("inventories the settings page and the two preference menus", async ({ page }) => {
    await open(page, "C2", SESSION);

    await openSettingsPage(page);
    const sections = await settingsSections(page);
    const pageBox = await measure(page, ".shell-settings");
    const saveState = await page.locator(".shell-settings-save").textContent();
    await capture(page, "C2", "S7-settings-page", SESSION);
    await page.keyboard.press("Escape");

    await page.locator(".shell-cx-permission").click();
    await expect(page.locator('.shell-menu[role="menu"]')).toBeVisible();
    const permission = await menuRows(page);
    await capture(page, "C2", "S7-composer-menu", SESSION);
    await page.keyboard.press("Escape");

    await page.locator(".shell-cx-model").click();
    await expect(page.locator('.shell-menu[role="menu"]')).toBeVisible();
    const model = await menuRows(page);
    await capture(page, "C2", "S7-model-menu", SESSION);
    await page.keyboard.press("Escape");

    console.log(
      "S7-INVENTORY " + JSON.stringify({ sections, pageBox, saveState, permission, model }, null, 2),
    );
  });

  /* ------------------------------- 2. the collapsed rail (C1 is the default) */

  test("measures the settings page on every home combination", async ({ page }) => {
    const results: Record<string, unknown> = {};

    for (const combination of ["C1", "C2", "C3", "C4"] as Combination[]) {
      await open(page, combination, SESSION);
      const rail = await measure(page, "#shell-sidebar");
      const trigger = await measure(page, '.shell-sidebar-footer button[aria-label="Settings"]');
      await openSettingsPage(page);
      const panel = await measure(page, ".shell-settings");
      /*
       * The nav labels are what the user is actually trying to read; a panel
       * that fits while its text does not is still a defect. This is the
       * question the old 250px dropdown failed at 15.8% visible.
       */
      const navOverflow = await page.$$eval(".shell-settings-nav-label", (nodes) =>
        nodes.map((node) => ({
          label: node.textContent?.trim() ?? "",
          scrollWidth: node.scrollWidth,
          clientWidth: node.clientWidth,
        })),
      );
      await capture(page, combination, "S7-settings-page-open", SESSION);
      results[combination] = { rail, trigger, panel, navOverflow };
      await page.keyboard.press("Escape");
    }

    console.log("S7-SETTINGS-PAGE " + JSON.stringify(results, null, 2));
  });

  /* --------------------------- 3. does one setting read the same in both places */

  test("checks whether Enter sends stays in step between the page and the composer menu", async ({ page }) => {
    await open(page, "C2", SESSION);

    /*
     * The two entry points are the settings page's Appearance switch and the
     * composer's permission menu. S7-002 was these two disagreeing inside one
     * page view; the shared store in `composer/settingsStore.ts` is what fixed
     * it, and this is the same question asked of the new surface.
     */
    await openSettingsPage(page);
    await openSection(page, "Appearance");
    const enterSwitch = page.getByRole("switch", { name: "Enter sends" });
    const pageBefore = await enterSwitch.getAttribute("aria-checked");
    await page.keyboard.press("Escape");

    // Flip it from the composer's copy of the switch.
    await page.locator(".shell-cx-permission").click();
    await expect(page.locator('.shell-menu[role="menu"]')).toBeVisible();
    const composerBefore = (await menuRows(page)).find((row) => /Enter/.test(row.label));
    await page.locator('.shell-menu[role="menu"] .shell-menu-item', { hasText: "Enter sends" }).click();

    // Re-read both, in the same page, without a reload.
    await page.locator(".shell-cx-permission").click();
    await expect(page.locator('.shell-menu[role="menu"]')).toBeVisible();
    const composerAfter = (await menuRows(page)).find((row) => /Enter/.test(row.label));
    await page.keyboard.press("Escape");

    await openSettingsPage(page);
    await openSection(page, "Appearance");
    const pageAfter = await page.getByRole("switch", { name: "Enter sends" }).getAttribute("aria-checked");
    await capture(page, "C2", "S7-enter-sync", SESSION);
    await page.keyboard.press("Escape");

    console.log(
      "S7-ENTER-SYNC " + JSON.stringify({ pageBefore, composerBefore, composerAfter, pageAfter }, null, 2),
    );
  });

  /* --------------------------------------------- 4. the custom model dialog */

  test("audits CustomModelDialog against the shell's own visual language", async ({ page }) => {
    await open(page, "C2", SESSION);

    await page.locator(".shell-cx-model").click();
    await expect(page.locator('.shell-menu[role="menu"]')).toBeVisible();
    await page.locator('.shell-menu[role="menu"] .shell-menu-item', { hasText: /Add model|Replace custom model/ }).click();
    await expect(page.locator(".od-dialog")).toBeVisible();
    await capture(page, "C2", "S7-custom-model-dialog", SESSION);

    const metrics = await page.evaluate(() => {
      const read = (selector: string, props: string[]) => {
        const node = document.querySelector(selector);
        if (!node) return null;
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        const out: Record<string, string | number> = {
          width: Math.round(rect.width * 10) / 10,
          height: Math.round(rect.height * 10) / 10,
        };
        for (const prop of props) out[prop] = style.getPropertyValue(prop);
        return out;
      };
      const common = ["border-radius", "font-family", "font-size", "height", "padding", "border-color", "background-color"];
      const key = document.querySelector("#shell-model-key") as HTMLInputElement | null;
      return {
        dialog: read(".od-dialog", ["border-radius", "width", "padding", "font-family", "background-color"]),
        header: read(".od-dialog__header h2", ["font-family", "font-size", "font-weight"]),
        content: read(".od-dialog__content", ["font-family", "font-size", "line-height", "color"]),
        nameInput: read("#shell-model-name", common),
        modelIdInput: read("#shell-model-id", common),
        nativeSelect: read("#shell-model-provider", common),
        baseUrlInput: read("#shell-model-base", common),
        apiKeyInput: read("#shell-model-key", common),
        okButton: read(".od-dialog__footer .od-button[data-type='primary'], .od-dialog__footer button:last-child", [
          "border-radius",
          "font-family",
          "font-size",
          "background-color",
          "height",
        ]),
        shellButtonForComparison: read(".shell-cx-send", ["border-radius", "font-family", "background-color", "height"]),
        shellMenuForComparison: null,
        // Is the key masked, and does its value leak into an attribute the DOM
        // (and therefore any screenshot / a11y dump / devtools copy) exposes?
        apiKey: key
          ? {
              type: key.type,
              hasValueAttribute: key.hasAttribute("value"),
              valueAttribute: key.getAttribute("value"),
              autocomplete: key.getAttribute("autocomplete"),
              spellcheck: key.getAttribute("spellcheck"),
            }
          : null,
        // How much of the dialog body is empty: the user-reported symptom.
        bodyRect: (() => {
          const body = document.querySelector(".od-dialog__content");
          if (!body) return null;
          const r = body.getBoundingClientRect();
          return { width: Math.round(r.width), height: Math.round(r.height) };
        })(),
      };
    });

    // Type a key and re-read the attribute: React writes value as a property,
    // but a stray `value=` attribute would put the secret in the serialised DOM.
    await page.locator("#shell-model-key").fill("sk-audit-probe-123456");
    const afterTyping = await page.evaluate(() => {
      const key = document.querySelector("#shell-model-key") as HTMLInputElement | null;
      if (!key) return null;
      return {
        valueAttribute: key.getAttribute("value"),
        outerHTMLContainsSecret: key.outerHTML.includes("sk-audit-probe"),
        documentHTMLContainsSecret: document.documentElement.outerHTML.includes("sk-audit-probe"),
        renderedWidth: Math.round(key.getBoundingClientRect().width),
      };
    });
    await capture(page, "C2", "S7-custom-model-dialog-filled", SESSION);

    console.log("S7-MODEL-DIALOG " + JSON.stringify({ metrics, afterTyping }, null, 2));
  });

  /* ------------------------------------- 5. does the preference take effect */

  test("checks whether Reduced motion reaches the surfaces that animate", async ({ page }) => {
    await open(page, "C1", SESSION);

    const before = await page.evaluate(() => {
      const shell = document.querySelector("#shell");
      const track = document.querySelector(".shell-highlights-track");
      return {
        shellDataAttributes: shell
          ? Object.fromEntries(Array.from(shell.attributes).map((a) => [a.name, a.value]))
          : null,
        shellDuration: shell ? getComputedStyle(shell).getPropertyValue("--shell-duration").trim() : null,
        trackScrollBehavior: track ? getComputedStyle(track).scrollBehavior : null,
      };
    });

    /*
     * Flip it on the settings page. The page is a full-window cover, so it is
     * closed again before the carousel probe below — the probe clicks the
     * "next" button from script, but the sample it takes is only meaningful
     * with Home actually on screen.
     */
    await openSettingsPage(page);
    await openSection(page, "Appearance");
    const motionSwitch = page.getByRole("switch", { name: "Reduced motion" });
    const motionBefore = await motionSwitch.getAttribute("aria-checked");
    await motionSwitch.click();
    // Did the control the user just pressed change?
    const motionAfter = await page.getByRole("switch", { name: "Reduced motion" }).getAttribute("aria-checked");
    await page.keyboard.press("Escape");
    await expect(page.locator(".shell-settings")).toHaveCount(0);

    const after = await page.evaluate(() => {
      const shell = document.querySelector("#shell");
      const track = document.querySelector(".shell-highlights-track");
      return {
        shellDataAttributes: shell
          ? Object.fromEntries(Array.from(shell.attributes).map((a) => [a.name, a.value]))
          : null,
        shellDuration: shell ? getComputedStyle(shell).getPropertyValue("--shell-duration").trim() : null,
        trackScrollBehavior: track ? getComputedStyle(track).scrollBehavior : null,
      };
    });

    // The behavioural probe: Highlights passes `behavior` to scrollBy. "instant"
    // lands on the target in one frame; "smooth" takes many. Sampling scrollLeft
    // right after the press tells the two apart without reading the source.
    const carousel = await page.evaluate(async () => {
      const track = document.querySelector(".shell-highlights-track") as HTMLElement | null;
      const next = document.querySelector('[aria-label="Next highlight videos"]') as HTMLButtonElement | null;
      if (!track || !next) return null;
      track.scrollLeft = 0;
      const start = track.scrollLeft;
      next.click();
      const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
      await frame();
      await frame();
      const twoFrames = track.scrollLeft;
      await new Promise((resolve) => setTimeout(resolve, 900));
      const settled = track.scrollLeft;
      return { start, twoFrames, settled, jumpedImmediately: twoFrames === settled && settled > start };
    });

    await capture(page, "C1", "S7-reduced-motion-on", SESSION);

    // Same probe after a reload, where every hook re-reads the port. If the
    // carousel only obeys the setting here, the setting needs a restart.
    await open(page, "C1", SESSION);
    const carouselAfterReload = await page.evaluate(async () => {
      const track = document.querySelector(".shell-highlights-track") as HTMLElement | null;
      const next = document.querySelector('[aria-label="Next highlight videos"]') as HTMLButtonElement | null;
      if (!track || !next) return null;
      track.scrollLeft = 0;
      const start = track.scrollLeft;
      next.click();
      const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
      await frame();
      await frame();
      const twoFrames = track.scrollLeft;
      await new Promise((resolve) => setTimeout(resolve, 900));
      const settled = track.scrollLeft;
      return { start, twoFrames, settled, jumpedImmediately: twoFrames === settled && settled > start };
    });

    console.log(
      "S7-REDUCED-MOTION " +
        JSON.stringify(
          { before, motionBefore, motionAfter, after, carousel, carouselAfterReload },
          null,
          2,
        ),
    );
  });

  /* ------------------------------- 6. the fake switch and its stated wording */

  test("records what the composer's Review changes row does when pressed", async ({ page }) => {
    await open(page, "C2", SESSION);

    /*
     * The sidebar's copy of this row is gone: the dropdown it lived in was
     * replaced by the settings page, and a control that only ever says it is
     * not available has no business on a page whose job is the honest list of
     * what *can* be changed. The composer's permission menu is where the tier
     * belongs — it is one of three, and the other two are real — so this
     * measures that one.
     */
    await page.locator(".shell-cx-permission").click();
    await expect(page.locator('.shell-menu[role="menu"]')).toBeVisible();
    const rowsBefore = await menuRows(page);
    await page.locator('.shell-menu[role="menu"] .shell-menu-item', { hasText: "Review changes" }).click();

    // notBuiltYet goes through the legacy toast host, which is fixed to the top
    // of the viewport at z-index 1100 — S2's territory, recorded here because
    // this is the entry point that raises it.
    const toast = await page.evaluate(() => {
      const host = document.querySelector(".od-toast-host");
      if (!host) return null;
      const rect = host.getBoundingClientRect();
      const style = getComputedStyle(host);
      return {
        text: host.textContent?.trim() ?? "",
        rect: { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width) },
        position: style.position,
        zIndex: style.zIndex,
      };
    });
    await capture(page, "C2", "S7-review-changes-toast", SESSION);

    // And the state afterwards: a fake switch that also leaves a mark would be
    // worse than one that does nothing.
    await page.locator(".shell-cx-permission").click();
    await expect(page.locator('.shell-menu[role="menu"]')).toBeVisible();
    const rowsAfter = await menuRows(page);
    const permissionLabel = await page.locator(".shell-cx-permission-name").textContent();
    await page.keyboard.press("Escape");

    console.log(
      "S7-REVIEW-CHANGES " + JSON.stringify({ toast, rowsBefore, rowsAfter, permissionLabel }, null, 2),
    );
  });
});
