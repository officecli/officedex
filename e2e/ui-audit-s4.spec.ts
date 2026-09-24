/**
 * S4 — editing canvas & floating agent, on the *real* bridge (PLAN 2.3, 3, 4).
 *
 * This is the only audit spec that does NOT drive the fixture server: it needs
 * `adapter !== null`, i.e. a real embedded editor mounted in `.shell-canvas`,
 * which only `scripts/dev-real.mjs` provides. Consequently
 * `CanvasPlaceholder`'s three skeletons can never appear here — that surface
 * belongs to S6 on 3100.
 *
 * Run:
 *   node scripts/dev-real.mjs --port 3210 <pptx> <xlsx> <docx>     # terminal 1
 *   S4_BRIDGE=<endpoint printed by dev-real> \
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:3210 \
 *     npx playwright test e2e/ui-audit-s4.spec.ts
 *
 * The shell has no `?shellFixture=1` equivalent against a real bridge, so the
 * ten combinations are reached by writing `officedex.shell.v1` (state/persist.ts)
 * and reloading with `?restoreSession=1` — a cold launch otherwise always
 * lands on Home with no tabs. The file ids in that state must be real, so the
 * first test imports three documents through the bridge's file-dialog control
 * channel and every later test reuses the persisted state it produced.
 */

import { expect, test, type Page } from "@playwright/test";

import { expectNoClip } from "./ui-audit-helpers";

const BRIDGE = process.env.S4_BRIDGE ?? "";

/**
 * A missing bridge is a broken run, not a case that does not apply.
 *
 * Every one of the thirty tests below used to open with
 * `test.skip(!BRIDGE, "S4_BRIDGE must point at the dev-real bridge endpoint")`.
 * Run without the variable — which is what happens when CI forgets to start
 * `dev-real`, or when somebody runs the whole `e2e/` directory — the suite
 * printed `30 skipped` and exited 0. In a summary line that is indistinguishable
 * from thirty passes, and it is the reason this file could not be put behind any
 * gate: it reported success for a configuration in which it had checked nothing
 * at all.
 *
 * `skip` is the right verb for "this case does not apply to this environment" —
 * a Windows-only assertion on macOS. It is the wrong verb for "the environment
 * this suite exists to test is not here", which is a configuration error, and
 * configuration errors have to be loud.
 *
 * The failure names the variable and the command, because the person who sees it
 * is usually someone who ran `npx playwright test` with no arguments and needs to
 * know what they were missing, not that something was missing.
 */
function requireBridge(): string {
  if (!BRIDGE) {
    throw new Error(
      "S4_BRIDGE is not set, so this suite has no real bridge to measure.\n" +
        "  node scripts/dev-real.mjs --port 3210 <pptx> <xlsx> <docx>\n" +
        "  S4_BRIDGE=<endpoint it prints> PLAYWRIGHT_BASE_URL=http://127.0.0.1:3210 \\\n" +
        "    npx playwright test e2e/ui-audit-s4.spec.ts",
    );
  }
  return BRIDGE;
}
const SHOTS = "docs/ui-audit-2026-09-19/S4/screenshots";
const PERSIST_KEY = "officedex.shell.v1";

const DOCUMENTS = [
  { path: "/tmp/s4-docs/sample.pptx", tab: "sample", type: "slides" },
  { path: "/tmp/s4-docs/sales-report.xlsx", tab: "sales-report", type: "sheet" },
  { path: "/tmp/s4-docs/sample.docx", tab: "sample", type: "doc" },
];

interface Persisted {
  mode: "agent" | "editor";
  home: boolean;
  homeList: "recent" | "pinned";
  navWidth: number;
  navCollapsed: boolean;
  taskWidth: number;
  selectedFolderId: string | null;
  expandedFolderIds: string[];
  revealedFolderIds: string[];
  openFileIds: string[];
  activeFileId: string | null;
  presence: {
    placement: "docked" | "floating";
    expanded: boolean;
    x: number | null;
    y: number | null;
    edge: "left" | "right" | "top" | "bottom" | null;
  };
}

/** Captured once, after the import, so every combination gets real file ids. */
let base: Persisted | null = null;

async function queueFileDialog(paths: string[]): Promise<void> {
  const response = await fetch(`${BRIDGE}/control/file-dialog`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ paths }),
  });
  if (!response.ok) throw new Error(`file-dialog control: ${response.status}`);
}

/**
 * Seeds the persisted view state *before* the app's first script runs.
 *
 * Writing it after `goto` loses a race: `ShellProvider` persists its own
 * initial state as soon as it mounts, so a value set between navigation and
 * mount is overwritten and the reload reads the default shell (C1) back. Every
 * combination in this spec would then have been filed under the wrong name.
 */
async function load(page: Page, state: Persisted): Promise<void> {
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key as string, value as string),
    [PERSIST_KEY, JSON.stringify(state)] as const,
  );
  await page.goto("/?restoreSession=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#shell")).toHaveAttribute("data-loaded", "true");
  // The embedded editor mounts asynchronously; a screenshot before it lands is
  // a picture of an empty canvas that looks exactly like a broken adapter.
  await page.waitForTimeout(2500);
}

/** Reads back what the shell believes it is showing — the audit's ground truth. */
async function shellAttrs(page: Page) {
  return page.evaluate(() => {
    const shell = document.querySelector("#shell");
    if (!shell) return null;
    return Object.fromEntries([...shell.attributes].map((a) => [a.name, a.value]));
  });
}

interface Geometry {
  presence: DOMRectLike | null;
  presenceZ: string | null;
  canvas: DOMRectLike | null;
  workspace: DOMRectLike | null;
  statusbar: DOMRectLike | null;
  tabs: DOMRectLike | null;
  sidebar: DOMRectLike | null;
  attention: DOMRectLike | null;
  /** Fraction of the canvas area the floating presence sits on top of. */
  coverRatio: number;
  /** What is directly under the presence's four corners, top document only. */
  under: string[];
  /** Elements inside the embedded editor's iframe under the panel, if any. */
  underInFrame: string[];
  viewport: { width: number; height: number };
}

interface DOMRectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

async function geometry(page: Page): Promise<Geometry> {
  return page.evaluate(() => {
    const rect = (selector: string): DOMRectLike | null => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const describe = (node: Element | null): string => {
      if (!node) return "(nothing)";
      const cls = typeof node.className === "string" ? node.className : node.tagName;
      return `${node.tagName.toLowerCase()}.${cls}`.slice(0, 90);
    };

    const presenceNode = document.querySelector(".shell-presence");
    const presence = rect(".shell-presence");
    const canvas = rect(".shell-canvas");

    let coverRatio = 0;
    if (presence && canvas) {
      const w = Math.max(0, Math.min(presence.right, canvas.right) - Math.max(presence.left, canvas.left));
      const h = Math.max(0, Math.min(presence.bottom, canvas.bottom) - Math.max(presence.top, canvas.top));
      const area = canvas.width * canvas.height;
      coverRatio = area > 0 ? (w * h) / area : 0;
    }

    // Corner probes, with the panel temporarily ignored for hit-testing so the
    // answer names what it covers rather than naming the panel itself.
    const under: string[] = [];
    const underInFrame: string[] = [];
    if (presence && presenceNode instanceof HTMLElement) {
      const previous = presenceNode.style.pointerEvents;
      presenceNode.style.pointerEvents = "none";
      const probes: Array<[string, number, number]> = [
        ["top-left", presence.left + 4, presence.top + 4],
        ["top-right", presence.right - 4, presence.top + 4],
        ["bottom-left", presence.left + 4, presence.bottom - 4],
        ["bottom-right", presence.right - 4, presence.bottom - 4],
        ["centre", (presence.left + presence.right) / 2, (presence.top + presence.bottom) / 2],
      ];
      for (const [name, x, y] of probes) {
        const hit = document.elementFromPoint(x, y);
        under.push(`${name}: ${describe(hit)}`);
        if (hit instanceof HTMLIFrameElement) {
          try {
            const frameRect = hit.getBoundingClientRect();
            const inner = hit.contentDocument?.elementFromPoint(x - frameRect.left, y - frameRect.top) ?? null;
            underInFrame.push(`${name}: ${describe(inner)}`);
          } catch {
            underInFrame.push(`${name}: (cross-origin)`);
          }
        }
      }
      presenceNode.style.pointerEvents = previous;
    }

    return {
      presence,
      presenceZ: presenceNode ? getComputedStyle(presenceNode).zIndex : null,
      canvas,
      workspace: rect(".shell-workspace"),
      statusbar: rect(".shell-statusbar"),
      tabs: rect(".shell-tabs"),
      sidebar: rect(".shell-sidebar"),
      attention: rect(".shell-attention"),
      coverRatio,
      under,
      underInFrame,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
}

function combo(patch: Partial<Persisted>): Persisted {
  if (!base) throw new Error("base state was never captured — the import test must run first");
  return { ...base, ...patch, presence: { ...base.presence, ...(patch.presence ?? {}) } };
}

test.describe.serial("S4 — editing canvas & floating agent (dev-real 3210)", () => {
  test("imports three real documents and captures the base shell state", async ({ page }) => {
    requireBridge();

    await page.addInitScript(
      ([key, value]) => localStorage.setItem(key as string, value as string),
      [
        PERSIST_KEY,
        JSON.stringify({
          mode: "editor",
          home: true,
          homeList: "recent",
          navWidth: 190,
          navCollapsed: false,
          taskWidth: 320,
          selectedFolderId: null,
          expandedFolderIds: [],
          revealedFolderIds: [],
          openFileIds: [],
          activeFileId: null,
          presence: { placement: "docked", expanded: true, x: null, y: null, edge: null },
        }),
      ] as const,
    );
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#shell")).toHaveAttribute("data-loaded", "true");

    for (const [index, document] of DOCUMENTS.entries()) {
      await queueFileDialog([document.path]);
      await page.getByRole("button", { name: "Open", exact: true }).click();
      // Import is a real round trip through officecli; wait for the tab rather
      // than for a fixed delay, or a slow conversion silently drops a document
      // and the whole matrix runs one file short.
      await expect(page.locator(".shell-tab")).toHaveCount(index + 1, { timeout: 60_000 });
      await page.waitForTimeout(1500);
    }

    base = (await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), PERSIST_KEY)) as Persisted;
    expect(base, "the import produced no persisted state").not.toBeNull();
    expect(base.openFileIds.length, "three documents should be open").toBeGreaterThanOrEqual(3);
    console.log("[S4] base state:", JSON.stringify(base));
  });

  /* ------------------------------------------------- C5–C10, all three types */

  const combos = [
    { id: "C5", mode: "agent" as const, navCollapsed: true, placement: "docked" as const },
    { id: "C6", mode: "agent" as const, navCollapsed: false, placement: "docked" as const },
    { id: "C7", mode: "agent" as const, navCollapsed: true, placement: "floating" as const },
    { id: "C8", mode: "agent" as const, navCollapsed: false, placement: "floating" as const },
    { id: "C9", mode: "editor" as const, navCollapsed: true, placement: "docked" as const },
    { id: "C10", mode: "editor" as const, navCollapsed: false, placement: "docked" as const },
  ];

  for (const c of combos) {
    test(`${c.id}: geometry over a real editor`, async ({ page }) => {
      requireBridge();
      await page.setViewportSize({ width: 1440, height: 900 });
      await load(
        page,
        combo({
          mode: c.mode,
          home: false,
          navCollapsed: c.navCollapsed,
          presence: { ...combo({}).presence, placement: c.placement },
        }),
      );

      const attrs = await shellAttrs(page);
      const g = await geometry(page);
      console.log(`[S4][${c.id}] attrs=${JSON.stringify(attrs)}`);
      console.log(`[S4][${c.id}] geometry=${JSON.stringify(g, null, 1)}`);

      // PLAN section 2: editor mode forces floating whatever the preference says.
      if (c.mode === "editor") {
        expect(attrs?.["data-presence"], `${c.id} must be forced floating`).toBe("floating");
      }

      await page.screenshot({ path: `${SHOTS}/${c.id}-docx-default.png` });
    });
  }

  /* ----------------------------------------------- per-file-type occlusion */

  for (const document of DOCUMENTS) {
    test(`C10: floating panel over a real ${document.type} editor`, async ({ page }) => {
      requireBridge();
      await page.setViewportSize({ width: 1440, height: 900 });
      await load(page, combo({ mode: "editor", home: false, navCollapsed: false }));

      // Tabs are named after the file; activating one swaps the mounted editor.
      const tab = page.locator(".shell-tab-name", { hasText: document.tab }).first();
      await tab.click();
      await page.waitForTimeout(3000);

      const g = await geometry(page);
      console.log(`[S4][C10-${document.type}] geometry=${JSON.stringify(g, null, 1)}`);
      await page.screenshot({ path: `${SHOTS}/C10-${document.type}-occlusion.png` });

      expect(g.presence, "the floating presence must exist in editor mode").not.toBeNull();
    });
  }

  /* -------------------------------------------------------- drag behaviour */

  test("C10: the panel can be dragged and where it lands", async ({ page }) => {
    requireBridge();
    await page.setViewportSize({ width: 1440, height: 900 });
    await load(page, combo({ mode: "editor", home: false, navCollapsed: false }));

    const grip = page.locator(".shell-task-head.is-grip");
    await expect(grip).toHaveCount(1);

    const drags: Array<[string, number, number]> = [
      ["far-right", 3000, 450],
      ["far-bottom", 700, 3000],
      ["far-top-left", -3000, -3000],
      ["under-tabs", 700, 5],
    ];

    const results: Record<string, unknown> = {};
    for (const [name, x, y] of drags) {
      const box = await grip.boundingBox();
      if (!box) throw new Error("the grip has no box");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(x, y, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(500);

      const g = await geometry(page);
      const persisted = await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key) ?? "null")?.presence,
        PERSIST_KEY,
      );
      results[name] = { rect: g.presence, edge: await page.locator(".shell-presence").getAttribute("data-edge"), persisted };
      console.log(`[S4][drag ${name}] ${JSON.stringify(results[name])}`);
      await page.screenshot({ path: `${SHOTS}/C10-drag-${name}.png` });
    }
  });

  test("C10: a tucked panel survives a reload, and can it be dragged back", async ({ page }) => {
    requireBridge();
    await page.setViewportSize({ width: 1440, height: 900 });
    // Persist a position that is already off the right edge, the way a drag to
    // the far right leaves it, and see what the shell renders on a cold start.
    await load(
      page,
      combo({
        mode: "editor",
        home: false,
        navCollapsed: false,
        presence: { ...combo({}).presence, x: 1412, y: 300, edge: "right", expanded: true },
      }),
    );
    const g = await geometry(page);
    console.log(`[S4][tucked-right-reload] ${JSON.stringify(g, null, 1)}`);
    await page.screenshot({ path: `${SHOTS}/C10-tucked-right-reload.png` });

    // Collapsed + tucked: the face, per agent.css's overhang rules.
    await load(
      page,
      combo({
        mode: "editor",
        home: false,
        navCollapsed: false,
        presence: { ...combo({}).presence, x: 1412, y: 300, edge: "right", expanded: false },
      }),
    );
    const collapsed = await geometry(page);
    console.log(`[S4][tucked-right-collapsed] ${JSON.stringify(collapsed, null, 1)}`);
    await page.screenshot({ path: `${SHOTS}/C10-tucked-right-collapsed.png` });
  });

  test("C10: small window — the panel against a 1024x700 viewport", async ({ page }) => {
    requireBridge();
    await page.setViewportSize({ width: 1024, height: 700 });
    await load(page, combo({ mode: "editor", home: false, navCollapsed: false }));
    const g = await geometry(page);
    console.log(`[S4][C10-1024x700] ${JSON.stringify(g, null, 1)}`);
    await page.screenshot({ path: `${SHOTS}/C10-1024x700.png` });
  });

  /* ---------------------------------------------------------------- seams */

  test("C10: the seam between shell chrome and the embedded editor", async ({ page }) => {
    requireBridge();
    await page.setViewportSize({ width: 1440, height: 900 });
    await load(page, combo({ mode: "editor", home: false, navCollapsed: false }));

    const seam = await page.evaluate(() => {
      const pick = (selector: string, properties: string[]) => {
        const node = document.querySelector(selector);
        if (!node) return null;
        const style = getComputedStyle(node);
        return Object.fromEntries(properties.map((p) => [p, style.getPropertyValue(p)]));
      };
      const frame = document.querySelector<HTMLIFrameElement>(".shell-canvas iframe");
      let inside: Record<string, unknown> | null = null;
      try {
        const doc = frame?.contentDocument ?? null;
        if (doc) {
          const bodyStyle = getComputedStyle(doc.body);
          inside = {
            fontFamily: bodyStyle.fontFamily,
            fontSize: bodyStyle.fontSize,
            lang: doc.documentElement.lang,
            // The editor's own chrome, in its own language.
            firstToolbarText: (doc.querySelector("[class*='tab'],[class*='ribbon'],[role='tab']")?.textContent ?? "").slice(0, 60),
            scrollbarWidth: bodyStyle.getPropertyValue("scrollbar-width"),
          };
        }
      } catch {
        inside = { error: "cross-origin" };
      }
      return {
        shellBody: pick("body", ["font-family", "font-size"]),
        canvas: pick(".shell-canvas", ["background-color", "overflow", "border"]),
        statusbar: pick(".shell-statusbar", ["background-color", "height", "font-size", "font-family"]),
        workspace: pick(".shell-workspace", ["background-color"]),
        taskScroll: pick(".shell-task-scroll", ["scrollbar-width", "overflow"]),
        frameAttrs: frame
          ? { src: frame.getAttribute("src"), sandbox: frame.getAttribute("sandbox"), style: frame.getAttribute("style") }
          : null,
        inside,
        documentLang: document.documentElement.lang,
      };
    });
    console.log(`[S4][seam] ${JSON.stringify(seam, null, 1)}`);
  });

  test("C10: the collapse button's reserved slot", async ({ page }) => {
    requireBridge();
    await page.setViewportSize({ width: 1440, height: 900 });
    await load(page, combo({ mode: "editor", home: false, navCollapsed: false }));

    const slot = await page.evaluate(() => {
      const panel = document.querySelector(".shell-presence-panel");
      const collapse = document.querySelector(".shell-presence-collapse");
      const dock = document.querySelector(".shell-task-head .shell-icon-button");
      if (!panel || !collapse) return null;
      const p = panel.getBoundingClientRect();
      const c = collapse.getBoundingClientRect();
      return {
        panelRight: p.right,
        collapseRight: c.right,
        gapToPanelEdge: p.right - c.right,
        computedRight: getComputedStyle(collapse).right,
        dockButtonPresent: dock !== null,
      };
    });
    console.log(`[S4][collapse-slot] ${JSON.stringify(slot)}`);
    expect(slot).not.toBeNull();
  });

  test("C8 vs C10: docked-preference round trip and the agent column", async ({ page }) => {
    requireBridge();
    await page.setViewportSize({ width: 1440, height: 900 });

    await load(page, combo({ mode: "agent", home: false, navCollapsed: false }));
    const agentDocked = await page.evaluate(() => {
      const section = document.querySelector(".shell-agent");
      const shell = document.querySelector("#shell");
      return {
        presence: shell?.getAttribute("data-presence"),
        taskWidthVar: shell ? getComputedStyle(shell).getPropertyValue("--shell-task-w") : null,
        agentRect: section?.getBoundingClientRect().width ?? null,
        floatingPresent: document.querySelector(".shell-presence") !== null,
        inert: section?.hasAttribute("inert"),
      };
    });
    console.log(`[S4][C6-docked] ${JSON.stringify(agentDocked)}`);
    await page.screenshot({ path: `${SHOTS}/C6-docked-column.png` });

    await load(page, combo({ mode: "editor", home: false, navCollapsed: false }));
    const editorForced = await page.evaluate(() => {
      const section = document.querySelector(".shell-agent");
      const shell = document.querySelector("#shell");
      return {
        presence: shell?.getAttribute("data-presence"),
        taskWidthVar: shell ? getComputedStyle(shell).getPropertyValue("--shell-task-w") : null,
        agentRect: section?.getBoundingClientRect().width ?? null,
        floatingPresent: document.querySelector(".shell-presence") !== null,
        inert: section?.hasAttribute("inert"),
      };
    });
    console.log(`[S4][C10-forced-floating] ${JSON.stringify(editorForced)}`);
    expect(editorForced.presence).toBe("floating");
  });

  test("C10: the attention border against the real canvas", async ({ page }) => {
    requireBridge();
    await page.setViewportSize({ width: 1440, height: 900 });
    await load(page, combo({ mode: "editor", home: false, navCollapsed: false }));

    const alignment = await page.evaluate(() => {
      const box = (selector: string) => {
        const node = document.querySelector(selector);
        if (!node) return null;
        const r = node.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      };
      const attention = document.querySelector(".shell-attention");
      return {
        attention: box(".shell-attention"),
        canvas: box(".shell-canvas"),
        statusbar: box(".shell-statusbar"),
        workspace: box(".shell-workspace"),
        attentionChildren: attention?.children.length ?? -1,
        statusbarHeightVar: getComputedStyle(document.documentElement).getPropertyValue("--shell-statusbar-h"),
      };
    });
    console.log(`[S4][attention] ${JSON.stringify(alignment, null, 1)}`);
    expect(alignment.attention).not.toBeNull();
  });

  test("C10: does the menu layer lose to the floating panel", async ({ page }) => {
    requireBridge();
    await page.setViewportSize({ width: 1440, height: 900 });
    await load(page, combo({ mode: "editor", home: false, navCollapsed: false }));

    const layers = await page.evaluate(() => {
      const z = (selector: string) => {
        const node = document.querySelector(selector);
        return node ? getComputedStyle(node).zIndex : null;
      };
      return {
        presence: z(".shell-presence"),
        tabs: z(".shell-tabs"),
        toastHost: z(".od-toast-host"),
        canvas: z(".shell-canvas"),
      };
    });
    console.log(`[S4][layers] ${JSON.stringify(layers)}`);

    // Open the sidebar settings menu and see whether the panel covers it.
    await page.getByRole("button", { name: "Settings" }).click();
    await page.waitForTimeout(300);
    const menu = await page.evaluate(() => {
      const node = document.querySelector(".shell-menu");
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { z: getComputedStyle(node).zIndex, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } };
    });
    console.log(`[S4][menu-over-panel] ${JSON.stringify(menu)}`);
    await page.screenshot({ path: `${SHOTS}/C10-menu-vs-panel.png` });
    if (menu) await expectNoClip(page, ".shell-menu").catch((error: Error) => console.log(`[S4][menu-clip] ${error.message.slice(0, 400)}`));
  });

  /* ------------------------------------------------ round two: the details */

  /**
   * The position persisted by the import run is a placed one. This is the
   * shell as a user who has never touched the panel sees it: `presence.x/y`
   * null, so AgentPresence resolves the bottom-right default against the
   * current viewport.
   */
  test("C9/C10: the never-placed default position over a real editor", async ({ page }) => {
    requireBridge();
    for (const [id, navCollapsed] of [["C9", true], ["C10", false]] as const) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await load(
        page,
        combo({
          mode: "editor",
          home: false,
          navCollapsed,
          presence: { placement: "docked", expanded: true, x: null, y: null, edge: null },
        }),
      );
      const g = await geometry(page);
      const overlaps = await page.evaluate(() => {
        const p = document.querySelector(".shell-presence")?.getBoundingClientRect();
        const status = document.querySelector(".shell-statusbar")?.getBoundingClientRect();
        if (!p || !status) return null;
        return {
          panelBottom: p.bottom,
          statusbarTop: status.top,
          overlapsShellStatusbar: p.bottom > status.top,
          // The sheet SDK renders its own chrome in the top document, so it can
          // be measured directly; Writer and the presentation are in iframes.
          sheetStatusBar: document.querySelector(".sm-sheet-status-bar-wrapper")?.getBoundingClientRect() ?? null,
          sheetTabs: document.querySelector(".sm-sheet-tab-container")?.getBoundingClientRect() ?? null,
        };
      });
      console.log(`[S4][${id}-default] presence=${JSON.stringify(g.presence)} cover=${g.coverRatio} under=${JSON.stringify(g.under)}`);
      console.log(`[S4][${id}-default] overlaps=${JSON.stringify(overlaps)}`);
      await page.screenshot({ path: `${SHOTS}/${id}-default-position.png` });
    }
  });

  /**
   * `.shell-presence-panel` sets `overflow: hidden` (agent.css:322) and nothing
   * in `src/shell` uses `createPortal`, so every menu the floating composer can
   * open is laid out inside a box that clips it.
   */
  test("C10: the floating composer's own menus against the panel's overflow", async ({ page }) => {
    requireBridge();
    await page.setViewportSize({ width: 1440, height: 900 });
    await load(
      page,
      combo({
        mode: "editor",
        home: false,
        navCollapsed: false,
        presence: { placement: "docked", expanded: true, x: null, y: null, edge: null },
      }),
    );

    const panelOverflow = await page.evaluate(() => {
      const panel = document.querySelector(".shell-presence-panel");
      return panel ? getComputedStyle(panel).overflow : null;
    });
    console.log(`[S4][panel-overflow] ${panelOverflow}`);

    // The model menu, opened from inside the floating panel.
    await page.locator(".shell-presence .shell-cx-model").click();
    await page.waitForTimeout(300);
    const model = await page.evaluate(() => {
      const menu = document.querySelector(".shell-presence .shell-menu, .shell-presence [class*='shell-model']");
      const panel = document.querySelector(".shell-presence-panel");
      if (!menu || !panel) return { menu: null, panel: null };
      const m = menu.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      return {
        menu: { cls: menu.className, left: m.left, top: m.top, right: m.right, bottom: m.bottom, height: m.height },
        panel: { left: p.left, top: p.top, right: p.right, bottom: p.bottom },
        clippedBelow: m.bottom > p.bottom,
        clippedAbove: m.top < p.top,
        z: getComputedStyle(menu).zIndex,
      };
    });
    console.log(`[S4][floating-model-menu] ${JSON.stringify(model)}`);
    // `overflow: hidden` boxes still scroll programmatically: focusing the menu
    // scrolls the panel and there is no scrollbar to put it back.
    const scrolled = await page.evaluate(() => {
      const panel = document.querySelector(".shell-presence-panel");
      const head = document.querySelector(".shell-task-head");
      if (!panel) return null;
      const p = panel.getBoundingClientRect();
      const h = head?.getBoundingClientRect();
      return {
        scrollTop: panel.scrollTop,
        scrollHeight: panel.scrollHeight,
        clientHeight: panel.clientHeight,
        headTop: h?.top ?? null,
        panelTop: p.top,
        headAbovePanel: h ? h.top < p.top - 0.5 : null,
      };
    });
    console.log(`[S4][panel-scrolled-by-focus] ${JSON.stringify(scrolled)}`);
    await page.screenshot({ path: `${SHOTS}/C10-floating-model-menu.png` });

    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);

    // The mention menu: type "@" into the floating composer.
    await page.locator(".shell-presence .shell-cx-input, .shell-presence textarea").first().click();
    await page.keyboard.type("@");
    await page.waitForTimeout(500);
    const mention = await page.evaluate(() => {
      const menu = document.querySelector(".shell-mention");
      const panel = document.querySelector(".shell-presence-panel");
      if (!menu || !panel) return null;
      const m = menu.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      return {
        menu: { left: m.left, top: m.top, right: m.right, bottom: m.bottom, height: m.height },
        panel: { left: p.left, top: p.top, right: p.right, bottom: p.bottom },
        clippedBelow: m.bottom > p.bottom + 0.5,
        clippedAbove: m.top < p.top - 0.5,
        visibleHeight: Math.max(0, Math.min(m.bottom, p.bottom) - Math.max(m.top, p.top)),
      };
    });
    console.log(`[S4][floating-mention-menu] ${JSON.stringify(mention)}`);
    await page.screenshot({ path: `${SHOTS}/C10-floating-mention-menu.png` });
  });

  /**
   * `place()` clamps a top-tucked panel's x to 12 (useDraggable.ts:65), and the
   * window bar's traffic lights live between x=13 and x=75 (WindowBar.tsx).
   */
  test("C10: the panel parked over the window bar's traffic lights", async ({ page }) => {
    requireBridge();
    await page.setViewportSize({ width: 1440, height: 900 });
    await load(page, combo({ mode: "editor", home: false, navCollapsed: false }));

    const grip = page.locator(".shell-task-head.is-grip");
    const box = await grip.boundingBox();
    if (!box) throw new Error("no grip");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(14, 2, { steps: 14 });
    await page.mouse.up();
    await page.waitForTimeout(500);

    const verdict = await page.evaluate(() => {
      const panel = document.querySelector(".shell-presence");
      const lights = [...document.querySelectorAll(".shell-window-button, .shell-windowbar button")];
      if (!panel) return null;
      const p = panel.getBoundingClientRect();
      const covered = lights.map((node) => {
        const r = node.getBoundingClientRect();
        const centreX = (r.left + r.right) / 2;
        const centreY = (r.top + r.bottom) / 2;
        return {
          label: node.getAttribute("aria-label") ?? node.className,
          rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
          insidePanel: centreX >= p.left && centreX <= p.right && centreY >= p.top && centreY <= p.bottom,
          topHit: (document.elementFromPoint(centreX, centreY)?.className ?? "").toString().slice(0, 60),
        };
      });
      return { panel: { left: p.left, top: p.top, right: p.right, bottom: p.bottom }, edge: panel.getAttribute("data-edge"), covered };
    });
    console.log(`[S4][traffic-lights] ${JSON.stringify(verdict, null, 1)}`);
    await page.screenshot({ path: `${SHOTS}/C10-over-traffic-lights.png` });
  });

  /**
   * agent.css:236-253 pushes the overhang out with a transform on `.shell-face`
   * — the collapsed mark. An *expanded* panel has `.shell-face` instances
   * inside it (the header companion, the empty-state companion), and the tuck
   * rule matches those too.
   */
  test("C10: what edge-tucking does to an expanded panel", async ({ page }) => {
    requireBridge();
    await page.setViewportSize({ width: 1440, height: 900 });
    await load(
      page,
      combo({
        mode: "editor",
        home: false,
        navCollapsed: false,
        presence: { placement: "docked", expanded: true, x: 1412, y: 240, edge: "right" },
      }),
    );

    const tuck = await page.evaluate(() => {
      const presence = document.querySelector(".shell-presence");
      const panel = document.querySelector(".shell-presence-panel");
      const head = document.querySelector(".shell-task-head");
      const faces = [...document.querySelectorAll(".shell-presence .shell-face")];
      if (!presence || !panel) return null;
      const pr = presence.getBoundingClientRect();
      const pa = panel.getBoundingClientRect();
      return {
        presenceRect: { left: pr.left, top: pr.top, right: pr.right, bottom: pr.bottom, width: pr.width },
        panelRect: { left: pa.left, top: pa.top, right: pa.right, bottom: pa.bottom, width: pa.width },
        opacity: getComputedStyle(presence).opacity,
        peekX: getComputedStyle(presence).getPropertyValue("--shell-presence-peek-x"),
        headRect: head ? (({ left, right }) => ({ left, right }))(head.getBoundingClientRect()) : null,
        faces: faces.map((face) => {
          const r = face.getBoundingClientRect();
          return {
            transform: getComputedStyle(face).transform,
            left: r.left,
            right: r.right,
            outsideViewport: r.left > window.innerWidth || r.right < 0,
            outsidePanel: r.right > pa.right + 0.5 || r.left < pa.left - 0.5,
          };
        }),
      };
    });
    console.log(`[S4][expanded-tuck] ${JSON.stringify(tuck, null, 1)}`);
    await page.screenshot({ path: `${SHOTS}/C10-expanded-tuck-right.png` });
  });

  /** The base font the shell hands to the document, per mounted editor. */
  test("C10: what each embedded editor does to the shell's typography", async ({ page }) => {
    requireBridge();
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const document of DOCUMENTS) {
      await load(page, combo({ mode: "editor", home: false, navCollapsed: false }));
      await page.locator(".shell-tab-name", { hasText: document.tab }).first().click();
      await page.waitForTimeout(3000);
      const typography = await page.evaluate(() => {
        const body = getComputedStyle(document.body);
        const status = document.querySelector(".shell-statusbar");
        const scrollbars = (selector: string) => {
          const node = document.querySelector(selector);
          if (!node) return null;
          const s = getComputedStyle(node);
          return { width: s.getPropertyValue("scrollbar-width"), color: s.getPropertyValue("scrollbar-color") };
        };
        return {
          bodyFont: body.fontFamily.slice(0, 60),
          bodyFontSize: body.fontSize,
          shellFontToken: getComputedStyle(document.documentElement).getPropertyValue("--shell-font").slice(0, 60),
          statusbarFont: status ? getComputedStyle(status).fontFamily.slice(0, 60) : null,
          canvasScrollbar: scrollbars(".shell-canvas"),
          taskScrollbar: scrollbars(".shell-task-scroll"),
          embeddedIsIframe: document.querySelector(".shell-canvas iframe") !== null,
        };
      });
      console.log(`[S4][typography ${document.type}] ${JSON.stringify(typography)}`);
    }
  });

  /** Scrolling the document must not move a viewport-fixed panel. */
  test("C10: the panel while the document scrolls", async ({ page }) => {
    requireBridge();
    await page.setViewportSize({ width: 1440, height: 900 });
    await load(
      page,
      combo({
        mode: "editor",
        home: false,
        navCollapsed: false,
        presence: { placement: "docked", expanded: true, x: null, y: null, edge: null },
      }),
    );
    // The sheet is the one editor whose scroll container lives in this document.
    await page.locator(".shell-tab-name", { hasText: "sales-report" }).first().click();
    await page.waitForTimeout(3000);

    const before = (await geometry(page)).presence;
    await page.mouse.move(500, 500);
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(600);
    const after = await geometry(page);
    console.log(`[S4][scroll] before=${JSON.stringify(before)} after=${JSON.stringify(after.presence)} attention=${JSON.stringify(after.attention)}`);
    await page.screenshot({ path: `${SHOTS}/C10-after-scroll.png` });
    expect(after.presence?.top, "a fixed panel must not move with the document").toBe(before?.top);
  });

  /* ---------------------------------------------- round three: the seam bar */

  /**
   * `.shell-canvas` is `overflow: hidden` and ends at the status bar, so an
   * embedded editor's own bottom chrome should be clipped there. The workbook
   * SDK's bar is not, which is the question this answers with numbers.
   */
  test("C10: who owns the bottom 32px — the shell status bar or the workbook's", async ({ page }) => {
    requireBridge();
    await page.setViewportSize({ width: 1440, height: 900 });

    for (const document of DOCUMENTS) {
      await load(
        page,
        combo({
          mode: "editor",
          home: false,
          navCollapsed: false,
          presence: { placement: "docked", expanded: true, x: 200, y: 120, edge: null },
        }),
      );
      await page.locator(".shell-tab-name", { hasText: document.tab }).first().click();
      await page.waitForTimeout(3000);

      const bottom = await page.evaluate(() => {
        const status = document.querySelector(".shell-statusbar");
        const canvas = document.querySelector(".shell-canvas");
        if (!status || !canvas) return null;
        const s = status.getBoundingClientRect();
        const c = canvas.getBoundingClientRect();
        const probeY = (s.top + s.bottom) / 2;
        const probes = [0.25, 0.5, 0.9].map((fraction) => {
          const x = s.left + s.width * fraction;
          const hit = document.elementFromPoint(x, probeY);
          return {
            x: Math.round(x),
            hit: `${hit?.tagName.toLowerCase()}.${typeof hit?.className === "string" ? hit.className : ""}`.slice(0, 70),
            insideShellStatusbar: hit ? status.contains(hit) : false,
          };
        });
        const sheetBar = document.querySelector(".sm-sheet-tab-container");
        return {
          statusbar: { top: s.top, bottom: s.bottom, left: s.left, right: s.right },
          canvasBottom: c.bottom,
          probes,
          sheetBarPosition: sheetBar
            ? {
                position: getComputedStyle(sheetBar).position,
                rect: (({ top, bottom, left, right }) => ({ top, bottom, left, right }))(sheetBar.getBoundingClientRect()),
                overflowsCanvasBy: sheetBar.getBoundingClientRect().bottom - c.bottom,
              }
            : null,
        };
      });
      console.log(`[S4][bottom-bar ${document.type}] ${JSON.stringify(bottom)}`);
      await page.screenshot({ path: `${SHOTS}/C10-${document.type}-bottom-bar.png` });
    }
  });

  /** Where do the portaled legacy overlays live, and in whose type stack. */
  test("C10: portaled overlays are outside .shell", async ({ page }) => {
    requireBridge();
    await page.setViewportSize({ width: 1440, height: 900 });
    await load(page, combo({ mode: "editor", home: false, navCollapsed: false }));

    const outside = await page.evaluate(() => {
      const shell = document.querySelector("#shell");
      const toastHost = document.querySelector(".od-toast-host");
      const sheets = [...document.styleSheets].flatMap((sheet) => {
        try {
          return [...sheet.cssRules]
            .filter((rule) => rule.cssText.startsWith("body") && rule.cssText.includes("font-family"))
            .map((rule) => `${sheet.href ?? "(inline)"} :: ${rule.cssText.slice(0, 160)}`);
        } catch {
          return [];
        }
      });
      return {
        toastHostInsideShell: toastHost && shell ? shell.contains(toastHost) : null,
        toastHostParent: toastHost?.parentElement?.tagName.toLowerCase() ?? null,
        toastHostFont: toastHost ? getComputedStyle(toastHost).fontFamily.slice(0, 70) : null,
        shellFont: shell ? getComputedStyle(shell).fontFamily.slice(0, 70) : null,
        bodyFontRules: sheets.slice(0, 6),
        shellFontTokenOnShell: shell ? getComputedStyle(shell).getPropertyValue("--shell-font").slice(0, 70) : null,
      };
    });
    console.log(`[S4][portals] ${JSON.stringify(outside, null, 1)}`);
  });

  /**
   * The narrowest reachable top-edge x is 12 (useDraggable.ts:65), and the
   * traffic lights occupy 12–75 (WindowBar.tsx). This is that exact state.
   */
  test("C10: a top-tucked panel at the minimum x, over the traffic lights", async ({ page }) => {
    requireBridge();
    await page.setViewportSize({ width: 1440, height: 900 });
    await load(
      page,
      combo({
        mode: "editor",
        home: false,
        navCollapsed: false,
        // What place(x, y, "top") writes for the leftmost reachable drop.
        presence: { placement: "docked", expanded: true, x: 12, y: 28 - 517, edge: "top" },
      }),
    );

    const verdict = await page.evaluate(() => {
      const panel = document.querySelector(".shell-presence");
      if (!panel) return null;
      const p = panel.getBoundingClientRect();
      const buttons = [...document.querySelectorAll("[class*='shell-window-']")].filter(
        (node) => node.tagName === "BUTTON",
      );
      return {
        panel: { left: p.left, top: p.top, right: p.right, bottom: p.bottom },
        opacity: getComputedStyle(panel).opacity,
        buttons: buttons.map((node) => {
          const r = node.getBoundingClientRect();
          const cx = (r.left + r.right) / 2;
          const cy = (r.top + r.bottom) / 2;
          const hit = document.elementFromPoint(cx, cy);
          return {
            label: node.getAttribute("aria-label"),
            covered: cx >= p.left && cx <= p.right && cy >= p.top && cy <= p.bottom,
            topHit: `${hit?.tagName.toLowerCase()}.${typeof hit?.className === "string" ? hit.className : ""}`.slice(0, 60),
          };
        }),
      };
    });
    console.log(`[S4][top-tuck-min-x] ${JSON.stringify(verdict, null, 1)}`);
    await page.screenshot({ path: `${SHOTS}/C10-top-tuck-over-traffic-lights.png` });
  });

  /**
   * The presentation, by tab index rather than by name.
   *
   * `sample.pptx` and `sample.docx` both render a tab reading "sample", so
   * selecting by text always landed on the first of the two — the earlier
   * per-type runs measured the Word editor twice and never opened the deck.
   * Tab order is `openFileIds` order: docx, pptx, xlsx.
   */
  test("C10: floating panel over the real presentation editor", async ({ page }) => {
    requireBridge();
    await page.setViewportSize({ width: 1440, height: 900 });
    await load(
      page,
      combo({
        mode: "editor",
        home: false,
        navCollapsed: false,
        presence: { placement: "docked", expanded: true, x: null, y: null, edge: null },
      }),
    );
    await page.locator(".shell-tab-select").nth(1).click();
    await page.waitForTimeout(4000);

    const g = await geometry(page);
    const which = await page.evaluate(() => ({
      canvasLabel: document.querySelector("[data-canvas-host]")?.getAttribute("aria-label"),
      fileType: document.querySelector("[data-canvas-host]")?.getAttribute("data-file-type"),
      frame: document.querySelector(".shell-canvas iframe")?.className ?? null,
      statusbarHit: (() => {
        const status = document.querySelector(".shell-statusbar");
        if (!status) return null;
        const r = status.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, (r.top + r.bottom) / 2);
        return { hit: `${hit?.tagName.toLowerCase()}.${typeof hit?.className === "string" ? hit.className : ""}`.slice(0, 60), inside: hit ? status.contains(hit) : false };
      })(),
    }));
    console.log(`[S4][C10-pptx] which=${JSON.stringify(which)}`);
    console.log(`[S4][C10-pptx] geometry=${JSON.stringify({ presence: g.presence, cover: g.coverRatio, under: g.under, underInFrame: g.underInFrame })}`);
    await page.screenshot({ path: `${SHOTS}/C10-pptx-occlusion.png` });
    expect(which.fileType, "this test must be looking at the deck").toBe("slides");
  });

  /**
   * PLAN 2.2, at the seam: `src/shell` has zero `t("` calls and is hardcoded
   * English, while each embedded editor ships its own locale. This records what
   * each one actually says, so the mix is a string and not an impression.
   */
  test("C10: the language of each embedded editor next to the English shell", async ({ page }) => {
    requireBridge();
    await page.setViewportSize({ width: 1440, height: 900 });

    const byIndex = [
      { index: 0, type: "doc" },
      { index: 1, type: "slides" },
      { index: 2, type: "sheet" },
    ];

    for (const { index, type } of byIndex) {
      await load(page, combo({ mode: "editor", home: false, navCollapsed: false }));
      await page.locator(".shell-tab-select").nth(index).click();
      await page.waitForTimeout(4000);

      const said = await page.evaluate(() => {
        const host = document.querySelector("[data-canvas-host]");
        const frame = document.querySelector<HTMLIFrameElement>(".shell-canvas iframe");
        const scope: Document | null = frame ? (frame.contentDocument ?? null) : document;
        const read = (root: Document | null, selector: string, limit = 12) =>
          root
            ? [...root.querySelectorAll(selector)]
                .map((node) => (node.textContent ?? "").trim())
                .filter(Boolean)
                .slice(0, limit)
            : [];
        // Ribbon tabs, whatever each editor calls them.
        const tabs = [
          ...read(scope, "[role='tab']"),
          ...read(scope, "[class*='ribbon'] [class*='tab-item']"),
          ...read(scope, "[class*='menu-tab'], [class*='tabs__item'], [class*='toolbar-tab']"),
        ];
        return {
          fileType: host?.getAttribute("data-file-type"),
          canvasLabel: host?.getAttribute("aria-label"),
          editorLang: scope?.documentElement.lang ?? null,
          shellLang: document.documentElement.lang,
          ribbonTabs: [...new Set(tabs)].slice(0, 14),
          // The shell's own strings at the same moment.
          shellStatusbar: (document.querySelector(".shell-statusbar")?.textContent ?? "").trim().slice(0, 80),
          shellSidebar: [...document.querySelectorAll(".shell-sidebar-item")].map((n) => (n.textContent ?? "").trim()),
        };
      });
      console.log(`[S4][language ${type}] ${JSON.stringify(said)}`);
    }
  });

  /** Which ancestor lets the workbook's bottom bar escape `.shell-canvas`. */
  test("C10: the workbook's escape route out of the canvas", async ({ page }) => {
    requireBridge();
    await page.setViewportSize({ width: 1440, height: 900 });
    await load(page, combo({ mode: "editor", home: false, navCollapsed: false }));
    await page.locator(".shell-tab-name", { hasText: "sales-report" }).first().click();
    await page.waitForTimeout(3500);

    const chain = await page.evaluate(() => {
      const start = document.querySelector(".sm-sheet-tab-container");
      if (!start) return null;
      const out: unknown[] = [];
      for (let node: Element | null = start; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        const r = node.getBoundingClientRect();
        out.push({
          node: `${node.tagName.toLowerCase()}.${typeof node.className === "string" ? node.className : ""}`.slice(0, 60),
          position: style.position,
          overflow: `${style.overflow}/${style.overflowY}`,
          height: style.height,
          rect: { top: Math.round(r.top), bottom: Math.round(r.bottom) },
        });
        if (node.id === "shell") break;
      }
      return out;
    });
    console.log(`[S4][sheet-chain] ${JSON.stringify(chain, null, 1)}`);
  });
});
