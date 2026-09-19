/**
 * S6 — shell combination x environment matrix (docs/ui-audit-2026-09-19/PLAN.md section 3).
 *
 * Primary axis: the ten shell combinations, every one of them, at the default
 * viewport in light. Then C1/C2/C4/C9 get the full sweep: four widths, light
 * and dark, and the awkward content states the fixture carries.
 *
 * Three things only this session can see:
 *   1. the agent<->editor transition's intermediate frames (App.tsx:42 says the
 *      layout is a flex-width transition and nothing unmounts — no static check
 *      can see a jump in the middle of it);
 *   2. tab order and focus rings in both modes (the sidebar's button set differs);
 *   3. CanvasPlaceholder's three skeletons, which only exist on 3100 where
 *      createShellCanvas() returns null (PLAN 2.3).
 *
 * Read-only: this spec drives the fixture server and writes screenshots into
 * docs/ui-audit-2026-09-19/S6/.
 */

import { expect, test, type Page } from "@playwright/test";

import { COMBINATIONS, capture, open, type Combination } from "./ui-audit-helpers";

const S6 = { session: "S6" } as const;

/** main.go:44 — the desktop window cannot be made narrower than this. */
const MIN_USABLE_WIDTH = 1040;
const WIDTHS = [1024, 1280, 1440, MIN_USABLE_WIDTH] as const;
const REPRESENTATIVE: Combination[] = ["C1", "C2", "C4", "C9"];

interface Probe {
  label: string;
  viewport: { width: number; height: number };
  attrs: Record<string, string | null>;
  regions: Record<string, { x: number; y: number; w: number; h: number } | null>;
  /** Elements whose own box leaves the viewport. */
  offViewport: Array<{ sel: string; left: number; right: number; top: number; bottom: number }>;
  /** Elements clipped by an ancestor that actually has overflow != visible. */
  clipped: Array<{ sel: string; by: string; overhang: number }>;
  /** Text nodes overflowing their own box horizontally (unbroken long names). */
  textOverflow: Array<{ sel: string; scrollW: number; clientW: number }>;
  tabScroll: { scrollW: number; clientW: number; hidden: number } | null;
  docScrollWidth: number;
}

/**
 * One geometry sweep of the whole shell.
 *
 * Done in the page rather than with a dozen locator round-trips because the
 * point is a number per element for every one of ~40 combination/viewport
 * cells; forty round-trips each would take longer than the audit.
 */
async function probe(page: Page, label: string): Promise<Probe> {
  return page.evaluate((probeLabel: string) => {
    const path = (el: Element): string => {
      const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
      return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ""}`;
    };
    const shell = document.querySelector("#shell");
    const regionSelectors = [
      "#shell",
      ".shell-row--top",
      ".shell-windowbar",
      ".shell-tabs",
      ".shell-tabstrip",
      ".shell-sidebar",
      ".shell-sidebar-body",
      ".shell-agent",
      ".shell-workspace",
      ".shell-home",
      ".shell-statusbar",
      ".shell-canvas",
      ".shell-presence",
      ".shell-presence-panel",
      ".shell-home-list",
      ".shell-home-list table",
    ];
    const regions: Record<string, { x: number; y: number; w: number; h: number } | null> = {};
    for (const sel of regionSelectors) {
      const el = document.querySelector(sel);
      if (!el) {
        regions[sel] = null;
        continue;
      }
      const r = el.getBoundingClientRect();
      regions[sel] = {
        x: Math.round(r.left * 10) / 10,
        y: Math.round(r.top * 10) / 10,
        w: Math.round(r.width * 10) / 10,
        h: Math.round(r.height * 10) / 10,
      };
    }

    const offViewport: Array<{ sel: string; left: number; right: number; top: number; bottom: number }> = [];
    const clipped: Array<{ sel: string; by: string; overhang: number }> = [];
    const textOverflow: Array<{ sel: string; scrollW: number; clientW: number }> = [];

    const all = shell ? Array.from(shell.querySelectorAll<HTMLElement>("*")) : [];
    for (const el of all) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      // The screen-reader-only utility is deliberately a 1px box at -1px.
      if (typeof el.className === "string" && el.className.includes("shell-visually-hidden")) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;

      if (r.left < -0.5 || r.top < -0.5 || r.right > window.innerWidth + 0.5 || r.bottom > window.innerHeight + 0.5) {
        offViewport.push({
          sel: path(el),
          left: Math.round(r.left),
          right: Math.round(r.right),
          top: Math.round(r.top),
          bottom: Math.round(r.bottom),
        });
      }

      // Axis-aware: an ancestor that *scrolls* the axis the child overflows on
      // is doing its job, and reporting it buries the ancestors that clip with
      // no way to reach the content. Only `hidden` on the overflowing axis is
      // a defect.
      for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
        const s = getComputedStyle(node);
        const visibleX = s.overflowX === "visible";
        const visibleY = s.overflowY === "visible";
        if (visibleX && visibleY) continue;
        const b = node.getBoundingClientRect();
        const overX = Math.max(b.left - r.left, r.right - b.right);
        const overY = Math.max(b.top - r.top, r.bottom - b.bottom);
        const badX = !visibleX && s.overflowX === "hidden" && overX > 1;
        const badY = !visibleY && s.overflowY === "hidden" && overY > 1;
        if (badX || badY) {
          clipped.push({
            sel: path(el),
            by: `${path(node)}[${badX ? "x" : ""}${badY ? "y" : ""}]`,
            overhang: Math.round(Math.max(badX ? overX : 0, badY ? overY : 0)),
          });
        }
        break;
      }

      if (el.scrollWidth > el.clientWidth + 1 && style.overflowX === "hidden" && style.textOverflow !== "ellipsis") {
        textOverflow.push({ sel: path(el), scrollW: el.scrollWidth, clientW: el.clientWidth });
      }
    }

    const strip = document.querySelector<HTMLElement>(".shell-tabstrip");
    const tabScroll = strip
      ? { scrollW: strip.scrollWidth, clientW: strip.clientWidth, hidden: strip.scrollWidth - strip.clientWidth }
      : null;

    return {
      label: probeLabel,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      attrs: {
        mode: shell?.getAttribute("data-mode") ?? null,
        home: shell?.getAttribute("data-home") ?? null,
        nav: shell?.getAttribute("data-nav-collapsed") ?? null,
        presence: shell?.getAttribute("data-presence") ?? null,
        loaded: shell?.getAttribute("data-loaded") ?? null,
      },
      regions,
      offViewport: offViewport.slice(0, 25),
      clipped: clipped.slice(0, 25),
      textOverflow: textOverflow.slice(0, 25),
      tabScroll,
      docScrollWidth: document.documentElement.scrollWidth,
    };
  }, label);
}

function report(p: Probe) {
  console.log(`\n@@PROBE ${p.label} ${JSON.stringify(p)}`);
}

test.describe("S6 combination x environment matrix", () => {
  /* ------------------------------------------------ main axis: C1..C10 */

  test("C1-C10 at the default viewport, light", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: "light" });
    for (const combination of COMBINATIONS) {
      await open(page, combination, S6);
      await page.waitForTimeout(350); // let the width transition settle
      await capture(page, combination, "default-light", S6);
      report(await probe(page, `${combination}/1280/light`));
    }
  });

  /* ---------------------------- full sweep on the four representatives */

  test("C1/C2/C4/C9 across four widths, light and dark", async ({ page }) => {
    for (const combination of REPRESENTATIVE) {
      for (const width of WIDTHS) {
        for (const scheme of ["light", "dark"] as const) {
          await page.setViewportSize({ width, height: 800 });
          await page.emulateMedia({ colorScheme: scheme });
          await open(page, combination, S6);
          await page.waitForTimeout(300);
          await capture(page, combination, `w${width}-${scheme}`, S6);
          report(await probe(page, `${combination}/${width}/${scheme}`));
        }
      }
    }
  });

  test("dark mode changes nothing at all", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const read = async () => {
      return page.evaluate(() => {
        const pick = (sel: string) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const s = getComputedStyle(el);
          return { bg: s.backgroundColor, color: s.color, scheme: s.colorScheme };
        };
        return {
          shell: pick("#shell"),
          sidebar: pick(".shell-sidebar"),
          html: getComputedStyle(document.documentElement).colorScheme,
          body: getComputedStyle(document.body).backgroundColor,
        };
      });
    };
    await page.emulateMedia({ colorScheme: "light" });
    await open(page, "C2", S6);
    const light = await read();
    await page.emulateMedia({ colorScheme: "dark" });
    await open(page, "C2", S6);
    const dark = await read();
    console.log(`\n@@DARK ${JSON.stringify({ light, dark })}`);
    // Recorded, not asserted: the finding is the equality, and a failing test
    // here would stop the rest of the sweep.
    expect(light).toBeTruthy();
  });

  /* -------------------------------------------- content / state axis */

  test("awkward content states on the representatives", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: "light" });

    // Empty folder (No files yet) in the sidebar tree — agent mode, expanded.
    await open(page, "C2", S6);
    await page.waitForTimeout(250);
    const emptyRow = page.getByText("yirentk", { exact: true }).first();
    if (await emptyRow.count()) await emptyRow.click();
    await page.waitForTimeout(200);
    await capture(page, "C2", "state-empty-folder", S6);
    report(await probe(page, "C2/empty-folder"));

    // Long CN + long EN names are in the tree and in the tab strip already.
    await open(page, "C2", S6);
    await page.waitForTimeout(250);
    const longMeasurements = await page.evaluate(() => {
      const out: Array<Record<string, unknown>> = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(".shell-tree-name, .shell-tab-name, .shell-file-name"))) {
        const s = getComputedStyle(el);
        if (el.scrollWidth <= el.clientWidth + 1) continue;
        out.push({
          text: (el.textContent ?? "").slice(0, 24),
          cls: el.className,
          scrollW: el.scrollWidth,
          clientW: el.clientWidth,
          ellipsis: s.textOverflow,
          whiteSpace: s.whiteSpace,
          overflowX: s.overflowX,
        });
      }
      return out;
    });
    console.log(`\n@@LONGNAMES ${JSON.stringify(longMeasurements)}`);
    await capture(page, "C2", "state-long-names", S6);

    // The true zero-data state: no fixture at all, so the preview port serves
    // an empty workspace. This is what a new user sees (PLAN section 9 item 3).
    await page.goto("/?shell=C1");
    await expect(page.locator("#shell")).toHaveAttribute("data-loaded", "true");
    await page.waitForTimeout(250);
    await capture(page, "C1", "state-zero-data", S6);
    report(await probe(page, "C1/zero-data"));

    // Loading: screenshot before data-loaded flips.
    await page.goto("/?shellFixture=1&shell=C4", { waitUntil: "commit" });
    await capture(page, "C4", "state-loading", S6);
    const loadingAttr = await page.locator("#shell").getAttribute("data-loaded").catch(() => "no-shell-yet");
    console.log(`\n@@LOADING ${JSON.stringify({ dataLoaded: loadingAttr })}`);

    // Pinned view with data, and the three comfortable empty states, on C4.
    await open(page, "C4", S6);
    await page.waitForTimeout(250);
    const pinned = page.getByRole("button", { name: "Pinned", exact: true }).first();
    if (await pinned.count()) await pinned.click();
    await page.waitForTimeout(250);
    await capture(page, "C4", "state-pinned", S6);
    report(await probe(page, "C4/pinned"));

    // C9: the floating panel over an editor canvas at the narrowest width.
    await page.setViewportSize({ width: MIN_USABLE_WIDTH, height: 720 });
    await open(page, "C9", S6);
    await page.waitForTimeout(300);
    await capture(page, "C9", "state-float-min-width", S6);
    report(await probe(page, "C9/float-min-width"));
  });

  /* --------------------------------------- 1. mode transition frames */

  test("agent<->editor transition, frame by frame", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: "light" });
    // From C6 (agent, workspace, docked) so the docked column's width actually
    // animates: that is the one box App.tsx:42 says a mode change moves.
    await open(page, "C6", S6);
    await page.waitForTimeout(400);
    report(await probe(page, "C6/before-transition"));
    await capture(page, "C6", "transition-agent-000-before", S6);

    const frames: Array<Record<string, unknown>> = [];
    const sample = async (t: string) => {
      const r = await page.evaluate(() => {
        const box = (sel: string) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          return { x: Math.round(rect.left), w: Math.round(rect.width) };
        };
        const tabs = document.querySelector(".shell-tabs");
        return {
          sidebar: box(".shell-sidebar"),
          agent: box(".shell-agent"),
          workspace: box(".shell-workspace"),
          tabstrip: box(".shell-tabstrip"),
          float: box(".shell-task-float"),
          tabsPadLeft: tabs ? getComputedStyle(tabs).paddingLeft : null,
          mode: document.querySelector("#shell")?.getAttribute("data-mode"),
          presence: document.querySelector("#shell")?.getAttribute("data-presence"),
        };
      });
      frames.push({ t, ...r });
    };

    // Flip the mode, then sample without waiting for the transition to end.
    await page.getByRole("button", { name: /Switch mode/ }).click();
    await page.locator(".shell-menu-item", { hasText: "Editor" }).first().click();
    await sample("0ms");
    await capture(page, "C6", "transition-agent-to-editor-000ms", S6);
    await page.waitForTimeout(100);
    await sample("100ms");
    await capture(page, "C6", "transition-agent-to-editor-100ms", S6);
    await page.waitForTimeout(200);
    await sample("300ms");
    await capture(page, "C6", "transition-agent-to-editor-300ms", S6);
    await page.waitForTimeout(700);
    await sample("end");
    await capture(page, "C6", "transition-agent-to-editor-end", S6);

    // And back.
    await page.getByRole("button", { name: /Switch mode/ }).click();
    await page.locator(".shell-menu-item", { hasText: "Agent" }).first().click();
    await sample("back-0ms");
    await capture(page, "C6", "transition-editor-to-agent-000ms", S6);
    await page.waitForTimeout(100);
    await sample("back-100ms");
    await capture(page, "C6", "transition-editor-to-agent-100ms", S6);
    await page.waitForTimeout(200);
    await sample("back-300ms");
    await capture(page, "C6", "transition-editor-to-agent-300ms", S6);
    await page.waitForTimeout(700);
    await sample("back-end");
    await capture(page, "C6", "transition-editor-to-agent-end", S6);

    console.log(`\n@@TRANSITION ${JSON.stringify(frames)}`);
  });

  /* ------------------------------------ 2. tab order + focus rings */

  test("tab order and focus rings in both modes", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: "light" });

    const walk = async (label: string, steps: number) => {
      const seen: Array<Record<string, unknown>> = [];
      for (let i = 0; i < steps; i += 1) {
        await page.keyboard.press("Tab");
        const info = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return { tag: "BODY", label: null, ring: null, region: null };
          const s = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          const region = el.closest("[class*='shell-']")?.className ?? null;
          return {
            tag: el.tagName,
            cls: typeof el.className === "string" ? el.className : "",
            label:
              el.getAttribute("aria-label") ||
              el.getAttribute("title") ||
              (el.textContent ?? "").trim().slice(0, 40),
            ring: {
              outlineStyle: s.outlineStyle,
              outlineWidth: s.outlineWidth,
              outlineColor: s.outlineColor,
              boxShadow: s.boxShadow.slice(0, 60),
            },
            region: typeof region === "string" ? region.split(/\s+/)[0] : null,
            offscreen: r.width === 0 && r.height === 0,
          };
        });
        seen.push(info);
      }
      console.log(`\n@@TABORDER ${label} ${JSON.stringify(seen)}`);
      return seen;
    };

    await open(page, "C2", S6);
    await page.waitForTimeout(300);
    // What the browser considers tabbable in the top row, in DOM order, with
    // the focus rule that would apply. This is the inventory the walk below
    // then confirms.
    const topRow = await page.evaluate(() => {
      const row = document.querySelector(".shell-row--top");
      if (!row) return null;
      return Array.from(row.querySelectorAll<HTMLElement>("button, a, input, [tabindex]")).map((el) => ({
        cls: el.className,
        tabindex: el.getAttribute("tabindex"),
        label: el.getAttribute("aria-label") ?? (el.textContent ?? "").trim().slice(0, 24),
        rect: (() => {
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height) };
        })(),
      }));
    });
    console.log(`\n@@TOPROW ${JSON.stringify(topRow)}`);
    await page.locator("body").click({ position: { x: 2, y: 2 } });
    const agentOrder = await walk("C2-agent", 16);
    await page.keyboard.press("Tab");
    await capture(page, "C2", "keyboard-focus-ring", S6);

    await open(page, "C4", S6);
    await page.waitForTimeout(300);
    await page.locator("body").click({ position: { x: 2, y: 2 } });
    const editorOrder = await walk("C4-editor", 16);
    await page.keyboard.press("Tab");
    await capture(page, "C4", "keyboard-focus-ring", S6);

    // Collapsed rail: same buttons, no labels — does the ring still show?
    await open(page, "C1", S6);
    await page.waitForTimeout(300);
    await page.locator("body").click({ position: { x: 2, y: 2 } });
    await walk("C1-agent-rail", 10);
    await capture(page, "C1", "keyboard-focus-ring", S6);

    // C7: the same top row with home=false, where one tab *is* current. This
    // is the combination axis showing up in the tab order itself.
    await open(page, "C7", S6);
    await page.waitForTimeout(300);
    const topRowWorkspace = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>(".shell-tabstrip button")).map((el) => ({
        cls: el.className,
        tabindex: el.getAttribute("tabindex"),
      })),
    );
    console.log(`\n@@TOPROW-C7 ${JSON.stringify(topRowWorkspace)}`);
    await page.locator("body").click({ position: { x: 2, y: 2 } });
    await walk("C7-agent-workspace", 8);

    // Focus return after a menu closes.
    await open(page, "C2", S6);
    await page.waitForTimeout(250);
    const trigger = page.getByRole("button", { name: /Switch mode/ });
    await trigger.focus();
    await trigger.press("Enter");
    await page.waitForTimeout(150);
    const inMenu = await page.evaluate(() => (document.activeElement as HTMLElement)?.className ?? "");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    const afterEscape = await page.evaluate(() => (document.activeElement as HTMLElement)?.className ?? "");
    console.log(`\n@@FOCUSRETURN ${JSON.stringify({ inMenu, afterEscape })}`);

    expect(agentOrder.length).toBe(16);
    expect(editorOrder.length).toBe(16);
  });

  /* ------------------------ 3. CanvasPlaceholder's three skeletons */

  test("the floating presence is clamped to a size it does not have", async ({ page }) => {
    // AgentPresence.tsx:12 declares PANEL_SIZE = 340 x 520 and hands that to
    // both the default position and useDraggable's clamp. Whatever the panel
    // actually measures is what decides whether it stays on screen.
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, "C9", S6);
    await page.waitForTimeout(350);
    const declared = { width: 340, height: 520 };
    const before = await page.evaluate(() => {
      const el = document.querySelector(".shell-presence");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    });

    // Drag the panel by its header, far past the bottom-right corner.
    const handle = page.locator(".shell-presence .shell-task-head, .shell-presence header").first();
    const hasHandle = await handle.count();
    if (hasHandle) {
      const box = await handle.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(2000, 2000, { steps: 12 });
        await page.mouse.up();
        await page.waitForTimeout(250);
      }
    }
    const after = await page.evaluate(() => {
      const el = document.querySelector(".shell-presence");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
        bottom: Math.round(r.bottom),
        right: Math.round(r.right),
        vw: window.innerWidth,
        vh: window.innerHeight,
      };
    });
    await capture(page, "C9", "presence-dragged-to-corner", S6);
    console.log(`\n@@PRESENCE ${JSON.stringify({ declared, before, after, hasHandle })}`);
    expect(before).toBeTruthy();
  });

  test("the three canvas skeletons, 3100 only", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: "light" });

    const cases: Array<{ tab: RegExp; kind: string }> = [
      { tab: /MO launch plan/, kind: "doc" },
      { tab: /MO sales forecast/, kind: "sheet" },
      { tab: /MO launch deck/, kind: "slides" },
    ];

    for (const combination of ["C9", "C7"] as Combination[]) {
      for (const entry of cases) {
        await open(page, combination, S6);
        await page.waitForTimeout(300);
        const tab = page.getByRole("tab", { name: entry.tab }).first();
        if (await tab.count()) await tab.click();
        await page.waitForTimeout(350);
        await capture(page, combination, `skeleton-${entry.kind}`, S6);
        const m = await page.evaluate(() => {
          const scroll = document.querySelector(".shell-canvas-scroll");
          const canvas = document.querySelector(".shell-canvas");
          const paper = document.querySelector(".shell-skeleton-paper");
          const grid = document.querySelector(".shell-skeleton-grid");
          const strip = document.querySelector(".shell-skeleton-filmstrip");
          const slide = document.querySelector(".shell-skeleton-slide");
          const stage = document.querySelector(".shell-skeleton-stage");
          const box = (el: Element | null) => {
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return {
              x: Math.round(r.left),
              y: Math.round(r.top),
              w: Math.round(r.width),
              h: Math.round(r.height),
              scrollW: (el as HTMLElement).scrollWidth,
              clientW: (el as HTMLElement).clientWidth,
              scrollH: (el as HTMLElement).scrollHeight,
              clientH: (el as HTMLElement).clientHeight,
            };
          };
          return {
            classes: scroll?.className ?? null,
            canvas: box(canvas),
            scroll: box(scroll),
            paper: box(paper),
            grid: box(grid),
            filmstrip: box(strip),
            slide: box(slide),
            stage: box(stage),
            skeletonCells: document.querySelectorAll(".shell-skeleton-cell").length,
            thumbs: document.querySelectorAll(".shell-skeleton-thumb").length,
            ariaHiddenRoots: document.querySelectorAll(".shell-canvas [aria-hidden='true']").length,
            canvasText: (canvas?.textContent ?? "").trim().slice(0, 120),
          };
        });
        console.log(`\n@@SKELETON ${combination}/${entry.kind} ${JSON.stringify(m)}`);
      }
    }

    // Narrow width: does the sheet grid or the filmstrip survive 1040?
    await page.setViewportSize({ width: MIN_USABLE_WIDTH, height: 720 });
    for (const entry of cases) {
      await open(page, "C9", S6);
      await page.waitForTimeout(300);
      const tab = page.getByRole("tab", { name: entry.tab }).first();
      if (await tab.count()) await tab.click();
      await page.waitForTimeout(350);
      await capture(page, "C9", `skeleton-${entry.kind}-w1040`, S6);
      report(await probe(page, `C9/skeleton-${entry.kind}/1040`));
    }
  });
});

/* Follow-ups: two numbers the sweep pointed at but did not pin down. */
test.describe("S6 follow-ups", () => {
  test("tab-strip actions at the four widths", async ({ page }) => {
    for (const width of [1024, 1040, 1280, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      await open(page, "C2", { session: "S6" });
      await page.waitForTimeout(250);
      const m = await page.evaluate(() => {
        const box = (sel: string) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return {
            x: Math.round(r.left),
            right: Math.round(r.right),
            w: Math.round(r.width),
            display: s.display,
            visibility: s.visibility,
            opacity: s.opacity,
          };
        };
        return {
          vw: window.innerWidth,
          tabs: box(".shell-tabs"),
          strip: box(".shell-tabstrip"),
          actions: box(".shell-tabs-actions"),
          save: box(".shell-save-state"),
          share: box(".shell-share"),
          icons: box(".shell-tabs-icons"),
        };
      });
      console.log(`\n@@ACTIONS ${JSON.stringify(m)}`);
    }
  });

  test("editor home file table columns", async ({ page }) => {
    for (const width of [1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      await open(page, "C4", { session: "S6" });
      await page.waitForTimeout(250);
      const m = await page.evaluate(() => {
        const host = document.querySelector<HTMLElement>(".shell-home-list");
        const table = host?.querySelector<HTMLElement>("table");
        const head = table ? Array.from(table.querySelectorAll("thead th")) : [];
        const firstDataRow = table?.querySelector("tbody tr:not(.shell-list-group)");
        const cells = firstDataRow ? Array.from(firstDataRow.querySelectorAll("td")) : [];
        const box = (el: Element) => {
          const r = el.getBoundingClientRect();
          return { w: Math.round(r.width), text: (el.textContent ?? "").trim().slice(0, 28) };
        };
        // The widest cell in the folder column is what drives the table's
        // min-content width once td:first-child is pinned at 46%.
        let widest = { w: 0, text: "" };
        for (const td of Array.from(table?.querySelectorAll("tbody td:nth-child(2)") ?? [])) {
          const r = td.getBoundingClientRect();
          if (r.width > widest.w) widest = { w: Math.round(r.width), text: (td.textContent ?? "").trim().slice(0, 40) };
        }
        return {
          vw: window.innerWidth,
          host: host ? Math.round(host.getBoundingClientRect().width) : null,
          table: table ? Math.round(table.getBoundingClientRect().width) : null,
          tableLayout: table ? getComputedStyle(table).tableLayout : null,
          hostOverflowX: host ? getComputedStyle(host).overflowX : null,
          homeOverflowX: getComputedStyle(document.querySelector(".shell-home")!).overflowX,
          homeScrollW: (document.querySelector(".shell-home") as HTMLElement)?.scrollWidth,
          homeClientW: (document.querySelector(".shell-home") as HTMLElement)?.clientWidth,
          head: head.map(box),
          cells: cells.map(box),
          widestFolderCell: widest,
        };
      });
      console.log(`\n@@TABLE ${JSON.stringify(m)}`);
      await capture(page, "C4", `table-w${width}`, { session: "S6" });
    }
  });

  test("first-run fold on C1 at each width", async ({ page }) => {
    for (const width of [1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/?shell=C1`);
      await expect(page.locator("#shell")).toHaveAttribute("data-loaded", "true");
      await page.waitForTimeout(300);
      const m = await page.evaluate(() => {
        const empty = document.querySelector(".shell-list-empty");
        const hero = document.querySelector(".shell-hero-prompt, .shell-hero");
        const r = (el: Element | null) =>
          el ? { top: Math.round(el.getBoundingClientRect().top), bottom: Math.round(el.getBoundingClientRect().bottom) } : null;
        return {
          vh: window.innerHeight,
          emptyState: r(empty),
          emptyText: (empty?.textContent ?? "").trim().slice(0, 120),
          hero: r(hero),
          highlightCards: document.querySelectorAll(".shell-highlight-card").length,
        };
      });
      console.log(`\n@@FIRSTRUN ${JSON.stringify(m)}`);
      await capture(page, "C1", `zero-data-w${width}`, { session: "S6" });
    }
  });
});

test.describe("S6 follow-up: tucked expanded panel", () => {
  test("geometry after the floating panel tucks to the right edge", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, "C9", { session: "S6" });
    await page.waitForTimeout(350);
    const handle = page.locator(".shell-presence .shell-task-head").first();
    const box = await handle.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(2000, 2000, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(300);
    }
    const m = await page.evaluate(() => {
      const rect = (sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          left: Math.round(r.left),
          top: Math.round(r.top),
          right: Math.round(r.right),
          bottom: Math.round(r.bottom),
          w: Math.round(r.width),
          h: Math.round(r.height),
        };
      };
      const host = document.querySelector(".shell-presence");
      return {
        vw: window.innerWidth,
        vh: window.innerHeight,
        edge: host?.getAttribute("data-edge") ?? null,
        expanded: host?.getAttribute("data-expanded") ?? null,
        peekX: host ? getComputedStyle(host).getPropertyValue("--shell-presence-peek-x") : null,
        peekY: host ? getComputedStyle(host).getPropertyValue("--shell-presence-peek-y") : null,
        presence: rect(".shell-presence"),
        panel: rect(".shell-presence-panel"),
        head: rect(".shell-presence .shell-task-head"),
        face: rect(".shell-presence .shell-presence-mark, .shell-presence svg"),
        collapse: rect(".shell-presence-collapse"),
        composer: rect(".shell-presence .shell-cx, .shell-presence form, .shell-presence textarea"),
      };
    });
    console.log(`\n@@TUCK ${JSON.stringify(m)}`);
    expect(m.vw).toBe(1280);
  });
});
