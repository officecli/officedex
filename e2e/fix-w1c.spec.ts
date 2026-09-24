/**
 * Regression cover for Wave 1 track C — the `renderer/ui` overlays and the
 * `--od-*` token bridge (docs/ui-audit-2026-09-19/fixes/W1-C.md).
 *
 * Every assertion here failed before the fix. There is deliberately no
 * `test.skip` in this file: it runs against the fixture server, which needs no
 * bridge and no workspace, so a skipped case here could only ever be a case
 * that was quietly not run.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3123 npx playwright test e2e/fix-w1c.spec.ts
 */

import { expect, test, type Page } from "@playwright/test";

/** The bridge's own values, read off src/shell/tokens.css. */
const BRIDGE = {
  radiusDialog: "10px",   // --shell-radius-card; the library default is 8px
  radiusControl: "5px",   // library default 4px
  controlMd: "36px",      // --shell-row-h; library default 32px
  primaryBg: "#41464b",   // library default #000000
  guidance: "#596f86",    // library default #5da4e3, a blue the shell has not got
  surfaceMuted: "#f5f6f8",
  borderSubtle: "#e4e6e9",
} as const;

async function open(page: Page, combination: string): Promise<void> {
  await page.goto(`/?shellFixture=1&shell=${combination}`);
  await expect(page.locator("#shell")).toHaveAttribute("data-loaded", "true");
}

/** C2 = Agent home with the sidebar expanded, where the folder tree lives. */
async function openNewFolderDialog(page: Page) {
  await open(page, "C2");
  const trigger = page.getByRole("button", { name: "New folder" });
  await trigger.click();
  await expect(page.locator(".od-dialog")).toBeVisible();
  return trigger;
}

function tokens(page: Page, selector: string) {
  return page.evaluate((target) => {
    const element = document.querySelector(target);
    if (!element) throw new Error(`no element for ${target}`);
    const style = getComputedStyle(element);
    const read = (name: string) => style.getPropertyValue(name).trim();
    return {
      radiusDialog: read("--od-radius-dialog"),
      radiusControl: read("--od-radius-control"),
      controlMd: read("--od-control-md"),
      primaryBg: read("--od-button-primary-bg"),
      guidance: read("--od-guidance"),
      surfaceMuted: read("--od-surface-muted"),
      borderSubtle: read("--od-border-subtle"),
      fontFamily: style.fontFamily,
    };
  }, selector);
}

test.describe("W1-C overlays and the token bridge", () => {
  test("the dialog mounts inside #shell and reads the bridged tokens", async ({ page }) => {
    await openNewFolderDialog(page);

    const inside = await page.evaluate(() => ({
      insideShell: document.querySelector("#shell .od-dialog") !== null,
      maskParentClass: document.querySelector(".od-dialog-mask")?.parentElement?.className ?? "",
      maskOnBody: document.querySelector("body > .od-dialog-mask") !== null,
    }));
    expect(inside.insideShell).toBe(true);
    expect(inside.maskOnBody).toBe(false);
    expect(inside.maskParentClass).toBe("od-overlay-layer");

    const dialog = await tokens(page, ".od-dialog");
    expect(dialog.radiusDialog).toBe(BRIDGE.radiusDialog);
    expect(dialog.radiusControl).toBe(BRIDGE.radiusControl);
    expect(dialog.controlMd).toBe(BRIDGE.controlMd);
    expect(dialog.primaryBg).toBe(BRIDGE.primaryBg);
    expect(dialog.guidance).toBe(BRIDGE.guidance);
    expect(dialog.surfaceMuted).toBe(BRIDGE.surfaceMuted);
    expect(dialog.borderSubtle).toBe(BRIDGE.borderSubtle);
    // The panel used to inherit `Times` from a bare <body>.
    expect(dialog.fontFamily).toContain("PingFang SC");

    // `document.body` still holds the library defaults — this is the value the
    // portal used to pick up, so the pair is the before/after in one run.
    const body = await tokens(page, "body");
    expect(body.radiusDialog).toBe("8px");
    expect(body.controlMd).toBe("32px");
    expect(body.primaryBg).toBe("#000000");
    expect(body.guidance).toBe("#5da4e3");

    // The visible consequence: one primary-button colour per window.
    const paint = await page.evaluate(() => {
      const button = document.querySelector<HTMLElement>(".od-dialog .od-button[data-variant='primary']")
        ?? document.querySelector<HTMLElement>(".od-dialog .od-button:last-of-type");
      const panel = document.querySelector<HTMLElement>(".od-dialog")!;
      return {
        buttonBg: button ? getComputedStyle(button).backgroundColor : "",
        dialogRadius: getComputedStyle(panel).borderTopLeftRadius,
      };
    });
    expect(paint.buttonBg).toBe("rgb(65, 70, 75)");
    expect(paint.dialogRadius).toBe("10px");
  });

  test("Escape closes the dialog and hands focus back to the trigger", async ({ page }) => {
    const trigger = await openNewFolderDialog(page);

    await page.keyboard.press("Escape");

    await expect(page.locator(".od-dialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("Tab cannot leave the dialog", async ({ page }) => {
    await openNewFolderDialog(page);

    // Eight presses: before the fix the fourth left the dialog and the fifth
    // landed on the button that closes the application window.
    const trail: string[] = [];
    for (let press = 0; press < 8; press += 1) {
      await page.keyboard.press("Tab");
      const where = await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        return {
          inDialog: active?.closest(".od-dialog") !== null && active?.closest(".od-dialog") !== undefined,
          label: active ? `${active.tagName}.${active.className || "(none)"}` : "null",
        };
      });
      trail.push(where.label);
      expect(where.inDialog, `press ${press + 1} landed on ${where.label}; trail: ${trail.join(" → ")}`).toBe(true);
    }
  });

  test("clicking the mask closes the dialog", async ({ page }) => {
    await openNewFolderDialog(page);

    await page.locator(".od-dialog-mask").click({ position: { x: 6, y: 6 } });

    await expect(page.locator(".od-dialog")).toHaveCount(0);
  });

  test("the dialog's text fields take the row instead of the UA's 173px", async ({ page }) => {
    await openNewFolderDialog(page);

    const widths = await page.evaluate(() => {
      const content = document.querySelector<HTMLElement>(".od-dialog__content")!;
      const input = document.querySelector<HTMLElement>(".od-dialog .od-input")!;
      const style = getComputedStyle(input);
      return {
        content: content.getBoundingClientRect().width,
        input: input.getBoundingClientRect().width,
        height: style.height,
        fontSize: style.fontSize,
      };
    });
    expect(widths.input).toBeGreaterThan(widths.content - 1);
    // 13.333px was the UA default showing through; 36px is the bridged control.
    expect(widths.fontSize).toBe("14px");
    expect(widths.height).toBe("36px");
  });

  test("the Select's option rows are menu rows, not raw UA buttons", async ({ page }) => {
    // C4 = editor home with the sidebar expanded; both Selects live in its head.
    await open(page, "C4");
    await page.getByRole("button", { name: "Group by" }).click();

    const row = await page.evaluate(() => {
      const option = document.querySelector<HTMLElement>(".od-menu [role='menuitemradio']");
      if (!option) throw new Error("the Select did not open a menu");
      const style = getComputedStyle(option);
      return {
        className: option.className,
        borderStyle: style.borderTopStyle,
        borderWidth: style.borderTopWidth,
        textAlign: style.textAlign,
        minHeight: style.minHeight,
        fontFamily: style.fontFamily,
      };
    });
    expect(row.className).toContain("od-menu__item");
    expect(row.borderStyle).not.toBe("outset");
    expect(row.borderWidth).toBe("0px");
    expect(row.textAlign).toBe("left");
    expect(row.minHeight).toBe("32px");
    expect(row.fontFamily).toContain("PingFang SC");

    // Moving the portal inside `#shell` must not move the panel: these overlays
    // are `position: fixed`, which only holds while no ancestor is a containing
    // block for them (a transform, a filter, `contain`).
    const placement = await page.evaluate(() => {
      const anchor = document.querySelector<HTMLElement>(".od-select")!.getBoundingClientRect();
      const panel = document.querySelector<HTMLElement>(".od-popover")!.getBoundingClientRect();
      return { gap: panel.top - anchor.bottom, drift: panel.left - anchor.left };
    });
    expect(placement.gap).toBeCloseTo(8, 0);
    expect(Math.abs(placement.drift)).toBeLessThan(1);
  });

  test("a notification leaves every file tab clickable", async ({ page }) => {
    // C7 = editor mode with a floating agent panel: seven tabs on the top strip.
    await open(page, "C7");
    await expect(page.locator(".shell-tab")).not.toHaveCount(0);

    /** Which element wins the centre of each tab, and the strip's own box. */
    const hits = () => page.evaluate(() => ({
      strip: document.querySelector<HTMLElement>(".shell-tabstrip")!.getBoundingClientRect().bottom,
      tabs: Array.from(document.querySelectorAll<HTMLElement>(".shell-tab")).map((tab) => {
        const rect = tab.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return {
          name: tab.textContent?.trim().slice(0, 20) ?? "",
          hit: hit ? `${hit.tagName}.${hit.className}` : "null",
          inToast: hit !== null && hit.closest(".od-toast-host") !== null,
        };
      }),
    }));

    const before = await hits();

    /*
     * A toast, raised without covering the frame.
     *
     * This used to open the sidebar footer's settings menu and dispatch a click
     * on its "Review changes" row. That menu is gone — the gear opens the
     * settings page now — and the page is a full-window cover, so raising the
     * toast from there would put it between this test and every tab centre it
     * is about to hit-test. The composer's permission menu carries the shell's
     * other `notBuiltYet` row and opens over the frame instead of replacing it.
     */
    await page.locator(".shell-cx-permission").click();
    await page.locator(".shell-menu").waitFor();
    await page.getByRole("menuitemradio", { name: /Review changes/ }).click();
    await expect(page.locator(".od-toast")).toBeVisible();

    const after = await hits();
    expect(after.tabs.length).toBeGreaterThan(0);

    // The claim: a notification intercepts nothing. Three of seven tab centres
    // used to return `div.od-toast`, which is `pointer-events: auto`.
    for (const tab of after.tabs) {
      expect(tab.inToast, `"${tab.name}" centre hit ${tab.hit}`).toBe(false);
    }
    // And it changes nothing: whatever owned each centre before the toast still
    // owns it. (`shell-save-state` wins one centre in both maps — the tab strip
    // overflows its own actions area, which is W2-F's, not this track's.)
    expect(after.tabs.map((tab) => tab.hit)).toEqual(before.tabs.map((tab) => tab.hit));

    // Geometry, independent of hit testing: the host now opens below the strip.
    const host = await page.locator(".od-toast-host").boundingBox();
    expect(host).not.toBeNull();
    expect(host!.y).toBeGreaterThanOrEqual(after.strip);
  });
});
