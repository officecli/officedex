/**
 * S2 — overlays: every menu / modal / tooltip / toast in the shell.
 *
 * The audit plan (docs/ui-audit-2026-09-19/PLAN.md) asks each finding to carry a
 * number, not an adjective. So this spec measures rather than eyeballs: every
 * check ends in a rect, a computed style or an `elementFromPoint` verdict that
 * somebody can re-run after the fix.
 *
 * Nothing here is a pass/fail gate yet — it is a probe. It prints one JSON blob
 * per surface (grep for `S2-PROBE`) and screenshots each state, and the findings
 * document quotes those numbers.
 */

import { expect, test, type Page } from "@playwright/test";

import { capture, open, type Combination } from "./ui-audit-helpers";

const SESSION = { session: "S2" };

/* ------------------------------------------------------------------ probes */

interface Probe {
  present: boolean;
  rect?: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  viewport?: { width: number; height: number };
  offViewport?: boolean;
  /** First ancestor whose overflow actually cuts the element. */
  clippedBy?: string | null;
  /** How much is cut off on each side by that ancestor (or by the viewport). */
  clipped?: { left: number; top: number; right: number; bottom: number };
  zIndex?: string;
  position?: string;
  /** The chain of ancestors that create a stacking context, outermost last. */
  stackingAncestors?: string[];
  /** What the browser says is painted at the element's own centre. */
  topmostAtCentre?: string | null;
  /** Whether that topmost element is the probe itself or inside it. */
  ownCentre?: boolean;
}

async function probe(page: Page, selector: string): Promise<Probe> {
  return page.evaluate((target: string) => {
    const element = document.querySelector(target);
    if (!element) return { present: false };
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);

    let clippedBy: string | null = null;
    let clipped = { left: 0, top: 0, right: 0, bottom: 0 };
    for (let node = element.parentElement; node; node = node.parentElement) {
      const nodeStyle = getComputedStyle(node);
      const visible =
        nodeStyle.overflow === "visible" &&
        nodeStyle.overflowX === "visible" &&
        nodeStyle.overflowY === "visible";
      if (visible) continue;
      const bounds = node.getBoundingClientRect();
      const cut = {
        left: Math.max(0, bounds.left - rect.left),
        top: Math.max(0, bounds.top - rect.top),
        right: Math.max(0, rect.right - bounds.right),
        bottom: Math.max(0, rect.bottom - bounds.bottom),
      };
      if (cut.left > 0.5 || cut.top > 0.5 || cut.right > 0.5 || cut.bottom > 0.5) {
        clippedBy = `${node.tagName.toLowerCase()}.${String(node.className).split(" ").filter(Boolean).join(".")}`;
        clipped = cut;
        break;
      }
    }

    // Stacking contexts between this element and the root decide whether its
    // z-index means anything at all.
    const stackingAncestors: string[] = [];
    for (let node = element.parentElement; node; node = node.parentElement) {
      const s = getComputedStyle(node);
      const creates =
        (s.position !== "static" && s.zIndex !== "auto") ||
        s.transform !== "none" ||
        s.filter !== "none" ||
        s.isolation === "isolate" ||
        s.mixBlendMode !== "normal" ||
        s.contain.includes("layout") ||
        s.contain.includes("paint") ||
        s.containerType !== "normal" ||
        (s.opacity !== "" && Number(s.opacity) < 1) ||
        s.willChange.includes("transform") ||
        s.willChange.includes("opacity");
      if (creates) {
        stackingAncestors.push(
          `${node.tagName.toLowerCase()}.${String(node.className).split(" ").filter(Boolean).join(".")}` +
            ` {z-index:${s.zIndex}; container-type:${s.containerType}; contain:${s.contain || "none"}}`,
        );
      }
    }

    const cx = Math.min(Math.max(rect.left + rect.width / 2, 1), window.innerWidth - 1);
    const cy = Math.min(Math.max(rect.top + rect.height / 2, 1), window.innerHeight - 1);
    const hit = document.elementFromPoint(cx, cy);

    return {
      present: true,
      rect: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      offViewport:
        rect.left < 0 ||
        rect.top < 0 ||
        rect.right > window.innerWidth ||
        rect.bottom > window.innerHeight,
      clippedBy,
      clipped,
      zIndex: style.zIndex,
      position: style.position,
      stackingAncestors,
      topmostAtCentre: hit
        ? `${hit.tagName.toLowerCase()}.${String(hit.className).split(" ").filter(Boolean).join(".")}`
        : null,
      ownCentre: hit ? element === hit || element.contains(hit) : false,
    };
  }, selector);
}

/** Which element is painted on top at an arbitrary viewport point. */
async function hitTest(page: Page, x: number, y: number) {
  return page.evaluate(
    ([px, py]) => {
      const hit = document.elementFromPoint(px, py);
      if (!hit) return null;
      const path: string[] = [];
      for (let node: Element | null = hit; node && path.length < 4; node = node.parentElement) {
        path.push(`${node.tagName.toLowerCase()}.${String(node.className).split(" ").filter(Boolean).join(".")}`);
      }
      return { hit: path[0], path };
    },
    [x, y],
  );
}

async function activeElement(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    return {
      tag: el.tagName.toLowerCase(),
      className: String(el.className),
      label: el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 40) ?? "",
    };
  });
}

function report(name: string, payload: unknown) {
  // eslint-disable-next-line no-console
  console.log(`S2-PROBE ${name} ${JSON.stringify(payload)}`);
}

/**
 * Raises a toast, which is the overlay this file measures next.
 *
 * It used to fire the sidebar footer's `notBuiltYet` "Review changes" row. That
 * row is gone with the dropdown it lived in, and the obvious replacement — the
 * settings page's auto-save toast — is the wrong instrument here: the page is a
 * full-window cover, so every tab centre this file hit-tests would report the
 * cover rather than the toast.
 *
 * The composer's permission menu carries the shell's other `notBuiltYet` row
 * and opens over the frame without replacing it. Every caller opens C7, which
 * has the composer chip.
 */
async function raiseToast(page: Page) {
  await page.locator(".shell-cx-permission").press("ArrowDown");
  await page.locator(".shell-menu").waitFor();
  await page.getByRole("menuitemradio", { name: /Review changes/ }).click();
  await page.locator(".od-toast").waitFor();
}

/* ------------------------------------------------------------- 1. shell-menu */

test.describe("S2 overlays", () => {
  test("folder context menu — every combination that has a sidebar tree", async ({ page }) => {
    // The tree only exists in agent mode (App.tsx:99), so C3/C4/C9/C10 have no
    // folder row to right-click. That is not a pass, it is a smaller surface.
    const combos: Combination[] = ["C1", "C2", "C5", "C6", "C7", "C8"];
    const results: Record<string, unknown> = {};

    for (const combination of combos) {
      await open(page, combination, SESSION);
      const rows = page.locator(".shell-tree-folder-row");
      if ((await rows.count()) === 0) {
        results[combination] = { tree: false };
        continue;
      }
      const row = rows.first();
      const rowName = await row.locator(".shell-tree-folder-toggle span").first().innerText();
      await row.click({ button: "right" });
      await page.locator(".shell-menu").waitFor();
      const measured = await probe(page, ".shell-menu");
      const firstItem = await page.locator(".shell-menu-item").first().innerText();
      results[combination] = { row: rowName, firstItem, ...measured };
      await capture(page, combination, "S2-001-folder-context-menu", SESSION);
      await page.keyboard.press("Escape");
    }

    report("folder-context-menu", results);
  });

  /*
   * S2-002 measured a 250px settings panel clipped to 15.8% of itself by
   * `.shell-sidebar`'s `overflow: hidden`. There is no such panel any more —
   * the gear opens a full-page settings surface — so what is measured here is
   * that replacement: whether the cover escapes the sidebar's box, which is the
   * property S2-002 was really about.
   */
  test("settings page — a full-window cover, not a panel inside the sidebar", async ({ page }) => {
    const results: Record<string, unknown> = {};
    for (const combination of ["C1", "C2", "C3", "C4"] as Combination[]) {
      await open(page, combination, SESSION);
      const rail = await page.locator("#shell-sidebar").boundingBox();
      await page.locator("#shell-sidebar .shell-sidebar-footer button[aria-label='Settings']").click();
      await page.locator(".shell-settings").waitFor();
      results[combination] = { sidebar: rail, ...(await probe(page, ".shell-settings")) };
      await capture(page, combination, "S2-002-settings-page", SESSION);
      await page.keyboard.press("Escape");
    }
    report("settings-page", results);
  });

  test("ModeMenu — 220px panel under the brand", async ({ page }) => {
    const results: Record<string, unknown> = {};
    for (const combination of ["C1", "C2", "C3", "C9"] as Combination[]) {
      await open(page, combination, SESSION);
      const brand = await page.locator(".shell-brand").boundingBox();
      await page.locator(".shell-brand").click();
      await page.locator(".shell-menu").waitFor();
      results[combination] = { brand, ...(await probe(page, ".shell-menu")) };
      await capture(page, combination, "S2-003-mode-menu", SESSION);
      await page.keyboard.press("Escape");
    }
    report("mode-menu", results);
  });

  test("composer menus — scope, permission, model", async ({ page }) => {
    const results: Record<string, unknown> = {};
    for (const combination of ["C1", "C2", "C5", "C6", "C7", "C8", "C9", "C10"] as Combination[]) {
      await open(page, combination, SESSION);
      const per: Record<string, unknown> = {};
      for (const [name, selector] of [
        ["scope", ".shell-cx-scope"],
        ["permission", ".shell-cx-permission"],
        ["model", ".shell-cx-model"],
      ] as const) {
        const trigger = page.locator(selector).first();
        if ((await trigger.count()) === 0) {
          per[name] = { present: false };
          continue;
        }
        // Opened from the keyboard, not the mouse: in the docked column the
        // toolbar's two groups overlap, so a click on the scope chip is
        // intercepted by the permission chip. That overlap is recorded below;
        // it must not also stop the menu from being measured.
        await trigger.focus();
        await page.keyboard.press("ArrowDown");
        await page.locator(".shell-menu").waitFor();
        per[name] = { trigger: await trigger.boundingBox(), ...(await probe(page, ".shell-menu")) };
        await capture(page, combination, `S2-004-composer-${name}`, SESSION);
        await page.keyboard.press("Escape");
      }
      // Do the toolbar's own controls overlap each other in this shell?
      per.toolbarOverlap = await page.evaluate(() => {
        const boxes = [...document.querySelectorAll(".shell-cx-toolbar button")].map((b) => ({
          label: b.getAttribute("title") ?? b.getAttribute("aria-label") ?? "",
          rect: b.getBoundingClientRect(),
        }));
        const collisions: Array<{ a: string; b: string; px: number }> = [];
        for (let i = 0; i < boxes.length; i += 1) {
          for (let j = i + 1; j < boxes.length; j += 1) {
            const overlap =
              Math.min(boxes[i].rect.right, boxes[j].rect.right) -
              Math.max(boxes[i].rect.left, boxes[j].rect.left);
            if (overlap > 0.5) {
              collisions.push({ a: boxes[i].label, b: boxes[j].label, px: Math.round(overlap) });
            }
          }
        }
        return collisions;
      });
      results[combination] = per;
    }
    report("composer-menus", results);
  });

  test("file-tab More menu, open in the strip that scrolls horizontally", async ({ page }) => {
    const results: Record<string, unknown> = {};
    for (const combination of ["C7", "C9"] as Combination[]) {
      await open(page, combination, SESSION);
      const trigger = page.locator("button[aria-label='More actions']");
      if ((await trigger.count()) === 0) {
        results[combination] = { present: false };
        continue;
      }
      await trigger.click();
      await page.locator(".shell-menu").waitFor();
      results[combination] = await probe(page, ".shell-menu");
      await capture(page, combination, "S2-005-tab-more-menu", SESSION);
      await page.keyboard.press("Escape");
    }
    report("tab-more-menu", results);
  });

  /* ------------------------------------------------------------ 2. scrolling */

  test("a menu opened in the sidebar and then scrolled", async ({ page }) => {
    await open(page, "C2", SESSION);
    const rows = page.locator(".shell-tree-folder-row");
    const last = rows.last();
    await last.scrollIntoViewIfNeeded();
    await last.click({ button: "right" });
    await page.locator(".shell-menu").waitFor();
    const before = await probe(page, ".shell-menu");
    await page.locator(".shell-sidebar-body").evaluate((node) => {
      node.scrollTop = 0;
    });
    await page.waitForTimeout(120);
    const after = await probe(page, ".shell-menu");
    await capture(page, "C2", "S2-006-menu-after-scroll", SESSION);
    report("menu-scroll-follow", { before, after, delta: (after.rect?.top ?? 0) - (before.rect?.top ?? 0) });
  });

  /* ------------------------------------------------- 3. keyboard and focus */

  test("Escape and Tab out of an open menu", async ({ page }) => {
    await open(page, "C2", SESSION);
    // The brand, not the footer gear: the gear opened a menu when S2 was
    // written and opens the settings page now, so it is no longer a `<Menu>`
    // call site. See `chrome/Sidebar.tsx`.
    const trigger = page.locator(".shell-brand");

    await trigger.click();
    await page.locator(".shell-menu").waitFor();
    const focusInMenu = await activeElement(page);
    await page.keyboard.press("Escape");
    await expect(page.locator(".shell-menu")).toHaveCount(0);
    const afterEscape = await activeElement(page);

    await trigger.click();
    await page.locator(".shell-menu").waitFor();
    await page.keyboard.press("Tab");
    await expect(page.locator(".shell-menu")).toHaveCount(0);
    const afterTab = await activeElement(page);

    report("menu-focus", { focusInMenu, afterEscape, afterTab });
  });

  test("Escape inside the folder dialog, and what it leaves focused", async ({ page }) => {
    await open(page, "C2", SESSION);
    await page.locator(".shell-tree-section-head button[aria-label='New folder']").click();
    await page.locator(".od-dialog, .od-dialog-mask").first().waitFor();
    const dialog = await probe(page, ".od-dialog-mask");
    await capture(page, "C2", "S2-007-folder-dialog", SESSION);
    const focusInDialog = await activeElement(page);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    const stillOpen = await page.locator(".od-dialog-mask").count();
    const afterEscape = await activeElement(page);
    report("folder-dialog", { dialog, focusInDialog, stillOpen, afterEscape });
  });

  /* ---------------------------------------------------------- 4. the toast */

  test("toast versus the tab strip and versus an open menu", async ({ page }) => {
    await open(page, "C7", SESSION);

    // Baseline: where the tab strip is before anything covers it.
    const tabs = await page.locator(".shell-tabstrip").boundingBox();
    const firstTab = await page.locator(".shell-tab").first().boundingBox();

    await raiseToast(page);
    const toastHost = await probe(page, ".od-toast-host");
    const toast = await probe(page, ".od-toast");
    await capture(page, "C7", "S2-008-toast-over-tabs", SESSION);

    // Does the toast physically overlap the tab strip, and does it win the hit
    // test at the point where they overlap?
    const overlap =
      tabs && toast.rect
        ? {
            horizontal: Math.min(tabs.x + tabs.width, toast.rect.right) - Math.max(tabs.x, toast.rect.left),
            vertical: Math.min(tabs.y + tabs.height, toast.rect.bottom) - Math.max(tabs.y, toast.rect.top),
          }
        : null;
    const atOverlap =
      tabs && toast.rect && overlap && overlap.horizontal > 0 && overlap.vertical > 0
        ? await hitTest(
            page,
            Math.max(tabs.x, toast.rect.left) + Math.min(overlap.horizontal, 40) / 2,
            Math.max(tabs.y, toast.rect.top) + Math.min(overlap.vertical, 10) / 2,
          )
        : null;

    report("toast-vs-tabs", { tabs, firstTab, toastHost, toast, overlap, atOverlap });

    // Now with a menu open at the same time. The toast lives for three seconds
    // (toast.tsx default duration), which is long enough to open a menu under
    // it — which is exactly the sequence a user hits: press a dead control,
    // then reach for the menu the notice is sitting on.
    await raiseToast(page);
    await page.locator(".shell-brand").click();
    await page.locator(".shell-menu").waitFor();
    const menu = await probe(page, ".shell-menu");
    const toast2 = await probe(page, ".od-toast");
    const menuVsToast =
      menu.rect && toast2.rect
        ? {
            horizontal:
              Math.min(menu.rect.right, toast2.rect.right) - Math.max(menu.rect.left, toast2.rect.left),
            vertical:
              Math.min(menu.rect.bottom, toast2.rect.bottom) - Math.max(menu.rect.top, toast2.rect.top),
          }
        : null;
    await capture(page, "C7", "S2-009-toast-over-menu", SESSION);
    report("toast-vs-menu", { menu, toast: toast2, menuVsToast });
  });

  /* ------------------------------------------- 5. overlay under the presence */

  test("floating presence: where it lands by default, and what it covers", async ({ page }) => {
    for (const combination of ["C7", "C8", "C9", "C10"] as Combination[]) {
      await open(page, combination, SESSION);
      const presence = await probe(page, ".shell-presence");
      if (!presence.present) {
        report(`presence-${combination}`, { present: false });
        continue;
      }
      // Whether the panel's own composer toolbar is reachable at the position
      // the shell chose for it, before anybody drags anything.
      const toolbar = await probe(page, ".shell-presence .shell-cx-toolbar");
      const composer = await probe(page, ".shell-presence .shell-cx");
      const sendButton = await probe(page, ".shell-presence .shell-cx-send");
      await capture(page, combination, "S2-010-presence-default", SESSION);
      report(`presence-default-${combination}`, { presence, composer, toolbar, sendButton });
    }
  });

  test("a menu opened underneath the floating presence", async ({ page }) => {
    // The presence is dragged with the mouse — the same gesture a user makes —
    // rather than having its inline style rewritten, which React overwrites on
    // the next render.
    await open(page, "C9", SESSION);
    const face = page.locator(".shell-presence .shell-task-head.is-grip, .shell-presence-face").first();
    const handle = face;
    const from = await handle.boundingBox();
    const tabsMore = page.locator("button[aria-label='More actions']");
    const target = await tabsMore.boundingBox();
    if (!from || !target) {
      report("presence-drag", { from, target, note: "no drag handle or no menu trigger" });
      return;
    }
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    // Land the presence just under the tab strip, where the More menu opens.
    await page.mouse.move(target.x - 40, target.y + 60, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(250);

    const presence = await probe(page, ".shell-presence");
    await tabsMore.click();
    await page.locator(".shell-menu").waitFor();
    const menu = await probe(page, ".shell-menu");
    const overlap =
      presence.rect && menu.rect
        ? {
            horizontal:
              Math.min(presence.rect.right, menu.rect.right) -
              Math.max(presence.rect.left, menu.rect.left),
            vertical:
              Math.min(presence.rect.bottom, menu.rect.bottom) -
              Math.max(presence.rect.top, menu.rect.top),
          }
        : null;
    const atOverlap =
      overlap && overlap.horizontal > 0 && overlap.vertical > 0 && presence.rect && menu.rect
        ? await hitTest(
            page,
            Math.max(presence.rect.left, menu.rect.left) + Math.min(overlap.horizontal, 30) / 2,
            Math.max(presence.rect.top, menu.rect.top) + Math.min(overlap.vertical, 30) / 2,
          )
        : null;
    await capture(page, "C9", "S2-011-presence-over-menu", SESSION);
    report("presence-vs-menu-C9", { presence, menu, overlap, atOverlap });
  });

  test("mention list in the floating panel's composer", async ({ page }) => {
    for (const combination of ["C7", "C9"] as Combination[]) {
      await open(page, combination, SESSION);
      const input = page.locator(".shell-presence .shell-cx-input").first();
      if ((await input.count()) === 0) {
        report(`mention-${combination}`, { present: false });
        continue;
      }
      await input.focus();
      await page.keyboard.type("@");
      await page.locator(".shell-mention").waitFor();
      const mention = await probe(page, ".shell-mention");
      const side = await page.locator(".shell-mention").getAttribute("data-side");
      await capture(page, combination, "S2-012-mention-floating", SESSION);
      report(`mention-${combination}`, { side, mention });
    }
  });

  test("mention list on Home, where the composer sits high in the page", async ({ page }) => {
    for (const combination of ["C1", "C2"] as Combination[]) {
      await open(page, combination, SESSION);
      const input = page.locator(".shell-cx-input").first();
      await input.click();
      await page.keyboard.type("@");
      await page.locator(".shell-mention").waitFor();
      const mention = await probe(page, ".shell-mention");
      const side = await page.locator(".shell-mention").getAttribute("data-side");
      await capture(page, combination, "S2-012-mention-home", SESSION);
      report(`mention-home-${combination}`, { side, mention });
    }
  });

  /* ------------------------------------------------- 6. the legacy dialogs */

  test("CustomModelDialog — the legacy Modal inside a shell menu", async ({ page }) => {
    await open(page, "C2", SESSION);
    await page.locator(".shell-cx-model").first().click();
    await page.locator(".shell-menu").waitFor();
    await page.getByRole("menuitem", { name: /Add model|Replace custom model/ }).click();
    await page.locator(".od-dialog-mask").waitFor();
    const mask = await probe(page, ".od-dialog-mask");
    const dialog = await probe(page, ".od-dialog");
    const select = await probe(page, ".shell-dialog-select");
    const keyType = await page.locator("#shell-model-key").getAttribute("type");
    const fonts = await page.evaluate(() => {
      const modal = document.querySelector(".od-dialog") as HTMLElement | null;
      const shell = document.querySelector(".shell") as HTMLElement | null;
      const select = document.querySelector(".shell-dialog-select") as HTMLElement | null;
      const cs = (el: HTMLElement | null) =>
        el
          ? {
              fontFamily: getComputedStyle(el).fontFamily,
              background: getComputedStyle(el).backgroundColor,
              borderRadius: getComputedStyle(el).borderRadius,
            }
          : null;
      return { modal: cs(modal), shell: cs(shell), select: cs(select) };
    });
    await capture(page, "C2", "S2-013-custom-model-dialog", SESSION);
    report("custom-model-dialog", { mask, dialog, select, keyType, fonts });
  });

  /* ----------------------------------------------------------- 7. tooltips */

  test("the shell has no tooltip component — only native title attributes", async ({ page }) => {
    await open(page, "C1", SESSION);
    const counts = await page.evaluate(() => ({
      nativeTitles: document.querySelectorAll("[title]").length,
      odTooltips: document.querySelectorAll(".od-tooltip, .od-tooltip-anchor").length,
      collapsedRailButtonsWithTitle: document.querySelectorAll(
        ".shell-sidebar [title], .shell-windowbar [title]",
      ).length,
      collapsedRailButtonsWithAriaLabel: document.querySelectorAll(
        ".shell-sidebar [aria-label], .shell-windowbar [aria-label]",
      ).length,
    }));
    report("tooltips", counts);
  });

  /* --------------------------------------------- 8. what the modal does not do */

  test("the legacy Modal: Escape, mask click, focus containment, fonts", async ({ page }) => {
    await open(page, "C2", SESSION);
    await page.locator(".shell-tree-section-head button[aria-label='New folder']").click();
    await page.locator(".od-dialog-mask").waitFor();

    const escape = await (async () => {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(150);
      return page.locator(".od-dialog-mask").count();
    })();

    const maskClick = await (async () => {
      await page.mouse.click(40, 40); // on the mask, well clear of the dialog
      await page.waitForTimeout(150);
      return page.locator(".od-dialog-mask").count();
    })();

    // Tab six times and see whether focus ever leaves the dialog — an
    // `aria-modal="true"` that the keyboard can walk out of is a lie to a
    // screen reader, which stops announcing anything outside it.
    const walk: Array<{ tag: string; inDialog: boolean; label: string }> = [];
    for (let step = 0; step < 6; step += 1) {
      await page.keyboard.press("Tab");
      walk.push(
        await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          return {
            tag: el ? `${el.tagName.toLowerCase()}.${String(el.className)}` : "none",
            inDialog: !!el?.closest(".od-dialog"),
            label: el?.getAttribute("aria-label") ?? el?.textContent?.trim().slice(0, 30) ?? "",
          };
        }),
      );
    }

    const fonts = await page.evaluate(() =>
      [".od-dialog", ".od-dialog__header h2", ".od-dialog__content", ".shell-dialog-label", ".od-input", ".od-button", ".shell"]
        .map((selector) => {
          const el = document.querySelector(selector) as HTMLElement | null;
          if (!el) return { selector, present: false };
          const s = getComputedStyle(el);
          return {
            selector,
            present: true,
            fontFamily: s.fontFamily,
            fontSize: s.fontSize,
            color: s.color,
            background: s.backgroundColor,
          };
        }),
    );

    await capture(page, "C2", "S2-014-modal-behaviour", SESSION);
    report("modal-behaviour", { afterEscape: escape, afterMaskClick: maskClick, tabWalk: walk, fonts });
  });

  /* ------------------------------------------ 9. exactly which tabs the toast hides */

  test("which file tabs the toast covers", async ({ page }) => {
    await open(page, "C7", SESSION);
    const before = await page.evaluate(() =>
      [...document.querySelectorAll(".shell-tab")].map((tab) => {
        const r = tab.getBoundingClientRect();
        return { name: tab.textContent?.trim().slice(0, 24) ?? "", left: r.left, right: r.right };
      }),
    );
    await raiseToast(page);
    const covered = await page.evaluate(() => {
      const toast = document.querySelector(".od-toast")?.getBoundingClientRect();
      if (!toast) return null;
      return [...document.querySelectorAll(".shell-tab")].map((tab) => {
        const r = tab.getBoundingClientRect();
        const cx = Math.min(Math.max(r.left + r.width / 2, 1), window.innerWidth - 1);
        const cy = Math.min(Math.max(r.top + r.height / 2, 1), window.innerHeight - 1);
        const hit = document.elementFromPoint(cx, cy);
        return {
          name: tab.textContent?.trim().slice(0, 24) ?? "",
          overlapPx: Math.max(0, Math.min(r.right, toast.right) - Math.max(r.left, toast.left)),
          centreReachable: !!hit && tab.contains(hit),
          centreHitsToast: !!hit?.closest(".od-toast-host"),
        };
      });
    });
    await capture(page, "C7", "S2-015-toast-covers-tabs", SESSION);
    report("toast-covers-tabs", { before, covered });
  });
});
