/**
 * Regression cover for Wave 1 track C — the `renderer/ui` overlays and the
 * `--od-*` token bridge (docs/ui-audit-2026-09-19/fixes/W1-C.md).
 *
 * Every assertion here failed before the fix. There is deliberately no
 * `test.skip` in this file: it runs against the fixture server, which needs no
 * bridge and no workspace, so a skipped case here could only ever be a case that
 * was quietly not run.
 *
 * **What r10 changed.** W1-C had two halves, and r10 kept one and moved the
 * other.
 *
 * The bridge is untouched: `renderer/ui/overlayHost.ts` still resolves `#shell`
 * and puts the library's portalled overlays in a `display: contents` layer there,
 * and `src/shell/tokens.css` still redeclares every `--od-*` on `#shell`. What
 * changed is which library overlay a user can still reach from this shell. The
 * `.od-dialog` the old spec drove — the "New folder" dialog off the sidebar's
 * tree — is gone: the workspace's dialogs are `kit/layers`' `openModal`, a real
 * `<dialog id="dx-modal">`. `renderer/ui` is down to the toast, the first-run
 * usage notice's buttons and the table inside Settings → diagnostics, and the
 * toast is the one that is portalled. So the bridge is measured on the toast and
 * the dialog's own contract — Escape, focus containment, a text field that fills
 * its row — is measured on `#dx-modal`.
 *
 * Two cases are gone rather than reinterpreted and are in the migration ledger:
 * dismissal by clicking the mask, and the library `Select`'s option rows.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3131 npx playwright test e2e/fix-w1c.spec.ts
 */

import { expect, test, type Locator, type Page } from "@playwright/test";

import { open } from "./r10-a-helpers";

/**
 * The bridge's own values, and where each comes from.
 *
 * Read off `src/shell/tokens.css`, and every one of them is a value the design
 * states rather than a recording of what r10 happens to render: OD-UI-1.2 §05
 * gives `color.text #343A40`, `color.canvas #F5F6F8`, `color.borderSubtle
 * #D9DFE4`, 控件圆角 6 and 卡片与菜单 8; §08 gives 常规按钮 高 36. `guidance` is
 * the shell's accent.
 */
const BRIDGE = {
  radiusDialog: "8px", // --shell-radius-card, §05 "卡片与菜单 8"
  radiusControl: "6px", // §05 "控件圆角 6"; the library default is 4px
  controlMd: "36px", // §08 常规按钮 高 36; the library default is 32px
  primaryBg: "#343a40", // §05 color.text; the library default is #000000
  guidance: "#596f86", // the shell's accent; the library default is a blue it has not got
  surfaceMuted: "#f5f6f8", // §05 color.canvas
  borderSubtle: "#d9dfe4", // §05 color.borderSubtle
} as const;

/** What `document.body` still resolves, i.e. what a portal to it used to pick up. */
const LIBRARY_DEFAULTS = {
  radiusControl: "4px",
  controlMd: "32px",
  primaryBg: "#000000",
  guidance: "#5da4e3",
} as const;

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

/**
 * Raises a real library toast.
 *
 * The composer refuses more than ten attachments and says so with
 * `toast.info(shell.cx.attach.onlyFirst)`, which is the shortest honest path to a
 * `.od-toast` from a browser: the shell's other `renderer/ui` overlays need the
 * desktop bridge (the diagnostics table, the report dialog's capability probe).
 *
 * It has to be a *real* notification, not a "not built yet" one: since r10 those
 * go through `kit/layers`' `notice()` into `#dx-notice` and never touch the
 * library's host at all.
 */
async function raiseToast(page: Page): Promise<void> {
  await page.locator("#dx-conversation input[type=file]").first().setInputFiles(
    Array.from({ length: 12 }, (_, index) => ({
      name: `attachment-${index}.txt`,
      mimeType: "text/plain",
      buffer: Buffer.from("x"),
    })),
  );
  await expect(page.locator(".od-toast").first()).toBeVisible();
}

/** C1 = Home with the sidebar showing, where the project tree's New is. */
async function openNameDialog(page: Page): Promise<Locator> {
  await open(page, "C1");
  const trigger = page.locator("#dx-sidebar .dx-group-heading [data-act=new-project]");
  await trigger.click();
  await expect(page.locator("dialog#dx-modal")).toBeVisible();
  return trigger;
}

test.describe("W1-C overlays and the token bridge", () => {
  test("a portalled library overlay mounts inside #shell and reads the bridged tokens", async ({ page }) => {
    // C7 = a document with the conversation floating: it has a composer to
    // refuse the attachments and a tab strip for the host to stay clear of.
    await open(page, "C7");
    await raiseToast(page);

    const inside = await page.evaluate(() => {
      const host = document.querySelector<HTMLElement>(".od-toast-host");
      return {
        insideShell: document.querySelector("#shell .od-toast-host") !== null,
        hostParentClass: host?.parentElement?.className ?? "",
        hostGrandparentId: host?.parentElement?.parentElement?.id ?? "",
        onBody: document.querySelector("body > .od-toast-host") !== null,
        position: host ? getComputedStyle(host).position : "",
      };
    });
    expect(inside.insideShell).toBe(true);
    expect(inside.onBody).toBe(false);
    expect(inside.hostParentClass).toBe("od-overlay-layer");
    expect(inside.hostGrandparentId).toBe("shell");
    /*
     * Moving the portal inside `#shell` must not move the overlay: these are
     * `position: fixed`, which only holds while no ancestor is a containing block
     * for them (a transform, a filter, `contain`). The layer is
     * `display: contents` for exactly this reason, and this is the assertion that
     * says so.
     */
    expect(inside.position).toBe("fixed");

    const toast = await tokens(page, ".od-toast");
    expect(toast.radiusDialog).toBe(BRIDGE.radiusDialog);
    expect(toast.radiusControl).toBe(BRIDGE.radiusControl);
    expect(toast.controlMd).toBe(BRIDGE.controlMd);
    expect(toast.primaryBg).toBe(BRIDGE.primaryBg);
    expect(toast.guidance).toBe(BRIDGE.guidance);
    expect(toast.surfaceMuted).toBe(BRIDGE.surfaceMuted);
    expect(toast.borderSubtle).toBe(BRIDGE.borderSubtle);
    // The panel used to inherit `Times` from a bare <body>.
    expect(toast.fontFamily).toContain("PingFang SC");

    /*
     * `document.body` still holds the library defaults — this is the value the
     * portal used to pick up, so the pair is the before/after in one run.
     *
     * `--od-radius-dialog` is not in the pair any more: r10's card radius is 8px
     * and so is the library's, so that one token would agree either way and
     * proves nothing about the bridge. It is asserted above as a value.
     */
    const body = await tokens(page, "body");
    expect(body.radiusControl).toBe(LIBRARY_DEFAULTS.radiusControl);
    expect(body.controlMd).toBe(LIBRARY_DEFAULTS.controlMd);
    expect(body.primaryBg).toBe(LIBRARY_DEFAULTS.primaryBg);
    expect(body.guidance).toBe(LIBRARY_DEFAULTS.guidance);
  });

  test("Escape closes the dialog and hands focus back to the trigger", async ({ page }) => {
    const trigger = await openNameDialog(page);
    // §17: a popup's trigger shows its open state, and only while it is open.
    await expect(trigger).toHaveAttribute("data-popup-open", "true");

    await page.keyboard.press("Escape");

    await expect(page.locator("dialog#dx-modal")).toHaveCount(0);
    await expect(trigger).toHaveAttribute("data-popup-open", "false");
    // OD-UI-1.2 §08: "普通弹窗 Esc/取消返回" — the keyboard user is put back where
    // they were, not on `document.body` with nothing selected.
    await expect(trigger).toBeFocused();
  });

  test("Tab cannot reach a control outside the dialog", async ({ page }) => {
    await openNameDialog(page);

    /*
     * Eight presses: before the fix the fourth left the dialog and the fifth
     * landed on the button that closes the application window.
     *
     * The bar is "no control outside the dialog", not "always inside it".
     * `#dx-modal` is a native `<dialog>` opened with `showModal()`, and Chromium
     * parks focus on `document.body` for one step as it wraps round the modal's
     * focus scope. `body` is not a control and everything outside the dialog is
     * inert while it is `:modal`, so that step cannot be used for anything — the
     * defect being fenced off is reaching a *control* out there.
     */
    const trail: string[] = [];
    for (let press = 0; press < 8; press += 1) {
      await page.keyboard.press("Tab");
      const where = await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        return {
          escaped: active !== null && active !== document.body && active.closest("#dx-modal") === null,
          label: active ? `${active.tagName}.${active.className || "(none)"}` : "null",
        };
      });
      trail.push(where.label);
      expect(
        where.escaped,
        `press ${press + 1} reached ${where.label} outside the dialog; trail: ${trail.join(" → ")}`,
      ).toBe(false);
    }
    // And it really did move, so this is not passing on a dead keyboard.
    expect(new Set(trail).size).toBeGreaterThan(1);
  });

  test("the dialog's text field takes the row instead of the UA's 173px", async ({ page }) => {
    await openNameDialog(page);

    const widths = await page.evaluate(() => {
      const field = document.querySelector<HTMLElement>("#dx-modal .dx-form-field")!;
      const input = field.querySelector<HTMLElement>("input")!;
      const style = getComputedStyle(input);
      return {
        field: field.getBoundingClientRect().width,
        input: input.getBoundingClientRect().width,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
      };
    });
    // The whole row, not the user agent's 173px default width.
    expect(widths.input).toBeGreaterThan(widths.field - 1);
    expect(widths.field).toBeGreaterThan(300);
    // §08, 单行输入: "弹窗高 40；16/24，横 padding 12". 13.333px was the UA default
    // showing through.
    expect(widths.fontSize).toBe("16px");
    expect(widths.lineHeight).toBe("24px");
    expect(widths.paddingLeft).toBe("12px");
    expect(widths.paddingRight).toBe("12px");
  });

  test("a notification leaves every document tab clickable", async ({ page }) => {
    // C7 = a document with the conversation floating: seven tabs on the strip.
    await open(page, "C7");
    await expect(page.locator(".dx-file-tab")).not.toHaveCount(0);

    /** Which element wins the centre of each tab, and the strip's own box. */
    const hits = () =>
      page.evaluate(() => ({
        strip: document.querySelector<HTMLElement>(".dx-tabs-strip")!.getBoundingClientRect().bottom,
        tabs: Array.from(document.querySelectorAll<HTMLElement>(".dx-file-tab")).map((tab) => {
          const rect = tab.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return {
            name: tab.textContent?.trim().slice(0, 20) ?? "",
            hit: hit ? `${hit.tagName}.${hit.className}` : "null",
            inOverlay: hit !== null && (hit.closest(".od-toast-host") !== null || hit.closest("#dx-notice") !== null),
          };
        }),
      }));

    const before = await hits();
    expect(before.tabs.length).toBeGreaterThan(0);

    /*
     * Both notification surfaces, because r10 has two and they fail differently.
     *
     * `#dx-notice` is the workspace's own (§08) and is what `notBuiltYet` raises
     * since the r10 port — one line, bottom centre, gone in 3.2s. The library
     * toast is now only for a real failure ("That did not work"), and it is the
     * one with a host that has to keep clear of the tab strip.
     */
    await page.locator(".dx-source-header-actions [data-act=file-menu]").click();
    await page.getByRole("menuitem", { name: "Preview" }).click();
    await expect(page.locator("#dx-notice.dx-visible")).toBeVisible();

    const withNotice = await hits();
    for (const tab of withNotice.tabs) {
      expect(tab.inOverlay, `"${tab.name}" centre hit ${tab.hit} while the notice was up`).toBe(false);
    }
    // A notice cannot intercept anything at all: it is not an interactive
    // surface, which is the structural half of the same promise.
    expect(await page.locator("#dx-notice").evaluate((node) => getComputedStyle(node).pointerEvents)).toBe("none");

    await raiseToast(page);
    const withToast = await hits();

    // The claim: a notification intercepts nothing. Three of seven tab centres
    // used to return `div.od-toast`, which is `pointer-events: auto`.
    for (const tab of withToast.tabs) {
      expect(tab.inOverlay, `"${tab.name}" centre hit ${tab.hit} while the toast was up`).toBe(false);
    }
    // And it changes nothing: whatever owned each centre before still owns it.
    expect(withToast.tabs.map((tab) => tab.hit)).toEqual(before.tabs.map((tab) => tab.hit));

    // Geometry, independent of hit testing: the host opens below the strip,
    // which is what `--od-toast-inset-top` is set for in `tokens.css`.
    const host = await page.locator(".od-toast-host").boundingBox();
    expect(host).not.toBeNull();
    expect(host!.y).toBeGreaterThanOrEqual(withToast.strip);
  });
});
